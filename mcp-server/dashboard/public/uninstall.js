const $ = id => document.getElementById(id);
export function createUninstall({ api, node, openDialog, allowDiscard, closeNavigation }) {
  const dialog = $('uninstallDialog'); let status = null, preview = null, pending = false;
  const reasons = { 'missing': 'не найдено', 'foreign-registration': 'чужая регистрация сохранена',
    'modified-or-foreign': 'изменённый или чужой skill сохранён', 'marketplace-managed': 'управляется marketplace; используйте управление плагинами клиента' };
  const input = () => ({ client: $('uninstallClient').value, operation: $('uninstallOperation').value,
    ...($('uninstallOperation').value === 'restore' ? { backupId: $('uninstallBackup').value } : {}) });
  function reset() { preview = null; $('uninstallPreview').replaceChildren(); }
  function error(problem) {
    $('uninstallError').hidden = !problem;
    $('uninstallError').textContent = !problem ? '' : problem.code === 'CONFLICT'
      ? 'Файлы клиента или состояние восстановления изменились. Обновите состояние и проверьте список снова.' : `${problem.code || 'Ошибка'}: ${problem.message}`;
  }
  function backups() {
    const current = $('uninstallBackup').value;
    $('uninstallBackup').replaceChildren(...(status?.receipts || []).filter(item => item.operation === 'uninstall' && item.client === input().client).map(item => {
      const option = node('option', `${item.status} / ${item.phase} · ${item.operationId}`); option.value = item.operationId; return option;
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
    $('uninstallApply').textContent = restore ? 'Подтвердить восстановление' : 'Подтвердить удаление интеграции';
  }
  function renderStatus() {
    const client = status?.items.find(item => item.client === input().client);
    $('uninstallStatus').textContent = !client ? 'Состояние клиента недоступно.' : client.unavailable ? client.error.message
      : `${client.name}: файлов к изменению — ${client.changed}. Канал: ${client.integration.mode}. Проверено: ${new Date(client.observedAt).toLocaleString('ru')}.`;
    $('uninstallHint').textContent = status?.notice || 'Выберите клиента, проверьте точные файлы и подтвердите действие.';
    if (status?.recoveryRequired) $('uninstallHint').textContent += ' Есть прерванная операция. Сначала восстановите её по квитанции.';
  }
  async function load() {
    reset(); error(null); pending = true; controls();
    try {
      status = await api('/api/uninstall'); backups(); renderStatus();
      $('uninstallReceipts').hidden = !status.receipts.length;
      $('uninstallReceiptList').replaceChildren(...status.receipts.map(item => node('li',
        `${item.client} · ${item.operation} · ${item.status} / ${item.phase} · обработано ${item.completed} · ${item.operationId}`)));
    } catch (problem) { status = null; error(problem); $('uninstallStatus').textContent = 'Состояние файлов недоступно.'; }
    finally { pending = false; controls(); }
  }
  $('openUninstall').addEventListener('click', async () => {
    if (!(await allowDiscard())) return; closeNavigation(); openDialog('uninstallDialog'); $('uninstallResult').textContent = '';
    await load(); if (dialog.open) $('uninstallClient').focus();
  });
  $('uninstallReview').addEventListener('click', async () => {
    reset(); error(null); pending = true; controls(); $('uninstallResult').textContent = 'Проверяются файлы клиента…';
    try {
      preview = await api('/api/uninstall', { action: 'preview', ...input() });
      const box = $('uninstallPreview');
      box.append(node('h3', `${preview.name}: ${preview.operation === 'restore' ? 'восстановление' : 'удаление интеграции'}`), node('p', `Область: глобальные файлы выбранного клиента. Файлов: ${preview.changed}.`));
      const list = node('ul');
      for (const file of preview.files) list.append(node('li', `${file.action === 'remove' ? 'Удалить' : 'Обновить'}: ${file.path} · ${file.beforeBytes} → ${file.afterBytes} байт`));
      box.append(list);
      if (preview.skipped.length) {
        const skips = node('ul'); for (const item of preview.skipped) skips.append(node('li', `${item.component}: ${reasons[item.reason] || item.reason}`));
        box.append(node('h3', 'Сохранено / пропущено'), skips);
      }
      if (!preview.canApply) box.append(node('p', preview.recoveryRequired ? 'Удаление заблокировано до восстановления прерванной операции.' : 'Этот канал управляется marketplace. Изменения недоступны.'));
      else if (!preview.changed) box.append(node('p', preview.operation === 'restore' ? 'Файлы уже восстановлены. Подтверждение закроет состояние прерванной операции.' : 'Принадлежащих плагину файлов для удаления нет.'));
      $('uninstallResult').textContent = 'Содержимое конфигураций скрыто: оно может включать секреты. Перед изменением сохраняется и проверяется локальная резервная копия.';
    } catch (problem) { reset(); error(problem); $('uninstallResult').textContent = ''; }
    finally { pending = false; controls(); if (dialog.open) $('uninstallReview').focus(); }
  });
  $('uninstallApply').addEventListener('click', async () => {
    if (pending || !preview?.canApply) return;
    const request = { action: 'apply', ...input(), previewToken: preview.previewToken, confirm: true };
    pending = true; error(null); controls(); $('uninstallResult').textContent = 'Выполняется подтверждённая операция…';
    try {
      const result = await api('/api/uninstall', request);
      // A newly removed integration should offer its own backup first. A hidden
      // selection left by an earlier recovery must not choose an older backup.
      if (result.operation === 'uninstall' && result.operationId) $('uninstallBackup').replaceChildren();
      const message = `${result.status === 'saved' ? 'Выполнено' : result.status === 'partial' ? 'Выполнено частично' : 'Без изменений'}. Обработано: ${result.completed || 0}. Квитанция: ${result.operationId || 'не нужна'}.`;
      await load(); $('uninstallResult').textContent = message; if (result.error) error(result.error);
    } catch (problem) {
      reset(); error(problem); $('uninstallResult').textContent = !problem.status || problem.status >= 500
        ? 'Ответ мог быть потерян. Обновите состояние и проверьте квитанции перед повтором операции.' : '';
    } finally { pending = false; controls(); if (dialog.open) $('uninstallReview').focus(); }
  });
  for (const id of ['uninstallClient','uninstallOperation','uninstallBackup']) $(id).addEventListener('change', () => {
    reset(); error(null); $('uninstallResult').textContent = ''; if (id !== 'uninstallBackup') backups(); renderStatus(); controls();
  });
  $('uninstallRefresh').addEventListener('click', async () => { await load(); if (dialog.open) $('uninstallRefresh').focus(); });
  $('uninstallClose').addEventListener('click', () => { if (!pending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => { reset(); if (!$('openUninstall').getClientRects().length) $('navigation').focus(); });
}
