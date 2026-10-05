export function createLinkEditor({ api, node, scopeKey, onSaved, notice }) {
  const $ = id => document.getElementById(id);
  let request, preview, previousFocus, busy = false;
  const query = input => new URLSearchParams(input).toString();
  function error(error) {
    $('linkError').hidden = false;
    $('linkError').textContent = error.code === 'CONFLICT' ? 'Данные изменились. Черновик сохранён; выполните предпросмотр снова.'
      : error.code === 'MIGRATION_REQUIRED' ? 'Сначала подготовьте устойчивые связи кнопкой «Подготовить связи». Перед миграцией сохранится полный ZIP-снимок.'
      : error.code === 'INVALID' ? 'Проверьте факт, источник, раздел и диапазон строк.'
      : error.code === 'RECOVERY_REQUIRED' ? 'Ожидает восстановления совместная правка. Проверьте локальный журнал через CLI перед продолжением.'
      : 'Не удалось изменить связь. Обновите данные и повторите действие.';
  }
  function setBusy(value) {
    busy = value; $('linkForm').setAttribute('aria-busy', String(value));
    for (const button of $('linkDialog').querySelectorAll('button')) button.disabled = value;
  }
  function invalidate() { preview = null; $('linkPreview').hidden = true; $('linkApply').hidden = true; $('linkReview').hidden = false; }
  function fields() {
    return { factRef: $('linkFact').value, docId: $('linkDocument').value, sectionId: $('linkSection').value.trim() || null,
      startLine: $('linkStart').value ? Number($('linkStart').value) : null, endLine: $('linkEnd').value ? Number($('linkEnd').value) : null,
      relationType: $('linkRelation').value };
  }
  async function documents(selected) {
    const result = await api(`/api/knowledge?${query({ action: 'list', scopeKey: request.scopeKey, includeGlobal: true, limit: 100, query: $('linkSearch').value })}`);
    const items = result.items;
    if (selected && !items.some(item => item.docId === selected)) {
      const doc = await api(`/api/knowledge?${query({ action: 'read', scopeKey: request.scopeKey, includeGlobal: true, docId: selected, textLimit: 1 })}`);
      items.unshift(doc);
    }
    $('linkDocument').replaceChildren(...items.map(doc => {
      const option = node('option', doc.title || doc.docId); option.value = doc.docId; return option;
    }));
    if (selected) $('linkDocument').value = selected;
    $('linkSearchState').textContent = `${result.total} источников · показано до 100. Уточните поиск, если нужного нет.`;
  }
  async function open({ factRef, docId, linkId, operation = 'create' } = {}) {
    if (busy) return;
    request = { action: 'preview', operation, scopeKey: scopeKey(), linkId }; invalidate();
    previousFocus = document.activeElement; $('linkDialog').showModal(); $('linkError').hidden = true;
    $('linkHeading').textContent = ({ create: 'Новая связь', update: 'Изменить связь', delete: 'Удалить связь' })[operation];
    $('linkFields').hidden = operation === 'delete'; $('linkReview').textContent = operation === 'delete' ? 'Проверить удаление' : 'Предпросмотр связи';
    for (const control of $('linkFields').querySelectorAll('input,select')) control.disabled = operation === 'delete';
    $('linkSearch').value = ''; $('linkSection').value = ''; $('linkStart').value = ''; $('linkEnd').value = ''; $('linkRelation').value = 'LINKS_TO';
    setBusy(true);
    try {
      const migration = await api('/api/knowledge-links?action=migration-status'); $('prepareLinks').hidden = migration.mutationAvailable;
      let link;
      if (linkId) {
        const links = await api(`/api/knowledge-links?${query({ action: 'list', scopeKey: request.scopeKey })}`);
        link = links.items.find(item => item.linkId === linkId);
        if (!link) throw { code: 'NOT_FOUND' };
        factRef = link.factRef; docId = link.docId;
        $('linkSection').value = link.sectionId || ''; $('linkStart').value = link.startLine || ''; $('linkEnd').value = link.endLine || '';
        $('linkRelation').value = link.relationType;
      }
      if (operation !== 'delete') {
        const notebook = await api(`/api/notebook?${query({ key: request.scopeKey })}`);
        const records = notebook.records.filter(record => record.id && !record.invalid && notebook.records.filter(other => other.id === record.id).length === 1);
        $('linkFact').replaceChildren(...records.map(record => { const duplicate = records.filter(other => other.title === record.title).length > 1;
          const option = node('option', `${record.title || record.body}${duplicate ? ` · ${record.id}` : ''}`); option.value = record.ref; return option; }));
        if (factRef) $('linkFact').value = factRef;
        await documents(docId);
      }
      $('linkContext').textContent = `Область: ${request.scopeKey}${linkId ? ` · связь ${linkId}` : ''}. Действие касается одной связи.`;
    } catch (caught) { error(caught); }
    finally { setBusy(false); $('linkReview').focus(); }
  }
  $('linkForm').addEventListener('input', invalidate);
  $('linkFind').addEventListener('click', async () => { invalidate(); setBusy(true); try { await documents(); } catch (caught) { error(caught); } finally { setBusy(false); } });
  $('linkForm').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    invalidate(); $('linkError').hidden = true; setBusy(true);
    try {
      request.fields = request.operation === 'delete' ? undefined : fields();
      preview = await api('/api/knowledge-links', request);
      $('linkPreviewText').textContent = `${({ create: 'Добавить связь', update: 'Изменить связь', delete: 'Удалить эту связь; факт и источник сохранятся' })[preview.operation]}\nФакт: ${preview.factTitle}\nИсточник: ${preview.documentTitle}${preview.fields ? `\nОтношение: ${preview.fields.relationType}` : ''}${preview.fields?.startLine ? `\nСтроки ${preview.fields.startLine}–${preview.fields.endLine}\n${preview.sourceExcerpt}` : ''}`;
      $('linkPreview').hidden = false; $('linkApply').hidden = false; $('linkReview').hidden = true;
      $('linkApply').textContent = request.operation === 'delete' ? 'Удалить эту связь' : 'Сохранить эту связь';
    } catch (caught) { error(caught); }
    finally { setBusy(false); if (preview) $('linkApply').focus(); }
  });
  $('linkApply').addEventListener('click', async () => {
    if (!preview || busy) return;
    setBusy(true); $('linkError').hidden = true;
    try {
      await api('/api/knowledge-links', { ...request, action: 'apply', previewToken: preview.previewToken });
      $('linkDialog').close(); notice('Связь сохранена.'); await onSaved();
    } catch (caught) { invalidate(); error(caught); }
    finally { setBusy(false); }
  });
  $('linkCancel').addEventListener('click', () => { if (!busy) $('linkDialog').close(); });
  $('linkDialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('linkDialog').addEventListener('close', () => { if (previousFocus?.isConnected) previousFocus.focus(); });
  $('prepareLinks').addEventListener('click', () => $('linkMigrationDialog').showModal());
  $('linkMigrationApply').addEventListener('click', async () => {
    $('linkMigrationApply').disabled = true;
    try {
      const report = await api('/api/knowledge-links', { action: 'migrate' });
      $('linkMigrationDialog').close(); if ($('linkDialog').open) $('linkDialog').close(); notice(`Связи подготовлены. Присвоено ID: ${report.assignedIds}; неоднозначных связей: ${report.needsReview.length}. Резервный снимок: ${report.backup}`); await onSaved();
    } catch (caught) { $('linkMigrationError').textContent = 'Миграция не завершена. Проверьте локальное хранилище; исходные данные и резервный снимок сохранены.'; }
    finally { $('linkMigrationApply').disabled = false; }
  });
  return { open };
}
