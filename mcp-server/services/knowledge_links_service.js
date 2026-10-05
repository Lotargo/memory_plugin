import fs from 'node:fs';
import { join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getDatabase, BLOBS_DIR } from '../db/database.js';
import { MEMORY_DIR, readMemory, memoryFileName, buildMemoryContent, extractFacts, storeFilePath, notebookVersion } from '../memory.js';
import { factMeta, factBody, factTitle, parseFactEntry, withMeta } from '../fact_format.js';
import { withSnapshotLock, atomicWrite } from '../storage/snapshot_lock.js';
import { createKnowledgeSchema, hasKnowledgeSchema, rebuildLinkProjections, KNOWLEDGE_COLUMNS } from '../storage/knowledge_schema.js';
import { commitKnowledge } from '../storage/knowledge_recovery.js';
import { listNotebookTargets, serviceError } from './notebook_service.js';
import { getConfig, assertLocalMemoryReady } from '../config/config_manager.js';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unique = (entries, id) => entries.filter(line => factMeta(line).id === id);
function identityLines(entries) {
  return entries.map(line => parseFactEntry(line) && !factMeta(line).id ? withMeta(line, { ...factMeta(line), id: `f_${randomUUID().replaceAll('-', '')}` }) : line);
}
function removeLegacyProjections(sql, links) {
  for (const edge of sql.prepare('SELECT * FROM graph_edges').all()) {
    let meta; try { meta = JSON.parse(edge.metadata_json || '{}'); } catch { continue; }
    const link = links.find(row => row.id === meta.linkId);
    const target = link && (link.start_line ? `${link.doc_id}:L${link.start_line}-${link.end_line || link.start_line}` : link.doc_id);
    if (link && edge.source_id === `fact:${link.fact_key}:${link.fact_text.substring(0, 30)}` && edge.target_id === target && edge.relation_type === link.relation_type) sql.prepare('DELETE FROM graph_edges WHERE source_id=? AND target_id=? AND relation_type=?').run(edge.source_id, edge.target_id, edge.relation_type);
  }
}
export async function migrateKnowledge({ afterCommit } = {}) {
  assertLocalMemoryReady();
  return withSnapshotLock(MEMORY_DIR, async () => {
    const db = await getDatabase();
    const targets = await listNotebookTargets();
    if (targets.some(target => target.unavailable)) throw serviceError('UNSUPPORTED', 'Repair Notebook identities before migration.');
    const stores = new Map(), originals = new Map(), files = [], report = { status: 'migrated', schema: 2, assignedIds: 0, resolvedLinks: [], needsReview: [] };
    for (const target of targets) {
      const old = await readMemory(target.key), entries = identityLines(old); stores.set(target.key, entries);
      const original = fs.existsSync(storeFilePath(target.key)) ? fs.readFileSync(storeFilePath(target.key), 'utf8') : null;
      originals.set(target.key, original);
      report.assignedIds += entries.filter((line, index) => line !== old[index]).length;
      if (entries.some((line, index) => line !== old[index])) {
        let index = 0;
        files.push({ file: memoryFileName(target.key), content: original.split('\n').map(line => line.startsWith('- [') ? entries[index++] : line).join('\n') });
      }
    }
    const { captureLocal, packPayload, unpackPayload, sha256, stateHash } = await import('../admin/full_snapshot.js');
    const directory = join(MEMORY_DIR, '.knowledge-backups'); fs.mkdirSync(directory, { recursive: true });
    report.backup = join(directory, `${Date.now()}-${randomUUID()}.zip`);
    const backupPayload = captureLocal(db, MEMORY_DIR, BLOBS_DIR, getConfig()), backupBytes = await packPayload(backupPayload);
    atomicWrite(report.backup, backupBytes);
    await unpackPayload(fs.readFileSync(report.backup), sha256(backupBytes), stateHash(backupPayload));
    const reportFile = { file: `.knowledge-backups/${basename(report.backup)}.report.json`, content: '' };
    // Resolve the report before serializing the journal, so recovery publishes
    // the same migration report even after interruption immediately after SQL.
    const legacyLinks = db.localDb.prepare('SELECT * FROM knowledge_links').all();
    const resolutions = new Map();
    for (const link of legacyLinks.filter(row => !row.fact_id)) {
      const entries = stores.get(link.fact_key) || [];
      const matches = entries.filter(line => factBody(line) === link.fact_text || parseFactEntry(line)?.text === link.fact_text);
      const id = matches.length === 1 ? factMeta(matches[0]).id : null;
      const resolved = id && unique(entries, id).length === 1;
      resolutions.set(link.id, resolved ? id : null);
      (resolved ? report.resolvedLinks : report.needsReview).push({ linkId: link.id, reason: resolved ? 'legacy-source-revision-unknown' : matches.length ? 'ambiguous-fact' : 'fact-not-found' });
    }
    reportFile.content = JSON.stringify(report, null, 2);
    await commitKnowledge(MEMORY_DIR, db, [...files, reportFile], sql => {
      for (const [key, original] of originals) {
        const current = fs.existsSync(storeFilePath(key)) ? fs.readFileSync(storeFilePath(key), 'utf8') : null;
        if (current !== original) throw serviceError('CONFLICT', 'Notebook changed during migration preparation.');
      }
      createKnowledgeSchema(sql);
      const links = sql.prepare('SELECT * FROM knowledge_links').all();
      if (hash(links.map(({ fact_id, revision, status, source_revision, ...legacy }) => legacy)) !== hash(legacyLinks.map(({ fact_id, revision, status, source_revision, ...legacy }) => legacy))) throw serviceError('CONFLICT', 'Links changed during migration preparation.');
      removeLegacyProjections(sql, links);
      for (const link of links) {
        if (link.fact_id) continue;
        sql.prepare("UPDATE knowledge_links SET fact_id=?,status='needs_review',source_revision=NULL WHERE id=?").run(resolutions.get(link.id), link.id);
      }
      rebuildLinkProjections(sql);
    }, { afterCommit });
    return report;
  });
}

