// Real cached ONNX acceptance, isolated data; never downloads or mutates the
// supplied cache. Run with MEMORY_MODEL_CACHE pointing to a complete models root.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const cache=process.env.MEMORY_MODEL_CACHE;
assert.ok(cache&&fs.statSync(cache).isDirectory(),'Explicit existing MEMORY_MODEL_CACHE required');
const root=fs.mkdtempSync(join(tmpdir(),'knowledge-live-')),memory=join(root,'memory');
process.env.MEMORY_DIR=memory;process.env.OPENCODE_CONFIG_DIR=join(root,'opencode');process.env.MEMORY_DISABLE_PERSONA_SYNC='1';process.env.MEMORY_DISABLE_BACKGROUND_SYNC='1';
fs.mkdirSync(join(memory,'storage'),{recursive:true});fs.symlinkSync(fs.realpathSync(cache),join(memory,'storage','models'),process.platform==='win32'?'junction':'dir');
const {createKnowledgeFixture}=await import('../fixtures/knowledge_fixture.js');
const {closeDatabase}=await import('../../mcp-server/db/database.js');
const {updateConfig}=await import('../../mcp-server/config/config_manager.js');
const {migrateKnowledge}=await import('../../mcp-server/services/knowledge_links_service.js');
const {manageKnowledgeContent:content}=await import('../../mcp-server/services/knowledge_content_service.js');
const {searchKnowledge}=await import('../../mcp-server/services/knowledge_search_service.js');
const {embedText,getModelRuntimeStatus,unloadModels}=await import('../../mcp-server/ml/model_manager.js');
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw new Error('Live cache test forbids downloading');};
const start=Date.now();
try{
  updateConfig({mode:'only-local',embeddingModel:'Xenova/multilingual-e5-small',vectorDimension:0,executionDevice:'cpu',rerankerEnabled:false});
  const f=await createKnowledgeFixture();await migrateKnowledge();
  const status=await searchKnowledge({action:'search-status',scopeKey:f.a});assert.equal(status.available,true);assert.equal(status.loaded,false);
  const job=await content({action:'prepare',scopeKey:f.a,operation:'create-note',fields:{title:'Real semantic acceptance',content:'# Semantic memory\n\nDense vector search represents documents numerically and finds meaning through cosine similarity.',indexMode:'dense'}},
    {embed:async texts=>{const vectors=[];for(const text of texts)vectors.push(await embedText(text,false,status.model,null,null,null,{localOnly:true}));return vectors;}});
  assert.equal(job.state,'ready',JSON.stringify(job));const saved=await content({action:'apply',scopeKey:f.a,operationId:job.operationId,previewToken:job.preview.previewToken});assert.equal(saved.state,'saved');
  const result=await searchKnowledge({action:'search',scopeKey:f.a,query:'How can I retrieve documents by their meaning?',searchMode:'dense'});
  const hit=result.items.find(item=>item.docId===saved.result.docId);assert.ok(hit);assert.ok(hit.scores.cosine>0.1);assert.equal(hit.embedding.documentProvenance.model,status.model);assert.equal(hit.embedding.queryDimension,384);
  const chunk=await (await import('../../mcp-server/services/knowledge_service.js')).inspectKnowledge({action:'chunk',scopeKey:f.a,docId:hit.docId,level:'micro',chunkId:hit.chunkId});assert.equal(chunk.vector.model,status.model);assert.equal(chunk.vector.dimension,384);
  assert.equal(getModelRuntimeStatus().embedding.loadedModel,status.model);assert.equal(network,0);
  console.log(JSON.stringify({status:'PASS',model:status.model,device:getModelRuntimeStatus().embedding.device,dimension:hit.embedding.queryDimension,cosine:hit.scores.cosine,networkCalls:network,seconds:(Date.now()-start)/1000}));
}finally{globalThis.fetch=originalFetch;await unloadModels('test-complete');closeDatabase();assert.ok(resolve(root).startsWith(resolve(tmpdir())+requireSeparator()));fs.rmSync(root,{recursive:true,force:true,maxRetries:5});}
function requireSeparator(){return process.platform==='win32'?'\\':'/';}
