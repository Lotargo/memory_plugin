// Reviewed single-directive transfer. Notebook files and source links publish
// together through the same SQL ledger/recovery journal as project operations.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { MEMORY_DIR, GLOBAL_KEY, readMemory, storeFilePath, memoryFileName, buildMemoryContent } from '../memory.js';
import { factMeta, factBody, parseFactEntry, isDirectiveFact, withMeta } from '../fact_format.js';
import { getDatabase, BLOBS_DIR } from '../db/database.js';
import { assertLocalMemoryReady, getConfig } from '../config/config_manager.js';
import { withSnapshotLock } from '../storage/snapshot_lock.js';
import { commitKnowledge } from '../storage/knowledge_recovery.js';
import { hasKnowledgeSchema, factNode, rebuildLinkProjections } from '../storage/knowledge_schema.js';
import { listNotebookTargets, readNotebook, serviceError } from './notebook_service.js';
import { syncPersonaPrompts } from '../prompt_manager.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, text) => { throw serviceError(code, text); };
const fileContent = key => fs.existsSync(storeFilePath(key)) ? fs.readFileSync(storeFilePath(key), 'utf8') : null;
const normalizedBody = line => factBody(line).toLowerCase().trim();

function validate(input) {
  const allowed = ['action', 'sourceKey', 'targetKey', 'ref', 'expectedSourceVersion', 'expectedTargetVersion',
    'shareSources', 'previewToken', 'confirm', 'confirmShare'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) fail('INVALID', 'Unknown directive transfer field.');
  if (!['targets', 'preview', 'apply'].includes(input.action)) fail('INVALID', 'Unknown directive transfer action.');
  for (const flag of ['shareSources', 'confirm', 'confirmShare']) if (input[flag] !== undefined && typeof input[flag] !== 'boolean') fail('INVALID', `${flag} must be boolean.`);
  for (const field of ['sourceKey', 'targetKey', 'ref', 'expectedSourceVersion', 'expectedTargetVersion', 'previewToken']) {
    if (input[field] !== undefined && (typeof input[field] !== 'string' || !input[field] || input[field].length > 4096 || /[\x00-\x1f]/.test(input[field]))) fail('INVALID', `Invalid ${field}.`);
  }
  if (input.action === 'targets') {
    if (Object.keys(input).some(key => key !== 'action')) fail('INVALID', 'targets takes no other fields.');
  } else {
    for (const field of ['sourceKey', 'targetKey', 'ref', 'expectedSourceVersion', 'expectedTargetVersion']) if (!input[field]) fail('INVALID', `Explicit ${field} is required.`);
    if (input.sourceKey === input.targetKey) fail('INVALID', 'Source and target must differ.');
  }
}

function dependencies(sql, sourceKey, id, text) {
  // Include unresolved links that might address the same assertion. Never
  // guess their ownership from a matching body or migrate on a preview.
  const links = sql.prepare('SELECT * FROM knowledge_links WHERE fact_key=? ORDER BY id').all(sourceKey)
    .filter(link => id && link.fact_id === id || !link.fact_id && [text.body, text.full].includes(link.fact_text));
  const documents = [...new Set(links.map(link => link.doc_id))].map(docId => ({
    docId,
    doc: sql.prepare('SELECT * FROM documents WHERE id=?').get(docId) || null,
    scopes: sql.prepare('SELECT * FROM document_scopes WHERE doc_id=? ORDER BY scope_key').all(docId),
  }));
  // All graph edges are included in the approval stamp: changing independent
  // edges during review cannot bypass the manual-edge guard at publication.
  const edges = sql.prepare('SELECT * FROM graph_edges ORDER BY source_id,target_id,relation_type').all();
  return { links, documents, edges };
}