// Shared by every Notebook writer, including older CLI/MCP/TUI callers. The
// existing snapshot lock serializes the entire read/check/journal/commit cycle.
export async function persistNotebookKnowledge(key, content, { afterCommit } = {}) {
  const db = await getDatabase();
  if (!hasKnowledgeSchema(db)) return false;
  const originalContent = fs.existsSync(storeFilePath(key)) ? fs.readFileSync(storeFilePath(key), 'utf8') : null;
  const old = extractFacts(originalContent);
  const original = extractFacts(content), next = identityLines(original);
  let index = 0;
  const nextContent = content.split('\n').map(line => line.startsWith('- [') ? next[index++] : line).join('\n');
  await commitKnowledge(MEMORY_DIR, db, [{ file: memoryFileName(key), content: nextContent }], sql => {
    const current = fs.existsSync(storeFilePath(key)) ? fs.readFileSync(storeFilePath(key), 'utf8') : null;
    if (current !== originalContent) throw serviceError('CONFLICT', 'Notebook changed during preparation.');
    for (const link of sql.prepare('SELECT * FROM knowledge_links WHERE fact_key=?').all(key)) {
      if (!link.fact_id) {
        const before = old.filter(line => factBody(line) === link.fact_text || parseFactEntry(line)?.text === link.fact_text);
        const after = next.filter(line => factBody(line) === link.fact_text || parseFactEntry(line)?.text === link.fact_text);
        if (before.length && after.length !== before.length) throw serviceError('CONFLICT', 'An unresolved legacy link targets this text. Repair or remove that link before editing the fact.');
        continue;
      }
      const before = unique(old, link.fact_id), after = unique(next, link.fact_id);
      if (before.length !== 1 || after.length > 1) throw serviceError('CONFLICT', 'A linked fact identity is missing or ambiguous. Review links before writing.');
      if (!after.length) sql.prepare('DELETE FROM knowledge_links WHERE id=?').run(link.id);
      else if (link.fact_text !== factBody(after[0])) sql.prepare('UPDATE knowledge_links SET fact_text=? WHERE id=?').run(factBody(after[0]), link.id);
    }
    rebuildLinkProjections(sql);
  }, { afterCommit });
  return { entries: next };
}

