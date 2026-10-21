import { formatText, joinText, scopeText, serviceText, setText, t } from './i18n.js';
const $ = id => document.getElementById(id);
const conflicts = {
  'duplicate-body': t('m237'),
  'ambiguous-target-ids': t('m238'),
  'replacement-history': t('m239'),
  'target-history-reference': t('m240'),
  'unresolved-source-links': t('m241'),
  'source-unavailable': t('m242'),
  'source-not-visible-in-target': t('m243'),
  'independent-graph-edges': t('m244'),
  'independent-legacy-graph-edges': t('m245'),
};

export function createDirectiveTransfer({ api, node, openDialog, onSaved }) {
  const dialog = $('transferDialog');
  let source = null, preview = null, request = null, sequence = 0, pending = false;
  function resetPreview() {
    preview = null; request = null;
    $('transferResults').replaceChildren(); $('transferConfirm').disabled = true;
    $('transferShareConfirm').checked = false; $('transferShareConfirmation').hidden = true;
  }
  function busy(value) {
    pending = value; dialog.setAttribute('aria-busy', String(value));
    for (const id of ['transferTarget', 'transferShare', 'transferShareConfirm', 'transferPreview', 'transferClose']) $(id).disabled = value;
    $('transferConfirm').disabled = value || !preview?.canApply || preview.sources.some(item => item.addScope) && !$('transferShareConfirm').checked;
    $('transferLoading').hidden = !value;
  }
  function error(message) { setText($('transferError'), message); $('transferError').hidden = !message; }
  function errorMessage(problem) {
    if (problem.code === 'CONFLICT') return t('m246');
    if (problem.code === 'MIGRATION_REQUIRED') return t('m247');
    if (problem.code === 'RECOVERY_REQUIRED') return t('m248');
    return t('m249', problem.code || t('m205'), serviceText(problem.message));
  }
  function render() {
    const results = $('transferResults'); results.replaceChildren();
    results.append(node('h3', preview.directive.title), node('p', preview.directive.body, 'knowledge-text'));
    const list = node('ul');
    for (const text of [
      t('m250', scopeText(preview.source), preview.source.key, preview.source.ref),
      t('m251', scopeText(preview.target), preview.target.key, preview.target.ref),
      preview.idChange.changed ? t('m252', preview.idChange.from || t('m253'), preview.idChange.to) : t('m254'),
      t('m255'),
      t('m256', preview.links.length),
      t('m257'),
      t('m258'),
    ]) list.append(node('li', text));
    results.append(list);
    for (const item of preview.sources) results.append(node('p',
      t('m259', item.title || item.docId, item.addScope ? t('m260', item.addScope)
        : item.scopes.some(key => key === 'global' || key === preview.target.key) ? t('m261') : t('m262'), joinText(item.scopes, ', ')), 'caption'));
    if (preview.sharingGlobal) results.append(node('p', t('m263'), 'inline-error'));
    if (preview.conflicts.length) {
      const issues = node('ul', null, 'inline-error');
      for (const item of preview.conflicts) issues.append(node('li', conflicts[item.reason] || item.reason));
      results.append(issues);
    }
    $('transferShareConfirmation').hidden = !preview.sources.some(item => item.addScope);
    setText($('transferHint'), preview.canApply ? t('m264') : t('m265'));
  }
  async function review() {
    if (pending || !source) return;
    const current = ++sequence; resetPreview(); error('');
    const targetKey = $('transferTarget').value;
    if (!targetKey) { error(t('m266')); return; }
    busy(true);
    try {
      const [from, to] = await Promise.all([
        api(formatText`/api/notebook?key=${encodeURIComponent(source.key)}`), api(formatText`/api/notebook?key=${encodeURIComponent(targetKey)}`),
      ]);
      if (current !== sequence || !dialog.open) return;
      const matches = from.records.filter(item => item.ref === source.ref);
      if (matches.length !== 1 || matches[0].fingerprint !== source.fingerprint) throw { code: 'CONFLICT' };
      const input = { sourceKey: source.key, targetKey, ref: source.ref, expectedSourceVersion: from.version,
        expectedTargetVersion: to.version, shareSources: $('transferShare').checked };
      const result = await api('/api/directive-transfer', { ...input, action: 'preview' });
      if (current !== sequence || !dialog.open) return;
      request = input; preview = result; render();
    } catch (problem) { if (current === sequence && dialog.open) error(errorMessage(problem)); }
    finally { if (current === sequence) busy(false); }
  }
  $('transferTarget').addEventListener('change', () => { sequence++; resetPreview(); error(''); setText($('transferHint'), t('m267')); });
  $('transferShare').addEventListener('change', () => { sequence++; resetPreview(); error(''); setText($('transferHint'), t('m268')); });
  $('transferShareConfirm').addEventListener('change', () => { if (!pending) busy(false); });
  $('transferPreview').addEventListener('click', review);
  $('transferClose').addEventListener('click', () => { if (!pending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => { sequence++; source = null; resetPreview(); });
  $('transferConfirm').addEventListener('click', async () => {
    if (pending || !preview?.canApply || !request) return;
    const input = { ...request, action: 'apply', previewToken: preview.previewToken, confirm: true,
      confirmShare: $('transferShareConfirm').checked };
    busy(true); error('');
    try {
      const result = await api('/api/directive-transfer', input);
      busy(false); dialog.close(); await onSaved(result);
    } catch (problem) { resetPreview(); error(errorMessage(problem)); setText($('transferHint'), t('m269')); }
    finally { busy(false); }
  });
  return { async open({ key, record }) {
    source = { key, ref: record.ref, fingerprint: record.fingerprint }; sequence++;
    resetPreview(); error(''); $('transferShare').checked = false; $('transferTarget').replaceChildren();
    setText($('transferSource'), t('m270', key, record.ref));
    setText($('transferHint'), t('m271'));
    openDialog('transferDialog'); busy(true);
    const current = sequence;
    try {
      const targets = await api('/api/directive-transfer', { action: 'targets' });
      if (current !== sequence || !dialog.open) return;
      $('transferTarget').append(node('option', t('m272')));
      $('transferTarget').firstChild.value = '';
      for (const item of targets.items.filter(item => item.key !== key && !item.unavailable && item.notebookAvailable !== false)) {
        const option = node('option', formatText`${scopeText(item)} · ${item.key}`); option.value = item.key; $('transferTarget').append(option);
      }
    } catch (problem) { if (current === sequence) error(errorMessage(problem)); }
    finally { if (current === sequence) { busy(false); $('transferTarget').focus(); } }
  } };
}