async function prepare(db, input) {
  if (!hasKnowledgeSchema(db)) fail('MIGRATION_REQUIRED', 'Prepare knowledge links before transferring directives. No migration is performed by preview.');
  const source = await readNotebook({ key: input.sourceKey }), target = await readNotebook({ key: input.targetKey });
  if (source.readOnly || target.readOnly) fail('UNSUPPORTED', 'Choose two writable Notebook stores; knowledge-only scopes require Git registration.');
  if (source.version !== input.expectedSourceVersion || target.version !== input.expectedTargetVersion) fail('CONFLICT', 'Source or target Notebook/links changed. Reload and review both stores.');
  const matches = source.records.map((record, index) => ({ record, index })).filter(item => item.record.ref === input.ref);
  if (matches.length !== 1) fail('CONFLICT', 'Source reference is missing or ambiguous. Select the directive again.');
  const { record, index } = matches[0], sourceEntries = await readMemory(input.sourceKey), targetEntries = await readMemory(input.targetKey);
  const line = sourceEntries[index], meta = factMeta(line);
  if (!parseFactEntry(line) || !isDirectiveFact(line)) fail('UNSUPPORTED', 'Only a valid directive, including recognized legacy persona tags, can be transferred.');
  const conflicts = [], idSet = new Set(targetEntries.map(line => factMeta(line).id).filter(Boolean));
  if (idSet.size !== targetEntries.filter(line => factMeta(line).id).length) conflicts.push({ reason: 'ambiguous-target-ids' });
  const duplicate = target.records.filter((_, i) => normalizedBody(targetEntries[i]) === normalizedBody(line));
  if (duplicate.length) conflicts.push({ reason: 'duplicate-body', records: duplicate.map(item => ({ ref: item.ref, title: item.title })) });
  const history = !!(meta.supersedes || meta.supersededBy) || !!meta.id && sourceEntries.some((other, i) => i !== index &&
    ['supersedes', 'supersededBy'].some(field => factMeta(other)[field] === meta.id));
  if (history) conflicts.push({ reason: 'replacement-history', message: 'A single move cannot split a scope-local replacement chain.' });
  let targetId = meta.id;
  if (!targetId || idSet.has(targetId)) {
    let attempt = 0;
    do { targetId = `f_${hash([input.sourceKey, input.targetKey, input.ref, source.version, target.version, attempt++]).slice(0, 32)}`; } while (idSet.has(targetId));
  }
  if (targetEntries.some(other => ['supersedes', 'supersededBy'].some(field => factMeta(other)[field] === targetId))) conflicts.push({ reason: 'target-history-reference' });
  const sql = db.localDb, deps = dependencies(sql, input.sourceKey, meta.id, { body: factBody(line), full: parseFactEntry(line).text });
  if (deps.links.some(link => !link.fact_id)) conflicts.push({ reason: 'unresolved-source-links' });
  const sources = deps.documents.map(({ docId, doc, scopes }) => {
    const sourceVisible = scopes.some(scope => [GLOBAL_KEY, input.sourceKey].includes(scope.scope_key));
    const targetVisible = scopes.some(scope => [GLOBAL_KEY, input.targetKey].includes(scope.scope_key));
    if (!doc || !sourceVisible) conflicts.push({ reason: 'source-unavailable', docId });
    if (!targetVisible && !input.shareSources) conflicts.push({ reason: 'source-not-visible-in-target', docId });
    return { docId, title: sourceVisible ? doc?.title : null, scopes: scopes.map(scope => scope.scope_key),
      addScope: !targetVisible && input.shareSources === true ? input.targetKey : null,
      contentRevision: doc?.content_revision || null };
  });
  const oldNode = meta.id ? factNode(input.sourceKey, meta.id) : null, newNode = factNode(input.targetKey, targetId);
  const manualEdges = deps.edges.filter(edge => {
    let details; try { details = JSON.parse(edge.metadata_json || '{}'); } catch { details = {}; }
    return details.knowledgeProjection !== true && [oldNode, newNode].filter(Boolean).some(node => [edge.source_id, edge.target_id].includes(node));
  });
  if (manualEdges.length) conflicts.push({ reason: 'independent-graph-edges', count: manualEdges.length });
  // Old text-based projections are removed only when tied to an exact moved
  // link ID and its recorded endpoints; unrelated legacy edges block the move.
  const legacyNodes = new Set([factBody(line), parseFactEntry(line).text, ...deps.links.map(link => link.fact_text)]
    .map(text => `fact:${input.sourceKey}:${text.slice(0, 30)}`));
  const legacyEdges = deps.edges.filter(edge => legacyNodes.has(edge.source_id) || legacyNodes.has(edge.target_id));
  const ownedLegacyEdges = legacyEdges.filter(edge => {
    let details; try { details = JSON.parse(edge.metadata_json || '{}'); } catch { return false; }
    return deps.links.some(link => link.id === details.linkId && legacyNodes.has(edge.source_id) && edge.relation_type === link.relation_type &&
      edge.target_id === (link.start_line ? `${link.doc_id}:L${link.start_line}-${link.end_line || link.start_line}` : link.doc_id));
  });
  if (legacyEdges.length !== ownedLegacyEdges.length) conflicts.push({ reason: 'independent-legacy-graph-edges' });
  const sourceContent = fileContent(input.sourceKey), targetContent = fileContent(input.targetKey), movedLine = withMeta(line, { id: targetId });
  const previewToken = hash([input.sourceKey, input.targetKey, input.ref, source.version, target.version,
    sourceContent, targetContent, input.shareSources === true, targetId, deps, getConfig().mode]);
  return { sourceContent, targetContent, deps, ownedLegacyEdges, movedLine,
    sourceEntries: sourceEntries.filter((_, i) => i !== index), targetEntries: [...targetEntries, movedLine],
    preview: { source: { key: input.sourceKey, name: source.target.name, ref: input.ref, version: source.version },
      target: { key: input.targetKey, name: target.target.name, ref: `id:${targetId}`, version: target.version },
      directive: record, idChange: { from: meta.id || null, to: targetId, changed: targetId !== meta.id },
      links: deps.links.map(link => ({ id: link.id, docId: link.doc_id, status: link.status })), sources,
      sharingGlobal: sources.some(source => source.addScope === GLOBAL_KEY), conflicts, canApply: !conflicts.length,
      effects: ['Remove only this directive from its source; append it to the selected target.',
        'Keep date, TTL, protection, disabled state and metadata. Move its source links; keep document scopes already present.',
        'Create a verified pinned local ZIP before publishing both Notebook files and links together.',
        'Existing agent sessions may retain old context; active-session delivery and agent usage are not observed.'],
      previewToken, observedAt: new Date().toISOString() } };
}