function documentState(sql, key, id, ownedLink = false) {
  if (typeof id !== 'string' || !id) throw serviceError('INVALID', 'docId is required.');
  const visible = sql.prepare(`SELECT * FROM documents d WHERE id=? AND EXISTS (SELECT 1 FROM document_scopes ds WHERE ds.doc_id=d.id AND ds.scope_key IN (?, 'global'))`).get(id, key);
  if (!visible && !ownedLink) throw serviceError('NOT_FOUND', 'Document is not visible to this fact.');
  const source = visible || sql.prepare('SELECT * FROM documents WHERE id=?').get(id) || null;
  const row = visible || { id, title: 'Недоступный источник', content_revision: null };
  const scopes = sql.prepare('SELECT ds.scope_key,r.generation FROM document_scopes ds LEFT JOIN knowledge_scope_revisions r ON ds.scope_key=r.scope_key WHERE ds.doc_id=? ORDER BY ds.scope_key').all(id);
  const epoch = sql.prepare("SELECT key,value FROM sync_state WHERE key IN ('snapshot_restore_id','knowledge_import_epoch') ORDER BY key").all();
  return { row, version: hash([source, scopes, epoch]) };
}
function requireFact(entries, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('id:')) throw serviceError('INVALID', 'A stable id: fact reference is required.');
  const id = ref.slice(3), matches = unique(entries, id);
  if (matches.length !== 1) throw serviceError('CONFLICT', 'Fact ID is missing or ambiguous.');
  return { id, line: matches[0] };
}
export function resolvedLinkState(sql, link) {
  const doc = sql.prepare('SELECT * FROM documents WHERE id=?').get(link.doc_id);
  const sameRevision = link.source_revision != null && doc?.content_revision === link.source_revision;
  const visible = !!sql.prepare("SELECT 1 FROM document_scopes WHERE doc_id=? AND scope_key IN (?, 'global') LIMIT 1").get(link.doc_id, link.fact_key);
  const sectionValid = !link.section_id || !!sql.prepare('SELECT id FROM sections WHERE id=? AND doc_id=?').get(link.section_id, link.doc_id);
  const status = !doc || !sectionValid ? 'orphaned' : link.fact_id && sameRevision && visible ? link.status : 'needs_review';
  return { status, coordinatesConfirmed: status === 'valid' && !!link.start_line,
    reason: !visible ? 'target-not-visible' : !link.fact_id ? 'ambiguous-or-missing-fact' : !sameRevision ? 'source-revision-unknown-or-changed' : !sectionValid ? 'section-missing' : status === 'needs_review' ? 'review-required' : 'confirmed-document-revision' };
}
function linkProjection(sql, row, entries) {
  return { linkId: row.id, factKey: row.fact_key, factRef: row.fact_id ? `id:${row.fact_id}` : null,
    factText: row.fact_text, docId: row.doc_id, sectionId: row.section_id, startLine: row.start_line, endLine: row.end_line,
    relationType: row.relation_type, revision: row.revision, version: hash(row), ...resolvedLinkState(sql, row),
    ...(entries && (!row.fact_id || unique(entries, row.fact_id).length !== 1) ? { status: 'needs_review', coordinatesConfirmed: false, reason: 'ambiguous-or-missing-fact' } : {}) };
}
const mutationFields = new Set(['factRef', 'docId', 'sectionId', 'startLine', 'endLine', 'relationType']);
function validateFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(key => !mutationFields.has(key))) throw serviceError('INVALID', 'Unknown link fields.');
  const relationType = fields.relationType || 'LINKS_TO';
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(relationType) || ['CONTAINS', 'PARENT_OF', 'HAS_SECTION', 'HAS_CHUNK'].includes(relationType)) throw serviceError('INVALID', 'A manual link relation is required.');
  const startLine = fields.startLine ?? null, endLine = fields.endLine ?? startLine;
  if (startLine !== null && (!Number.isSafeInteger(startLine) || startLine < 1 || !Number.isSafeInteger(endLine) || endLine < startLine)) throw serviceError('INVALID', 'Invalid line range.');
  if (startLine === null && endLine !== null) throw serviceError('INVALID', 'startLine is required for a line range.');
  if (fields.sectionId != null && (typeof fields.sectionId !== 'string' || !fields.sectionId)) throw serviceError('INVALID', 'Invalid sectionId.');
  if (fields.sectionId && startLine !== null) throw serviceError('UNSUPPORTED', 'Section/raw line coordinates have not been verified. Choose a section or a raw line range, not both.');
  return { ...fields, sectionId: fields.sectionId || null, startLine, endLine, relationType };
}

