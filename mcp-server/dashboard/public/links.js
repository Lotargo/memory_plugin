import { formatText, setText, t } from './i18n.js';
export function createLinkEditor({ api, node, scopeKey, onSaved, notice }) {
  const $ = id => document.getElementById(id);
  let request, preview, previousFocus, busy = false;
  const query = input => new URLSearchParams(input).toString();
  function error(error) {
    $('linkError').hidden = false;
    setText($('linkError'), error.code === 'CONFLICT' ? t('m420')
      : error.code === 'MIGRATION_REQUIRED' ? t('m421')
      : error.code === 'INVALID' ? t('m422')
      : error.code === 'RECOVERY_REQUIRED' ? t('m423')
      : t('m424'));
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
    const result = await api(formatText`/api/knowledge?${query({ action: 'list', scopeKey: request.scopeKey, includeGlobal: true, limit: 100, query: $('linkSearch').value })}`);
    const items = result.items;
    if (selected && !items.some(item => item.docId === selected)) {
      const doc = await api(formatText`/api/knowledge?${query({ action: 'read', scopeKey: request.scopeKey, includeGlobal: true, docId: selected, textLimit: 1 })}`);
      items.unshift(doc);
    }
    $('linkDocument').replaceChildren(...items.map(doc => {
      const option = node('option', doc.title || doc.docId); option.value = doc.docId; return option;
    }));
    if (selected) $('linkDocument').value = selected;
    setText($('linkSearchState'), t('m425', result.total));
  }
  async function open({ factRef, docId, linkId, operation = 'create' } = {}) {
    if (busy) return;
    request = { action: 'preview', operation, scopeKey: scopeKey(), linkId }; invalidate();
    previousFocus = document.activeElement; $('linkDialog').showModal(); $('linkError').hidden = true;
    setText($('linkHeading'), ({ create: t('m426'), update: t('m75'), delete: t('m76') })[operation]);
    $('linkFields').hidden = operation === 'delete'; setText($('linkReview'), operation === 'delete' ? t('m427') : t('m428'));
    for (const control of $('linkFields').querySelectorAll('input,select')) control.disabled = operation === 'delete';
    $('linkSearch').value = ''; $('linkSection').value = ''; $('linkStart').value = ''; $('linkEnd').value = ''; $('linkRelation').value = 'LINKS_TO';
    setBusy(true);
    try {
      const migration = await api('/api/knowledge-links?action=migration-status'); $('prepareLinks').hidden = migration.mutationAvailable;
      let link;
      if (linkId) {
        const links = await api(formatText`/api/knowledge-links?${query({ action: 'list', scopeKey: request.scopeKey })}`);
        link = links.items.find(item => item.linkId === linkId);
        if (!link) throw { code: 'NOT_FOUND' };
        factRef = link.factRef; docId = link.docId;
        $('linkSection').value = link.sectionId || ''; $('linkStart').value = link.startLine || ''; $('linkEnd').value = link.endLine || '';
        $('linkRelation').value = link.relationType;
      }
      if (operation !== 'delete') {
        const notebook = await api(formatText`/api/notebook?${query({ key: request.scopeKey })}`);
        const records = notebook.records.filter(record => record.id && !record.invalid && notebook.records.filter(other => other.id === record.id).length === 1);
        $('linkFact').replaceChildren(...records.map(record => { const duplicate = records.filter(other => other.title === record.title).length > 1;
          const option = node('option', formatText`${record.title || record.body}${duplicate ? formatText` · ${record.id}` : ''}`); option.value = record.ref; return option; }));
        if (factRef) $('linkFact').value = factRef;
        await documents(docId);
      }
      setText($('linkContext'), t('m429', request.scopeKey, linkId ? t('m430', linkId) : ''));
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
      setText($('linkPreviewText'), t('m431', ({ create: t('m432'), update: t('m75'), delete: t('m433') })[preview.operation], preview.factTitle, preview.documentTitle, preview.fields ? t('m434', preview.fields.relationType) : '', preview.fields?.startLine ? t('m435', preview.fields.startLine, preview.fields.endLine, preview.sourceExcerpt) : ''));
      $('linkPreview').hidden = false; $('linkApply').hidden = false; $('linkReview').hidden = true;
      setText($('linkApply'), request.operation === 'delete' ? t('m436') : t('m437'));
    } catch (caught) { error(caught); }
    finally { setBusy(false); if (preview) $('linkApply').focus(); }
  });
  $('linkApply').addEventListener('click', async () => {
    if (!preview || busy) return;
    setBusy(true); $('linkError').hidden = true;
    try {
      await api('/api/knowledge-links', { ...request, action: 'apply', previewToken: preview.previewToken });
      $('linkDialog').close(); notice(t('m438')); await onSaved();
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
      $('linkMigrationDialog').close(); if ($('linkDialog').open) $('linkDialog').close(); notice(t('m439', report.assignedIds, report.needsReview.length, report.backup)); await onSaved();
    } catch (caught) { setText($('linkMigrationError'), t('m440')); }
    finally { $('linkMigrationApply').disabled = false; }
  });
  return { open };
}
