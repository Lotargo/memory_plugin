const $ = id => document.getElementById(id);
const groups = {search:'Поиск',models:'Модели и вычисления',web:'Веб-панель',sources:'Доступ к источникам'};
const display = value => Array.isArray(value) ? value.join('\n') || 'Нет' : typeof value === 'boolean' ? value ? 'Да' : 'Нет' : String(value);
export function createSettings({api,node,openDialog,allowDiscard,closeNavigation,onChanged,onOpen}) {
  let data, busy = false, pending, afterDiscard, reviewTrigger;
  const input = key => $(`setting-${key}`);
  function message(text='',error=false) { $('settingsMessage').textContent=text; $('settingsMessage').hidden=!text; $('settingsMessage').classList.toggle('error',error); }
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
    if(dirtyGroups().some(other=>other!==group)) {message('Есть правки в другом блоке. Сохраните их или отмените перед этой операцией.',true);return false;}
    return true;
  }
  function draft() { $('settingsDraftState').textContent=Object.keys(enginePatch()).length ? 'Есть несохранённые настройки.' : 'Без изменений.'; }
  function property(container,label,value) {container.append(node('dt',label),node('dd',display(value??'—')));}
  function render(next) {
    data=next; $('settingsContent').hidden=false; $('settingsLoadState').textContent='';
    $('settingsMode').value=data.storage.mode; $('settingsSyncMode').value=data.storage.syncMode; $('settingsInterval').value=data.storage.intervalHours;
    const cloudMode=data.storage.mode==='cloud-snapshots';
    $('settingsScheduleFields').disabled=!cloudMode;
    $('settingsScheduleHint').textContent=cloudMode ? 'Для отправки требуется сохранённое облачное подключение.' : 'Расписание доступно в режиме «Локально + облачные снимки».';
    const migration=data.storage.legacyCloudBackupRequired || data.storage.legacyCloudRestoreRequired;
    $('settingsMigration').hidden=!migration;
    $('settingsMigration').textContent=data.storage.legacyCloudRestoreRequired ? 'Прежний режим only-cloud: включите облачные снимки для резервирования, затем явно восстановите скачанный локальный архив. До восстановления память недоступна.' : 'Прежний hybrid-sync: включение облачных снимков сначала сохранит локальную и старую облачную копии.';
    $('settingsCloudUrl').value=data.cloud.dbUrl; $('settingsCloudToken').value='';
    $('settingsCloudStatus').textContent=`${data.cloud.configured ? 'Подключение сохранено' : 'Подключение не задано'} · источник: ${data.cloud.source}. Доступность сети не проверялась.`;
    $('settingsSnapshotUpload').disabled=!cloudMode || migration;
    $('settingsSnapshotStatus').replaceChildren();
    for(const [label,value] of [['Последний отправленный снимок',data.snapshots.lastUploadedId],['Ожидающий снимок',data.snapshots.pendingId],['Следующая отправка',cloudMode && data.storage.syncMode==='scheduled' && data.snapshots.nextDueAt ? new Date(data.snapshots.nextDueAt).toLocaleString('ru') : 'Расписание выключено'],['Повтор после ошибки',data.snapshots.nextAttemptAt ? new Date(data.snapshots.nextAttemptAt).toLocaleString('ru') : null],['Квота блокирует отправку',data.snapshots.quotaBlocked],['Ошибка отправки',data.snapshots.lastError]]) property($('settingsSnapshotStatus'),label,value);
    $('settingsGroups').replaceChildren();
    for(const [group,label] of Object.entries(groups)) {
      const section=node('section',null,'settings-section'),heading=node('h3',label),grid=node('div',null,'settings-grid');
      section.append(heading,grid);
      for(const field of data.fields.filter(field=>field.group===group)) {
        const wrap=node('div',null,'field'),label=node('label',field.label);label.htmlFor=`setting-${field.key}`;
        const control=node(field.type==='select' ? 'select' : field.type==='paths' ? 'textarea' : 'input');
        control.id=`setting-${field.key}`;control.name=field.key;
        if(field.type==='select') for(const [value,label] of field.options) {const option=node('option',label);option.value=value;control.append(option);}
        else if(field.type==='paths') control.rows=3;
        else {control.type=field.type==='boolean' ? 'checkbox' : field.type==='number' ? 'number' : 'text';if(field.type!=='boolean')control.required=true;}
        if(field.type==='number') {control.min=field.min;control.max=field.max;control.step=field.step;}
        if(field.type==='boolean') {control.checked=data.values[field.key];wrap.classList.add('settings-check');}
        else control.value=field.type==='paths' ? data.values[field.key].join('\n') : data.values[field.key];
        const hint=node('p',field.hint,'caption');hint.id=`setting-${field.key}-hint`;control.setAttribute('aria-describedby',`${hint.id} settingsMessage`);
        wrap.append(label,control,hint);grid.append(wrap);control.addEventListener('input',()=>{control.removeAttribute('aria-invalid');draft();});
      }
      $('settingsGroups').append(section);
    }
    draft();
  }
  async function load() { $('settingsContent').hidden=true; $('settingsLoadState').textContent='Читаем локальные настройки…'; try {render(await api('/api/settings'));}catch(error){message(error.message,true);$('settingsLoadState').textContent='Не удалось загрузить настройки.';} }
  async function operation(path,request,{review=false}={}) {
    if(busy)return;
    busy=true;const disabled=new Map();
    for(const control of document.querySelectorAll('#settingsDialog button,#settingsDialog input,#settingsDialog select,#settingsDialog textarea,#settingsReviewDialog button')) {disabled.set(control,control.disabled);control.disabled=true;}
    $('settingsDialog').setAttribute('aria-busy','true');$('settingsReviewApply').disabled=true;
    message('Выполняем операцию…');
    try {
      const result=await api(path,request);
      if(result.settings)render(result.settings);
      if(review){$('settingsReviewDialog').close();pending=null;}
      if(path==='/api/snapshots') {
        render(await api('/api/settings'));await listSnapshots();
      }
      let text={saved:'Настройки сохранены.',enabled:'Облачные снимки включены. Локальная резервная копия сохранена.',connected:`Подключение проверено: ${new Date(result.observedAt).toLocaleString('ru')}.`,uploaded:'Снимок отправлен в облако.',unchanged:'Память не изменилась; повторная отправка не требуется.','saved-local':'Локальный снимок сохранён.','local-only':result.reason,restored:'Память восстановлена. Текущее состояние сохранено в резервном снимке.',deleted:'Выбранные снимки удалены.','restore-required':`Облачный архив сохранён локально: ${result.cloudBackupId}. Загрузите локальный список и выберите «Восстановить» для этого архива.`}[result.status] || 'Операция завершена.';
      if(result.reindexRequired)text+=' Смена модели или размерности требует переиндексации в разделе «Модели»; векторы ещё не перестроены.';
      if(result.restartRequired)text+=' Новый порт применится после перезапуска панели.';
      message(text,result.status==='local-only');
      if(['switch-mode','cloud-logout'].includes(request.action) || result.status==='restored')await onChanged();
      return result;
    } catch(error) {
      const text=error.message || 'Операция не завершена.';
      message(text,true);
      if(review){$('settingsReviewError').textContent=text;$('settingsReviewError').hidden=false;}
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
    pending={path,request};$('settingsReviewHint').textContent=hint;$('settingsReviewChanges').replaceChildren();
    for(const [label,value] of changes)property($('settingsReviewChanges'),label,value);
    $('settingsReviewError').hidden=true;openDialog('settingsReviewDialog');
  }
  async function listSnapshots() {
    const location=$('settingsSnapshotLocation').value;
    $('settingsSnapshotListStatus').textContent='Загружаем список…';
    try {
      const rows=await api('/api/snapshots',{action:'list',location,limit:100});
      $('settingsSnapshotList').replaceChildren();$('settingsSnapshotListStatus').textContent=rows.length ? `Снимков: ${rows.length}. Показаны последние 100.` : 'Снимков пока нет.';
      for(const row of rows) {
        const li=node('li'),description=node('p',`${new Date(Number(row.created_at)).toLocaleString('ru')} · ${(Number(row.size)/1024).toFixed(1)} КБ${Number(row.pinned) ? ' · Закреплён' : ''}`);
        li.append(description,node('p',row.id,'caption'));const actions=node('div',null,'settings-actions');
        for(const [label,action] of [['Восстановить','restore'],[Number(row.pinned) ? 'Снять закрепление' : 'Закрепить','pin']]) {
          const button=node('button',label,'button secondary');button.type='button';button.setAttribute('aria-label',`${label} снимок ${row.id}`);
          button.addEventListener('click',async()=>{
            if(!allow())return;
            if(action==='pin')await operation('/api/snapshots',{action,id:row.id,location,pinned:!Number(row.pinned)});
            else await prepareSnapshot({action,id:row.id,location});
          });actions.append(button);
        }li.append(actions);$('settingsSnapshotList').append(li);
      }
    }catch(error){$('settingsSnapshotListStatus').textContent=error.message;$('settingsSnapshotList').replaceChildren();}
  }
  async function prepareSnapshot(request) {
    if(!allow())return;
    busy=true;const disabled=new Map();
    for(const control of $('settingsDialog').querySelectorAll('button,input,select,textarea')) {disabled.set(control,control.disabled);control.disabled=true;}
    $('settingsDialog').setAttribute('aria-busy','true');
    try {
      const result=await api('/api/snapshots',request);
      const counts=value=>`Областей Notebook: ${value.notebookStores}; документов: ${value.documents}; связей: ${value.factsLinked}; чанков: ${value.chunks}.`;
      const changes=request.action==='restore' ? [['Снимок',request.id],['Текущее состояние',counts(result.current)],['Состояние из снимка',counts(result.replacement)]] : Object.entries(result).filter(([key])=>['local','cloud'].includes(key)).map(([key,value])=>[key==='local' ? 'На компьютере' : 'В облаке',`${value.count} снимков, ${(value.bytes/1024).toFixed(1)} КБ`]);
      review('/api/snapshots',{...request,confirmToken:result.confirmToken},request.action==='restore' ? 'Рабочая память будет полностью заменена снимком. Перед восстановлением сохраняется резервная копия текущего состояния. Закройте другие клиенты памяти.' : 'Будут удалены только снимки из предпросмотра. Рабочая память остаётся доступной.',changes);
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
  $('settingsStorageForm').addEventListener('submit',event=>{event.preventDefault();if(!allow('storage'))return;review('/api/settings',{action:'switch-mode',mode:$('settingsMode').value,expectedVersion:data.version},'Применить режим хранения?', [['Режим',`${data.storage.mode} → ${$('settingsMode').value}`]]);});
  $('settingsScheduleForm').addEventListener('submit',event=>{event.preventDefault();if(!allow('schedule'))return;review('/api/settings',{action:'configure-snapshots',syncMode:$('settingsSyncMode').value,intervalHours:Number($('settingsInterval').value),expectedVersion:data.version},'Изменить расписание отправки снимков?', [['Отправка',$('settingsSyncMode').value],['Интервал, часов',Number($('settingsInterval').value)]]);});
  $('settingsEngineForm').addEventListener('submit',event=>{event.preventDefault();if(!allow('engine'))return;const fields=enginePatch();if(!Object.keys(fields).length){message('Нет изменённых настроек.');return;}review('/api/settings',{action:'save',fields,expectedVersion:data.version},'Настройки сохраняются для всех клиентов. Смена embedding-модели или размерности требует отдельной переиндексации.',Object.entries(fields).map(([key,value])=>[data.fields.find(field=>field.key===key).label,`${display(data.values[key])} → ${display(value)}`]));});
  $('settingsCloudForm').addEventListener('submit',event=>{event.preventDefault();if(!allow('cloud'))return;review('/api/settings',{action:'cloud-login',dbUrl:$('settingsCloudUrl').value.trim(),token:$('settingsCloudToken').value,expectedVersion:data.version},'Сохранить подключение в зашифрованном хранилище? Проверка сети выполняется отдельно.',[['URL базы',$('settingsCloudUrl').value.trim()]]);});
  $('settingsCloudCheck').addEventListener('click',()=>{if(allow())operation('/api/settings',{action:'cloud-check'});});
  $('settingsCloudLogout').addEventListener('click',()=>{if(allow())review('/api/settings',{action:'cloud-logout',expectedVersion:data.version},'Удалить сохранённые секреты и перейти к локальному режиму? Учётные данные из окружения остаются заданными.');});
  $('settingsReviewApply').addEventListener('click',async()=>{if(pending){const {path,request}=pending;await operation(path,request,{review:true});if(request.action==='cloud-login'){$('settingsCloudToken').value='';request.token='';if($('settingsReviewDialog').open)$('settingsReviewDialog').close();}}});
  $('settingsReviewDialog').addEventListener('close',()=>{if(pending?.request.action==='cloud-login')pending.request.token='';pending=null;});
  $('settingsSnapshotCreate').addEventListener('click',()=>{if(allow())operation('/api/snapshots',{action:'create'});});
  $('settingsSnapshotUpload').addEventListener('click',()=>{if(allow())operation('/api/snapshots',{action:'upload'});});
  $('settingsSnapshotListForm').addEventListener('submit',event=>{event.preventDefault();if(!busy)listSnapshots();});
  $('settingsSnapshotDeleteForm').addEventListener('submit',event=>{event.preventDefault();prepareSnapshot({action:'delete',from:Date.parse($('settingsDeleteFrom').value+'T00:00:00Z'),to:Date.parse($('settingsDeleteTo').value+'T00:00:00Z'),location:$('settingsDeleteLocation').value});});
  window.addEventListener('beforeunload',event=>{if(busy||$('settingsDialog').open && dirty()){event.preventDefault();event.returnValue='';}});
  return {dirty};
}
