import { createHash } from 'node:crypto';
import { getDatabase, BLOBS_DIR } from '../db/database.js';
import { MEMORY_DIR } from '../memory.js';
import { withSnapshotLock } from '../storage/snapshot_lock.js';
import { hasKnowledgeSchema } from '../storage/knowledge_schema.js';
import { removalState, publishRemoval, retryBlobCleanup } from '../storage/knowledge_removal.js';
import { listKnowledgeTargets } from './knowledge_service.js';
import { serviceError } from './notebook_service.js';
import { assertLocalMemoryReady } from '../config/config_manager.js';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function preview(sql,input) {
  if (!['unlink-scope','delete'].includes(input.operation) || typeof input.docId !== 'string' || !input.docId) throw serviceError('INVALID','Explicit docId and unlink-scope|delete operation required.');
  const state = removalState(sql,input.docId,input.operation === 'delete' ? null : [input.scopeKey]);
  if (!state || !state.scopes.some(item => item.scope_key === input.scopeKey)) throw serviceError('NOT_FOUND','Choose an owning scope for removal.');
  if (state.links.length > 5000 || state.ids.length > 100000) throw serviceError('UNSUPPORTED','Removal exceeds the supported preview limit.');
  const own = state.removedLinks.filter(link => link.fact_key === input.scopeKey);
  const token = digest([input.operation,input.scopeKey,state]);
  return { state, public: { operation:input.operation,scopeKey:input.scopeKey,docId:state.row.id,title:state.row.title,path:state.row.path,
    version:digest(state), previewToken:token, purge:state.purge, shared:state.scopes.length>1,
    ownScopeRemoved:state.removedScopes.includes(input.scopeKey), removedScopeCount:state.removedScopes.length, remainingScopeCount:state.remaining.length,
    privateScopeCount:state.scopes.filter(scope => scope.scope_key !== input.scopeKey).length,
    linksRemoved:own.map(link => ({linkId:link.id,status:'removed',factRef:link.fact_id?`id:${link.fact_id}`:null})),
    privateLinksRemoved:state.removedLinks.length-own.length, totalLinksRemoved:state.removedLinks.length,
    preservedLinks:state.links.length-state.removedLinks.length, counts:state.purge?state.counts:null, edgesRemoved:state.purge?state.edges.length:null,
    history:'Existing snapshots retain their historical contents. Only explicit restore can return removed data.',
    effects:state.purge ? ['Remove this document, all its scopes, hierarchy, FTS, vectors, links and exact owned graph edges. Keep Notebook facts.','Remove its blob only if no other document references it.'] : ['Remove the selected scope. Keep the document and index in other scopes.','Remove only links whose facts lose visibility; preserve links still visible through global. Keep Notebook facts.'] } };
}
export async function manageKnowledgeRemoval(input, options = {}) {
  assertLocalMemoryReady();
  if (!['preview','apply','cleanup'].includes(input.action)) throw serviceError('INVALID','Unknown removal action.');
  if (!(await listKnowledgeTargets()).some(target => target.key === input.scopeKey)) throw serviceError('NOT_FOUND','Existing explicit scopeKey required.');
  const db = await getDatabase();
  return withSnapshotLock(MEMORY_DIR,async () => {
    if (input.action==='cleanup') return {status:'saved',...(await retryBlobCleanup(db,BLOBS_DIR))};
    if (!hasKnowledgeSchema(db)) throw serviceError('MIGRATION_REQUIRED','Prepare knowledge storage before managed removal.');
    const current=preview(db.localDb,input);
    if(input.action==='preview')return current.public;
    if(input.previewToken!==current.public.previewToken)throw serviceError('CONFLICT','Removal preview is stale. Review a fresh preview.');
    if(input.confirm!==true)throw serviceError('CONFIRMATION','Explicit confirmation of reviewed removal effects required.');
    if(input.operation==='delete'&&current.public.shared&&input.confirmShared!==true)throw serviceError('CONFIRMATION','Confirm removal in all owning scopes.');
    return publishRemoval(db,current.state,BLOBS_DIR,{...options,beforeCommit:sql=>{
      if(preview(sql,input).public.previewToken!==input.previewToken)throw serviceError('CONFLICT','Knowledge changed before removal publication.');
    }});
  });
}