export async function directiveTransferRequest(input, { afterCommit } = {}) {
  validate(input); assertLocalMemoryReady();
  const { CloudSnapshots } = await import('../admin/cloud_snapshots.js');
  const checkpoints = new CloudSnapshots();
  const work = () => withSnapshotLock(MEMORY_DIR, async () => {
    if (input.action === 'targets') return { items: await listNotebookTargets(), observedAt: new Date().toISOString() };
    const db = await getDatabase(), prepared = await prepare(db, input), { preview } = prepared;
    if (input.action === 'preview') return preview;
    if (input.confirm !== true) fail('CONFIRMATION', 'Review and confirm the directive transfer.');
    if (preview.previewToken !== input.previewToken) fail('CONFLICT', 'Transfer preview is stale. Review it again.');
    if (!preview.canApply) fail('CONFLICT', 'Resolve the conflicts shown in the transfer preview.');
    if (preview.sources.some(source => source.addScope) && input.confirmShare !== true) fail('CONFIRMATION', 'Separately confirm opening the listed sources to the target scope.');
    const { captureLocal } = await import('../admin/full_snapshot.js');
    const payload = captureLocal(db, MEMORY_DIR, BLOBS_DIR, getConfig());
    const backup = await checkpoints.store(payload, checkpoints.state(), { force: true, pinned: true, source: 'directive-before-transfer' });
    await checkpoints.load(backup.id, 'local');
    const current = await prepare(db, input);
    if (current.preview.previewToken !== preview.previewToken) fail('CONFLICT', 'Transfer data changed during backup preparation. Review again.');
    const operationId = await commitKnowledge(MEMORY_DIR, db, [
      { file: memoryFileName(input.sourceKey), content: buildMemoryContent(input.sourceKey, prepared.sourceEntries) },
      { file: memoryFileName(input.targetKey), content: buildMemoryContent(input.targetKey, prepared.targetEntries) },
    ], sql => {
      if (fileContent(input.sourceKey) !== prepared.sourceContent || fileContent(input.targetKey) !== prepared.targetContent ||
        hash(dependencies(sql, input.sourceKey, preview.idChange.from, { body: preview.directive.body, full: parseFactEntry(prepared.movedLine).text })) !== hash(prepared.deps)) fail('CONFLICT', 'Notebook or dependencies changed before publication.');
      for (const source of preview.sources.filter(source => source.addScope)) sql.prepare('INSERT INTO document_scopes (doc_id,scope_key,created_at) VALUES (?,?,?)').run(source.docId, source.addScope, Date.now());
      for (const link of prepared.deps.links) sql.prepare('UPDATE knowledge_links SET fact_key=?,fact_id=? WHERE id=? AND fact_key=?').run(input.targetKey, preview.idChange.to, link.id, input.sourceKey);
      for (const edge of prepared.ownedLegacyEdges) sql.prepare('DELETE FROM graph_edges WHERE source_id=? AND target_id=? AND relation_type=?').run(edge.source_id, edge.target_id, edge.relation_type);
      rebuildLinkProjections(sql);
    }, { afterCommit });
    let persona = [], status = 'saved';
    if ([input.sourceKey, input.targetKey].includes(GLOBAL_KEY)) {
      if (process.env.MEMORY_DISABLE_PERSONA_SYNC === '1') persona = [{ status: 'disabled_by_environment' }];
      else try { persona = await syncPersonaPrompts(); if (persona.some(item => item.status === 'failed')) status = 'partial'; }
      catch { status = 'partial'; persona = [{ status: 'failed' }]; }
    }
    return { status, sourceKey: input.sourceKey, targetKey: input.targetKey, ref: preview.target.ref, operationId,
      movedLinks: prepared.deps.links.length, sharedSources: preview.sources.filter(source => source.addScope).map(source => source.docId),
      backup: checkpoints.archivePath(backup.id), backupId: backup.id, persona,
      contextNotice: 'Existing agent sessions may retain old context; refresh the client context.' };
  });
  return input.action === 'apply' ? checkpoints.lock(work) : work();
}
