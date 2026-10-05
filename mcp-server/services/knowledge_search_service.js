import {createHash} from 'node:crypto';
import {getDatabase} from '../db/database.js';
import {MEMORY_DIR} from '../memory.js';
import {withSnapshotLock} from '../storage/snapshot_lock.js';
import {getConfig,assertLocalMemoryReady} from '../config/config_manager.js';
import {embedText,getModelRuntimeStatus,getModelStorageInfo} from '../ml/model_manager.js';
import {hybridQuery} from '../retrieval/retriever.js';
import {listKnowledgeTargets} from './knowledge_service.js';
import {serviceError} from './notebook_service.js';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clip=(value,max)=>value==null?null:String(value).slice(0,max);
function modelStatus(){const config=getConfig(),model=config.embeddingModel||'Xenova/multilingual-e5-small',runtime=getModelRuntimeStatus().embedding;
  const cached=getModelStorageInfo(model).status;return {model,dimension:config.vectorDimension||null,cached,loaded:runtime.loaded&&runtime.loadedModel===model,
    available:cached==='downloaded'||(runtime.loaded&&runtime.loadedModel===model),device:runtime.loadedModel===model?runtime.device:null,loadingPolicy:'local-files-only; no model download, fallback or cache purge'};}
function state(sql,keys){const docs=sql.prepare(`SELECT d.* FROM documents d WHERE EXISTS(SELECT 1 FROM document_scopes ds WHERE ds.doc_id=d.id AND ds.scope_key IN (${keys.map(()=>'?')})) ORDER BY d.id LIMIT 5001`).all(...keys);
  if(docs.length>5000)throw serviceError('UNSUPPORTED','Search context exceeds 5000 documents.');
  const scopes=sql.prepare(`SELECT * FROM document_scopes WHERE scope_key IN (${keys.map(()=>'?')}) ORDER BY doc_id,scope_key`).all(...keys);
  const epochs=sql.prepare("SELECT key,value FROM sync_state WHERE key IN ('snapshot_restore_id','knowledge_import_epoch') ORDER BY key").all();
  return {docs,version:digest([docs,scopes,epochs])};}
async function localEmbedding(query,status){const vector=await embedText(query,true,status.model,null,null,status.dimension,{localOnly:true});
  if(getModelRuntimeStatus().embedding.loadedModel!==status.model)throw serviceError('UNSUPPORTED','Embedding model changed; no compatible result can be reported.');return vector;}
