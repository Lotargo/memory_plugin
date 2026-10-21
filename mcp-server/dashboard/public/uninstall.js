import { appendText, dateText, formatText, serviceText, setText, t } from './i18n.js';
const $ = id => document.getElementById(id);
export function createUninstall({ api, node, openDialog, allowDiscard, closeNavigation }) {
  const dialog = $('uninstallDialog'); let status = null, preview = null, pending = false;
  const reasons = { 'missing': t('m729'), 'foreign-registration': t('m730'),
    'modified-or-foreign': t('m731'), 'marketplace-managed': t('m732') };
  const input = () => ({ client: $('uninstallClient').value, operation: $('uninstallOperation').value,
    ...($('uninstallOperation').value === 'restore' ? { backupId: $('uninstallBackup').value } : {}) });
  function reset() { preview = null; $('uninstallPreview').replaceChildren(); }
  function error(problem) {
    $('uninstallError').hidden = !problem;
    setText($('uninstallError'), !problem ? '' : problem.code === 'CONFLICT'
      ? t('m733') : formatText`${problem.code || t('m205')}: ${serviceText(problem.message)}`);
  }
  function backups() {
    const current = $('uninstallBackup').value;
    $('uninstallBackup').replaceChildren(...(status?.receipts || []).filter(item => item.operation === 'uninstall' && item.client === input().client).map(item => {
      const option = node('option', formatText`${item.status} / ${item.phase} · ${item.operationId}`); option.value = item.operationId; return option;
    }));
    if ([...$('uninstallBackup').options].some(option => option.value === current)) $('uninstallBackup').value = current;
  }
  function controls() {
    const request = input(), restore = request.operation === 'restore';
    $('uninstallBackupField').hidden = !restore;
    dialog.setAttribute('aria-busy', String(pending));
    for (const id of ['uninstallClient','uninstallOperation','uninstallBackup','uninstallRefresh','uninstallClose']) $(id).disabled = pending;
    $('uninstallReview').disabled = pending || !status || restore && !request.backupId;
    $('uninstallApply').disabled = pending || !preview?.canApply || !preview.changed && !restore;
    setText($('uninstallApply'), restore ? t('m734') : t('m735'));
  }
  function renderStatus() {
    const client = status?.items.find(item => item.client === input().client);
    setText($('uninstallStatus'), !client ? t('m736') : client.unavailable ? serviceText(client.error.message)
      : t('m737', client.name, client.changed, client.integration.mode, dateText(new Date(client.observedAt), 'toLocaleString')));
    setText($('uninstallHint'), status?.notice || t('m738'));
    if (status?.recoveryRequired) appendText($('uninstallHint'), t('m739'));
  }
  async function load() {
    reset(); error(null); pending = true; controls();
    try {
      status = await api('/api/uninstall'); backups(); renderStatus();
      $('uninstallReceipts').hidden = !status.receipts.length;
      $('uninstallReceiptList').replaceChildren(...status.receipts.map(item => node('li',
        t('m740', item.client, item.operation, item.status, item.phase, item.completed, item.operationId))));
    } catch (problem) { status = null; error(problem); setText($('uninstallStatus'), t('m741')); }
    finally { pending = false; controls(); }
  }
  $('openUninstall').addEventListener('click', async () => {
    if (!(await allowDiscard())) return; closeNavigation(); openDialog('uninstallDialog'); setText($('uninstallResult'), '');
    await load(); if (dialog.open) $('uninstallClient').focus();
  });
  $('uninstallReview').addEventListener('click', async () => {
    reset(); error(null); pending = true; controls(); setText($('uninstallResult'), t('m742'));
    try {
      preview = await api('/api/uninstall', { action: 'preview', ...input() });
      const box = $('uninstallPreview');
      box.append(node('h3', formatText`${preview.name}: ${preview.operation === 'restore' ? t('m743') : t('m744')}`), node('p', t('m745', preview.changed)));
      const list = node('ul');
      for (const file of preview.files) list.append(node('li', t('m746', file.action === 'remove' ? t('m747') : t('m748'), file.path, file.beforeBytes, file.afterBytes)));
      box.append(list);
      if (preview.skipped.length) {
        const skips = node('ul'); for (const item of preview.skipped) skips.append(node('li', formatText`${item.component}: ${reasons[item.reason] || item.reason}`));
        box.append(node('h3', t('m749')), skips);
      }
      if (!preview.canApply) box.append(node('p', preview.recoveryRequired ? t('m750') : t('m751')));
      else if (!preview.changed) box.append(node('p', preview.operation === 'restore' ? t('m752') : t('m753')));
      setText($('uninstallResult'), t('m754'));
    } catch (problem) { reset(); error(problem); setText($('uninstallResult'), ''); }
    finally { pending = false; controls(); if (dialog.open) $('uninstallReview').focus(); }
  });
  $('uninstallApply').addEventListener('click', async () => {
    if (pending || !preview?.canApply) return;
    const request = { action: 'apply', ...input(), previewToken: preview.previewToken, confirm: true };
    pending = true; error(null); controls(); setText($('uninstallResult'), t('m230'));
    try {
      const result = await api('/api/uninstall', request);
      // A newly removed integration should offer its own backup first. A hidden
      // selection left by an earlier recovery must not choose an older backup.
      if (result.operation === 'uninstall' && result.operationId) $('uninstallBackup').replaceChildren();
      const message = t('m755', result.status === 'saved' ? t('m232') : result.status === 'partial' ? t('m233') : t('m80'), result.completed || 0, result.operationId || t('m234'));
      await load(); setText($('uninstallResult'), message); if (result.error) error(result.error);
    } catch (problem) {
      reset(); error(problem); setText($('uninstallResult'), !problem.status || problem.status >= 500
        ? t('m236') : '');
    } finally { pending = false; controls(); if (dialog.open) $('uninstallReview').focus(); }
  });
  for (const id of ['uninstallClient','uninstallOperation','uninstallBackup']) $(id).addEventListener('change', () => {
    reset(); error(null); setText($('uninstallResult'), ''); if (id !== 'uninstallBackup') backups(); renderStatus(); controls();
  });
  $('uninstallRefresh').addEventListener('click', async () => { await load(); if (dialog.open) $('uninstallRefresh').focus(); });
  $('uninstallClose').addEventListener('click', () => { if (!pending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => { reset(); if (!$('openUninstall').getClientRects().length) $('navigation').focus(); });
}
