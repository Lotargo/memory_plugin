import {createResourceView} from './resources.js';
const $=id=>document.getElementById(id);
const live=job=>job && ['queued','running','unconfirmed'].includes(job.state);
const operations={download:'Скачивание',load:'Загрузка в память',unload:'Выгрузка из памяти','apply-device':'Смена устройства',reindex:'Переиндексация'};
const states={queued:'В очереди',running:'Выполняется',succeeded:'Завершено',failed:'Ошибка',interrupted:'Результат не подтверждён',unconfirmed:'Ожидается подтверждение клиента'};
export function createModels({api,node,openDialog,allowDiscard,closeNavigation,onChanged}) {
  const resources = createResourceView({api,node});
  let data,pending,busy=false,timer,job,reviewTrigger;
  function message(text='',error=false){$('modelsMessage').textContent=text;$('modelsMessage').hidden=!text;$('modelsMessage').classList.toggle('error',error);}
  function property(container,label,value){container.append(node('dt',label),node('dd',String(value??'—')));}
  function disabled() {
    for(const button of [$('modelsLoad'),$('modelsUnload'),$('modelsApplyDevice')])button.disabled=busy || live(job) || !selectedOwner()?.fresh || selectedOwner()?.controlProtocol!==2;
    for(const id of ['modelsReindex','modelsDownloadName','modelsType','modelsDevice','modelsOwner'])$(id).disabled=busy || live(job);
    $('modelsDownloadForm').querySelector('button').disabled=busy || live(job);
    for(const button of $('modelsCache').querySelectorAll('button'))button.disabled=busy || live(job) || !!data?.owners.length;
    $('modelsRefresh').disabled=busy;$('modelsReviewApply').disabled=busy;
  }
  const selectedOwner=()=>data?.owners.find(owner=>String(owner.serverPid)===$('modelsOwner').value);
  function runtime() {
    const owner=selectedOwner();$('modelsRuntime').replaceChildren();
    $('modelsOwnerHint').textContent=!owner ? 'Зарегистрированный процесс клиента не найден. Состояние загруженных моделей неизвестно; скачивание и переиндексация доступны отдельно.' : !owner.fresh ? 'Состояние процесса устарело. Дождитесь свежего подтверждения.' : owner.controlProtocol!==2 ? 'Для команд требуется обновление плагина в этом клиенте.' : `Состояние на ${new Date(owner.updatedAt).toLocaleString('ru')}.`;
    if(owner) {
      property($('modelsRuntime'),'RAM процесса',`${owner.serverRssMB??'—'} МБ`);
      for(const [label,value] of [['Embedding',owner.embedding],['Reranker',owner.reranker]])property($('modelsRuntime'),label,value?.loaded?`${value.loadedModel} · ${value.device?.toUpperCase()}`:'Не загружена в этом процессе');
    }
    disabled();
  }
  function presets(){const type=$('modelsType').value;$('modelsPresets').replaceChildren(...(data?.presets[type]||[]).map(value=>{const option=node('option');option.value=value;return option;}));}
  function render(next) {
    const previous=$('modelsOwner').value;data=next;job=next.job;$('modelsContent').hidden=false;
    $('modelsConfig').replaceChildren();
    for(const [label,value] of [['Embedding',data.config.embeddingModel],['Размерность',data.config.vectorDimension||'По модели'],['Reranker',data.config.rerankerEnabled?data.config.rerankerModel:'Выключен'],['Устройство по умолчанию',data.config.executionDevice==='cpu'?'CPU / RAM':'GPU / VRAM'],['Выгрузка при простое',data.config.modelUnloadTimeoutMinutes?`${data.config.modelUnloadTimeoutMinutes} мин`:'Отключена']])property($('modelsConfig'),label,value);
    $('modelsOwner').replaceChildren(...data.owners.map(owner=>{const option=node('option',`PID ${owner.serverPid}${!owner.fresh?' · устарело':''}`);option.value=owner.serverPid;return option;}));
    if(data.owners.some(owner=>String(owner.serverPid)===previous))$('modelsOwner').value=previous;
    if(!$('modelsDownloadName').value)$('modelsDownloadName').value=data.config.embeddingModel;
    if(!$('modelsDevice').matches(':focus'))$('modelsDevice').value=data.config.executionDevice;
    $('modelsCache').replaceChildren();
    for(const row of data.models) {
      const li=node('li');li.append(node('p',row.model),node('p',`${({downloaded:'Файлы на месте',partial:'Частичный кэш',not_downloaded:'Не скачана'})[row.status]} · ${row.sizeMB} МБ`,'caption'));
      if(row.bytes) {const button=node('button','Удалить кэш','button ghost danger');button.type='button';button.setAttribute('aria-label',`Удалить кэш ${row.model}`);button.addEventListener('click',()=>prepare('delete-cache',row.model));li.append(button);}
      $('modelsCache').append(li);
    }
    presets();runtime();renderJob();
  }
  async function refresh(){if(busy)return;busy=true;disabled();try{render(await api('/api/models'));message();}catch(error){message(error.message,true);}finally{busy=false;disabled();}}
  function renderJob() {
    $('modelsJobSection').hidden=!job;if(!job){clearTimeout(timer);return;}
    $('modelsJobState').textContent=`${operations[job.operation]} · ${states[job.state]}`;
    const p=job.progress||{},pct=typeof p.done==='number' && p.total>0?p.done/p.total*100:typeof p.progress==='number'?p.progress:null;
    $('modelsProgress').max=100;if(pct===null)$('modelsProgress').removeAttribute('value');else $('modelsProgress').value=Math.max(0,Math.min(100,pct));
    $('modelsProgress').hidden=!live(job);
    $('modelsProgressText').textContent=p.done!==undefined?`${p.done} / ${p.total} чанков` : [p.file,pct!==null?`${Math.round(pct)}%`:p.status].filter(Boolean).join(' · ');
    $('modelsJobDetail').textContent=job.error || (job.state==='succeeded' ? job.operation==='download'?`${job.result.model}: модель проверена, кэш сохранён.`:job.operation==='reindex'?`Перестроено чанков: ${job.result.reindexed}; документов: ${job.result.documentsAffected}.`:'Клиент подтвердил выполнение команды.' : 'Операция продолжится при закрытии окна. Закрытие не отменяет команду.');
    disabled();clearTimeout(timer);if(live(job) && $('modelsDialog').open)timer=setTimeout(poll,1000);
  }
  async function poll(){if(!job || !$('modelsDialog').open)return;try{job=await api(`/api/models?action=status&operationId=${encodeURIComponent(job.operationId)}`);renderJob();if(!live(job)){await refresh();await onChanged();}}catch(error){message(error.message,true);timer=setTimeout(poll,3000);}}
  function review(request,hint,changes=[]) {
    reviewTrigger=document.activeElement;pending={...request,expectedVersion:data.version};$('modelsReviewHint').textContent=hint;$('modelsReviewChanges').replaceChildren();
    for(const [label,value] of changes)property($('modelsReviewChanges'),label,value);
    $('modelsReviewError').hidden=true;openDialog('modelsReviewDialog');
  }
  async function prepare(operation,model) {
    if(busy || live(job))return;busy=true;disabled();
    try{const preview=await api('/api/models',{action:'preview',operation,...(model?{model}: {})});
      review({action:operation==='delete-cache'?'delete-cache':'start',...(operation==='delete-cache'?{model}:{operation}),previewToken:preview.previewToken},operation==='delete-cache'?'Удалить файлы этой модели с диска? Для повторного использования потребуется скачивание.':'Перестроить векторы во всех локальных областях знаний? Сначала подготовятся новые векторы, затем индекс сохранится одной транзакцией.',operation==='delete-cache'?[['Модель',model],['Размер',`${(preview.bytes/1024/1024).toFixed(2)} МБ`]]:[['Модель',preview.model],['Размерность',preview.dimension||'По модели'],['Документы',preview.documents],['Чанки',preview.chunks]]);
    }catch(error){message(error.message,true);}finally{busy=false;disabled();}
  }
  $('openModels').addEventListener('click',async()=>{if(!await allowDiscard())return;closeNavigation();openDialog('modelsDialog');$('modelsHeading').focus();resources.start();await refresh();});
  $('modelsRefresh').addEventListener('click',()=>{refresh();resources.refresh();});
  $('modelsOwner').addEventListener('change',runtime);
  $('modelsType').addEventListener('change',()=>{presets();$('modelsDownloadName').value=data.config[$('modelsType').value==='embedding'?'embeddingModel':'rerankerModel']==='none'?'':data.config[$('modelsType').value==='embedding'?'embeddingModel':'rerankerModel'];});
  $('modelsSettings').addEventListener('click',()=>{if(busy)return;$('modelsDialog').close();$('openSettings').click();});
  $('modelsDownloadForm').addEventListener('submit',event=>{event.preventDefault();if(!busy&&!live(job))review({action:'start',operation:'download',model:$('modelsDownloadName').value.trim(),type:$('modelsType').value},'Скачать модель из Hugging Face и проверить её загрузку на CPU?', [['Модель',$('modelsDownloadName').value.trim()],['Тип',$('modelsType').value]]);});
  for(const [id,operation] of [['modelsLoad','load'],['modelsUnload','unload'],['modelsApplyDevice','apply-device']])$(id).addEventListener('click',()=>{if(!busy&&!live(job))review({action:'start',operation,targetPid:Number($('modelsOwner').value),...(operation!=='unload'?{device:$('modelsDevice').value}:{})},operation==='unload'?'Выгрузить embedding и reranker из выбранного процесса?':operation==='load'?'Загрузить выбранные модели из локального кэша? Выбор устройства сохраняется для следующих загрузок.':'Сохранить устройство и выгрузить прежние экземпляры в выбранном процессе? Следующая обработка загрузит модели на выбранное устройство.',[['Процесс',`PID ${$('modelsOwner').value}`],['Устройство',$('modelsDevice').value==='cpu'?'CPU / RAM':'GPU / VRAM']]);});
  $('modelsReindex').addEventListener('click',()=>prepare('reindex'));
  $('modelsReviewApply').addEventListener('click',async()=>{
    if(busy || !pending)return;busy=true;disabled();$('modelsReviewDialog').setAttribute('aria-busy','true');
    try{const result=await api('/api/models',pending);$('modelsReviewDialog').close();pending=null;if(result.operationId){job=result;renderJob();}else message(`Кэш удалён: ${result.model}.`);data=await api('/api/models');render(data);}
    catch(error){$('modelsReviewError').textContent=error.message;$('modelsReviewError').hidden=false;}
    finally{busy=false;disabled();$('modelsReviewDialog').removeAttribute('aria-busy');if(!$('modelsReviewDialog').open)(reviewTrigger?.isConnected&&!reviewTrigger.disabled?reviewTrigger:$('modelsHeading')).focus();}
  });
  $('modelsDialog').addEventListener('close',()=>{clearTimeout(timer);resources.stop();});
  $('modelsReviewDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('modelsReviewDialog').addEventListener('close',()=>{pending=null;});
}
