import { formatText, joinText, setText, t } from './i18n.js';
import { renderContent } from './content.js';

export function createKnowledgeEditor({ api, scopeKey, notice, onSaved }) {
  const $ = id => document.getElementById(id), query = input => new URLSearchParams(input).toString();
  let request, saved, job, opener, busy = false, publishing = false, generation = 0;
  function error(caught) {
    setText($('contentError'), caught.code === 'CONFLICT' ? t('m319')
      : caught.code === 'MIGRATION_REQUIRED' ? t('m320')
      : caught.code === 'CONFIRMATION' ? t('m321')
      : caught.code === 'NOT_FOUND' ? t('m322')
      : caught.code === 'UNSUPPORTED' ? t('m323')
      : t('m324'));
    $('contentError').hidden = false;
  }
  function controls() {
    $('contentFields').disabled = busy;
    $('contentPrepare').disabled = busy;
    $('contentApply').disabled = busy;
    $('contentReload').disabled = busy;
    $('contentClose').disabled = publishing;
    $('contentDiscard').hidden = !busy || publishing;
  }
  function invalidate() { job = null; $('contentPreview').hidden = true; $('contentApply').hidden = true; $('contentShared').checked = false; }
  function draft() {
    const value = { title: $('contentTitle').value.trim(), tags: $('contentTags').value.split(',').map(tag => tag.trim()).filter(Boolean), indexMode: $('contentIndex').value };
    if (request.operation.includes('note') || saved?.sourceType === 'note') value.kind = $('contentKind').value;
    if (request.operation !== 'metadata' && (!$('contentBodyField').hidden)) value.content = $('contentBody').value;
    if (request.operation === 'ingest-source') {
      value.sourceType = $('contentSourceType').value;
      if (value.sourceType !== 'text') value.path = $('contentPath').value.trim();
    }
    return value;
  }
  function sourceFields() {
    const type = request.operation === 'ingest-source' ? $('contentSourceType').value : saved?.sourceType || 'note';
    $('contentSourceFields').hidden = request.operation !== 'ingest-source';
    $('contentPathField').hidden = type === 'text'; $('contentPath').required = request.operation === 'ingest-source' && type !== 'text';
    $('contentKindField').hidden = type !== 'note';
    $('contentBodyField').hidden = request.operation === 'metadata' || ['file','url'].includes(type);
    $('contentBody').required = !$('contentBodyField').hidden;
    $('contentRefreshHint').hidden = request.operation !== 'refresh-source' || !['file','url'].includes(type);
    setText($('contentRefreshHint'), type === 'file' ? t('m325', saved?.path || '') : t('m326', saved?.path || ''));
  }
  async function readSaved(keepDraft = false) {
    const current=generation;
    const before=saved;
    const touched=before ? {title:$('contentTitle').value!==before.title,content:$('contentBody').value!==before.content,
      tags:$('contentTags').value!==joinText(before.tags, ', '),kind:$('contentKind').value!==before.kind,
      index:$('contentIndex').value!==(before.indexState==='dense'?'dense':'lexical')} : {};
    const next = await api(formatText`/api/knowledge-content?${query({action:'read',scopeKey:request.scopeKey,docId:request.docId})}`);
    if(current!==generation)return;
    saved = next; request.expectedVersion = next.version;
    if (!keepDraft) {
      $('contentTitle').value = next.title; $('contentBody').value = next.content;
      $('contentTags').value = joinText(next.tags, ', '); $('contentKind').value = next.kind;
      $('contentIndex').value = next.indexState === 'dense' ? 'dense' : 'lexical';
    } else {
      if(!touched.title)$('contentTitle').value=next.title;
      if(!touched.content)$('contentBody').value=next.content;
      if(!touched.tags)$('contentTags').value=joinText(next.tags, ', ');
      if(!touched.kind)$('contentKind').value=next.kind;
      if(!touched.index)$('contentIndex').value=next.indexState==='dense'?'dense':'lexical';
      setText($('contentSavedMetadata'), t('m327', next.title, next.kind, joinText(next.tags, ', ')||t('m328'), next.indexState));
      setText($('contentSavedText'), next.content); $('contentComparison').hidden = false;
      $('contentError').hidden = true;
    }
    sourceFields();
  }
  async function enable() {
    const current=generation;
    const migration = await api('/api/knowledge-links?action=migration-status');
    if(current!==generation)return;
    $('contentMigration').hidden = migration.mutationAvailable;
    $('contentFields').disabled = !migration.mutationAvailable;
    $('contentPrepare').disabled = !migration.mutationAvailable;
    if (migration.mutationAvailable && request.docId) await readSaved();
  }
  async function open({ operation, docId }) {
    if ($('contentDialog').open) return;
    const current = ++generation; opener = document.activeElement; request = { operation, docId, scopeKey: scopeKey() }; saved = null; busy = false; publishing = false;
    $('contentForm').reset(); invalidate(); $('contentError').hidden = true; $('contentComparison').hidden = true;
    setText($('contentProgress'), ''); setText($('contentContext'), t('m329', request.scopeKey));
    setText($('contentHeading'), ({'create-note':t('m330'),'update-note':t('m331'),'ingest-source':t('m332'),'refresh-source':t('m333'),'metadata':t('m334')})[operation]);
    $('contentReload').hidden = !docId; sourceFields(); controls(); $('contentDialog').showModal();
    try { await enable(); if (current === generation && $('contentDialog').open) $('contentTitle').focus(); }
    catch(caught) { if(current===generation)error(caught); }
  }
  function progress(value) {
    const phases = {queued:t('m335'),reading:t('m336'),normalizing:t('m337'),embedding:t('m338'),indexing:t('m339'),preview:t('m340'),publishing:t('m341'),complete:t('m342')};
    setText($('contentProgress'), formatText`${phases[value.phase] || t('m343')}${value.total != null ? t('m344', value.completed, value.total) : ''}`);
  }
  function showPreview(value) {
    const preview = value.preview; job = value;
    setText($('contentPreviewText'), t('m345', preview.title, preview.contentChanged ? t('m346') : t('m347'), preview.rebuildIndex ? t('m348') : t('m349'), preview.indexState === 'dense' ? t('m350') : preview.indexState === 'lexical-only' ? t('m351') : t('m352'), preview.microCount, preview.scopeCount, preview.shared ? t('m353') : '', preview.totalLinks, preview.needsReview, preview.otherLinkCount ? t('m354', preview.otherLinkCount) : ''));
    $('contentLinkEffects').replaceChildren(...preview.links.map(link=>{const li=document.createElement('li');setText(li, formatText`${link.linkId} · ${link.status} · ${link.orphaned ? t('m355') : link.status==='valid' ? t('m356') : t('m357')}`);return li;}));
    renderContent($('contentRenderedPreview'),preview.sourceExcerpt);
    setText($('contentPreviewLimit'), preview.contentCharacters > 2000 ? t('m358') : '');
    $('contentSharedOption').hidden = !preview.shared; $('contentShared').required = preview.shared;
    $('contentPreview').hidden = false; $('contentApply').hidden = false; $('contentApply').focus();
  }
  $('contentSourceType').addEventListener('change',sourceFields);
  $('contentForm').addEventListener('input',event=>{if(event.target!==$('contentShared')&&!busy)invalidate();});
  $('contentForm').addEventListener('submit',async event=>{
    event.preventDefault(); if(busy)return;
    invalidate(); $('contentError').hidden=true; busy=true; controls();
    const current=++generation;
    try {
      const submitted={...request,action:'start',fields:draft()};
      let value=await api('/api/knowledge-content',submitted);
      if(current!==generation){await api('/api/knowledge-content',{action:'cancel',scopeKey:submitted.scopeKey,operationId:value.operationId});return;}
      job=value;
      while(current===generation && !['ready','failed','cancelled','saved'].includes(value.state)) {
        progress(value); await new Promise(resolve=>setTimeout(resolve,500));
        if(current!==generation)return;
        value=await api(formatText`/api/knowledge-content?${query({action:'status',scopeKey:request.scopeKey,operationId:value.operationId})}`); job=value;
      }
      if(current!==generation)return;
      progress(value);
      if(value.state==='ready')showPreview(value);
      else { invalidate(); error({code:value.error?.code}); }
    } catch(caught) { if(current===generation)error(caught); }
    finally { if(current===generation){busy=false;controls();if(job?.preview&&!$('contentPreview').hidden)$('contentApply').focus();} }
  });
  $('contentApply').addEventListener('click',async()=>{
    if(!job?.preview||busy)return;
    if(job.preview.shared&&!$('contentShared').checked){error({code:'CONFIRMATION'});$('contentShared').focus();return;}
    busy=true;publishing=true;controls();$('contentError').hidden=true;
    try {
      const result=await api('/api/knowledge-content',{action:'apply',scopeKey:request.scopeKey,operationId:job.operationId,previewToken:job.preview.previewToken,confirmShared:$('contentShared').checked});
      $('contentDialog').close();notice(t('m359'));await onSaved(result.result.docId);
    } catch(caught) { invalidate();error(caught); }
    finally {busy=false;publishing=false;controls();}
  });
  $('contentReload').addEventListener('click',async()=>{if(busy)return;invalidate();busy=true;controls();try{await readSaved(true);setText($('contentProgress'), t('m360'));}catch(caught){error(caught);}finally{busy=false;controls();}});
  async function discard() {
    if(publishing)return;
    ++generation;
    if(job?.operationId && !['saved','cancelled','failed'].includes(job.state)) {
      try { await api('/api/knowledge-content',{action:'cancel',scopeKey:request.scopeKey,operationId:job.operationId}); }
      catch(caught){error(caught);return;}
    }
    busy=false;invalidate();controls();setText($('contentProgress'), t('m361'));
  }
  $('contentDiscard').addEventListener('click',discard);
  $('contentClose').addEventListener('click',async()=>{if(publishing)return;await discard();if(!busy)$('contentDialog').close();});
  $('contentDialog').addEventListener('cancel',event=>{event.preventDefault();$('contentClose').click();});
  $('contentDialog').addEventListener('close',()=>{++generation;if(opener?.isConnected)opener.focus();});
  $('contentMigration').addEventListener('click',()=>{$('contentMigrationError').hidden=true;$('contentMigrationDialog').showModal();});
  let migrating=false;
  $('contentMigrationCancel').addEventListener('click',()=>{if(!migrating)$('contentMigrationDialog').close();});
  $('contentMigrationDialog').addEventListener('cancel',event=>{if(migrating)event.preventDefault();});
  $('contentMigrationApply').addEventListener('click',async()=>{
    migrating=true;$('contentMigrationApply').disabled=true;$('contentMigrationCancel').disabled=true;
    try{const report=await api('/api/knowledge-links',{action:'migrate'});$('contentMigrationDialog').close();notice(t('m362', report.backup));await enable();$('contentTitle').focus();}
    catch{ $('contentMigrationError').hidden=false; }
    finally{migrating=false;$('contentMigrationApply').disabled=false;$('contentMigrationCancel').disabled=false;}
  });
  return {open};
}
