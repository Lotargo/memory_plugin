// Reviewed RAG maintenance. Files are immutable inputs; publication and receipts
// share one SQLite transaction. Notebook, identities and settings are preserved.
import fs from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { MEMORY_DIR, storeFilePath, parseMeta } from '../memory.js';
import { getConfig, assertLocalMemoryReady } from '../config/config_manager.js';
import { getDatabase, BLOBS_DIR } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { withSnapshotLock, atomicWrite } from '../storage/snapshot_lock.js';
import { safeGunzip, getBlobPath } from '../storage/blob_store.js';
import { hasKnowledgeSchema, createKnowledgeSchema, restoreKnowledgeRevisions, rebuildLinkProjections, factNode } from '../storage/knowledge_schema.js';
import { TABLES_V2, captureLocal, validatePayload, stateHash, sha256, encodeRows } from '../admin/full_snapshot.js';
import { factBody, factMeta, parseFactEntry } from '../fact_format.js';
import { serviceError } from './notebook_service.js';

export const RAG_FILE_LIMIT = 32 * 1024 * 1024;
export const RAG_UNPACKED_LIMIT = 128 * 1024 * 1024;
const directory = join(MEMORY_DIR, 'storage', 'rag-maintenance');
const tables = ['documents','sections','medium_chunks','micro_chunks','document_scopes','knowledge_links','graph_edges','rag_document_tombstones'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const fail = (code, message) => { throw serviceError(code, message); };
function safeFile(file) {
  for (let current = file; ; current = join(current, '..')) {
    try { if (fs.lstatSync(current).isSymbolicLink()) fail('UNSUPPORTED', 'Linked RAG maintenance files or parent directories are unsupported.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = join(current, '..'); if (parent === current) break;
  }
}
function validate(input) {
  const allowed = { status:['action'], stage:['action','fileName','data'], export:['action'], download:['action','snapshotId'],
    preview:['action','operation','snapshotId','mode'], apply:['action','operation','snapshotId','mode','previewToken','confirm'], receipt:['action','operationId'] };
  if (!input || Array.isArray(input) || !Object.hasOwn(allowed,input.action) || Object.keys(input).some(key => !allowed[input.action].includes(key))) fail('INVALID','Unknown RAG maintenance field or action.');
  for (const key of ['snapshotId','operationId']) if (input[key] !== undefined && !UUID.test(input[key])) fail('INVALID',`Invalid ${key}.`);
  if (['download'].includes(input.action) && !input.snapshotId || input.action === 'receipt' && !input.operationId) fail('INVALID','Choose an exact saved ID.');
  if (['preview','apply'].includes(input.action)) {
    if (!['import','reset'].includes(input.operation)) fail('INVALID','Choose import or reset.');
    if (input.operation === 'import' && (!input.snapshotId || !['merge','replace'].includes(input.mode))) fail('INVALID','Choose an immutable snapshot and explicit merge or replace mode.');
    if (input.operation === 'reset' && (input.snapshotId !== undefined || input.mode !== undefined)) fail('INVALID','Reset targets all local RAG.');
    if (input.confirm !== undefined && typeof input.confirm !== 'boolean') fail('INVALID','confirm must be boolean.');
    if (input.previewToken !== undefined && (typeof input.previewToken !== 'string' || !/^[a-f0-9]{64}$/.test(input.previewToken))) fail('INVALID','Invalid preview token.');
  }
}
const embeddingSettings = () => ({ embeddingModel:getConfig().embeddingModel, vectorDimension:getConfig().vectorDimension });
function shell(tablesValue, blobs, settings = embeddingSettings()) {
  return { format:'memory-full', version:2, tables:{ ...Object.fromEntries(Object.keys(TABLES_V2).map(key => [key,[]])), ...tablesValue }, notebooks:[], blobs, settings };
}
function normalize(snapshot) {
  if (!snapshot || ![1,2,3,4].includes(snapshot.version) || !Array.isArray(snapshot.documents) || !Array.isArray(snapshot.sections) || !Array.isArray(snapshot.micro_chunks) || !Array.isArray(snapshot.blobs)) fail('INVALID','Incomplete or unsupported RAG snapshot (versions 1–4).');
  const fields=new Set(['version','created_at',...tables,'blobs','knowledge_scope_revisions','embedding_settings']);
  if(Object.keys(snapshot).some(key=>!fields.has(key)))fail('INVALID','Unknown RAG snapshot field. Choose a RAG-only export.');
  if(snapshot.version>=3 && ['medium_chunks','document_scopes','knowledge_links','graph_edges'].some(key=>!Array.isArray(snapshot[key])))fail('INVALID','Incomplete modern RAG snapshot.');
  const result = {}, blobs = {};
  for (const blob of snapshot.blobs) {
    if (!blob || typeof blob.hash !== 'string' || !/^[a-f0-9]{64}$/.test(blob.hash) || Object.hasOwn(blobs,blob.hash)) fail('INVALID','Invalid or duplicate blob.');
    blobs[blob.hash] = blob.content;
  }
  for (const table of tables) {
    const rows = snapshot[table] ?? [];
    if (!Array.isArray(rows)) fail('INVALID',`Invalid ${table}.`);
    result[table] = rows.map(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) fail('INVALID',`Invalid ${table} row.`);
      const defaults = table === 'documents' && snapshot.version < 4 ? { revision:1,content_revision:1,index_revision:1 }
        : table === 'knowledge_links' && snapshot.version < 4 ? { fact_id:null,revision:1,status:'needs_review',source_revision:null } : {};
      if (table === 'micro_chunks') Object.assign(defaults,{ medium_id:null,retrieval_policy:'micro_chunk',policy_source_id:null });
      if (table === 'graph_edges' && snapshot.version < 3) Object.assign(defaults,{metadata_json:null,created_at:null});
      const merged = {...defaults,...row};
      // Historical exporters occasionally included derived chunk breadcrumbs.
      if (table === 'micro_chunks') delete merged.breadcrumbs;
      return merged;
    });
  }
  if (snapshot.version < 3 && !result.document_scopes.length) result.document_scopes = result.documents.map(doc => ({doc_id:doc.id,scope_key:'global',created_at:doc.created_at}));
  const payload = shell(result,blobs);
  try { validatePayload(payload); validateRelations(payload); } catch (error) { fail('INVALID',`Snapshot validation failed: ${error.message}`); }
  return { payload, settings:snapshot.embedding_settings || null, version:snapshot.version };
}
function validateRelations(payload) {
  const data = payload.tables, docs = new Map(data.documents.map(row => [row.id,row])), sections = new Map(data.sections.map(row => [row.id,row])), medium = new Map(data.medium_chunks.map(row => [row.id,row]));
  const numeric=new Set(['created_at','updated_at','token_count','revision','content_revision','index_revision','start_line','end_line','source_revision','deleted_at']);
  for (const table of tables) {
    const seen = new Set();
    for (const row of data[table]) {
      for(const [key,value]of Object.entries(row))if(value!==null && typeof value!==(numeric.has(key)?'number':'string'))throw new Error(`Invalid value type in ${table}.${key}`);
      const id = table === 'graph_edges' ? JSON.stringify([row.source_id,row.target_id,row.relation_type]) : table === 'document_scopes' ? JSON.stringify([row.doc_id,row.scope_key]) : row.id || row.doc_id;
      if (!id || seen.has(id)) throw new Error(`Duplicate or empty identity in ${table}`); seen.add(id);
    }
  }
  for (const row of [...data.sections,...data.medium_chunks,...data.micro_chunks,...data.document_scopes,...data.knowledge_links]) if (!docs.has(row.doc_id)) throw new Error('Missing document reference');
  for (const row of [...data.medium_chunks,...data.micro_chunks]) if (sections.get(row.section_id)?.doc_id !== row.doc_id) throw new Error('Chunk section belongs to another document');
  for (const row of data.micro_chunks) {
    if (row.medium_id && medium.get(row.medium_id)?.section_id !== row.section_id || row.policy_source_id && medium.get(row.policy_source_id)?.doc_id !== row.doc_id) throw new Error('Invalid parent or retrieval policy source');
    if (!['micro_chunk','table_summary','code_signature'].includes(row.retrieval_policy)) throw new Error('Unknown retrieval policy');
    const bytes = Buffer.from(row.vector,'base64');
    if (!BASE64.test(row.vector) || bytes.length % 4) throw new Error('Invalid vector bytes');
    for (let i=0;i<bytes.length;i+=4) if (!Number.isFinite(bytes.readFloatLE(i))) throw new Error('Nonfinite vector');
  }
  for (const row of data.documents) if (!data.document_scopes.some(scope => scope.doc_id === row.id)) throw new Error('Document has no explicit scope');
  for (const row of data.rag_document_tombstones) if(docs.has(row.doc_id))throw new Error('An active document also has a deletion tombstone');
  for (const row of data.document_scopes) if (typeof row.scope_key !== 'string' || !row.scope_key || row.scope_key.length>4096 || /[\x00-\x1f]/.test(row.scope_key)) throw new Error('Invalid scope key');
  for (const link of data.knowledge_links) {
    if (link.section_id && (sections.has(link.section_id) ? sections.get(link.section_id).doc_id !== link.doc_id : link.status !== 'orphaned')) throw new Error('Invalid link section');
    if ((link.start_line === null) !== (link.end_line === null) || link.start_line !== null && (!Number.isSafeInteger(link.start_line) || link.start_line < 1 || link.end_line < link.start_line || link.status==='valid' && link.end_line > payload.blobs[docs.get(link.doc_id).blob_hash].split('\n').length)) throw new Error('Invalid source line range');
  }
  if(data.documents.length>5000 || data.micro_chunks.length>100000 || data.knowledge_links.length>10000 || data.graph_edges.length>200000)throw new Error('RAG exceeds the bounded maintenance preview limit');
}
function readSaved(id) {
  const metaFile=join(directory,`${id}.meta.json`), file=join(directory,`${id}.json.gz`); safeFile(metaFile); safeFile(file);
  try {
    if (fs.statSync(metaFile).size > 16000 || fs.statSync(file).size > RAG_FILE_LIMIT) throw new Error();
    const meta=JSON.parse(fs.readFileSync(metaFile,'utf8')), bytes=fs.readFileSync(file);
    if (meta.id !== id || meta.checksum !== sha256(bytes) || meta.bytes !== bytes.length || !['export','upload','local-file'].includes(meta.source)) throw new Error();
    const raw=safeGunzip(bytes,RAG_UNPACKED_LIMIT), snapshot=JSON.parse(raw.toString('utf8'));
    return {meta,bytes,snapshot,normalized:normalize(snapshot)};
  } catch (error) { if (error.code === 'UNSUPPORTED') throw error; fail('RECOVERY_REQUIRED','Saved RAG input is missing, corrupt or invalid. Select the original file again.'); }
}
async function saveInput(snapshot, source, fileName) {
  await validateDesired(normalize(snapshot).payload);
  const raw=Buffer.from(JSON.stringify(snapshot)); if(raw.length>RAG_UNPACKED_LIMIT)fail('UNSUPPORTED','RAG snapshot exceeds the 128 MiB unpacked limit.');
  const bytes=gzipSync(raw); if(bytes.length>RAG_FILE_LIMIT)fail('UNSUPPORTED','RAG snapshot exceeds the 32 MiB file limit.');
  safeFile(directory); const id=randomUUID(), file=join(directory,`${id}.json.gz`);
  const meta={id,source,fileName,bytes:bytes.length,checksum:sha256(bytes),observedAt:new Date().toISOString(),counts:{...Object.fromEntries(tables.map(table=>[table,snapshot[table]?.length||0])),blobs:snapshot.blobs.length}};
  atomicWrite(file,bytes,{renameRetries:10}); atomicWrite(join(directory,`${id}.meta.json`),JSON.stringify(meta),{renameRetries:10}); readSaved(id);
  return {...meta,snapshotId:id,outputPath:file};
}
// CLI/TUI file paths never enter the HTTP contract; freeze and validate bytes.
export async function stageRagFile(file) {
  const {validateSnapshotPath}=await import('../admin/snapshot.js'); file=validateSnapshotPath(file); safeFile(file);
  if(fs.statSync(file).size>RAG_FILE_LIMIT)fail('UNSUPPORTED','Input exceeds 32 MiB.');
  const bytes=fs.readFileSync(file); let snapshot;
  try{snapshot=JSON.parse((file.endsWith('.gz')?safeGunzip(bytes,RAG_UNPACKED_LIMIT):bytes).toString('utf8'));}catch{fail('INVALID','Cannot decode RAG JSON input.');}
  return withSnapshotLock(MEMORY_DIR,()=>saveInput(snapshot,'local-file',file.split(/[\\/]/).at(-1)));
}
function currentState(db) {
  assertLocalMemoryReady(); if(!hasKnowledgeSchema(db))fail('MIGRATION_REQUIRED','Prepare knowledge links before RAG maintenance.');
  safeFile(MEMORY_DIR); safeFile(BLOBS_DIR);
  for (const file of fs.readdirSync(MEMORY_DIR).filter(file=>file.endsWith('.md')))safeFile(join(MEMORY_DIR,file));
  for (const {blob_hash} of db.localDb.prepare('SELECT blob_hash FROM documents').all()) {
    if(!/^[a-f0-9]{64}$/.test(blob_hash))fail('RECOVERY_REQUIRED','Invalid local blob hash.');safeFile(getBlobPath(blob_hash,BLOBS_DIR));
  }
  return captureLocal(db,MEMORY_DIR,BLOBS_DIR,getConfig());
}
const counts = data => Object.fromEntries(tables.map(table=>[table,data[table].length]));
function exported(current) {
  return {version:4,created_at:new Date().toISOString(),...Object.fromEntries(tables.map(table=>[table,current.tables[table]])),
    knowledge_scope_revisions:current.tables.knowledge_scope_revisions,embedding_settings:current.settings,
    blobs:Object.entries(current.blobs).map(([hash,content])=>({hash,content}))};
}
function affectedNode(id, owned, touched) {
  const lines=/^(.+):L\d+-\d+$/.exec(id);
  return owned.has(id) || !!lines && touched.has(lines[1]);
}
function reconcileLinks(payload, incomingIds) {
  const reviews=[],notebooks=new Map(),documents=new Map(payload.tables.documents.map(doc=>[doc.id,doc])),scopes=new Map();
  for(const scope of payload.tables.document_scopes){if(!scopes.has(scope.doc_id))scopes.set(scope.doc_id,new Set());scopes.get(scope.doc_id).add(scope.scope_key);}
  for(const link of payload.tables.knowledge_links) {
    if(!incomingIds.has(link.id))continue;
    if(typeof link.fact_key!=='string'||!link.fact_key||link.fact_key.length>4096||/[\x00-\x1f]/.test(link.fact_key))fail('INVALID','Invalid fact scope.');
    if(!notebooks.has(link.fact_key)) {
      const ids=new Map();try {
        safeFile(storeFilePath(link.fact_key));const text=fs.readFileSync(storeFilePath(link.fact_key),'utf8');
        if(link.fact_key==='global'||parseMeta(text).key===link.fact_key)for(const line of text.split('\n').filter(line=>parseFactEntry(line))){const id=factMeta(line).id;if(!ids.has(id))ids.set(id,[]);ids.get(id).push(line);}
      }catch(error){if(error.code!=='ENOENT')throw error;}notebooks.set(link.fact_key,ids);
    }
    const matches=link.fact_id?notebooks.get(link.fact_key).get(link.fact_id)||[]:[];
    const exact=matches.length===1 && factBody(matches[0])===link.fact_text;
    const visible=scopes.get(link.doc_id)?.has(link.fact_key)||scopes.get(link.doc_id)?.has('global');
    const doc=documents.get(link.doc_id);
    if(!exact || !visible || doc.content_revision!==link.source_revision) {
      reviews.push({linkId:link.id,factKey:link.fact_key,reason:!exact?'missing-or-different-notebook-fact':!visible?'target-not-visible':'source-revision-unknown-or-changed'});
      if(!exact)link.fact_id=null; if(link.status!=='orphaned')link.status='needs_review';link.source_revision=null;
    }
  }
  return reviews;
}
function desiredState(input,current,saved) {
  const incoming=saved?.normalized.payload, touched=new Set(input.operation==='reset'||input.mode==='replace'?current.tables.documents.map(doc=>doc.id):incoming.tables.documents.map(doc=>doc.id));
  const incomingIds=new Set(incoming?.tables.documents.map(doc=>doc.id)||[]),incomingMarks=new Set(incoming?.tables.rag_document_tombstones.map(row=>row.doc_id)||[]);
  const owned=new Set([...touched,...tables.slice(1,4).flatMap(table=>current.tables[table].filter(row=>touched.has(row.doc_id)).map(row=>row.id))]);
  const next=shell({},{}); const merge=input.mode==='merge';
  for(const table of tables) {
    const preserved=table==='rag_document_tombstones'?current.tables[table].filter(row=>!incomingIds.has(row.doc_id)&&!incomingMarks.has(row.doc_id))
      :!merge?[]:current.tables[table].filter(row=>table==='graph_edges'?!affectedNode(row.source_id,owned,touched)&&!affectedNode(row.target_id,owned,touched):table==='documents'?!touched.has(row.id):!touched.has(row.doc_id));
    const rows=structuredClone(incoming?.tables[table]||[]);
    next.tables[table]=[...preserved,...rows];
  }
  next.blobs=Object.fromEntries(next.tables.documents.map(doc=>[doc.blob_hash,incoming?.blobs[doc.blob_hash]??current.blobs[doc.blob_hash]]));
  const nextIds=new Set(next.tables.documents.map(doc=>doc.id)),removed=current.tables.documents.filter(doc=>!nextIds.has(doc.id));
  const stamp=removed.length?Math.max(...current.tables.documents.map(doc=>doc.updated_at),0)+1:0;
  for(const doc of removed) {
    next.tables.rag_document_tombstones=next.tables.rag_document_tombstones.filter(row=>row.doc_id!==doc.id);
    next.tables.rag_document_tombstones.push({doc_id:doc.id,path:doc.path,deleted_at:stamp});
  }
  const mismatch=input.operation==='import' && stateHash(saved.normalized.settings)!==stateHash(current.settings);
  let vectorsCleared=0;
  const incomingChunks=new Set(incoming?.tables.micro_chunks.map(row=>row.id)||[]),vectorDocs=new Set(),metadata=new Map();
  for(const doc of next.tables.documents){let value;try{value=JSON.parse(doc.metadata_json||'{}');}catch{value={};}if(!value||typeof value!=='object'||Array.isArray(value))value={};metadata.set(doc.id,value);}
  for(const chunk of next.tables.micro_chunks) if(incomingChunks.has(chunk.id) && chunk.vector) {
    const provenance=metadata.get(chunk.doc_id)?.embedding_provenance,dimension=Buffer.from(chunk.vector,'base64').length/4;
    // Stored per-document publication provenance is authoritative. A config
    // written after indexing cannot relabel an old or unknown vector space.
    if(!provenance || provenance.model!==current.settings.embeddingModel || provenance.dimension!==dimension || current.settings.vectorDimension>0 && current.settings.vectorDimension!==dimension) {
      chunk.vector='';vectorsCleared++;vectorDocs.add(chunk.doc_id);
    }
  }
  for(const doc of next.tables.documents)if(vectorDocs.has(doc.id)){const value=metadata.get(doc.id);value.index_state='lexical-only';value.embedding_provenance=null;doc.metadata_json=JSON.stringify(value);}
  const reviews=reconcileLinks(next,new Set(incoming?.tables.knowledge_links.map(link=>link.id)||[]));
  const provenFacts=new Set(next.tables.knowledge_links.filter(link=>link.fact_id && incomingIds.has(link.doc_id)).map(link=>factNode(link.fact_key,link.fact_id)));
  for(const edge of incoming?.tables.graph_edges||[]) {
    let meta;try{meta=JSON.parse(edge.metadata_json||'{}');}catch{meta={};}
    if(meta?.knowledgeProjection===true)continue; // rebuilt from reconciled links
    if([edge.source_id,edge.target_id].some(id=>/^fact:.+:id:.+$/.test(id)&&!provenFacts.has(id)))fail('UNSUPPORTED','An independent imported graph edge targets a Notebook fact without an exact body/key proof. Review that edge in the input before importing.');
  }
  // Scope generations and Notebook SQL journals belong to the current store.
  next.tables.knowledge_scope_revisions=structuredClone(current.tables.knowledge_scope_revisions);
  return {next,touched,removed,reviews,vectorsCleared,embeddingCompatibility:vectorsCleared?'unknown-or-different':mismatch?'config-differs-provenance-checked':'provenance-checked'};
}
function insertTables(sql,payload) {
  sql.exec('DELETE FROM micro_chunks_fts');
  for(const table of [...tables].reverse())sql.exec(`DELETE FROM ${table}`);
  for(const table of tables) {
    const columns=TABLES_V2[table], insert=sql.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
    for(const row of payload.tables[table])insert.run(...columns.map(key=>key==='vector'?Buffer.from(row[key],'base64'):row[key]));
  }
  restoreKnowledgeRevisions(sql,payload.tables.documents,payload.tables.knowledge_links,true);rebuildLinkProjections(sql);
  sql.exec(`INSERT INTO micro_chunks_fts(id,content,breadcrumbs) SELECT c.id,c.content,s.breadcrumbs FROM micro_chunks c JOIN sections s ON s.id=c.section_id`);
  if(sql.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Broken relational references');
}
async function validateDesired(next) {
  try {
    validatePayload(next);validateRelations(next);
    const sql=new DatabaseSync(':memory:');
    try {
      sql.exec('PRAGMA foreign_keys=ON');await runMigrations(sql);createKnowledgeSchema(sql);insertTables(sql,next);
      next.tables.graph_edges=encodeRows(sql.prepare('SELECT * FROM graph_edges').all());
    } finally{sql.close();}
  } catch(error){fail('INVALID',`RAG conflicts or invalid references: ${error.message}`);}
}
async function prepare(input,db) {
  const current=currentState(db), saved=input.snapshotId?readSaved(input.snapshotId):null;
  const desired=desiredState(input,current,saved); await validateDesired(desired.next);
  const before=Object.fromEntries(tables.map(table=>[table,current.tables[table]]));
  const after=Object.fromEntries(tables.map(table=>[table,encodeRows(desired.next.tables[table].map(row=>({...row,...(table==='micro_chunks'?{vector:Buffer.from(row.vector,'base64')}:{} )})))]));
  const changed=stateHash(before)!==stateHash(after);
  const documents=current.tables.documents.filter(doc=>desired.touched.has(doc.id)).map(doc=>({id:doc.id,title:doc.title,path:doc.path,scopes:current.tables.document_scopes.filter(scope=>scope.doc_id===doc.id).map(scope=>scope.scope_key),effect:desired.removed.some(row=>row.id===doc.id)?'removed':'replaced'}));
  const removedLinks=current.tables.knowledge_links.filter(link=>!desired.next.tables.knowledge_links.some(row=>stateHash(row)===stateHash(link))).map(link=>({linkId:link.id,factKey:link.fact_key,factRef:link.fact_id?`id:${link.fact_id}`:null,docId:link.doc_id}));
  return {current,desired,view:{operation:input.operation,mode:input.mode||null,snapshotId:input.snapshotId||null,scope:'all-local-rag',changed,canApply:true,
    previewToken:stateHash([input,stateHash(current),saved?.meta.checksum,desired.next]),before:counts(before),after:counts(desired.next.tables),documents,
    incomingDocuments:input.operation==='import'?desired.next.tables.documents.filter(doc=>saved.normalized.payload.tables.documents.some(row=>row.id===doc.id)).map(doc=>({id:doc.id,title:doc.title,path:doc.path,scopes:desired.next.tables.document_scopes.filter(scope=>scope.doc_id===doc.id).map(scope=>scope.scope_key)})):[],
    removedLinks,linkReviews:desired.reviews,vectorsCleared:desired.vectorsCleared,embeddingCompatibility:desired.embeddingCompatibility,
    notice:'All local RAG scopes. Notebook facts, project identities, settings and snapshot history are preserved. Unreferenced blobs are retained for separate cleanup. A verified pinned full local ZIP precedes apply.',observedAt:new Date().toISOString()}};
}
export async function ragMaintenanceRequest(input,{afterBackup,beforeCommit,afterCommit}={}) {
  validate(input);assertLocalMemoryReady();
  const work=checkpoints=>withSnapshotLock(MEMORY_DIR,async()=>{
    safeFile(directory);
    if(input.action==='stage') {
      if(typeof input.fileName!=='string'|| !/^[^\\/\x00-\x1f:]{1,200}\.json(?:\.gz)?$/.test(input.fileName)||typeof input.data!=='string'||input.data.length>Math.ceil(RAG_FILE_LIMIT/3)*4||!BASE64.test(input.data))fail('INVALID','Choose a JSON or JSON.gz file up to 32 MiB.');
      let snapshot;try {const bytes=Buffer.from(input.data,'base64');snapshot=JSON.parse((input.fileName.endsWith('.gz')?safeGunzip(bytes,RAG_UNPACKED_LIMIT):bytes).toString('utf8'));}catch{fail('INVALID','Cannot decode RAG JSON input.');}
      return saveInput(snapshot,'upload',input.fileName);
    }
    if(input.action==='download'){const {bytes,meta}=readSaved(input.snapshotId);return {fileName:`rag_${meta.id}.json.gz`,data:bytes.toString('base64'),checksum:meta.checksum};}
    const db=await getDatabase(),sql=db.localDb;
    if(input.action==='receipt') {const row=sql.prepare('SELECT value FROM sync_state WHERE key=?').get(`rag-maintenance:${input.operationId}`);if(!row)fail('NOT_FOUND','No committed RAG receipt with this ID.');return JSON.parse(row.value);}
    if(input.action==='status') {
      const snapshots=fs.existsSync(directory)?fs.readdirSync(directory).filter(name=>UUID.test(name.replace('.meta.json',''))&&name.endsWith('.meta.json')).map(name=>{const id=name.replace('.meta.json','');try{return readSaved(id).meta;}catch(error){return {id,unavailable:error.code};}}):[];
      const receipts=sql.prepare("SELECT value FROM sync_state WHERE key LIKE 'rag-maintenance:%' ORDER BY updated_at DESC LIMIT 20").all().map(row=>JSON.parse(row.value));
      return {scope:'all-local-rag',counts:Object.fromEntries(tables.map(table=>[table,sql.prepare(`SELECT count(*) AS n FROM ${table}`).get().n])),snapshots:snapshots.sort((a,b)=>(b.observedAt||'').localeCompare(a.observedAt||'')),receipts,migrationRequired:!hasKnowledgeSchema(db),observedAt:new Date().toISOString(),localOnly:true};
    }
    if(input.action==='export'){const current=currentState(db);return saveInput(exported(current),'export','RAG export.json.gz');}
    const target=Object.fromEntries(Object.entries(input).filter(([key])=>!['action','confirm','previewToken'].includes(key))),prepared=await prepare(target,db),view=prepared.view;
    if(input.action==='preview')return view;
    if(input.confirm!==true)fail('CONFIRMATION','Review and explicitly confirm all RAG effects.');
    if(input.previewToken!==view.previewToken)fail('CONFLICT','RAG, Notebook, settings or selected input changed. Refresh the preview.');
    if(!view.changed)return {status:'unchanged',operation:input.operation,changed:false};
    const backup=await checkpoints.store(prepared.current,checkpoints.state(),{force:true,pinned:true,source:'rag-maintenance-before-apply'});await checkpoints.load(backup.id,'local');
    if(afterBackup)await afterBackup();
    if((await prepare(target,db)).view.previewToken!==view.previewToken)fail('CONFLICT','State changed during backup. Refresh the preview.');
    // Immutable blobs publish before SQL. A pre-commit crash only leaves unused
    // content-addressed files; a post-commit crash already has a durable receipt.
    for(const [hash,content]of Object.entries(prepared.desired.next.blobs)) {
      const file=getBlobPath(hash,BLOBS_DIR);safeFile(file);
      if(fs.existsSync(file)){if(sha256(safeGunzip(fs.readFileSync(file)))!==hash)fail('RECOVERY_REQUIRED','An existing blob failed integrity validation.');}
      else atomicWrite(file,gzipSync(content),{renameRetries:10});
    }
    const operationId=randomUUID(),receipt={operationId,status:'saved',operation:input.operation,mode:input.mode||null,snapshotId:input.snapshotId||null,scope:'all-local-rag',
      before:view.before,after:view.after,backupId:backup.id,backup:checkpoints.archivePath(backup.id),reindexRequired:view.vectorsCleared>0,linkReviews:view.linkReviews,
      blobsRetained:true,notebookChanged:false,observedAt:new Date().toISOString()};
    sql.exec('BEGIN IMMEDIATE');
    try {
      if(stateHash(captureLocal(db,MEMORY_DIR,BLOBS_DIR,getConfig(),false))!==stateHash(prepared.current))fail('CONFLICT','Memory changed before RAG publication.');
      const removedIds=new Set(prepared.desired.removed.map(doc=>doc.id));
      for(const mark of prepared.desired.next.tables.rag_document_tombstones)if(removedIds.has(mark.doc_id))mark.deleted_at=Date.now();
      insertTables(sql,prepared.desired.next);
      // Clear transport copies of removed blobs. Local CAS files stay recoverable.
      for(const row of sql.prepare('SELECT hash FROM rag_blobs').all())if(!Object.hasOwn(prepared.desired.next.blobs,row.hash))sql.prepare('DELETE FROM rag_blobs WHERE hash=?').run(row.hash);
      sql.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES ('knowledge_import_epoch',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(operationId,Date.now());
      sql.prepare('INSERT INTO sync_state(key,value,updated_at) VALUES (?,?,?)').run(`rag-maintenance:${operationId}`,JSON.stringify(receipt),Date.now());
      if(beforeCommit)beforeCommit();sql.exec('COMMIT');
    }catch(error){sql.exec('ROLLBACK');throw error;}
    if(afterCommit)await afterCommit();return receipt;
  });
  if(input.action==='apply'){const {CloudSnapshots}=await import('../admin/cloud_snapshots.js');const checkpoints=new CloudSnapshots();return checkpoints.lock(()=>work(checkpoints));}
  return work();
}
