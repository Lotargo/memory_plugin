import { formatText, setText, t } from './i18n.js';
export function createProjectManager({ api, node, scopeKey, onSaved, openDialog, allowDiscard, closeNavigation }) {
  const $ = id => document.getElementById(id);
  let items=[], preview=null, request=null, busy=false;
  const labels={link:t('m549'),unlink:t('m550'),relink:t('m551'),migrate:t('m552')};
  function error(error) {
    $('projectError').hidden=false;
    setText($('projectError'), error.code==='CONFLICT' ? t('m553')
      : error.code==='INVALID' ? t('m554')
      : error.code==='NOT_FOUND' ? t('m555')
      : error.code==='MIGRATION_REQUIRED' ? t('m556')
      : error.code==='RECOVERY_REQUIRED' ? t('m557')
      : t('m558'));
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
    for(const [label,value] of [[t('m559'),item?.key],['Remote',item?.primaryRemote],[t('m560'),item?.facts],[t('m561'),item?.documents]]) {
      $('projectDetails').append(node('dt',label),node('dd',value==null?t('m562'):value));
    }
    $('projectAliases').replaceChildren(...(item?.aliases||[]).map(alias=>node('li',alias.alias)));
    if(!item?.aliases.length) $('projectAliases').append(node('li',t('m563')));
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
    setText($('projectHint'), operation==='unlink' ? t('m564')
      : operation==='link' ? t('m565')
      : t('m566'));
    display();
  }
  async function open() {
    if(busy || !await allowDiscard()) return;
    closeNavigation(); openDialog('projectDialog'); $('projectError').hidden=true;
    setBusy(true);
    try {
      items=(await api('/api/projects?action=list')).items;
      $('projectSource').replaceChildren(...items.map(item=>{const option=node('option',formatText`${item.name}${item.legacy?' · legacy':''}`);option.value=item.key;return option;}));
      $('projectTarget').replaceChildren(...items.filter(item=>!item.legacy).map(item=>{const option=node('option',formatText`${item.name} · ${item.key}`);option.value=item.key;return option;}));
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
      const backupText = preview.backupRequired ? t('m567') : t('m568');
      setText($('projectSummary'), t('m569', labels[preview.operation], preview.sourceKey||preview.directory, preview.targetKey||t('m570'), c.sourceFacts, c.targetFacts, c.addedFacts, c.duplicateFacts, c.assignedIds, c.documents, c.links, backupText));
      const effects=preview.operation==='unlink' ? [t('m571')]
        : preview.backupRequired ? [t('m572'),t('m573'),t('m574'),t('m575')]
          : [t('m576')];
      $('projectEffects').replaceChildren(...effects.map(text=>node('li',text)));
      const reasons={'same-text-different-record':t('m577'),'duplicate-source-id':t('m578'),'duplicate-target-id':t('m579'),'duplicate-history-needs-rebinding':t('m580'),'alias-owned-by-other-project':t('m581'),'ambiguous-link':t('m582'),'target-fact-has-no-id':t('m583'),'invalid-fact':t('m584')};
      $('projectConflicts').replaceChildren(...preview.conflicts.map(c=>node('li',formatText`${reasons[c.reason]||c.reason}${c.title?formatText`: ${c.title}`:''}${c.linkId?formatText`: ${c.linkId}`:''}${c.alias?formatText`: ${c.alias} → ${c.owner}`:''}`)));
      setText($('projectConflictState'), preview.conflictCount ? t('m585', preview.conflictCount, preview.truncated?t('m586'):'') : t('m587'));
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
