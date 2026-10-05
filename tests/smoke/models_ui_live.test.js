// Browser fixture with an isolated copy of the real cached model. No user
// knowledge, config, cache deletion or loaded client sessions are touched.
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fork} from 'node:child_process';
const root=fs.mkdtempSync(join(tmpdir(),'memory-models-ui-'));
process.env.MEMORY_DIR=join(root,'memory');process.env.OPENCODE_CONFIG_DIR=join(root,'opencode');
process.env.MEMORY_DISABLE_BACKGROUND_SYNC='1';process.env.MEMORY_DISABLE_PERSONA_SYNC='1';process.env.MEMORY_DISABLE_WEB_AUTOSTART='1';
const {writeMemory}=await import('../../mcp-server/memory.js');
const {ingestDocument}=await import('../../mcp-server/ingest/pipeline.js');
const {closeDatabase,MODELS_DIR}=await import('../../mcp-server/db/database.js');
const {startDashboard}=await import('../../mcp-server/dashboard/server.js');
const {getConfig,updateConfig}=await import('../../mcp-server/config/config_manager.js');
let app,owner;
try {
  const model='Xenova/multilingual-e5-small';
  const source=process.env.MEMORY_MODEL_CACHE;
  if(!source)throw new Error('Set MEMORY_MODEL_CACHE to an existing copied/read-only model cache root.');
  fs.mkdirSync(MODELS_DIR,{recursive:true});fs.cpSync(join(source,...model.split('/')),join(MODELS_DIR,...model.split('/')),{recursive:true});
  updateConfig({embeddingModel:model,rerankerEnabled:false,rerankerModel:'none',executionDevice:'cpu',onnxThreads:2});
  await writeMemory('global',['- [2026-10-04 10:00] **Models fixture** — Isolated browser acceptance <!-- id:test, kind:fact -->']);
  await ingestDocument({path:'memory://note/models-fixture',title:'Проверка модели',content:'# Поиск\n\nЛокальная модель преобразует текст в векторы для поиска.\n\n## Индекс\n\nПереиндексация публикует новые векторы одной транзакцией.',projectScope:'global',generateEmbeddings:false});
  owner=fork(new URL('../fixtures/model_owner.js',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],env:process.env});
  await new Promise((resolve,reject)=>{owner.once('message',resolve);owner.once('error',reject);});
  app=await startDashboard();console.log(JSON.stringify({url:app.url,root,ownerPid:owner.pid,model:getConfig().embeddingModel}));
  await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
}finally{
  if(app)await app.close();if(owner){owner.kill();await new Promise(resolve=>owner.exitCode!==null?resolve():owner.once('exit',resolve));}closeDatabase();
  // Preserve the isolated cache/receipts for evidence; cleanup is separate.
  console.log('Browser fixture stopped; evidence directory: '+root);
}
