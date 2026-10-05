// All adapters share exact ownership cleanup. Blob removal is a post-commit
// side effect with a durable retry entry; a cleanup error never reverses saved SQL.
import { deleteBlob } from './blob_store.js';
import { hasKnowledgeSchema, rebuildLinkProjections } from './knowledge_schema.js';

export function ownedDocumentIds(sql, docId) {
  return [docId, ...['sections','medium_chunks','micro_chunks'].flatMap(table => sql.prepare(`SELECT id FROM ${table} WHERE doc_id=? ORDER BY id`).all(docId).map(row => row.id))];
}
export function isDocumentEndpoint(id, docId, owned) {
  return owned.has(id) || (id.startsWith(`${docId}:L`) && /^\d+-\d+$/.test(id.slice(docId.length + 2)));
}
export function removalState(sql, docId, scopeKeys = null) {
  const row = sql.prepare('SELECT * FROM documents WHERE id=?').get(docId);
  if (!row) return null;
  const scopes = sql.prepare('SELECT * FROM document_scopes WHERE doc_id=? ORDER BY scope_key').all(docId);
  const removedScopes = scopeKeys === null ? scopes.map(item => item.scope_key) : scopes.filter(item => scopeKeys.includes(item.scope_key)).map(item => item.scope_key);
  const remaining = scopes.filter(item => !removedScopes.includes(item.scope_key)).map(item => item.scope_key);
  const links = sql.prepare('SELECT * FROM knowledge_links WHERE doc_id=? ORDER BY id').all(docId);
  const removedLinks = links.filter(link => !remaining.length || (!remaining.includes('global') && !remaining.includes(link.fact_key)));
  const ids = ownedDocumentIds(sql, docId), owned = new Set(ids);
  const edges = sql.prepare('SELECT * FROM graph_edges ORDER BY source_id,target_id,relation_type').all().filter(edge => isDocumentEndpoint(edge.source_id,docId,owned) || isDocumentEndpoint(edge.target_id,docId,owned));
  const epochs = sql.prepare("SELECT key,value FROM sync_state WHERE key IN ('snapshot_restore_id','knowledge_import_epoch') ORDER BY key").all();
  const generations = hasKnowledgeSchema(sql) ? sql.prepare('SELECT * FROM knowledge_scope_revisions ORDER BY scope_key').all().filter(item => scopes.some(scope => scope.scope_key === item.scope_key)) : [];
  const counts = Object.fromEntries(['sections','medium_chunks','micro_chunks'].map(table => [table, sql.prepare(`SELECT count(*) n FROM ${table} WHERE doc_id=?`).get(docId).n]));
  return { row, scopes, removedScopes, remaining, links, removedLinks, ids, edges, epochs, generations, counts, purge: remaining.length === 0 };
}
export async function retryBlobCleanup(db, blobDir, { removeBlob = deleteBlob } = {}) {
  const queue = await db.prepare("SELECT key FROM sync_state WHERE key LIKE 'knowledge_blob_cleanup:%' ORDER BY key LIMIT 100").all();
  for (const item of queue) {
    const hash = item.key.slice('knowledge_blob_cleanup:'.length);
    if (!/^[a-f0-9]{64}$/.test(hash)) continue;
    try {
      if (!(await db.prepare('SELECT 1 FROM documents WHERE blob_hash=? LIMIT 1').get(hash))) await removeBlob(hash, blobDir);
      await db.prepare('DELETE FROM sync_state WHERE key=?').run(item.key);
    } catch { /* Keep the durable entry for another attempt. */ }
  }
  const remaining = await db.prepare("SELECT count(*) n FROM sync_state WHERE key LIKE 'knowledge_blob_cleanup:%'").get();
  return { pending: remaining.n, attempted: queue.length };
}
export async function publishRemoval(db, state, blobDir, { removeBlob = deleteBlob, beforeCommit = null } = {}) {
  await db.exec('BEGIN IMMEDIATE;');
  try {
    if (beforeCommit) beforeCommit(db.localDb);
    for (const link of state.removedLinks) await db.prepare('DELETE FROM knowledge_links WHERE id=?').run(link.id);
    if (state.purge) {
      await db.prepare('DELETE FROM micro_chunks_fts WHERE id IN (SELECT id FROM micro_chunks WHERE doc_id=?)').run(state.row.id);
      for (const edge of state.edges) await db.prepare('DELETE FROM graph_edges WHERE source_id=? AND target_id=? AND relation_type=?').run(edge.source_id,edge.target_id,edge.relation_type);
      await db.prepare('DELETE FROM documents WHERE id=?').run(state.row.id);
      if (/^[a-f0-9]{64}$/.test(state.row.blob_hash || '')) await db.prepare('INSERT OR REPLACE INTO sync_state(key,value,updated_at) VALUES (?,?,?)').run(`knowledge_blob_cleanup:${state.row.blob_hash}`, 'pending', Date.now());
    } else {
      for (const key of state.removedScopes) await db.prepare('DELETE FROM document_scopes WHERE doc_id=? AND scope_key=?').run(state.row.id,key);
      await db.prepare('UPDATE documents SET updated_at=? WHERE id=?').run(Date.now(),state.row.id);
    }
    if (hasKnowledgeSchema(db)) rebuildLinkProjections(db.localDb);
    else {
      // Legacy projections have explicit linkId metadata. Never guess ownership
      // from a fact prefix or remove an independently authored edge.
      const removed = new Set(state.removedLinks.map(link => link.id));
      for (const edge of await db.prepare('SELECT * FROM graph_edges').all()) {
        let meta; try { meta = JSON.parse(edge.metadata_json || '{}'); } catch { continue; }
        if (removed.has(meta.linkId)) await db.prepare('DELETE FROM graph_edges WHERE source_id=? AND target_id=? AND relation_type=?').run(edge.source_id,edge.target_id,edge.relation_type);
      }
    }
    await db.exec('COMMIT;');
  } catch (error) { try { await db.exec('ROLLBACK;'); } catch {} throw error; }
  const cleanup = await retryBlobCleanup(db,blobDir,{ removeBlob }).catch(() => ({pending:1,attempted:0}));
  return { status:'saved', deleted:state.purge, unlinked:!state.purge, docId:state.row.id, title:state.row.title,
    removedScopes:state.removedScopes, remainingScopes:state.remaining.length, linksRemoved:state.removedLinks.length,
    linksCleaned:true, syncPending:false, cleanupPending:cleanup.pending>0,
    ...(cleanup.pending ? { warning:'Knowledge was saved; local blob cleanup is pending and can be retried.' } : {}) };
}
