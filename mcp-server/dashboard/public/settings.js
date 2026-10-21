import { concatText, dateText, formatText, joinText, serviceText, setAttr, setText, t } from './i18n.js';
const $ = id => document.getElementById(id);
const groups = {search:t('m665'),models:t('m666'),web:t('m667'),sources:t('m668')};
const display = value => Array.isArray(value) ? joinText(value, '\n') || t('m92') : typeof value === 'boolean' ? value ? t('m91') : t('m92') : value;
export function createSettings({api,node,openDialog,allowDiscard,closeNavigation,onChanged,onOpen}) {
  let data, busy = false, pending, afterDiscard, reviewTrigger;
  const input = key => $(formatText`setting-${key}`);
  function message(text='',error=false) { setText($('settingsMessage'), serviceText(text)); $('settingsMessage').hidden=!text; $('settingsMessage').classList.toggle('error',error); }
  function fieldValue(field) {
    const control=input(field.key);
    return field.type==='boolean' ? control.checked : field.type==='number' ? Number(control.value) : field.type==='paths' ? control.value.split('\n').map(path=>path.trim()).filter(Boolean) : control.value.trim();
  }
  function enginePatch() { return data ? Object.fromEntries(data.fields.map(field=>[field.key,fieldValue(field)]).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(data.values[key]))) : {}; }
  function dirtyGroups() {
    if (!data) return [];
    return [Object.keys(enginePatch()).length && 'engine', $('settingsMode').value!==data.storage.mode && 'storage', ($('settingsSyncMode').value!==data.storage.syncMode || Number($('settingsInterval').value)!==data.storage.intervalHours) && 'schedule', ($('settingsCloudToken').value || $('settingsCloudUrl').value!==data.cloud.dbUrl) && 'cloud'].filter(Boolean);
  }
  const dirty=()=>!!dirtyGroups().length;
  function allow(group) {
    if (busy) return false;
    if(dirtyGroups().some(other=>other!==group)) {message(t('m669'),true);return false;}
    return true;
  }
  function draft() { setText($('settingsDraftState'), Object.keys(enginePatch()).length ? t('m670') : t('m671')); }
  function property(container,label,value) {container.append(node('dt',label),node('dd',display(value??'—')));}
  function render(next) {
    data=next; $('settingsContent').hidden=false; setText($('settingsLoadState'), '');
    $('settingsMode').value=data.storage.mode; $('settingsSyncMode').value=data.storage.syncMode; $('settingsInterval').value=data.storage.intervalHours;
    const cloudMode=data.storage.mode==='cloud-snapshots';
    $('settingsScheduleFields').disabled=!cloudMode;
    setText($('settingsScheduleHint'), cloudMode ? t('m672') : t('m673'));
    const migration=data.storage.legacyCloudBackupRequired || data.storage.legacyCloudRestoreRequired;
    $('settingsMigration').hidden=!migration;
    setText($('settingsMigration'), data.storage.legacyCloudRestoreRequired ? t('m674') : t('m675'));
    $('settingsCloudUrl').value=data.cloud.dbUrl; $('settingsCloudToken').value='';
    setText($('settingsCloudStatus'), t('m676', data.cloud.configured ? t('m677') : t('m678'), data.cloud.source));
    $('settingsSnapshotUpload').disabled=!cloudMode || migration;
    $('settingsSnapshotStatus').replaceChildren();
    for(const [label,value] of [[t('m679'),data.snapshots.lastUploadedId],[t('m680'),data.snapshots.pendingId],[t('m681'),cloudMode && data.storage.syncMode==='scheduled' && data.snapshots.nextDueAt ? dateText(new Date(data.snapshots.nextDueAt), 'toLocaleString') : t('m682')],[t('m683'),data.snapshots.nextAttemptAt ? dateText(new Date(data.snapshots.nextAttemptAt), 'toLocaleString') : null],[t('m684'),data.snapshots.quotaBlocked],[t('m685'),data.snapshots.lastError]]) property($('settingsSnapshotStatus'),label,value);
    $('settingsGroups').replaceChildren();
    for(const [group,label] of Object.entries(groups)) {
      const section=node('section',null,'settings-section'),heading=node('h3',label),grid=node('div',null,'settings-grid');
      section.append(heading,grid);
      for(const field of data.fields.filter(field=>field.group===group)) {
        const wrap=node('div',null,'field'),label=node('label',serviceText(field.label));label.htmlFor=formatText`setting-${field.key}`;
        const control=node(field.type==='select' ? 'select' : field.type==='paths' ? 'textarea' : 'input');
        control.id=formatText`setting-${field.key}`;control.name=field.key;
        if(field.type==='select') for(const [value,label] of field.options) {const option=node('option',serviceText(label));option.value=value;control.append(option);}
        else if(field.type==='paths') control.rows=3;
        else {control.type=field.type==='boolean' ? 'checkbox' : field.type==='number' ? 'number' : 'text';if(field.type!=='boolean')control.required=true;}
        if(field.type==='number') {control.min=field.min;control.max=field.max;control.step=field.step;}
        if(field.type==='boolean') {control.checked=data.values[field.key];wrap.classList.add('settings-check');}
        else control.value=field.type==='paths' ? joinText(data.values[field.key], '\n') : data.values[field.key];
        const hint=node('p',serviceText(field.hint),'caption');hint.id=formatText`setting-${field.key}-hint`;control.setAttribute('aria-describedby',formatText`${hint.id} settingsMessage`);
        wrap.append(label,control,hint);grid.append(wrap);control.addEventListener('input',()=>{control.removeAttribute('aria-invalid');draft();});
      }
      $('settingsGroups').append(section);
    }
    draft();
  }
  async function load() { $('settingsContent').hidden=true; setText($('settingsLoadState'), t('m686')); try {render(await api('/api/settings'));}catch(error){message(error.message,true);setText($('settingsLoadState'), t('m687'));} }
  async function operation(path,request,{review=false}={}) {
    if(busy)return;
    busy=true;const disabled=new Map();
    for(const control of document.querySelectorAll('#settingsDialog button,#settingsDialog input,#settingsDialog select,#settingsDialog textarea,#settingsReviewDialog button')) {disabled.set(control,control.disabled);control.disabled=true;}
    $('settingsDialog').setAttribute('aria-busy','true');$('settingsReviewApply').disabled=true;
    message(t('m688'));
    try {
      const result=await api(path,request);
      if(result.settings)render(result.settings);
      if(review){$('settingsReviewDialog').close();pending=null;}
      if(path==='/api/snapshots') {
        render(await api('/api/settings'));await listSnapshots();
      }
      let text={saved:t('m689'),enabled:t('m690'),connected:t('m691', dateText(new Date(result.observedAt), 'toLocaleString')),uploaded:t('m692'),unchanged:t('m693'),'saved-local':t('m694'),'local-only':serviceText(result.reason),restored:t('m695'),deleted:t('m696'),'restore-required':t('m697', result.cloudBackupId)}[result.status] || t('m698');
      if(result.reindexRequired)text = concatText(text, t('m699'));
      if(result.restartRequired)text = concatText(text, t('m700'));
      message(text,result.status==='local-only');
      if(['switch-mode','cloud-logout'].includes(request.action) || result.status==='restored')await onChanged();
      return result;
    } catch(error) {
      const text=error.message || t('m701');
      message(text,true);
      if(review){setText($('settingsReviewError'), serviceText(text));$('settingsReviewError').hidden=false;}
      if(error.code==='INVALID') for(const field of data?.fields||[]) if(text.startsWith(field.label))input(field.key)?.setAttribute('aria-invalid','true');
    } finally {
      busy=false;for(const [control,value] of disabled)if(control.isConnected)control.disabled=value;
      if(data){$('settingsScheduleFields').disabled=data.storage.mode!=='cloud-snapshots';$('settingsSnapshotUpload').disabled=data.storage.mode!=='cloud-snapshots'||data.storage.legacyCloudBackupRequired||data.storage.legacyCloudRestoreRequired;}
      $('settingsDialog').removeAttribute('aria-busy');$('settingsReviewApply').disabled=false;
      if(review && !$('settingsReviewDialog').open) {
        if(reviewTrigger?.isConnected && !reviewTrigger.disabled)reviewTrigger.focus();else $('settingsHeading').focus();
      }
    }
  }
  function review(path,request,hint,changes=[]) {
    reviewTrigger=document.activeElement;
    pending={path,request};setText($('settingsReviewHint'), hint);$('settingsReviewChanges').replaceChildren();
    for(const [label,value] of changes)property($('settingsReviewChanges'),label,value);
    $('settingsReviewError').hidden=true;openDialog('settingsReviewDialog');
  }
  async function listSnapshots() {
    const location=$('settingsSnapshotLocation').value;
    setText($('settingsSnapshotListStatus'), t('m702'));
    try {
      const rows=await api('/api/snapshots',{action:'list',location,limit:100});
      $('settingsSnapshotList').replaceChildren();setText($('settingsSnapshotListStatus'), rows.length ? t('m703', rows.length) : t('m704'));
      for(const row of rows) {
        const li=node('li'),description=node('p',t('m705', dateText(new Date(Number(row.created_at)), 'toLocaleString'), (Number(row.size)/1024).toFixed(1), Number(row.pinned) ? t('m706') : ''));
        li.append(description,node('p',row.id,'caption'));const actions=node('div',null,'settings-actions');
        for(const [label,action] of [[t('m707'),'restore'],[Number(row.pinned) ? t('m708') : t('m709'),'pin']]) {
          const button=node('button',label,'button secondary');button.type='button';setAttr(button, 'aria-label', t('m710', label, row.id));
          button.addEventListener('click',async()=>{
            if(!allow())return;
            if(action==='pin')await operation('/api/snapshots',{action,id:row.id,location,pinned:!Number(row.pinned)});
            else await prepareSnapshot({action,id:row.id,location});
          });actions.append(button);
        }li.append(actions);$('settingsSnapshotList').append(li);
      }
    }catch(error){setText($('settingsSnapshotListStatus'), serviceText(error.message));$('settingsSnapshotList').replaceChildren();}
  }
  async function prepareSnapshot(request) {
    if(!allow())return;
    busy=true;const disabled=new Map();
    for(const control of $('settingsDialog').querySelectorAll('button,input,select,textarea')) {disabled.set(control,control.disabled);control.disabled=true;}
    $('settingsDialog').setAttribute('aria-busy','true');
    try {
      const result=await api('/api/snapshots',request);
      const counts=value=>t('m711', value.notebookStores, value.documents, value.factsLinked, value.chunks);
      const changes=request.action==='restore' ? [[t('m712'),request.id],[t('m713'),counts(result.current)],[t('m714'),counts(result.replacement)]] : Object.entries(result).filter(([key])=>['local','cloud'].includes(key)).map(([key,value])=>[key==='local' ? t('m715') : t('m716'),t('m717', value.count, (value.bytes/1024).toFixed(1))]);
      review('/api/snapshots',{...request,confirmToken:result.confirmToken},request.action==='restore' ? t('m718') : t('m719'),changes);
    }catch(error){message(error.message,true);}finally{busy=false;for(const [control,value] of disabled)if(control.isConnected)control.disabled=value;$('settingsDialog').removeAttribute('aria-busy');}
  }
  function discardThen(callback) {if(!dirty()){callback();return;}afterDiscard=callback;openDialog('settingsDiscardDialog');}
  function close() {if(!busy)discardThen(()=>{$('settingsCloudToken').value='';$('settingsDialog').close();});}
  $('openSettings').addEventListener('click',async()=>{if(!await allowDiscard())return;onOpen();closeNavigation();openDialog('settingsDialog');$('settingsHeading').focus();await load();});
  $('settingsClose').addEventListener('click',close);
  $('settingsDialog').addEventListener('cancel',event=>{event.preventDefault();close();});
  $('settingsReviewDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('settingsDiscard').addEventListener('click',()=>{$('settingsDiscardDialog').close();const callback=afterDiscard;afterDiscard=null;if(data)render(data);callback?.();});
  $('settingsReload').addEventListener('click',()=>{if(!busy)discardThen(()=>{message();load();});});
  $('settingsStorageForm').addEventListener('submit',event=>{event.preventDefault();if(!allow('storage'))return;review('/api/settings',{action:'switch-mode',mode:$('settingsMode').value,expectedVersion:data.version},t('m720'), [[t('m115'),formatText`${data.storage.mode} → ${$('settingsMode').value}`]]);});
  $('settingsScheduleForm').addEventListener('submit',event=>{event.preventDefault();if(!allow('schedule'))return;review('/api/settings',{action:'configure-snapshots',syncMode:$('settingsSyncMode').value,intervalHours:Number($('settingsInterval').value),expectedVersion:data.version},t('m721'), [[t('m722'),$('settingsSyncMode').value],[t('m723'),Number($('settingsInterval').value)]]);});
  $('settingsEngineForm').addEventListener('submit',event=>{event.preventDefault();if(!allow('engine'))return;const fields=enginePatch();if(!Object.keys(fields).length){message(t('m724'));return;}review('/api/settings',{action:'save',fields,expectedVersion:data.version},t('m725'),Object.entries(fields).map(([key,value])=>[serviceText(data.fields.find(field=>field.key===key).label),formatText`${display(data.values[key])} → ${display(value)}`]));});
  $('settingsCloudForm').addEventListener('submit',event=>{event.preventDefault();if(!allow('cloud'))return;review('/api/settings',{action:'cloud-login',dbUrl:$('settingsCloudUrl').value.trim(),token:$('settingsCloudToken').value,expectedVersion:data.version},t('m726'),[[t('m727'),$('settingsCloudUrl').value.trim()]]);});
  $('settingsCloudCheck').addEventListener('click',()=>{if(allow())operation('/api/settings',{action:'cloud-check'});});
  $('settingsCloudLogout').addEventListener('click',()=>{if(allow())review('/api/settings',{action:'cloud-logout',expectedVersion:data.version},t('m728'));});
  $('settingsReviewApply').addEventListener('click',async()=>{if(pending){const {path,request}=pending;await operation(path,request,{review:true});if(request.action==='cloud-login'){$('settingsCloudToken').value='';request.token='';if($('settingsReviewDialog').open)$('settingsReviewDialog').close();}}});
  $('settingsReviewDialog').addEventListener('close',()=>{if(pending?.request.action==='cloud-login')pending.request.token='';pending=null;});
  $('settingsSnapshotCreate').addEventListener('click',()=>{if(allow())operation('/api/snapshots',{action:'create'});});
  $('settingsSnapshotUpload').addEventListener('click',()=>{if(allow())operation('/api/snapshots',{action:'upload'});});
  $('settingsSnapshotListForm').addEventListener('submit',event=>{event.preventDefault();if(!busy)listSnapshots();});
  $('settingsSnapshotDeleteForm').addEventListener('submit',event=>{event.preventDefault();prepareSnapshot({action:'delete',from:Date.parse(concatText($('settingsDeleteFrom').value, 'T00:00:00Z')),to:Date.parse(concatText($('settingsDeleteTo').value, 'T00:00:00Z')),location:$('settingsDeleteLocation').value});});
  window.addEventListener('beforeunload',event=>{if(busy||$('settingsDialog').open && dirty()){event.preventDefault();event.returnValue='';}});
  return {dirty};
}
