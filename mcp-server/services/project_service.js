// Git identity administration shared by HTTP, CLI, MCP and OpenCode.
// Preview is read-only; publication joins registry/RAG changes and Notebook
// files through the existing SQL ledger + recovery journal.
import fs from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { MEMORY_DIR, canonicalPath, memoryFileName, listProjectStores, extractFacts, buildMemoryContent } from '../memory.js';
import { getDatabase, BLOBS_DIR } from '../db/database.js';
import { resolveProjectIdentity, bustIdentityCache, normalizeRemoteUrl } from '../identity.js';
import { factBody, factMeta, withMeta, parseFactEntry } from '../fact_format.js';
import { assertLocalMemoryReady, getConfig } from '../config/config_manager.js';
import { withSnapshotLock } from '../storage/snapshot_lock.js';
import { commitKnowledge } from '../storage/knowledge_recovery.js';
import { createKnowledgeSchema, rebuildLinkProjections } from '../storage/knowledge_schema.js';
import { serviceError } from './notebook_service.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (code, text) => { throw serviceError(code, text); };
const textKey = line => factBody(line).toLowerCase().trim();
const withoutId = line => withMeta(line, { id:null });
function sqlStamp(sql) {
  return hash(['project_identities','project_aliases','documents','document_scopes','knowledge_links','graph_edges','sync_state'].map(table =>
    sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
}

async function gitAt(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) failure('INVALID', 'Select an existing absolute directory path.');
  bustIdentityCache();
  const identity = await resolveProjectIdentity(directory);
  if (!identity) failure('INVALID', 'No Git repository detected. Project memory requires Git.');
  return identity;
}
function remoteKey(remote) {
  const value = normalizeRemoteUrl(remote?.replace(/^git:/, ''));
  if (!value || /[\s\x00-\x1f<>]/.test(value) || !value.includes('/') || value.startsWith('/') || value.startsWith('local:')) failure('INVALID', 'Use a repository remote URL or an existing target project.');
  return `git:${value}`;
}
async function catalog(sql) {
  const identities = sql.prepare('SELECT * FROM project_identities ORDER BY key').all();
  const aliases = sql.prepare('SELECT * FROM project_aliases ORDER BY alias').all();
  const stores = await listProjectStores();
  const scopes = sql.prepare('SELECT DISTINCT scope_key FROM document_scopes ORDER BY scope_key').all();
  const keys = [...new Set([...identities.map(i => i.key), ...stores.map(i => i.key), ...scopes.map(i => i.scope_key)])].filter(k => k !== 'global');
  return { identities, aliases, stores, items: keys.map(key => {
    const identity = identities.find(i => i.key === key), matches = stores.filter(i => i.key === key);
    return { key, name: identity?.name || matches[0]?.basename || key, primaryRemote: identity?.primary_remote || null,
      legacy: !key.startsWith('git:'), aliases: aliases.filter(a => a.identity_key === key),
      facts: matches.reduce((n, s) => n + s.count, 0), documents: sql.prepare('SELECT count(*) AS n FROM document_scopes WHERE scope_key=?').get(key).n,
      unavailable: matches.length > 1 ? 'Multiple files claim this scope.' : null };
  }) };
}
function fileState(key, stores) {
  const matches = stores.filter(s => s.key === key);
  if (matches.length > 1) failure('CONFLICT', 'Multiple Notebook files claim the selected scope. Repair the conflicting headers first.');
  const file = matches[0]?.file || memoryFileName(key);
  // Never read a differently owned file through a slug collision.
  if (stores.some(s => s.key !== key && s.file === file)) failure('CONFLICT', 'Notebook filename belongs to another scope.');
  const path = join(MEMORY_DIR, file), content = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : null;
  return { key, file, content, entries: extractFacts(content) };
}
function mergeFacts(source, target) {
  const entries = [...target], matches = [], conflicts = [], idMap = new Map(), addedRows=[];
  const idSet = new Set(target.map(line => factMeta(line).id).filter(Boolean));
  if (idSet.size !== target.filter(line => factMeta(line).id).length) conflicts.push({ reason: 'duplicate-target-id' });
  const sourceIds = source.map(line => factMeta(line).id).filter(Boolean);
  if (new Set(sourceIds).size !== sourceIds.length) conflicts.push({ reason: 'duplicate-source-id' });
  let added = 0, assignedIds = 0;
  for (let index = 0; index < source.length; index++) {
    const line = source[index], meta = factMeta(line), same = entries.filter(other => textKey(other) === textKey(line));
    if (!parseFactEntry(line)) { conflicts.push({ reason: 'invalid-fact', index }); continue; }
    if (same.length) {
      // Duplicate text with a different directive/TTL/title/keep is a conflict,
      // never a reason to silently discard a durable instruction or metadata.
      if (same.length !== 1 || withoutId(same[0]) !== withoutId(line)) { conflicts.push({ reason: 'same-text-different-record', index, title: parseFactEntry(line).title || factBody(line).slice(0, 120) }); continue; }
      const id = factMeta(same[0]).id;
      matches.push({ index, targetId: id || null });
      idMap.set(meta.id || `legacy:${index}`, id || null); continue;
    }
    let id = meta.id;
    if (!id || idSet.has(id)) { id = `f_${hash([source, target, index]).slice(0, 32)}`; assignedIds++; }
    if (idSet.has(id)) { conflicts.push({ reason: 'generated-id-collision', index }); continue; }
    idSet.add(id); addedRows.push(entries.length); entries.push(withMeta(line, { ...meta, id })); idMap.set(meta.id || `legacy:${index}`, id); added++;
  }
  // The history chain uses scope-local IDs too. Only imported records are
  // rewritten; target history continues pointing to its original target IDs.
  for(const position of addedRows) {
    const meta=factMeta(entries[position]), patch={};
    for(const field of ['supersedes','supersededBy']) if(meta[field] && idMap.has(meta[field])) patch[field]=idMap.get(meta[field]);
    if(Object.keys(patch).length) entries[position]=withMeta(entries[position],patch);
  }
  for(const match of matches) {
    const meta=factMeta(source[match.index]);
    if(['supersedes','supersededBy'].some(field=>meta[field] && idMap.has(meta[field]) && idMap.get(meta[field])!==meta[field]))
      conflicts.push({reason:'duplicate-history-needs-rebinding',index:match.index});
  }
  return { entries, idMap, matches, conflicts, added, assignedIds };
}
async function prepare(sql, input) {
  const data = await catalog(sql), operation = input.operation;
  if (!['link', 'unlink', 'relink', 'migrate', 'purge-identity'].includes(operation)) failure('INVALID', 'Unknown project operation.');
  let identity = null, sourceKey = input.sourceKey || null, targetKey = input.targetKey || null, aliases = [];
  if (operation === 'link') {
    identity = await gitAt(input.directory); targetKey = identity.key;
    if (input.remote && remoteKey(input.remote) !== targetKey) failure('CONFLICT', 'Explicit remote differs from the detected Git identity. Use relink for a memory move.');
    aliases = [{ alias: `path:${canonicalPath(input.directory)}`, kind: 'path' }, { alias: `basename:${identity.name}`, kind: 'basename' }];
    if (identity.primaryRemote) aliases.push({ alias: `remote:${identity.primaryRemote}`, kind: 'remote' });
    // Automatic legacy migration is restricted to this exact directory key.
    const legacyKey = canonicalPath(input.directory);
    if (!sourceKey && (data.stores.some(s => s.key === legacyKey) || data.items.some(s => s.key === legacyKey))) sourceKey = legacyKey;
    if (sourceKey && (sourceKey.startsWith('git:') || !data.items.some(s => s.key === sourceKey))) failure('INVALID', 'Choose a known legacy source for migration.');
  } else if (operation === 'purge-identity') {
    const git = await gitAt(input.directory); sourceKey=git.key;
    if(!data.identities.some(i=>i.key===sourceKey)) failure('NOT_FOUND','Detected Git identity is not registered.');
    if(input.sourceKey && input.sourceKey!==sourceKey) failure('CONFLICT','Git identity differs from the selected identity.');
    aliases=data.aliases.filter(a=>a.identity_key===sourceKey);
  } else if (operation === 'unlink') {
    if (typeof input.directory !== 'string' || !isAbsolute(input.directory)) failure('INVALID', 'An absolute path alias is required.');
    const alias = `path:${canonicalPath(input.directory)}`, previous = data.aliases.find(a => a.alias === alias);
    if (!previous) failure('NOT_FOUND', 'This directory has no registered path alias.');
    sourceKey = previous.identity_key; aliases = [previous];
    if (input.sourceKey && input.sourceKey !== sourceKey) failure('CONFLICT', 'The path alias now belongs to another project.');
  } else {
    if (!sourceKey && input.directory) sourceKey = (await gitAt(input.directory)).key;
    if (!data.items.some(item => item.key === sourceKey)) failure('NOT_FOUND', 'Select an existing source project or legacy store.');
    if (operation === 'migrate' && sourceKey.startsWith('git:')) failure('INVALID', 'Migration requires a legacy source.');
    if (!targetKey && input.remote) targetKey = remoteKey(input.remote);
    if (input.directory && operation === 'migrate') { identity = await gitAt(input.directory); targetKey ||= identity.key; }
    if (!targetKey?.startsWith('git:') || /[\x00-\x1f]/.test(targetKey)) failure('INVALID', 'Target must be a Git project.');
    if (!data.items.some(item => item.key === targetKey) && identity?.key !== targetKey && !input.remote) failure('NOT_FOUND', 'Choose a known target or specify its repository remote.');
    if (sourceKey === targetKey) failure('INVALID', 'Source and target are identical.');
    identity ||= { key: targetKey, name: data.items.find(i => i.key === targetKey)?.name || data.items.find(i => i.key === sourceKey)?.name,
      primaryRemote: targetKey.startsWith('git:local:') ? null : targetKey.slice(4) };
    aliases = data.aliases.filter(a => a.identity_key === sourceKey);
  }
  const source = sourceKey ? fileState(sourceKey, data.stores) : null;
  const target = targetKey ? fileState(targetKey, data.stores) : null;
  const moving = !['unlink','purge-identity'].includes(operation) && source && sourceKey !== targetKey;
  if (moving && source.file === target.file) failure('CONFLICT', 'Source and target resolve to the same Notebook filename.');
  if (target && data.stores.some(s => s.file === memoryFileName(targetKey) && s.key !== targetKey)) failure('CONFLICT', 'Canonical target filename is owned by a different project.');
  const merge = moving ? mergeFacts(source.entries, target.entries) : { entries: target?.entries || [], idMap: new Map(), matches: [], conflicts: [], added: 0, assignedIds: 0 };
  const links = sourceKey ? sql.prepare('SELECT * FROM knowledge_links WHERE fact_key=? ORDER BY id').all(sourceKey) : [];
  const scopes = sourceKey ? sql.prepare('SELECT * FROM document_scopes WHERE scope_key=? ORDER BY doc_id').all(sourceKey) : [];
  const linkMap = new Map();
  if (moving) for (const link of links) {
    const same = source.entries.map((line, index) => ({ line, index })).filter(({ line }) => link.fact_id ? factMeta(line).id === link.fact_id && factBody(line) === link.fact_text : factBody(line) === link.fact_text || parseFactEntry(line)?.text === link.fact_text);
    if (same.length !== 1) { merge.conflicts.push({ reason: 'ambiguous-link', linkId: link.id }); continue; }
    const id = merge.idMap.get(link.fact_id || `legacy:${same[0].index}`);
    if (!id) { merge.conflicts.push({ reason: 'target-fact-has-no-id', linkId: link.id }); continue; }
    linkMap.set(link.id, id);
  }
  if (operation === 'link') for (const alias of aliases) {
    const previous = data.aliases.find(a => a.alias === alias.alias);
    if (previous && previous.identity_key !== targetKey && previous.identity_key !== sourceKey) merge.conflicts.push({ reason: 'alias-owned-by-other-project', alias: alias.alias, owner: previous.identity_key });
  }
  const docIds = [...new Set([...scopes.map(s => s.doc_id), ...(moving ? links.map(l => l.doc_id) : [])])];
  const documents = docIds.map(id => sql.prepare('SELECT * FROM documents WHERE id=?').get(id));
  const allScopes = docIds.flatMap(id => sql.prepare('SELECT * FROM document_scopes WHERE doc_id=? ORDER BY scope_key').all(id));
  const epochs = sql.prepare("SELECT * FROM sync_state WHERE key IN ('snapshot_restore_id','knowledge_import_epoch') ORDER BY key").all();
  const stamp=sqlStamp(sql);
  const fingerprint = hash([operation, input.directory || null, sourceKey, targetKey, identity, aliases, source, target, data.identities, data.aliases, links, scopes, documents, allScopes, stamp,
    sql.prepare('SELECT * FROM graph_edges ORDER BY source_id,target_id,relation_type').all(), epochs]);
  const preview = { operation, sourceKey, targetKey, directory: input.directory || null, identity, aliases,
    counts: { sourceFacts: source?.entries.length || 0, targetFacts: target?.entries.length || 0, addedFacts: merge.added, duplicateFacts: merge.matches.length, assignedIds: merge.assignedIds,
      links: moving ? links.length : 0, documents: moving ? docIds.length : 0 },
    matches: merge.matches.slice(0, 100), conflicts: merge.conflicts.slice(0, 100), conflictCount: merge.conflicts.length,
    truncated: merge.matches.length > 100 || merge.conflicts.length > 100, canApply: !merge.conflicts.length,
    effects: operation === 'purge-identity' ? ['Remove the detected registry identity and all its aliases. Keep Notebook, documents, scopes and Git detection. This does not delete memory.']
      : operation === 'unlink' ? ['Remove only the selected path alias. Keep Notebook, documents, other aliases and Git detection.']
      : moving ? ['Merge records without dropping metadata; remap colliding fact IDs and their links.', 'Move document scopes and registry aliases; preserve other document scopes.', 'Save a verified full local ZIP before publishing; remove the source Notebook only with the committed move.', 'Repository Git configuration stays unchanged; opening its old Git remote still resolves the old identity.']
        : ['Register the detected Git identity and aliases. No project is created outside Git.'], previewToken: fingerprint };
  return { preview, data, source, target, moving, merge, links, linkMap, docIds, stamp };
}
export async function projectRequest(input = {}, { afterCommit } = {}) {
  assertLocalMemoryReady();
  const allowed = ['action', 'operation', 'directory', 'sourceKey', 'targetKey', 'remote', 'previewToken', 'confirm'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) failure('INVALID', 'Unknown project field.');
  for (const name of ['directory', 'sourceKey', 'targetKey', 'remote', 'previewToken']) if (input[name] != null && (typeof input[name] !== 'string' || input[name].length > 4096 || /[\x00-\x1f]/.test(input[name]))) failure('INVALID', `Invalid ${name}.`);
  const {CloudSnapshots}=await import('../admin/cloud_snapshots.js');
  const checkpoints=new CloudSnapshots();
  const work=()=>withSnapshotLock(MEMORY_DIR, async () => {
    const db = await getDatabase(), sql = db.localDb;
    if (input.action === 'list') return { items: (await catalog(sql)).items, observedAt: Date.now() };
    if (input.action === 'inspect') {
      const identity = await gitAt(input.directory), data = await catalog(sql);
      return { identity, aliases: data.aliases.filter(a => a.identity_key === identity.key), registered: data.identities.some(i => i.key === identity.key) };
    }
    if (!['preview', 'apply'].includes(input.action)) failure('INVALID', 'Unknown project action.');
    const prepared = await prepare(sql, input), { preview, source, target, moving, merge, links, linkMap, docIds } = prepared;
    if (input.action === 'preview') return preview;
    if (input.confirm !== true) failure('CONFIRMATION', 'Review and confirm the project preview.');
    if (!input.previewToken || input.previewToken !== preview.previewToken) failure('CONFLICT', 'Project preview is stale. Review it again.');
    if (!preview.canApply) failure('CONFLICT', 'Resolve the listed record or alias conflicts before moving memory.');
    // Full snapshot also backs up legacy schema; activation happens only on
    // an explicit move and can be recovered together with its publication.
    const { captureLocal } = await import('../admin/full_snapshot.js');
    const payload = captureLocal(db, MEMORY_DIR, BLOBS_DIR, getConfig());
    const checkpoint=await checkpoints.store(payload,checkpoints.state(),{force:true,source:`project-before-${preview.operation}`,pinned:true});
    await checkpoints.load(checkpoint.id,'local');
    const backup=checkpoints.archivePath(checkpoint.id);
    const current = await prepare(sql, input);
    if (current.preview.previewToken !== preview.previewToken) failure('CONFLICT', 'Project changed during backup preparation. Review a new preview.');
    const files = moving ? [{ file: target.file, content: buildMemoryContent(preview.targetKey, merge.entries) }, ...(source.content !== null ? [{ file: source.file, content: null }] : [])] : [];
    const operationId = await commitKnowledge(MEMORY_DIR, db, files, tx => {
      if(sqlStamp(tx)!==prepared.stamp) failure('CONFLICT','Project data changed before publication.');
      // Recheck files synchronously inside the SQL transaction for external edits.
      for (const item of [source, target].filter(Boolean)) {
        const file = join(MEMORY_DIR, item.file), content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
        if (content !== item.content) failure('CONFLICT', 'Notebook changed before publication.');
      }
      createKnowledgeSchema(tx);
      if(preview.operation==='purge-identity') tx.prepare('DELETE FROM project_identities WHERE key=?').run(preview.sourceKey);
      else if (preview.operation === 'unlink') tx.prepare('DELETE FROM project_aliases WHERE alias=? AND identity_key=?').run(preview.aliases[0].alias, preview.sourceKey);
      else {
        const existing = prepared.data.identities.find(i => i.key === preview.targetKey), identity = preview.identity;
        tx.prepare(`INSERT INTO project_identities (key,name,primary_remote,created_at,updated_at) VALUES (?,?,?,?,?)
          ON CONFLICT(key) DO UPDATE SET updated_at=excluded.updated_at`).run(preview.targetKey, existing?.name || identity.name, existing?.primary_remote || identity.primaryRemote || null, Date.now(), Date.now());
        if (moving) {
          for (const docId of docIds) tx.prepare('INSERT OR IGNORE INTO document_scopes (doc_id,scope_key,created_at) VALUES (?,?,?)').run(docId, preview.targetKey, Date.now());
          tx.prepare('DELETE FROM document_scopes WHERE scope_key=?').run(preview.sourceKey);
          for (const link of links) tx.prepare("UPDATE knowledge_links SET fact_key=?,fact_id=? WHERE id=?").run(preview.targetKey, linkMap.get(link.id), link.id);
          // Remove legacy projections positively tied to these exact link IDs.
          for (const edge of tx.prepare('SELECT * FROM graph_edges').all()) {
            let meta; try { meta = JSON.parse(edge.metadata_json || '{}'); } catch { continue; }
            const link = links.find(l => l.id === meta.linkId);
            const endpoint = link && (link.start_line ? `${link.doc_id}:L${link.start_line}-${link.end_line || link.start_line}` : link.doc_id);
            if (link && edge.source_id === `fact:${preview.sourceKey}:${link.fact_text.substring(0, 30)}` && edge.target_id === endpoint && edge.relation_type === link.relation_type) tx.prepare('DELETE FROM graph_edges WHERE source_id=? AND target_id=? AND relation_type=?').run(edge.source_id, edge.target_id, edge.relation_type);
          }
          tx.prepare('UPDATE project_aliases SET identity_key=? WHERE identity_key=?').run(preview.targetKey, preview.sourceKey);
          tx.prepare('DELETE FROM project_identities WHERE key=?').run(preview.sourceKey);
          rebuildLinkProjections(tx);
        }
        if (preview.operation === 'link') for (const a of preview.aliases) tx.prepare(`INSERT INTO project_aliases (alias,identity_key,kind,created_at) VALUES (?,?,?,?)
          ON CONFLICT(alias) DO UPDATE SET identity_key=excluded.identity_key,kind=excluded.kind`).run(a.alias, preview.targetKey, a.kind, Date.now());
      }
    }, { afterCommit });
    bustIdentityCache();
    return { status: 'success', operation: preview.operation, sourceKey: preview.sourceKey, targetKey: preview.targetKey, key: preview.targetKey,
      name: preview.identity?.name, primaryRemote: preview.identity?.primaryRemote, aliases: preview.aliases.map(a => a.alias), migrated: !!moving,
      mergedFacts: merge.added, movedKnowledgeLinks: moving ? links.length : 0, movedRagDocuments: moving ? docIds.length : 0, backup, backupId:checkpoint.id,
      restoreCommand:`memory-cli snapshots restore ${checkpoint.id} --location local`, operationId };
  });
  // Same lock order as upload/restore: checkpoint catalog, then working memory.
  // This makes the backup visible to normal CLI restore without a lock cycle.
  return input.action==='apply' ? checkpoints.lock(work) : work();
}

// Compatibility calls keep their public names. An explicit old command/tool
// is authorization to apply; both preparation and publication use this service.
export async function executeProjectOperation(operation, input = {}) {
  if(input.purge && operation==='unlink') operation='purge-identity';
  const request = { operation, directory: input.directory || process.cwd(), ...(input.remote ? { remote: input.remote } : {}),
    ...(input.sourceKey ? { sourceKey: input.sourceKey } : {}), ...(input.targetKey ? { targetKey: input.targetKey } : {}) };
  const preview = await projectRequest({ ...request, action: 'preview' });
  return projectRequest({ ...request, action: 'apply', previewToken: preview.previewToken, confirm: true });
}
