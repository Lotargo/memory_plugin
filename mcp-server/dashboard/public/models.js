import { dateText, formatText, joinText, setAttr, serviceText, setText, t } from './i18n.js';
import {createResourceView} from './resources.js';
const $=id=>document.getElementById(id);
const live=job=>job && ['queued','running','unconfirmed'].includes(job.state);
const operations={download:t('m482'),load:t('m483'),unload:t('m484'),'apply-device':t('m485'),reindex:t('m486')};
const states={queued:t('m487'),running:t('m488'),succeeded:t('m489'),failed:t('m205'),interrupted:t('m490'),unconfirmed:t('m491')};
export function createModels({api,node,openDialog,allowDiscard,closeNavigation,onChanged}) {
  const resources = createResourceView({api,node});
  let data,pending,busy=false,timer,job,reviewTrigger;
  function message(text='',error=false){setText($('modelsMessage'), text);$('modelsMessage').hidden=!text;$('modelsMessage').classList.toggle('error',error);}
  function property(container,label,value){container.append(node('dt',label),node('dd',value??'—'));}
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
    setText($('modelsOwnerHint'), !owner ? t('m492') : !owner.fresh ? t('m493') : owner.controlProtocol!==2 ? t('m494') : t('m495', dateText(new Date(owner.updatedAt), 'toLocaleString')));
    if(owner) {
      property($('modelsRuntime'),t('m496'),t('m497', owner.serverRssMB??'—'));
      for(const [label,value] of [['Embedding',owner.embedding],['Reranker',owner.reranker]])property($('modelsRuntime'),label,value?.loaded?formatText`${value.loadedModel} · ${value.device?.toUpperCase()}`:t('m498'));
    }
    disabled();
  }
  function presets(){const type=$('modelsType').value;$('modelsPresets').replaceChildren(...(data?.presets[type]||[]).map(value=>{const option=node('option');option.value=value;return option;}));}
  function render(next) {
    const previous=$('modelsOwner').value;data=next;job=next.job;$('modelsContent').hidden=false;
    $('modelsConfig').replaceChildren();
    for(const [label,value] of [['Embedding',data.config.embeddingModel],[t('m499'),data.config.vectorDimension||t('m500')],['Reranker',data.config.rerankerEnabled?data.config.rerankerModel:t('m501')],[t('m502'),data.config.executionDevice==='cpu'?'CPU / RAM':'GPU / VRAM'],[t('m503'),data.config.modelUnloadTimeoutMinutes?t('m504', data.config.modelUnloadTimeoutMinutes):t('m505')]])property($('modelsConfig'),label,value);
    $('modelsOwner').replaceChildren(...data.owners.map(owner=>{const option=node('option',formatText`PID ${owner.serverPid}${!owner.fresh?t('m506'):''}`);option.value=owner.serverPid;return option;}));
    if(data.owners.some(owner=>String(owner.serverPid)===previous))$('modelsOwner').value=previous;
    if(!$('modelsDownloadName').value)$('modelsDownloadName').value=data.config.embeddingModel;
    if(!$('modelsDevice').matches(':focus'))$('modelsDevice').value=data.config.executionDevice;
    $('modelsCache').replaceChildren();
    for(const row of data.models) {
      const li=node('li');li.append(node('p',row.model),node('p',t('m507', ({downloaded:t('m508'),partial:t('m509'),not_downloaded:t('m510')})[row.status], row.sizeMB),'caption'));
      if(row.bytes) {const button=node('button',t('m511'),'button ghost danger');button.type='button';setAttr(button, 'aria-label', t('m512', row.model));button.addEventListener('click',()=>prepare('delete-cache',row.model));li.append(button);}
      $('modelsCache').append(li);
    }
    presets();runtime();renderJob();
  }
  async function refresh(){if(busy)return;busy=true;disabled();try{render(await api('/api/models'));message();}catch(error){message(serviceText(error.message),true);}finally{busy=false;disabled();}}
  function renderJob() {
    $('modelsJobSection').hidden=!job;if(!job){clearTimeout(timer);return;}
    setText($('modelsJobState'), formatText`${operations[job.operation]} · ${states[job.state]}`);
    const p=job.progress||{},pct=typeof p.done==='number' && p.total>0?p.done/p.total*100:typeof p.progress==='number'?p.progress:null;
    $('modelsProgress').max=100;if(pct===null)$('modelsProgress').removeAttribute('value');else $('modelsProgress').value=Math.max(0,Math.min(100,pct));
    $('modelsProgress').hidden=!live(job);
    setText($('modelsProgressText'), p.done!==undefined?t('m513', p.done, p.total) : joinText([p.file,pct!==null?formatText`${Math.round(pct)}%`:p.status].filter(Boolean), ' · '));
    setText($('modelsJobDetail'), serviceText(job.error) || (job.state==='succeeded' ? job.operation==='download'?t('m514', job.result.model):job.operation==='reindex'?t('m515', job.result.reindexed, job.result.documentsAffected):t('m516') : t('m517')));
    disabled();clearTimeout(timer);if(live(job) && $('modelsDialog').open)timer=setTimeout(poll,1000);
  }
  async function poll(){if(!job || !$('modelsDialog').open)return;try{job=await api(formatText`/api/models?action=status&operationId=${encodeURIComponent(job.operationId)}`);renderJob();if(!live(job)){await refresh();await onChanged();}}catch(error){message(serviceText(error.message),true);timer=setTimeout(poll,3000);}}
  function review(request,hint,changes=[]) {
    reviewTrigger=document.activeElement;pending={...request,expectedVersion:data.version};setText($('modelsReviewHint'), hint);$('modelsReviewChanges').replaceChildren();
    for(const [label,value] of changes)property($('modelsReviewChanges'),label,value);
    $('modelsReviewError').hidden=true;openDialog('modelsReviewDialog');
  }
  async function prepare(operation,model) {
    if(busy || live(job))return;busy=true;disabled();
    try{const preview=await api('/api/models',{action:'preview',operation,...(model?{model}: {})});
      review({action:operation==='delete-cache'?'delete-cache':'start',...(operation==='delete-cache'?{model}:{operation}),previewToken:preview.previewToken},operation==='delete-cache'?t('m518'):t('m519'),operation==='delete-cache'?[[t('m520'),model],[t('m521'),t('m497', (preview.bytes/1024/1024).toFixed(2))]]:[[t('m520'),preview.model],[t('m499'),preview.dimension||t('m500')],[t('m522'),preview.documents],[t('m523'),preview.chunks]]);
    }catch(error){message(serviceText(error.message),true);}finally{busy=false;disabled();}
  }
  $('openModels').addEventListener('click',async()=>{if(!await allowDiscard())return;closeNavigation();openDialog('modelsDialog');$('modelsHeading').focus();resources.start();await refresh();});
  $('modelsRefresh').addEventListener('click',()=>{refresh();resources.refresh();});
  $('modelsOwner').addEventListener('change',runtime);
  $('modelsType').addEventListener('change',()=>{presets();$('modelsDownloadName').value=data.config[$('modelsType').value==='embedding'?'embeddingModel':'rerankerModel']==='none'?'':data.config[$('modelsType').value==='embedding'?'embeddingModel':'rerankerModel'];});
  $('modelsSettings').addEventListener('click',()=>{if(busy)return;$('modelsDialog').close();$('openSettings').click();});
  $('modelsDownloadForm').addEventListener('submit',event=>{event.preventDefault();if(!busy&&!live(job))review({action:'start',operation:'download',model:$('modelsDownloadName').value.trim(),type:$('modelsType').value},t('m524'), [[t('m520'),$('modelsDownloadName').value.trim()],[t('m11'),$('modelsType').value]]);});
  for(const [id,operation] of [['modelsLoad','load'],['modelsUnload','unload'],['modelsApplyDevice','apply-device']])$(id).addEventListener('click',()=>{if(!busy&&!live(job))review({action:'start',operation,targetPid:Number($('modelsOwner').value),...(operation!=='unload'?{device:$('modelsDevice').value}:{})},operation==='unload'?t('m525'):operation==='load'?t('m526'):t('m527'),[[t('m528'),formatText`PID ${$('modelsOwner').value}`],[t('m529'),$('modelsDevice').value==='cpu'?'CPU / RAM':'GPU / VRAM']]);});
  $('modelsReindex').addEventListener('click',()=>prepare('reindex'));
  $('modelsReviewApply').addEventListener('click',async()=>{
    if(busy || !pending)return;busy=true;disabled();$('modelsReviewDialog').setAttribute('aria-busy','true');
    try{const result=await api('/api/models',pending);$('modelsReviewDialog').close();pending=null;if(result.operationId){job=result;renderJob();}else message(t('m530', result.model));data=await api('/api/models');render(data);}
    catch(error){setText($('modelsReviewError'), serviceText(error.message));$('modelsReviewError').hidden=false;}
    finally{busy=false;disabled();$('modelsReviewDialog').removeAttribute('aria-busy');if(!$('modelsReviewDialog').open)(reviewTrigger?.isConnected&&!reviewTrigger.disabled?reviewTrigger:$('modelsHeading')).focus();}
  });
  $('modelsDialog').addEventListener('close',()=>{clearTimeout(timer);resources.stop();});
  $('modelsReviewDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('modelsReviewDialog').addEventListener('close',()=>{pending=null;});
}
