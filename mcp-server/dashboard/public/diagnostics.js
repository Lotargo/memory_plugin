import { appendText, countText, dateText, formatText, serviceText, setText, t } from './i18n.js';
const $ = id => document.getElementById(id);
export function createDiagnostics({ api, node, openDialog, allowDiscard, closeNavigation }) {
  const dialog = $('diagnosticsDialog'); let status = null, preview = null, pending = false;
  const names = { 'graph-check': t('m192'), 'cleanup-blobs': t('m193'), 'restore-blobs': t('m194'), 'resume-cleanup': t('m195') };
  const checkNames = { 'isolated-store': t('m196'), 'notebook-write-readback': t('m197'),
    'scoped-link-graph-projection': t('m198'), 'saved-source-lines': t('m199'), 'lexical-retrieval-without-models': t('m200') };
  const fileCount = count => countText(count, 'files');
  function input() { const operation = $('diagnosticsOperation').value; return { operation,
    ...(['restore-blobs','resume-cleanup'].includes(operation) ? { backupId: $('diagnosticsBackup').value } : {}) }; }
  function error(problem) {
    $('diagnosticsError').hidden = !problem;
    setText($('diagnosticsError'), !problem ? '' : problem.code === 'CONFLICT'
      ? t('m204') : formatText`${problem.code || t('m205')}: ${serviceText(problem.message)}`);
  }
  function reset() { preview = null; $('diagnosticsPreview').replaceChildren(); }
  function controls() {
    const { operation, backupId } = input(), run = operation === 'graph-check', recovery = ['restore-blobs','resume-cleanup'].includes(operation);
    $('diagnosticsBackupField').hidden = !recovery;
    setText($('diagnosticsHint'), run
      ? t('m206')
      : t('m207'));
    if (!run && status?.recoveryRequired) appendText($('diagnosticsHint'), t('m208'));
    dialog.setAttribute('aria-busy', String(pending));
    for (const id of ['diagnosticsOperation','diagnosticsBackup','diagnosticsRefresh','diagnosticsClose']) $(id).disabled = pending;
    setText($('diagnosticsReview'), run ? t('m209') : t('m210'));
    $('diagnosticsReview').disabled = pending || !run && (!status || recovery && !backupId || operation === 'cleanup-blobs' && status.recoveryRequired);
    $('diagnosticsApply').disabled = pending || !preview || !preview.changed && operation === 'cleanup-blobs';
  }
  function backups() {
    const selected = $('diagnosticsBackup').value, resume = input().operation === 'resume-cleanup';
    $('diagnosticsBackup').replaceChildren(...(status?.receipts || []).filter(item => !item.unavailable && (!resume || item.operation !== 'restore-blobs')).map(item => {
      const option = node('option', formatText`${names[item.operation]} · ${item.status} · ${item.operationId}`); option.value = item.operationId; return option;
    }));
    if ([...$('diagnosticsBackup').options].some(item => item.value === selected)) $('diagnosticsBackup').value = selected;
  }
  async function load() {
    reset(); error(null); pending = true; controls();
    try {
      status = await api('/api/diagnostics'); backups();
      setText($('diagnosticsCounts'), t('m211', status.unusedFiles, dateText(status.unusedBytes, 'toLocaleString'), status.skipped.length, dateText(new Date(status.observedAt), 'toLocaleString')));
      $('diagnosticsReceipts').hidden = !status.receipts.length;
      $('diagnosticsReceiptList').replaceChildren(...status.receipts.map(item => node('li', item.unavailable
        ? t('m212', item.operationId, item.unavailable)
        : t('m213', names[item.operation], item.status, item.phase, item.completed, item.operationId, item.backup))));
    } catch (problem) {
      status = null; setText($('diagnosticsCounts'), t('m214'));
      $('diagnosticsBackup').replaceChildren(); $('diagnosticsReceipts').hidden = true; error(problem);
    }
    finally { pending = false; controls(); }
  }
  $('openDiagnostics').addEventListener('click', async () => {
    if (!(await allowDiscard())) return; closeNavigation(); openDialog('diagnosticsDialog'); setText($('diagnosticsResult'), '');
    await load(); if (dialog.open) $('diagnosticsOperation').focus();
  });
  $('diagnosticsReview').addEventListener('click', async () => {
    reset(); error(null); const request = input(); pending = true; controls();
    setText($('diagnosticsResult'), request.operation === 'graph-check' ? t('m215') : t('m216'));
    try {
      const result = await api('/api/diagnostics', { action: request.operation === 'graph-check' ? 'run' : 'preview', ...request });
      setText($('diagnosticsResult'), '');
      if (request.operation === 'graph-check') {
        const box = $('diagnosticsPreview'); box.append(node('h3', result.status === 'passed' ? t('m217') : t('m218')));
        const list = node('ul'); for (const item of result.checks) list.append(node('li', formatText`${checkNames[item.name] || item.name}: ${item.status === 'passed' ? t('m219') : item.status}`)); box.append(list);
        box.append(node('p', t('m220', result.temporaryCleanup === 'completed' ? t('m221') : t('m222'), dateText(new Date(result.observedAt), 'toLocaleString'))));
        if (result.error) error(result.error);
      } else {
        preview = result; const box = $('diagnosticsPreview'); box.append(node('h3', formatText`${names[result.operation]}: ${fileCount(result.changed)}`),
          node('p', t('m223', dateText(result.bytes, 'toLocaleString'), result.operation === 'restore-blobs' ? t('m224') : t('m225'))));
        const list = node('ul'); for (const item of result.files) list.append(node('li', t('m226', item.hash, item.bytes))); box.append(list);
        if (result.skipped.length) { const details = node('details'); details.append(node('summary', t('m227', result.skipped.length)),node('pre',JSON.stringify(result.skipped,null,2),'knowledge-text')); box.append(details); }
        if (!result.changed) box.append(node('p', request.operation === 'cleanup-blobs' ? t('m228') : t('m229')));
      }
    } catch (problem) { setText($('diagnosticsResult'), ''); error(problem); }
    finally { pending = false; controls(); if (dialog.open) $('diagnosticsReview').focus(); }
  });
  $('diagnosticsApply').addEventListener('click', async () => {
    if (pending || !preview) return; const request = { action: 'apply', ...input(), previewToken: preview.previewToken, confirm: true };
    pending = true; error(null); controls(); setText($('diagnosticsResult'), t('m230'));
    try {
      const result = await api('/api/diagnostics', request); reset();
      const message = t('m231', result.status === 'saved' ? t('m232') : result.status === 'partial' ? t('m233') : t('m80'), result.completed || 0, result.operationId || t('m234'), result.backup || t('m235'));
      await load(); setText($('diagnosticsResult'), message); if (result.error) error(result.error);
    } catch (problem) {
      reset(); error(problem); setText($('diagnosticsResult'), !problem.status || problem.status >= 500
        ? t('m236') : '');
    } finally { pending = false; controls(); if (dialog.open) $('diagnosticsReview').focus(); }
  });
  $('diagnosticsOperation').addEventListener('change', () => { reset(); error(null); setText($('diagnosticsResult'), ''); backups(); controls(); });
  $('diagnosticsBackup').addEventListener('change', () => { reset(); error(null); setText($('diagnosticsResult'), ''); controls(); });
  $('diagnosticsRefresh').addEventListener('click', load);
  $('diagnosticsClose').addEventListener('click', () => { if (!pending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => { reset(); if (!$('openDiagnostics').getClientRects().length) $('navigation').focus(); });
}
