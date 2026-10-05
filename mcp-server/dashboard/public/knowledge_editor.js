import { renderContent } from './content.js';

export function createKnowledgeEditor({ api, scopeKey, notice, onSaved }) {
  const $ = id => document.getElementById(id), query = input => new URLSearchParams(input).toString();
  let request, saved, job, opener, busy = false, publishing = false, generation = 0;
  function error(caught) {
    $('contentError').textContent = caught.code === 'CONFLICT' ? 'Данные изменились. Черновик сохранён. Нажмите «Обновить версию», сравните сохранённый текст и снова подготовьте правку.'
      : caught.code === 'MIGRATION_REQUIRED' ? 'Для редактирования сначала подготовьте хранилище с резервной копией.'
      : caught.code === 'CONFIRMATION' ? 'Подтвердите изменение всех областей общего документа.'
      : caught.code === 'NOT_FOUND' ? 'Выбранная область не владеет этим документом.'
      : caught.code === 'UNSUPPORTED' ? 'Сохранённый текст недоступен редактору: проверьте источник, размер и тип.'
      : 'Подготовка или сохранение не завершены. Черновик остаётся здесь; можно повторить подготовку с текстовым индексом.';
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
    $('contentRefreshHint').textContent = type === 'file' ? `Подготовка прочитает файл: ${saved?.path || ''}. Просмотр сохранённого документа файл не обновляет.` : `Подготовка загрузит URL: ${saved?.path || ''}. Обновление действует во всех областях документа.`;
  }
  async function readSaved(keepDraft = false) {
    const current=generation;
    const before=saved;
    const touched=before ? {title:$('contentTitle').value!==before.title,content:$('contentBody').value!==before.content,
      tags:$('contentTags').value!==before.tags.join(', '),kind:$('contentKind').value!==before.kind,
      index:$('contentIndex').value!==(before.indexState==='dense'?'dense':'lexical')} : {};
    const next = await api(`/api/knowledge-content?${query({action:'read',scopeKey:request.scopeKey,docId:request.docId})}`);
    if(current!==generation)return;
    saved = next; request.expectedVersion = next.version;
    if (!keepDraft) {
      $('contentTitle').value = next.title; $('contentBody').value = next.content;
      $('contentTags').value = next.tags.join(', '); $('contentKind').value = next.kind;
      $('contentIndex').value = next.indexState === 'dense' ? 'dense' : 'lexical';
    } else {
      if(!touched.title)$('contentTitle').value=next.title;
      if(!touched.content)$('contentBody').value=next.content;
      if(!touched.tags)$('contentTags').value=next.tags.join(', ');
      if(!touched.kind)$('contentKind').value=next.kind;
      if(!touched.index)$('contentIndex').value=next.indexState==='dense'?'dense':'lexical';
      $('contentSavedMetadata').textContent=`Сохранено сейчас: ${next.title} · вид ${next.kind} · теги ${next.tags.join(', ')||'без тегов'} · индекс ${next.indexState}. Нетронутые поля обновлены, ваши изменённые поля сохранены.`;
      $('contentSavedText').textContent = next.content; $('contentComparison').hidden = false;
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
    $('contentProgress').textContent = ''; $('contentContext').textContent = `Область: ${request.scopeKey}`;
    $('contentHeading').textContent = ({'create-note':'Новая Memory Note','update-note':'Редактирование Note','ingest-source':'Добавить источник','refresh-source':'Обновление источника','metadata':'Метаданные документа'})[operation];
    $('contentReload').hidden = !docId; sourceFields(); controls(); $('contentDialog').showModal();
    try { await enable(); if (current === generation && $('contentDialog').open) $('contentTitle').focus(); }
    catch(caught) { if(current===generation)error(caught); }
  }
  function progress(value) {
    const phases = {queued:'Ожидает подготовки',reading:'Читаем выбранный источник',normalizing:'Нормализуем текст',embedding:'Готовим векторы',indexing:'Готовим текстовый индекс',preview:'Ревизия готова к проверке',publishing:'Публикуем ревизию',complete:'Сохранено'};
    $('contentProgress').textContent = `${phases[value.phase] || 'Подготовка'}${value.total != null ? ` · ${value.completed}/${value.total} чанков` : ''}`;
  }
  function showPreview(value) {
    const preview = value.preview; job = value;
    $('contentPreviewText').textContent = `${preview.title}\n${preview.contentChanged ? 'Новый сохранённый текст' : 'Текст сохраняется'} · ${preview.rebuildIndex ? 'Индекс будет перестроен' : 'Индекс сохраняется'}\n${preview.indexState === 'dense' ? 'Текстовый индекс и векторы' : preview.indexState === 'lexical-only' ? 'Текстовый индекс без векторов' : 'Происхождение прежнего индекса UNKNOWN'} · ${preview.microCount} micro-чанков\nОбластей документа: ${preview.scopeCount}${preview.shared ? '; изменение действует во всех областях' : ''}\nСвязей: ${preview.totalLinks}; требуют проверки: ${preview.needsReview}${preview.otherLinkCount ? `; связей других областей: ${preview.otherLinkCount} (частные данные скрыты)` : ''}`;
    $('contentLinkEffects').replaceChildren(...preview.links.map(link=>{const li=document.createElement('li');li.textContent=`${link.linkId} · ${link.status} · ${link.orphaned ? 'раздел исчезнет' : link.status==='valid' ? 'точная привязка сохранена' : 'нужна проверка источника'}`;return li;}));
    renderContent($('contentRenderedPreview'),preview.sourceExcerpt);
    $('contentPreviewLimit').textContent = preview.contentCharacters > 2000 ? 'Оформление показывает первые 2000 символов подготовленного текста.' : '';
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
        value=await api(`/api/knowledge-content?${query({action:'status',scopeKey:request.scopeKey,operationId:value.operationId})}`); job=value;
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
      $('contentDialog').close();notice('Ревизия сохранена.');await onSaved(result.result.docId);
    } catch(caught) { invalidate();error(caught); }
    finally {busy=false;publishing=false;controls();}
  });
  $('contentReload').addEventListener('click',async()=>{if(busy)return;invalidate();busy=true;controls();try{await readSaved(true);$('contentProgress').textContent='Версия обновлена. Сравните сохранённый текст с черновиком перед новой подготовкой.';}catch(caught){error(caught);}finally{busy=false;controls();}});
  async function discard() {
    if(publishing)return;
    ++generation;
    if(job?.operationId && !['saved','cancelled','failed'].includes(job.state)) {
      try { await api('/api/knowledge-content',{action:'cancel',scopeKey:request.scopeKey,operationId:job.operationId}); }
      catch(caught){error(caught);return;}
    }
    busy=false;invalidate();controls();$('contentProgress').textContent='Подготовка отброшена; сохранённый документ не изменён. Уже начатый запрос может завершиться.';
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
    try{const report=await api('/api/knowledge-links',{action:'migrate'});$('contentMigrationDialog').close();notice(`Хранилище подготовлено. Резервная копия: ${report.backup}`);await enable();$('contentTitle').focus();}
    catch{ $('contentMigrationError').hidden=false; }
    finally{migrating=false;$('contentMigrationApply').disabled=false;$('contentMigrationCancel').disabled=false;}
  });
  return {open};
}
