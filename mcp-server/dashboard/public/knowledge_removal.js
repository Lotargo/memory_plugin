export function createKnowledgeRemoval({api,scopeKey,notice,onSaved}) {
  const $=id=>document.getElementById(id), dialog=$('removalDialog');
  let input=null, preview=null, sequence=0, busy=false, opener=null;
  const error=message=>{$('removalError').textContent=message;$('removalError').hidden=false;};
  const close=()=>{if(busy)return;sequence++;dialog.close();opener?.focus();};
  $('removalClose').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('removalApply').addEventListener('click',async()=>{
    if(!preview||busy)return;
    if(!$('removalConfirm').checked){error('Подтвердите действие после проверки последствий.');$('removalConfirm').focus();return;}
    if(preview.shared&&input.operation==='delete'&&!$('removalShared').checked){error('Подтвердите удаление во всех областях.');$('removalShared').focus();return;}
    busy=true;$('removalApply').disabled=true;$('removalClose').disabled=true;
    try {
      const result=await api('/api/knowledge-removal',{action:'apply',...input,previewToken:preview.previewToken,confirm:true,confirmShared:$('removalShared').checked});
      busy=false;close();notice(result.cleanupPending?'Изменение сохранено. Очистка локального blob ожидает повтора.':'Изменение сохранено.');await onSaved();document.getElementById('knowledgeSearch').focus();
    } catch(e){preview=null;error(e.code==='CONFLICT'?'Данные изменились. Закройте окно и проверьте новый предпросмотр.':'Удаление не подтверждено или не выполнено. Закройте окно и повторите проверку.');}
    finally{busy=false;$('removalClose').disabled=false;}
  });
  return {async open({operation,docId}){
    input={operation,docId,scopeKey:scopeKey()};preview=null;opener=document.activeElement;
    const current=++sequence;$('removalHeading').textContent=operation==='delete'?'Удалить источник полностью':'Убрать источник из области';
    $('removalError').hidden=true;$('removalConfirm').checked=false;$('removalShared').checked=false;
    $('removalSharedOption').hidden=true;$('removalApply').disabled=true;$('removalSummary').textContent='Проверяем последствия…';$('removalEffects').replaceChildren();
    dialog.showModal();$('removalClose').focus();
    try{
      const p=await api('/api/knowledge-removal',{action:'preview',...input});if(current!==sequence)return;preview=p;
      $('removalSummary').textContent=`${p.title||p.docId}\n${p.path}\nОбластей будет снято: ${p.removedScopeCount}; останется: ${p.remainingScopeCount}.\nСвязей будет удалено: ${p.totalLinksRemoved}, из других областей: ${p.privateLinksRemoved}; сохранится: ${p.preservedLinks}.\n${p.purge?'Документ и его индекс будут удалены. Notebook-факты сохранятся.':'Документ и индекс сохранятся в других областях.'}\n${p.counts?`Sections: ${p.counts.sections}; medium: ${p.counts.medium_chunks}; micro: ${p.counts.micro_chunks}; рёбер: ${p.edgesRemoved}.`:''}`;
      for(const item of p.linksRemoved){const li=document.createElement('li');li.textContent=`${item.linkId} — будет удалена`;$('removalEffects').append(li);}
      $('removalSharedOption').hidden=!(p.shared&&operation==='delete');$('removalApply').disabled=false;$('removalConfirm').focus();
    }catch(e){if(current===sequence)error(e.code==='MIGRATION_REQUIRED'?'Сначала подготовьте хранилище через редактор знаний.':'Предпросмотр недоступен. Проверьте область и повторите действие.');}
  }};
}
