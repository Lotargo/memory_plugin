// Explicit admin jobs own their temporary ONNX sessions. Merely opening the
// panel never starts this process or imports the transformer runtime.
import fs from 'node:fs';
import { modelJobFile, saveModelJob, modelVersion } from '../services/model_service.js';
import { getExtractor, getReranker, unloadModels, getModelStorageInfo, getModelRuntimeStatus } from './model_manager.js';
import { sendModelCommand, waitForCommandAck, isProcessAlive } from './model_control.js';
import { reindexEmbeddings } from '../ingest/pipeline.js';
import { closeDatabase, getDatabase, DB_PATH } from '../db/database.js';

const id=process.argv[2];
// ONNX/import promises do not always own a referenced event-loop handle.
// Keep this explicit job alive until it writes its final receipt.
const lifetime=setInterval(()=>{},1000);
const startupTimeout=setTimeout(()=>clearInterval(lifetime),10000);
const start=new Promise(resolve=>process.once('message',resolve));
process.send?.('ready');
await start;
clearTimeout(startupTimeout);
if(process.connected)process.disconnect();
let job;
function progress(value) {
  job.progress={...value,file:typeof value.file==='string'?value.file.slice(0,200):undefined};saveModelJob(job);
}
try {
  job=JSON.parse(fs.readFileSync(modelJobFile(id),'utf8'));
  job.state='running';job.phase=job.operation;saveModelJob(job);
  if(job.expectedVersion!==modelVersion())throw Object.assign(new Error(),{code:'CONFLICT'});
  if(job.operation==='download') {
    const options={strict:true,device:'cpu'};
    const loaded=job.type==='embedding' ? await getExtractor(job.model,progress,options) : await getReranker(job.model,progress,options);
    const runtime=getModelRuntimeStatus(),actual=job.type==='embedding'?runtime.embedding:runtime.reranker;
    if(!loaded || actual.loadedModel!==job.model)throw new Error('Requested model not loaded.');
    job.result={model:job.model,type:job.type,cache:getModelStorageInfo(job.model),validated:true};
  } else if(job.operation==='reindex') {
    const db=await getDatabase(),identity=fs.statSync(DB_PATH);
    job.result=await reindexEmbeddings({customDb:db,model:job.config.embeddingModel,dimension:job.config.vectorDimension,progressCallback:progress,modelOptions:{localOnly:true,strict:true},
      beforePublish(){const current=fs.statSync(DB_PATH);if(job.expectedVersion!==modelVersion() || current.ino!==identity.ino || current.dev!==identity.dev)throw Object.assign(new Error(),{code:'CONFLICT'});}});
  } else {
    if(!isProcessAlive(job.targetPid))throw Object.assign(new Error(),{code:'UNAVAILABLE'});
    const timeout=job.operation==='load'?180000:15000;
    const command=sendModelCommand(job.operation,{device:job.device,reason:'ui-request',expectedConfig:job.config,strict:true,localOnly:true},{targetPid:job.targetPid,expiresAt:Date.now()+timeout});
    job.commandId=command.id;job.phase='awaiting-client';saveModelJob(job);
    const ack=await waitForCommandAck(command.id,timeout);
    if(!ack) {job.state='unconfirmed';job.error='Клиент не подтвердил команду в срок. Команда могла продолжить выполнение; закрытие панели её не отменяет.';}
    else if(ack.serverPid!==job.targetPid || !ack.result.ok)throw Object.assign(new Error(),{code:'CLIENT_FAILED'});
    else job.result=ack.result;
  }
  if(job.state!=='unconfirmed'){job.state='succeeded';job.phase='complete';}
} catch(error) {
  if(!job)throw error;
  job.diagnostics={name:error.name,code:error.code,syscall:error.syscall,path:error.path,causeName:error.cause?.name,causeCode:error.cause?.code};
  job.state='failed';job.errorCode=error.code || 'MODEL_FAILED';
  job.error=error.code==='CONFLICT'?'Настройки изменились во время операции; результат не опубликован.':job.operation==='reindex'?'Переиндексация не завершена. При ошибке подготовки прежние векторы сохранены. Обновите состояние перед повтором.':job.operation==='download'?'Не удалось скачать и проверить выбранную модель. Частичный кэш сохранён; проверьте ID модели и сеть.':'Клиент не выполнил команду. Обновите его состояние и проверьте локальные журналы.';
} finally {
  try {await unloadModels('admin-job-finished');closeDatabase();if(job)saveModelJob(job);}finally{clearInterval(lifetime);}
}
