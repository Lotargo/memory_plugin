export function createProjectManager({ api, node, scopeKey, onSaved, openDialog, allowDiscard, closeNavigation }) {
  const $ = id => document.getElementById(id);
  let items=[], preview=null, request=null, busy=false;
  const labels={link:'Привязать каталог',unlink:'Отвязать каталог',relink:'Перенести память',migrate:'Перенести legacy-память'};
  function error(error) {
    $('projectError').hidden=false;
    $('projectError').textContent=error.code==='CONFLICT' ? 'Данные изменились или есть конфликт записей. Поля сохранены; проверьте предпросмотр заново.'
      : error.code==='INVALID' ? 'Проверьте абсолютный путь существующего Git-каталога, источник и целевой проект.'
      : error.code==='NOT_FOUND' ? 'Проект или ассоциация больше не доступны. Обновите список.'
      : error.code==='MIGRATION_REQUIRED' ? 'Сначала восстановите память прежнего облачного режима через CLI.'
      : error.code==='RECOVERY_REQUIRED' ? 'Публикация требует восстановления. Проверьте локальный журнал перед продолжением.'
      : 'Операция не завершена. Проверьте доступ к локальному хранилищу и резервному снимку.';
  }
  function invalidate() { preview=null; $('projectPreview').hidden=true; $('projectApply').hidden=true; $('projectReview').hidden=false; }
  function setBusy(value) {
    busy=value; $('projectDialog').setAttribute('aria-busy',String(value));
    for(const control of $('projectDialog').querySelectorAll('button,input,select')) control.disabled=value;
    if(!value) $('projectApply').disabled=!preview?.canApply;
  }
  function selected() { return items.find(item=>item.key===$('projectSource').value); }
  function display() {
    const item=selected(); $('projectDetails').replaceChildren();
    for(const [label,value] of [['Идентичность',item?.key],['Remote',item?.primaryRemote],['Записей',item?.facts],['Документов',item?.documents]]) {
      $('projectDetails').append(node('dt',label),node('dd',value==null?'Нет данных':String(value)));
    }
    $('projectAliases').replaceChildren(...(item?.aliases||[]).map(alias=>node('li',alias.alias)));
    if(!item?.aliases.length) $('projectAliases').append(node('li','Зарегистрированных ассоциаций нет.'));
    const paths=(item?.aliases||[]).filter(alias=>alias.kind==='path');
    $('projectPathAlias').replaceChildren(...paths.map(alias=>{const option=node('option',alias.alias.slice(5));option.value=alias.alias.slice(5);return option;}));
    $('projectPathAlias').required=$('projectOperation').value==='unlink';
    invalidate();
  }
  function mode() {
    const operation=$('projectOperation').value;
    $('projectInfo').hidden=operation==='link';
    $('projectDirectoryField').hidden=operation!=='link'; $('projectDirectory').required=operation==='link';
    $('projectSourceField').hidden=operation==='link'; $('projectSource').required=operation!=='link';
    $('projectTargetField').hidden=!['relink','migrate'].includes(operation);
    $('projectAliasField').hidden=operation!=='unlink';
    $('projectTarget').required=['relink','migrate'].includes(operation);
    $('projectHint').textContent=operation==='unlink' ? 'Отвязка удаляет только ассоциацию пути. Память и Git-автоопределение сохраняются.'
      : operation==='link' ? 'Укажите существующий Git-каталог. Привязка обнаружит память прежнего пути; перенос потребует проверки.'
      : 'Память объединится с выбранным проектом. Конфликтующие записи останутся на месте до их исправления. Git remote репозитория не меняется.';
    display();
  }
  async function open() {
    if(busy || !await allowDiscard()) return;
    closeNavigation(); openDialog('projectDialog'); $('projectError').hidden=true;
    setBusy(true);
    try {
      items=(await api('/api/projects?action=list')).items;
      $('projectSource').replaceChildren(...items.map(item=>{const option=node('option',`${item.name}${item.legacy?' · legacy':''}`);option.value=item.key;return option;}));
      $('projectTarget').replaceChildren(...items.filter(item=>!item.legacy).map(item=>{const option=node('option',`${item.name} · ${item.key}`);option.value=item.key;return option;}));
      if(items.some(item=>item.key===scopeKey())) $('projectSource').value=scopeKey();
      $('projectOperation').value='link'; mode();
    }catch(err){error(err);}finally{setBusy(false);$('projectOperation').focus();}
  }
  function fields() {
    const operation=$('projectOperation').value;
    if(operation==='link') return {operation,directory:$('projectDirectory').value.trim()};
    if(operation==='unlink') return {operation,sourceKey:$('projectSource').value,directory:$('projectPathAlias').value};
    return {operation,sourceKey:$('projectSource').value,targetKey:$('projectTarget').value};
  }
  async function review(event) {
    event.preventDefault(); if(busy || !$('projectForm').reportValidity()) return;
    invalidate(); request=fields(); setBusy(true); $('projectError').hidden=true;
    try {
      preview=await api('/api/projects',{...request,action:'preview'});
      const c=preview.counts;
      $('projectSummary').textContent=`${labels[preview.operation]}\n${preview.sourceKey||preview.directory} → ${preview.targetKey||'Удаление ассоциации'}\nЗаписей в источнике: ${c.sourceFacts}; в цели: ${c.targetFacts}; добавится: ${c.addedFacts}; совпадений: ${c.duplicateFacts}; новых ID: ${c.assignedIds}.\nДокументов: ${c.documents}; связей: ${c.links}.\nПеред изменением сохранится проверенный полный локальный ZIP.`;
      const effects=preview.operation==='unlink' ? ['Удаляется только выбранная ассоциация пути. Записи, документы, другие aliases и Git-автоопределение сохраняются.']
        : c.sourceFacts||c.documents||c.links ? ['Записи объединяются с сохранением метаданных; совпавшие ID переназначаются вместе со связями.','Области документов и aliases переносятся; остальные области документов сохраняются.','Исходный Notebook удаляется только после согласованного сохранения переноса.','Git remote остаётся прежним; открытие старого репозитория по-прежнему определяет прежнюю Git-идентичность.']
          : ['Регистрируются Git-идентичность и ассоциации каталога.'];
      $('projectEffects').replaceChildren(...effects.map(text=>node('li',text)));
      const reasons={'same-text-different-record':'Одинаковый текст, разные поля записи','duplicate-source-id':'Повторяющийся ID в источнике','duplicate-target-id':'Повторяющийся ID в цели','duplicate-history-needs-rebinding':'История совпавшей записи требует отдельного сопоставления','alias-owned-by-other-project':'Ассоциация принадлежит другому проекту','ambiguous-link':'Связь неоднозначна','target-fact-has-no-id':'У совпавшего факта в цели нет ID','invalid-fact':'Повреждённая запись'};
      $('projectConflicts').replaceChildren(...preview.conflicts.map(c=>node('li',`${reasons[c.reason]||c.reason}${c.title?`: ${c.title}`:''}${c.linkId?`: ${c.linkId}`:''}${c.alias?`: ${c.alias} → ${c.owner}`:''}`)));
      $('projectConflictState').textContent=preview.conflictCount ? `Конфликтов: ${preview.conflictCount}. Изменение недоступно; исправьте записи или выберите другую цель.${preview.truncated?' Показано до 100.':''}` : 'Конфликтов нет. Проверьте последствия перед подтверждением.';
      $('projectPreview').hidden=false; $('projectApply').hidden=false;
    }catch(err){error(err);}finally{setBusy(false);(preview?.canApply?$('projectApply'):$('projectReview')).focus();}
  }
  $('manageProjects').addEventListener('click',open);
  $('projectOperation').addEventListener('change',mode); $('projectSource').addEventListener('change',display);
  $('projectForm').addEventListener('input',invalidate); $('projectForm').addEventListener('change',invalidate);
  $('projectForm').addEventListener('submit',review);
  $('projectApply').addEventListener('click',async()=>{
    if(busy || !preview?.canApply)return;
    setBusy(true); $('projectError').hidden=true;
    let result;
    try{result=await api('/api/projects',{...request,action:'apply',previewToken:preview.previewToken,confirm:true});}
    catch(err){error(err);invalidate();}
    finally{setBusy(false);if(!result)$('projectReview').focus();}
    if(result){$('projectDialog').close();await onSaved(result);}
  });
  $('projectDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('projectDialog').querySelector('[data-close]').addEventListener('click',event=>{if(busy)event.stopImmediatePropagation();},true);
  return {open};
}
