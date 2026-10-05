import {createHash} from 'node:crypto';
import {getDatabase} from '../db/database.js';
import {MEMORY_DIR,readMemory,notebookVersion} from '../memory.js';
import {factMeta,factTitle,factBody} from '../fact_format.js';
import {factNode,hasKnowledgeSchema} from '../storage/knowledge_schema.js';
import {withSnapshotLock} from '../storage/snapshot_lock.js';
import {listKnowledgeTargets} from './knowledge_service.js';
import {resolvedLinkState} from './knowledge_links_service.js';
import {serviceError} from './notebook_service.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function readKnowledgeGraph(input) {
  if(!(await listKnowledgeTargets()).some(target=>target.key===input.scopeKey))throw serviceError('NOT_FOUND','Existing explicit scopeKey required.');
  if(input.includeGlobal!==undefined&&typeof input.includeGlobal!=='boolean')throw serviceError('INVALID','includeGlobal must be boolean.');
  const keys=input.includeGlobal&&input.scopeKey!=='global'?[input.scopeKey,'global']:[input.scopeKey];
  const limit=Number(input.limit??40),offset=Number(input.offset??0),type=input.nodeType??'all',relation=input.relationType??'';
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>5000||!['all','document','section','medium','micro','fact','symbol','lines'].includes(type)||typeof relation!=='string'||relation.length>100)throw serviceError('INVALID','Invalid graph filters or page bounds.');
  return withSnapshotLock(MEMORY_DIR,async()=>{
    const db=await getDatabase(),sql=db.localDb,facts=new Map(),notebooks=[];
    for(const key of keys){const entries=await readMemory(key);if(entries.length>10000)throw serviceError('UNSUPPORTED','Graph Notebook exceeds 10000 entries.');notebooks.push([key,notebookVersion(entries)]);const counts=new Map();for(const entry of entries){const id=factMeta(entry).id;if(id)counts.set(id,(counts.get(id)||0)+1);}
      for(const entry of entries){const id=factMeta(entry).id;if(id&&counts.get(id)===1)facts.set(factNode(key,id),{id:factNode(key,id),type:'fact',label:(factTitle(entry)||factBody(entry)).slice(0,300),state:'available',target:{kind:'fact',scopeKey:key,factRef:`id:${id}`}});}}
    sql.exec('BEGIN;');try {
    const docs=sql.prepare(`SELECT d.* FROM documents d WHERE EXISTS(SELECT 1 FROM document_scopes ds WHERE ds.doc_id=d.id AND ds.scope_key IN (${keys.map(()=>'?')})) ORDER BY d.id LIMIT 5001`).all(...keys);
    if(docs.length>5000)throw serviceError('UNSUPPORTED','Narrow the scope before reading a graph with more than 5000 documents.');
    const documents=new Map(docs.map(doc=>[doc.id,doc]));
    if(input.docId&&!documents.has(input.docId))throw serviceError('NOT_FOUND','Document is not visible in this graph context.');
    const cache=new Map(),nodes=new Map();
    const resolve=id=>{
      if(cache.has(id))return cache.get(id);
      let node=facts.get(id)||null;
      if(!node&&documents.has(id)){const doc=documents.get(id);node={id,type:'document',label:(doc.title||id).slice(0,300),docId:id,state:'available',target:{kind:'document',docId:id}};}
      if(!node&&!id.startsWith('fact:'))for(const [type,table] of [['section','sections'],['medium','medium_chunks'],['micro','micro_chunks']]){
        const row=sql.prepare(`SELECT id,doc_id${type==='section'?',heading':''} FROM ${table} WHERE id=?`).get(id);
        if(row){if(documents.has(row.doc_id))node={id,type,label:(row.heading||id).slice(0,300),docId:row.doc_id,state:'available',target:{kind:'chunk',level:type,docId:row.doc_id,chunkId:id}};break;}}
      if(!node){const match=/^(.+):L(\d+)-(\d+)$/.exec(id);if(match&&documents.has(match[1]))node={id,type:'lines',label:`Lines ${match[2]}–${match[3]}`,docId:match[1],state:'coordinates-unverified',target:{kind:'document',docId:match[1],startLine:Number(match[2])}};}
      if(!node&&id.startsWith('symbol:'))node={id,type:'symbol',label:id.slice(7,307),state:'name-only-nonunique',target:null};
      cache.set(id,node);return node;
    };
    // Candidate scan is bounded. Resolve BOTH ends before exposing any edge or
    // metadata; a shared document never grants access to another project's fact.
    const candidates=sql.prepare(`SELECT e.* FROM graph_edges e WHERE (?='' OR relation_type=?) AND (
      EXISTS(SELECT 1 FROM documents d JOIN document_scopes ds ON d.id=ds.doc_id WHERE ds.scope_key IN (${keys.map(()=>'?')}) AND (?='' OR d.id=?) AND (e.source_id=d.id OR e.target_id=d.id OR substr(e.source_id,1,length(d.id)+2)=d.id||':L' OR substr(e.target_id,1,length(d.id)+2)=d.id||':L'))
      OR EXISTS(SELECT 1 FROM sections c JOIN document_scopes ds ON c.doc_id=ds.doc_id WHERE ds.scope_key IN (${keys.map(()=>'?')}) AND (?='' OR c.doc_id=?) AND (e.source_id=c.id OR e.target_id=c.id))
      OR EXISTS(SELECT 1 FROM medium_chunks c JOIN document_scopes ds ON c.doc_id=ds.doc_id WHERE ds.scope_key IN (${keys.map(()=>'?')}) AND (?='' OR c.doc_id=?) AND (e.source_id=c.id OR e.target_id=c.id))
      OR EXISTS(SELECT 1 FROM micro_chunks c JOIN document_scopes ds ON c.doc_id=ds.doc_id WHERE ds.scope_key IN (${keys.map(()=>'?')}) AND (?='' OR c.doc_id=?) AND (e.source_id=c.id OR e.target_id=c.id)))
      ORDER BY e.source_id,e.target_id,e.relation_type LIMIT 5001`).all(relation,relation,...keys,input.docId||'',input.docId||'',...keys,input.docId||'',input.docId||'',...keys,input.docId||'',input.docId||'',...keys,input.docId||'',input.docId||'');
    const visible=[];
    for(const edge of candidates.slice(0,5000)){
      const source=resolve(edge.source_id),target=resolve(edge.target_id);if(!source||!target)continue;
      if(input.docId&&source.docId!==input.docId&&target.docId!==input.docId)continue;
      if(type!=='all'&&source.type!==type&&target.type!==type)continue;
      let meta;try{meta=JSON.parse(edge.metadata_json||'{}');}catch{meta={};}
      const linkIds=Array.isArray(meta.linkIds)?meta.linkIds:meta.linkId?[meta.linkId]:[];
      const links=linkIds.flatMap(id=>{if(typeof id!=='string')return [];const row=sql.prepare('SELECT * FROM knowledge_links WHERE id=?').get(id);
        if(!row||!keys.includes(row.fact_key)||!documents.has(row.doc_id))return [];
        const expectedSource=row.fact_id?factNode(row.fact_key,row.fact_id):null,expectedTarget=row.start_line?`${row.doc_id}:L${row.start_line}-${row.end_line||row.start_line}`:row.section_id||row.doc_id;
        if(expectedSource!==edge.source_id||expectedTarget!==edge.target_id||row.relation_type!==edge.relation_type)return [];
        return [{linkId:row.id,scopeKey:row.fact_key,editable:row.fact_key===input.scopeKey,...(hasKnowledgeSchema(sql)?resolvedLinkState(sql,row):{status:'needs_review'})}];});
      // Imported/falsely marked projections are retained as UNKNOWN; no mutation
      // target is synthesized from an arbitrary metadata linkId.
      const structural=(edge.relation_type==='CONTAINS'&&['document','section','medium'].includes(source.type)&&['section','medium','micro'].includes(target.type)&&source.docId===target.docId)
        ||(edge.relation_type==='DEFINES_SYMBOL'&&source.type==='section'&&target.type==='symbol');
      visible.push({edgeId:hash([edge.source_id,edge.target_id,edge.relation_type]),sourceId:source.id,targetId:target.id,relationType:edge.relation_type,
        provenance:links.length?'manual-link':structural?'structure-origin-unrecorded':'UNKNOWN',links,editable:links.some(link=>link.editable),createdAt:edge.created_at??null});
    }
    const edges=visible.slice(offset,offset+limit);
    for(const edge of edges){nodes.set(edge.sourceId,resolve(edge.sourceId));nodes.set(edge.targetId,resolve(edge.targetId));}
    const result={scopeKey:input.scopeKey,contextKeys:keys,docId:input.docId??null,nodes:[...nodes.values()],edges,
      version:hash([docs,notebooks,visible]),visibleCandidateCount:visible.length,scanTruncated:candidates.length>5000,
      complete:candidates.length<=5000&&offset===0&&edges.length===visible.length,offset,limit,nextOffset:offset+edges.length<visible.length?offset+edges.length:null,
      order:'saved source/target/relation; bounded to 5000 candidates',warning:'Symbols are name-only and may refer to different definitions. Unresolved/foreign endpoints are omitted. Structural edges are rebuilt from their source.'};
    sql.exec('COMMIT;');return result;
    } catch(error) {sql.exec('ROLLBACK;');throw error;}
  });
}