export async function searchKnowledge(input, options={}) {
  assertLocalMemoryReady();
  if(!(await listKnowledgeTargets()).some(target=>target.key===input.scopeKey))throw serviceError('NOT_FOUND','Existing explicit scopeKey required.');
  if(input.includeGlobal!==undefined&&typeof input.includeGlobal!=='boolean')throw serviceError('INVALID','includeGlobal must be boolean.');
  const status=(options.modelStatus||modelStatus)();if(input.action==='search-status')return status;
  const mode=input.searchMode??'lexical',resultMode=input.resultMode??'snippet',limit=Number(input.limit??5);
  if(!['lexical','dense'].includes(mode)||!['index','snippet'].includes(resultMode)||!Number.isSafeInteger(limit)||limit<1||limit>20||typeof input.query!=='string'||!input.query.trim()||input.query.length>1000||(input.policyExpansion!==undefined&&typeof input.policyExpansion!=='boolean'))throw serviceError('INVALID','Nonempty query (1000 characters), explicit lexical|dense/index|snippet and limit 1–20 required.');
  const keys=input.includeGlobal&&input.scopeKey!=='global'?[input.scopeKey,'global']:[input.scopeKey],db=await getDatabase();
  let vector=null,preparedVersion=null;
  if(mode==='dense'){
    if(!status.available)throw serviceError('UNSUPPORTED','Local embedding model is unavailable; choose lexical or prepare the model through CLI.');
    preparedVersion=await withSnapshotLock(MEMORY_DIR,()=>state(db.localDb,keys).version);
    vector=await (options.embed||localEmbedding)(input.query.trim(),status);
    if(!vector?.length||Array.from(vector).some(value=>!Number.isFinite(value))||(status.dimension&&vector.length!==status.dimension))throw serviceError('UNSUPPORTED','Query embedding has invalid dimension or values.');
  }
  return withSnapshotLock(MEMORY_DIR,async()=>{
    const sql=db.localDb;sql.exec('BEGIN;');
    try{
      const initial=state(sql,keys);if(preparedVersion&&preparedVersion!==initial.version)throw serviceError('CONFLICT','Knowledge changed while preparing the query. Search again.');
      const expansion=resultMode==='snippet'&&(input.policyExpansion??true);
      const hits=await hybridQuery({query:input.query.trim(),limit,customDb:db,scopeKeys:keys,generateEmbeddings:mode==='dense',fusionAlgorithm:mode==='dense'?'semantic_only':'lexical_only',embeddingModel:status.model,
        _precomputedVector:vector,vectorScanLimit:Math.min(getConfig().vectorScanLimit||50000,50000),policyExpansion:expansion,rerankerEnabled:false,includeGraphContext:false});
      const documents=new Map(initial.docs.map(row=>[row.id,row]));
      const items=hits.flatMap(hit=>{const doc=documents.get(hit.doc_id);if(!doc)return [];
        const micro=sql.prepare('SELECT section_id,medium_id,policy_source_id,retrieval_policy FROM micro_chunks WHERE id=? AND doc_id=?').get(hit.chunk_id,doc.id);if(!micro)return [];
        const actual=hit.fragment||{level:'micro',chunkId:hit.chunk_id};
        const target=sql.prepare(`SELECT id FROM ${actual.level==='medium'?'medium_chunks':'micro_chunks'} WHERE id=? AND doc_id=?`).get(actual.chunkId,doc.id);if(!target)return [];
        const metadata=(()=>{try{return JSON.parse(doc.metadata_json||'{}');}catch{return {};}})();
        const text=resultMode==='snippet'?String(hit.snippet||''):null;
        return [{docId:doc.id,title:clip(doc.title,2000),path:clip(doc.path,4000),sourceType:hit.source_type||'UNKNOWN',noteKind:hit.note_kind,tags:hit.tags.slice(0,100).map(tag=>clip(tag,200)),
          version:digest(doc),contentRevision:doc.content_revision??'UNKNOWN',indexRevision:doc.index_revision??'UNKNOWN',chunkId:hit.chunk_id,sectionId:micro.section_id,
          fragment:actual,policy:{stored:micro.retrieval_policy||'UNKNOWN',applied:actual.level==='medium'?micro.retrieval_policy:'micro_chunk',sourceId:actual.level==='medium'?actual.chunkId:null,expansionRequested:expansion,expanded:actual.level==='medium'},
          text:text===null?null:text.slice(0,20000),textTruncated:text!==null&&text.length>20000,totalTextCharacters:text?.length??null,
          scores:{score:hit.score??null,ftsRank:hit.fts_rank??null,bm25Rank:hit.bm25_rank??null,cosine:hit.cosine_sim??null,rerank:null},
          scoreMeaning:mode==='lexical'?'reciprocal BM25 rank; FTS rank is a separate raw value':'cosine similarity',
          embedding:mode==='dense'?{queryModel:status.model,queryDimension:vector.length,documentProvenance:metadata.embedding_provenance||'UNKNOWN'}:null,
          target:{kind:'chunk',docId:doc.id,level:actual.level,chunkId:actual.chunkId}}];});
      sql.exec('COMMIT;');return {scopeKey:input.scopeKey,contextKeys:keys,query:input.query.trim(),searchMode:mode,resultMode,policyExpansion:expansion,
        version:initial.version,items,limit,model:mode==='dense'?{...status,queryDimension:vector.length}:null,
        vectorScanLimit:mode==='dense'?Math.min(getConfig().vectorScanLimit||50000,50000):null,
        notice:'This is a retrieval preview. It does not prove injection or actual use by an agent. Missing scores/provenance are null/UNKNOWN.'};
    }catch(error){sql.exec('ROLLBACK;');throw error;}
  });
}