export async function manageKnowledgeLinks(input) {
  assertLocalMemoryReady();
  return withSnapshotLock(MEMORY_DIR, async () => {
    const db = await getDatabase(), sql = db.localDb;
    if (input.action === 'migration-status') return { schema: hasKnowledgeSchema(db) ? 2 : 1, mutationAvailable: hasKnowledgeSchema(db) };
    if (!hasKnowledgeSchema(db)) throw serviceError('MIGRATION_REQUIRED', 'Run memory-cli knowledge migrate after reviewing the backup requirement.');
    const key = input.scopeKey;
    if (typeof key !== 'string' || !(await listNotebookTargets()).some(target => target.key === key && !target.unavailable)) throw serviceError('NOT_FOUND', 'Unknown scope key.');
    const entries = await readMemory(key);
    if (input.action === 'list') {
      const clauses = ['fact_key=?'], values = [key];
      if (input.factRef) { const fact = requireFact(entries, input.factRef); clauses.push('fact_id=?'); values.push(fact.id); }
      if (input.docId) { documentState(sql, key, input.docId); clauses.push('doc_id=?'); values.push(input.docId); }
      const rows = sql.prepare(`SELECT * FROM knowledge_links WHERE ${clauses.join(' AND ')} ORDER BY id LIMIT 501`).all(...values);
      return { items: rows.slice(0, 500).map(row => linkProjection(sql, row, entries)), truncated: rows.length > 500, notebookVersion: notebookVersion(entries) };
    }
    if (!['preview', 'apply'].includes(input.action) || !['create', 'update', 'delete'].includes(input.operation)) throw serviceError('INVALID', 'Unknown link action.');
    const previous = input.operation === 'create' ? null : sql.prepare('SELECT * FROM knowledge_links WHERE id=? AND fact_key=?').get(input.linkId, key);
    if (input.operation !== 'create' && !previous) throw serviceError('NOT_FOUND', 'Link is not owned by the selected scope.');
    const fields = input.operation === 'delete' ? null : validateFields(input.fields);
    const fact = fields ? requireFact(entries, fields.factRef) : null;
    const doc = documentState(sql, key, fields?.docId || previous.doc_id, input.operation === 'delete');
    if (fields?.sectionId && !sql.prepare('SELECT id FROM sections WHERE id=? AND doc_id=?').get(fields.sectionId, fields.docId)) throw serviceError('INVALID', 'Section is not in this document.');
    let sourceExcerpt = null;
    if (fields?.startLine) {
      const { readBlob } = await import('../storage/blob_store.js');
      const source = await readBlob(doc.row.blob_hash, BLOBS_DIR);
      const lines = source.replace(/\r\n?/g, '\n').split('\n');
      if (fields.endLine > lines.length) throw serviceError('INVALID', 'Line range is outside the saved source.');
      sourceExcerpt = lines.slice(fields.startLine - 1, fields.endLine).join('\n').slice(0, 2000);
    }
    // Include the prior target too: moving a link cannot reuse approval after
    // either source or scope membership has changed.
    const priorDoc = previous ? documentState(sql, key, previous.doc_id, true) : null;
    const token = hash([input.operation, key, input.linkId || null, fields, notebookVersion(entries), previous, doc.version, priorDoc?.version]);
    const preview = { operation: input.operation, scopeKey: key, linkId: previous?.id || null,
      factTitle: fact ? factTitle(fact.line) : previous.fact_text, documentTitle: doc.row.title || doc.row.id, sourceExcerpt,
      factRef: fields?.factRef || (previous?.fact_id ? `id:${previous.fact_id}` : null),
      docId: doc.row.id, sourceRevision: doc.row.content_revision,
      effects: input.operation === 'delete' ? ['Remove this link and its graph projection. Keep the fact and document.'] : ['Bind this fact identity to the selected saved document revision.'],
      previewToken: token, notebookVersion: notebookVersion(entries), link: previous ? linkProjection(sql, previous) : null, fields };
    if (input.action === 'preview') return preview;
    if (typeof input.previewToken !== 'string' || input.previewToken !== token) throw serviceError('CONFLICT', 'Link preview is stale. Review a fresh preview.');
    const id = previous?.id || `link_${randomUUID()}`;
    await commitKnowledge(MEMORY_DIR, db, [], transaction => {
      if (documentState(transaction, key, doc.row.id, input.operation === 'delete').version !== doc.version || (priorDoc && documentState(transaction, key, priorDoc.row.id, true).version !== priorDoc.version)) throw serviceError('CONFLICT', 'Source changed during link preparation.');
      const currentEntries = fs.existsSync(storeFilePath(key)) ? extractFacts(fs.readFileSync(storeFilePath(key), 'utf8')) : [];
      if (notebookVersion(currentEntries) !== notebookVersion(entries)) throw serviceError('CONFLICT', 'Notebook changed during link preparation.');
      if (input.operation === 'delete') transaction.prepare('DELETE FROM knowledge_links WHERE id=? AND fact_key=?').run(id, key);
      else if (input.operation === 'create') transaction.prepare(`INSERT INTO knowledge_links
        (id,fact_key,fact_id,fact_text,doc_id,section_id,start_line,end_line,relation_type,created_at,status,source_revision)
        VALUES (?,?,?,?,?,?,?,?,?,?,'valid',?)`).run(id, key, fact.id, factBody(fact.line), fields.docId, fields.sectionId, fields.startLine, fields.endLine, fields.relationType, Date.now(), doc.row.content_revision);
      else transaction.prepare(`UPDATE knowledge_links SET fact_id=?,fact_text=?,doc_id=?,section_id=?,start_line=?,end_line=?,relation_type=?,status='valid',source_revision=? WHERE id=?`)
        .run(fact.id, factBody(fact.line), fields.docId, fields.sectionId, fields.startLine, fields.endLine, fields.relationType, doc.row.content_revision, id);
      rebuildLinkProjections(transaction);
    });
    return { status: 'saved', operation: input.operation, linkId: id, link: input.operation === 'delete' ? null : linkProjection(sql, sql.prepare('SELECT * FROM knowledge_links WHERE id=?').get(id)) };
  });
}
