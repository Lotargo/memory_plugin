import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fork} from 'node:child_process';
const root=fs.mkdtempSync(join(tmpdir(),'memory-models-'));
process.env.MEMORY_DIR=join(root,'memory');process.env.OPENCODE_CONFIG_DIR=join(root,'opencode');
process.env.MEMORY_DISABLE_BACKGROUND_SYNC='1';process.env.MEMORY_DISABLE_PERSONA_SYNC='1';process.env.MEMORY_DISABLE_WEB_AUTOSTART='1';
const {modelsRequest,modelJobStatus,saveModelJob,modelVersion,modelJobFile}=await import('../../mcp-server/services/model_service.js');
const {writeRuntimeState,readRuntimeStates,sendModelCommand,pollModelCommand,writeCommandAck,readCommandAck,CONTROL_DIR}=await import('../../mcp-server/ml/model_control.js');
const {getModelRuntimeStatus,getModelStorageInfo}=await import('../../mcp-server/ml/model_manager.js');
const {getDatabase,closeDatabase,MODELS_DIR}=await import('../../mcp-server/db/database.js');
const {updateConfig}=await import('../../mcp-server/config/config_manager.js');
const {ingestDocument,reindexEmbeddings}=await import('../../mcp-server/ingest/pipeline.js');
const {startDashboard}=await import('../../mcp-server/dashboard/server.js');
const nativeFetch=globalThis.fetch;let network=0,app,owner,otherOwner;
globalThis.fetch=async()=>{network++;throw new Error('No remote requests on reads');};
const request=extra=>modelsRequest({action:'start',expectedVersion:modelVersion(),...extra});
const cached='Fixture/embedding';
function seedCache(model) {
  const dir=join(MODELS_DIR,...model.split('/'));fs.mkdirSync(join(dir,'onnx'),{recursive:true});
  fs.writeFileSync(join(dir,'config.json'),'{}');fs.writeFileSync(join(dir,'tokenizer.json'),'{}');
  const fd=fs.openSync(join(dir,'onnx','model_quantized.onnx'),'w');fs.ftruncateSync(fd,11*1024*1024);fs.closeSync(fd);return dir;
}
try {
  updateConfig({embeddingModel:cached,rerankerModel:'none',rerankerEnabled:false,batchSize:1});
  let overview=await modelsRequest({action:'read'});
  assert.equal(overview.coverage,'registered-processes-only');assert.equal(overview.owners.length,0);assert.equal(network,0);
  assert.equal(getModelRuntimeStatus().embedding.loaded,false);
  await assert.rejects(request({operation:'download',model:'../escape',type:'embedding'}),e=>e.code==='INVALID');
  for(const model of ['./.','Fixture/.','./embedding','Fixture/embedding.']) {
    await assert.rejects(modelsRequest({action:'preview',operation:'delete-cache',model}),e=>e.code==='INVALID');
    assert.equal(getModelStorageInfo(model).invalid,true,'root/organization aliases cannot reach deletion through the common model manager');
  }
  await assert.rejects(request({operation:'load',targetPid:123456,device:'cpu'}),e=>e.code==='UNAVAILABLE');
  await assert.rejects(modelsRequest({action:'status',operationId:'../../config'}),e=>e.code==='INVALID');
  await assert.rejects(modelsRequest({action:'preview',operation:'reindex'}),e=>e.code==='UNSUPPORTED');
  await assert.rejects(modelsRequest({action:'read',secret:true}),e=>e.code==='INVALID');
  const dir=seedCache(cached);overview=await modelsRequest({action:'read'});assert.equal(overview.models[0].status,'downloaded');assert.equal(network,0);
  const tiny=seedCache('Fixture/tiny');fs.truncateSync(join(tiny,'onnx','model_quantized.onnx'),1024);
  assert.equal(getModelStorageInfo('Fixture/tiny').status,'downloaded','small ONNX files are present; correctness is checked by strict inference, not file size');
  const preview=await modelsRequest({action:'preview',operation:'delete-cache',model:cached});
  fs.writeFileSync(join(dir,'new-file'),'changed');
  await assert.rejects(modelsRequest({action:'delete-cache',model:cached,expectedVersion:modelVersion(),previewToken:preview.previewToken}),e=>e.code==='CONFLICT');
  const current=await modelsRequest({action:'preview',operation:'delete-cache',model:cached});
  assert.equal((await modelsRequest({action:'delete-cache',model:cached,expectedVersion:modelVersion(),previewToken:current.previewToken})).status,'deleted');assert.ok(!fs.existsSync(dir));seedCache(cached);
  writeRuntimeState({...getModelRuntimeStatus(),serverPid:process.pid});
  assert.equal(readRuntimeStates().length,1);
  fs.rmSync(join(CONTROL_DIR,`runtime_${process.pid}.json`));
  writeRuntimeState({...getModelRuntimeStatus(),controlProtocol:undefined});
  await assert.rejects(request({operation:'unload',targetPid:process.pid}),e=>e.code==='UNSUPPORTED');
  writeRuntimeState({...getModelRuntimeStatus()});
  const stateFile=join(CONTROL_DIR,`runtime_${process.pid}.json`),state=JSON.parse(fs.readFileSync(stateFile,'utf8'));state.updatedAt=new Date(Date.now()-60000).toISOString();fs.writeFileSync(stateFile,JSON.stringify(state));
  await assert.rejects(request({operation:'unload',targetPid:process.pid}),e=>e.code==='UNAVAILABLE');writeRuntimeState(getModelRuntimeStatus());
  await assert.rejects(modelsRequest({action:'preview',operation:'delete-cache',model:cached}),e=>e.code==='BUSY');
  const other=sendModelCommand('status',{}, {targetPid:process.pid+999999});assert.equal(pollModelCommand(),null);
  const expired=sendModelCommand('status',{}, {targetPid:process.pid,expiresAt:Date.now()-1});assert.equal(pollModelCommand(),null);
  const command=sendModelCommand('status',{}, {targetPid:process.pid});assert.equal(pollModelCommand().id,command.id);
  writeCommandAck(command.id,{ok:true});writeCommandAck(other.id,{ok:false});assert.equal(readCommandAck(command.id).id,command.id,'ack remains available after another command');
  let job=await modelsRequest({action:'start',operation:'download',model:cached,type:'embedding',expectedVersion:modelVersion()},{launch:()=>({pid:process.pid})});
  await assert.rejects(request({operation:'download',model:cached,type:'embedding'}),e=>e.code==='BUSY');
  const rename=fs.renameSync;let denied=0;
  try {
    fs.renameSync=(source,target)=>{if(process.platform==='win32' && target===modelJobFile(job.operationId) && denied++===0){assert.equal(modelJobStatus(job.operationId).state,'queued','destination stays readable during replacement refusal');throw Object.assign(new Error('temporary reader lock'),{code:'EPERM'});}return rename(source,target);};
    saveModelJob({...job,state:'failed',error:'fixture error'});
  } finally {fs.renameSync=rename;}
  assert.equal(modelJobStatus(job.operationId).state,'failed','durable receipt survives a transient Windows replacement lock');
  await assert.rejects(modelsRequest({action:'start',operation:'download',model:cached,type:'embedding',expectedVersion:'old'}),e=>e.code==='CONFLICT');
  const db=await getDatabase();await ingestDocument({path:'memory://note/models',title:'Models test',content:'# Test\n\nSaved knowledge.',projectScope:'global',generateEmbeddings:false});
  const before=await db.prepare('SELECT id,vector FROM micro_chunks ORDER BY id').all();
  await assert.rejects(reindexEmbeddings({embedFn:async texts=>texts.map(()=>new Float32Array([1,0])),beforePublish(){throw new Error('configuration changed');}}));
  assert.deepEqual(await db.prepare('SELECT id,vector FROM micro_chunks ORDER BY id').all(),before,'failed preparation never changes saved vectors');
  const progress=[];await reindexEmbeddings({model:cached,dimension:2,embedFn:async texts=>texts.map(()=>new Float32Array([1,0])),progressCallback:p=>progress.push(p)});
  assert.ok(progress.at(-1).done>0);assert.equal((await db.prepare('SELECT vector FROM micro_chunks LIMIT 1').get()).vector.length,8);
  const rp=await modelsRequest({action:'preview',operation:'reindex'});updateConfig({vectorDimension:3});
  await assert.rejects(request({operation:'reindex',previewToken:rp.previewToken}),e=>e.code==='CONFLICT');updateConfig({vectorDimension:0});
  // Real child control client, real target owner, no model download/inference.
  owner=fork(new URL('../fixtures/model_owner.js',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],env:process.env});
  await new Promise((resolve,reject)=>{owner.once('message',resolve);owner.once('error',reject);});
  otherOwner=fork(new URL('../fixtures/model_owner.js',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],env:process.env});
  await new Promise((resolve,reject)=>{otherOwner.once('message',resolve);otherOwner.once('error',reject);});
  assert.equal(readRuntimeStates().length,3);
  job=await request({operation:'unload',targetPid:owner.pid});
  for(let i=0;i<120 && ['queued','running'].includes(job.state);i++){await new Promise(resolve=>setTimeout(resolve,50));job=modelJobStatus(job.operationId);}
  assert.equal(job.state,'succeeded');assert.equal(job.result.wasLoaded,false);assert.equal(job.result.unloaded.length,0);
  assert.equal(readRuntimeStates().find(state=>state.serverPid===otherOwner.pid).lastCommandId,null,'targeted command never reaches the second live owner');
  job=await request({operation:'apply-device',targetPid:owner.pid,device:'webgpu'});
  for(let i=0;i<120 && ['queued','running'].includes(job.state);i++){await new Promise(resolve=>setTimeout(resolve,50));job=modelJobStatus(job.operationId);}
  assert.equal(job.state,'succeeded');assert.equal(job.result.device,process.platform==='win32'?'dml':process.platform==='linux'?'cuda':'webgpu');
  // Late acknowledgement resolves UNKNOWN; absence never becomes success.
  saveModelJob({...job,state:'unconfirmed',commandId:'late-command',targetPid:process.pid,result:undefined});
  assert.equal(modelJobStatus(job.operationId).state,'unconfirmed');writeCommandAck('late-command',{ok:true});assert.equal(modelJobStatus(job.operationId).state,'succeeded');
  // Real worker invalid cached model: strict local reindex fails without a
  // network request, fallback model or destructive cache repair.
  const failedPreview=await modelsRequest({action:'preview',operation:'reindex'}),stable=await db.prepare('SELECT id,vector FROM micro_chunks ORDER BY id').all();
  job=await request({operation:'reindex',previewToken:failedPreview.previewToken});
  for(let i=0;i<300 && ['queued','running'].includes(job.state);i++){await new Promise(resolve=>setTimeout(resolve,50));job=modelJobStatus(job.operationId);}
  assert.equal(job.state,'failed');assert.deepEqual(await db.prepare('SELECT id,vector FROM micro_chunks ORDER BY id').all(),stable);assert.ok(fs.existsSync(dir));assert.ok(!fs.existsSync(join(MODELS_DIR,'Xenova','multilingual-e5-small')));
  writeRuntimeState(getModelRuntimeStatus());
  job=await request({operation:'unload',targetPid:process.pid});
  for(let i=0;i<400 && ['queued','running'].includes(job.state);i++){await new Promise(resolve=>setTimeout(resolve,50));job=modelJobStatus(job.operationId);}
  assert.equal(job.state,'unconfirmed','real timeout never claims completion or cancellation');
  assert.equal(pollModelCommand(),null,'expired command cannot execute later');
  writeCommandAck(job.commandId,{ok:true});assert.equal(modelJobStatus(job.operationId).state,'succeeded');
  globalThis.fetch=nativeFetch;app=await startDashboard();const token=app.url.split('#')[1],auth={Authorization:`Bearer ${token}`};
  assert.equal((await fetch(app.origin+'/api/models')).status,401);
  assert.equal((await fetch(app.origin+'/api/models',{headers:auth})).status,200);
  assert.equal((await fetch(app.origin+'/api/models?action=read&action=status',{headers:auth})).status,400);
  assert.equal((await fetch(app.origin+'/api/models',{method:'POST',headers:{...auth,'Content-Type':'application/json',Origin:'https://foreign.invalid'},body:JSON.stringify({action:'read'})})).status,403);
  assert.equal((await fetch(app.origin+'/models.js')).status,200);
  console.log('MODEL ADMIN TESTS PASSED: offline reads, cache preview/conflict, targeted process control, real workers, progress/transaction rollback, auth/origin.');
} finally {
  globalThis.fetch=nativeFetch;if(app)await app.close();for(const child of [owner,otherOwner].filter(Boolean)){child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));}
  closeDatabase();
  try{fs.rmSync(root,{recursive:true,force:true,maxRetries:5});}catch(error){if(!['EPERM','EBUSY'].includes(error.code))throw error;console.log('Windows native file handles deferred fixture cleanup: '+root);}
}
