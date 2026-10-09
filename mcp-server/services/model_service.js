import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MEMORY_DIR } from '../memory.js';
import { nodeExecutable } from '../client_cli.js';
import { getConfig } from '../config/config_manager.js';
import { getDatabase, MODELS_DIR } from '../db/database.js';
import { getModelStorageInfo, listAllCachedModels, isValidModelId } from '../ml/model_manager.js';
import { readRuntimeStates, readCommandAck, isProcessAlive, CONTROL_DIR } from '../ml/model_control.js';
import { withSnapshotLock, atomicWrite } from '../storage/snapshot_lock.js';
import { EMBEDDING_PRESETS, RERANKER_PRESETS } from '../cli/ui.js';

const directory = path.join(CONTROL_DIR, 'model-admin');
const activeFile = path.join(directory, 'active.json');
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = file => { try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch(error) { if(error.code==='ENOENT')return null;fail('RECOVERY_REQUIRED','Не удалось прочитать запись операции моделей. Сохраните файлы и проверьте локальное хранилище.'); } };
export const modelConfig = () => { const config=getConfig();return Object.fromEntries(['embeddingModel','vectorDimension','rerankerModel','rerankerEnabled','executionDevice','batchSize','onnxThreads','gpuAttentionBudget','modelUnloadTimeoutMinutes'].map(key => [key,config[key]])); };
export const modelVersion = () => hash(modelConfig());
export const modelJobFile = id => {
  if (typeof id !== 'string' || !/^model_[a-f0-9-]{36}$/.test(id)) fail('INVALID','Неверный ID операции.');
  return path.join(directory, id+'.json');
};
export function saveModelJob(job) { atomicWrite(modelJobFile(job.operationId), JSON.stringify({...job,updatedAt:Date.now()}), {renameRetries:30}); }
export function modelJobStatus(id) {
  const job = read(modelJobFile(id));
  if (!job) fail('NOT_FOUND','Операция не найдена.');
  if(job.state==='unconfirmed') {
    const ack=readCommandAck(job.commandId);
    if(ack?.id===job.commandId && ack.serverPid===job.targetPid) {
      job.state=ack.result?.ok?'succeeded':'failed';job.result=ack.result?.ok?ack.result:undefined;job.error=ack.result?.ok?undefined:'Клиент сообщил об ошибке выполнения команды.';saveModelJob(job);
    } else if(!isProcessAlive(job.targetPid)) {job.state='interrupted';job.error='Выбранный процесс клиента завершился без подтверждения команды.';saveModelJob(job);}
  }
  if (['queued','running'].includes(job.state) && !isProcessAlive(job.workerPid || job.ownerPid)) {
    job.state='interrupted';job.error='Процесс операции завершился без подтверждения результата. Обновите состояние перед повтором.';saveModelJob(job);
  }
  return job;
}
function activeJob() { const active=read(activeFile); return active?.operationId ? modelJobStatus(active.operationId) : null; }
function assertIdle() { const job=activeJob();if(job && ['queued','running','unconfirmed'].includes(job.state))fail('BUSY','Другая операция с моделями ещё выполняется или ожидает подтверждения.'); }
function modelName(name) {
  if(!isValidModelId(name))fail('INVALID','Укажите ID модели organization/model.');
  return name;
}
function owners() { return readRuntimeStates().map(state => ({...state,fresh:Date.now()-Date.parse(state.updatedAt)<15000})); }
export async function modelOverview() {
  const config=modelConfig(), names=new Set([config.embeddingModel,...(config.rerankerModel==='none'?[]:[config.rerankerModel]),...listAllCachedModels().map(row=>row.modelName)]);
  return {version:modelVersion(),config,models:[...names].map(model=>({model,...getModelStorageInfo(model)})),owners:owners(),coverage:'registered-processes-only',
    presets:{embedding:EMBEDDING_PRESETS,reranker:RERANKER_PRESETS.filter(model=>model!=='none')},job:activeJob(),observedAt:Date.now()};
}
// No links/reparse points and no escaped path are accepted for cache removal.
function cacheTree(model) {
  const root=path.resolve(MODELS_DIR), dir=path.resolve(root,...modelName(model).split('/'));
  const rel=path.relative(root,dir);
  if(!rel || rel.split(path.sep).length!==2 || rel.startsWith('..') || path.isAbsolute(rel))fail('INVALID','Нужен путь одной модели внутри каталога кэша.');
  const entries=[];
  for(const p of [root,path.dirname(dir),dir]) if(fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink())fail('UNSUPPORTED','Удаление кэша через ссылку недоступно.');
  function visit(folder) { for(const entry of fs.readdirSync(folder,{withFileTypes:true})) {
    const file=path.join(folder,entry.name),stat=fs.lstatSync(file);
    if(stat.isSymbolicLink())fail('UNSUPPORTED','В кэше есть ссылка; удаление недоступно.');
    if(stat.isDirectory())visit(file);else if(stat.isFile())entries.push([path.relative(dir,file),stat.size,stat.mtimeMs]);
  } }
  if(fs.existsSync(dir))visit(dir);
  return {dir,entries};
}
export async function modelPreview(operation, model) {
  assertIdle();
  if(operation==='delete-cache') {
    modelName(model);
    if(owners().length)fail('BUSY','Перед удалением кэша закройте клиенты памяти: зарегистрированные процессы могут использовать модель.');
    const tree=cacheTree(model),info=getModelStorageInfo(model);
    if(!tree.entries.length)fail('NOT_FOUND','Кэш модели пуст или не найден.');
    return {operation,model,bytes:info.bytes,previewToken:hash({operation,model,tree,version:modelVersion()}),expiresHint:'Предпросмотр проверяется повторно перед удалением.'};
  }
  if(operation==='reindex') {
    const config=modelConfig();
    if(getModelStorageInfo(config.embeddingModel).status!=='downloaded')fail('UNSUPPORTED','Сначала скачайте выбранную embedding-модель.');
    const db=await getDatabase();
    const rows=await db.prepare('SELECT id,doc_id,content FROM micro_chunks ORDER BY id').all();
    return {operation,model:config.embeddingModel,dimension:config.vectorDimension,chunks:rows.length,documents:new Set(rows.map(row=>row.doc_id)).size,
      previewToken:hash({operation,version:modelVersion(),rows}),scope:'all-local-knowledge'};
  }
  fail('INVALID','Неизвестная операция предпросмотра.');
}
export async function startModelJob(input, {launch=launchWorker}={}) {
  return withSnapshotLock(directory, async()=>{
    assertIdle();
    if(input.expectedVersion!==modelVersion())fail('CONFLICT','Настройки моделей изменились. Обновите панель перед запуском.');
    if(!['download','load','unload','apply-device','reindex'].includes(input.operation))fail('INVALID','Неизвестная операция моделей.');
    if(input.operation==='download') { modelName(input.model);if(!['embedding','reranker'].includes(input.type))fail('INVALID','Выберите тип модели.'); }
    if(['load','unload','apply-device'].includes(input.operation)) {
      const owner=owners().find(owner=>owner.serverPid===input.targetPid);
      if(!owner || !owner.fresh)fail('UNAVAILABLE','Нет свежего состояния выбранного процесса клиента.');
      if(owner.controlProtocol!==2)fail('UNSUPPORTED','Этот клиент использует старый протокол управления моделями. Обновите плагин в клиенте.');
      if(input.operation!=='unload' && !['cpu','webgpu'].includes(input.device))fail('INVALID','Выберите CPU или GPU.');
      if(input.operation==='load') {
        const config=modelConfig();
        for(const model of [config.embeddingModel,...(config.rerankerEnabled && config.rerankerModel!=='none'?[config.rerankerModel]:[])])if(getModelStorageInfo(model).status!=='downloaded')fail('UNSUPPORTED',`Сначала скачайте модель ${model}.`);
      }
    }
    if(input.operation==='reindex') {
      const preview=await modelPreview('reindex');
      if(input.previewToken!==preview.previewToken)fail('CONFLICT','Индекс или настройки изменились после предпросмотра.');
    }
    const job={operationId:'model_'+randomUUID(),operation:input.operation,model:input.model,type:input.type,targetPid:input.targetPid,device:input.device,
      config:modelConfig(),expectedVersion:input.expectedVersion,state:'queued',phase:'queued',ownerPid:process.pid,createdAt:Date.now()};
    saveModelJob(job);atomicWrite(activeFile,JSON.stringify({operationId:job.operationId}));
    try { const worker=await launch(job);job.workerPid=worker.pid;saveModelJob(job);worker.start?.(); }
    catch {job.state='failed';job.error='Не удалось запустить процесс операции.';saveModelJob(job);}
    return modelJobStatus(job.operationId);
  });
}
function launchWorker(job) {
  const worker=spawn(nodeExecutable(),[fileURLToPath(new URL('../ml/model_admin_worker.js',import.meta.url)),job.operationId],{
    windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,MEMORY_DIR,MEMORY_DISABLE_BACKGROUND_SYNC:'1',MEMORY_DISABLE_PERSONA_SYNC:'1',MEMORY_DISABLE_WEB_AUTOSTART:'1'}
  });
  // Handshake prevents the worker receipt being overwritten by the launcher's queued receipt.
  let ready=false,go=false,started=false;
  function start(){if(!ready || !go || started)return;started=true;worker.send('start');worker.unref();}
  worker.on('message',message=>{if(message==='ready'){ready=true;start();}});
  worker.on('error',()=>{job.state='failed';job.error='Процесс операции не запущен.';saveModelJob(job);});
  return {pid:worker.pid,start(){go=true;start();}};
}
export async function modelsRequest(input, dependencies) {
  const allowed={read:['action'],status:['action','operationId'],preview:['action','operation','model'],start:['action','operation','model','type','targetPid','device','expectedVersion','previewToken'], 'delete-cache':['action','model','expectedVersion','previewToken']};
  if(!Object.hasOwn(allowed,input?.action) || Object.keys(input).some(key=>!allowed[input.action].includes(key)))fail('INVALID','Неизвестное поле операции моделей.');
  if(input.action==='read')return modelOverview();
  if(input.action==='status')return modelJobStatus(input.operationId);
  if(input.action==='preview')return modelPreview(input.operation,input.model);
  if(input.action==='start')return startModelJob(input,dependencies);
  return withSnapshotLock(directory,async()=>{
    if(input.expectedVersion!==modelVersion())fail('CONFLICT','Настройки моделей изменились.');
    const preview=await modelPreview('delete-cache',input.model);
    if(input.previewToken!==preview.previewToken)fail('CONFLICT','Кэш изменился после предпросмотра. Обновите список.');
    const tree=cacheTree(input.model);
    fs.rmSync(tree.dir,{recursive:true,force:false});
    return {status:'deleted',model:input.model,freedBytes:preview.bytes};
  });
}
