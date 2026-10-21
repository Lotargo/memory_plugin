import { setText, t } from './i18n.js';
export function createKnowledgeRemoval({api,scopeKey,notice,onSaved}) {
  const $=id=>document.getElementById(id), dialog=$('removalDialog');
  let input=null, preview=null, sequence=0, busy=false, opener=null;
  const error=message=>{setText($('removalError'), message);$('removalError').hidden=false;};
  const close=()=>{if(busy)return;sequence++;dialog.close();opener?.focus();};
  $('removalClose').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('removalApply').addEventListener('click',async()=>{
    if(!preview||busy)return;
    if(!$('removalConfirm').checked){error(t('m379'));$('removalConfirm').focus();return;}
    if(preview.shared&&input.operation==='delete'&&!$('removalShared').checked){error(t('m380'));$('removalShared').focus();return;}
    busy=true;$('removalApply').disabled=true;$('removalClose').disabled=true;
    try {
      const result=await api('/api/knowledge-removal',{action:'apply',...input,previewToken:preview.previewToken,confirm:true,confirmShared:$('removalShared').checked});
      busy=false;close();notice(result.cleanupPending?t('m381'):t('m382'));await onSaved();document.getElementById('knowledgeSearch').focus();
    } catch(e){preview=null;error(e.code==='CONFLICT'?t('m383'):t('m384'));}
    finally{busy=false;$('removalClose').disabled=false;}
  });
  return {async open({operation,docId}){
    input={operation,docId,scopeKey:scopeKey()};preview=null;opener=document.activeElement;
    const current=++sequence;setText($('removalHeading'), operation==='delete'?t('m385'):t('m386'));
    $('removalError').hidden=true;$('removalConfirm').checked=false;$('removalShared').checked=false;
    $('removalSharedOption').hidden=true;$('removalApply').disabled=true;setText($('removalSummary'), t('m387'));$('removalEffects').replaceChildren();
    dialog.showModal();$('removalClose').focus();
    try{
      const p=await api('/api/knowledge-removal',{action:'preview',...input});if(current!==sequence)return;preview=p;
      setText($('removalSummary'), t('m388', p.title||p.docId, p.path, p.removedScopeCount, p.remainingScopeCount, p.totalLinksRemoved, p.privateLinksRemoved, p.preservedLinks, p.purge?t('m389'):t('m390'), p.counts?t('m391', p.counts.sections, p.counts.medium_chunks, p.counts.micro_chunks, p.edgesRemoved):''));
      for(const item of p.linksRemoved){const li=document.createElement('li');setText(li, t('m392', item.linkId));$('removalEffects').append(li);}
      $('removalSharedOption').hidden=!(p.shared&&operation==='delete');$('removalApply').disabled=false;$('removalConfirm').focus();
    }catch(e){if(current===sequence)error(e.code==='MIGRATION_REQUIRED'?t('m393'):t('m394'));}
  }};
}
