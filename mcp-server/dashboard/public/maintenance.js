const $ = id => document.getElementById(id);
export function createMaintenance({ api, node, openDialog, allowDiscard, closeNavigation, scopeKey, onSaved }) {
  const dialog = $('maintenanceDialog');
  let status = null, preview = null, pending = false, sequence = 0;
  function reset() { preview = null; $('maintenancePreview').replaceChildren(); $('maintenanceApply').disabled = true; }
  function error(problem) {
    $('maintenanceError').hidden = !problem;
    $('maintenanceError').textContent = !problem ? '' : problem.code === 'CONFLICT'
      ? 'Состояние изменилось в другом клиенте. Обновите состояние и проверьте изменения снова.'
      : `${problem.code || 'Ошибка'}: ${problem.message}`;
  }
  function input() {
    const operation = $('maintenanceOperation').value;
    return { operation, ...(operation.startsWith('migrate-') ? { key: operation === 'migrate-persona' ? 'global' : $('maintenanceTarget').value } : {}),
      ...(operation === 'restore-settings' ? { backupId: $('maintenanceBackup').value } : {}) };
  }
  function controls() {
    const operation = $('maintenanceOperation').value;
    $('maintenanceTargetField').hidden = !operation.startsWith('migrate-');
    $('maintenanceBackupField').hidden = operation !== 'restore-settings';
    if (operation === 'migrate-persona') $('maintenanceTarget').value = 'global';
    $('maintenanceHint').textContent = operation.startsWith('migrate-')
      ? 'Один Notebook. Даты, keep, TTL, история и источники сохраняются. Перед записью создаётся проверенный полный ZIP. Синхронизацию файлов клиентов выполните отдельно в разделе «Инструкции».'
      : 'Поиск, модели и доступ к источникам. Режим хранения, облачное подключение, расписание снимков, порт и автозапуск сохраняются. Модели в процессах и существующие векторы не меняются. Есть резервная копия для восстановления.';
    busy(pending);
  }
  function busy(value) {
    pending = value; dialog.setAttribute('aria-busy', String(value));
    for (const id of ['maintenanceOperation','maintenanceTarget','maintenanceBackup','maintenanceRefresh','maintenanceClose']) $(id).disabled = value;
    const request = input(), unavailable = !status || request.operation.startsWith('migrate-') && (!request.key || status.unavailable)
      || request.operation === 'restore-settings' && !request.backupId;
    $('maintenanceReview').disabled = value || !!unavailable;
    $('maintenanceTarget').disabled = value || request.operation === 'migrate-persona';
    $('maintenanceApply').disabled = value || !preview?.changed;
  }
  async function load() {
    const current = ++sequence; reset(); error(null); busy(true);
    try {
      const result = await api('/api/maintenance'); if (current !== sequence || !dialog.open) return;
      status = result; const target = $('maintenanceTarget').value || scopeKey();
      $('maintenanceTarget').replaceChildren(...result.targets.filter(item => !item.unavailable && item.notebookAvailable !== false).map(item => {
        const option = node('option', `${item.name} · ${item.key}`); option.value = item.key; return option;
      }));
      if (result.targets.some(item => item.key === target && !item.unavailable)) $('maintenanceTarget').value = target;
      $('maintenanceBackup').replaceChildren(...result.backups.filter(item => !item.unavailable).map(item => {
        const option = node('option', `${new Date(item.observedAt).toLocaleString('ru')} · ${item.id}`); option.value = item.id; return option;
      }));
      if (result.unavailable) error({ code: result.unavailable, message: 'Notebook недоступен; операции с настройками остаются доступны.' });
      if (result.backups.some(item => item.unavailable)) error({ code: 'RECOVERY_REQUIRED', message: 'Есть повреждённые резервные копии настроек. Они исключены из списка восстановления.' });
      controls();
    } catch (problem) { if (current === sequence) { status = null; error(problem); } }
    finally { if (current === sequence) busy(false); }
  }
  $('openMaintenance').addEventListener('click', async () => {
    if (!(await allowDiscard())) return; closeNavigation(); openDialog('maintenanceDialog'); $('maintenanceResult').textContent = ''; await load();
    if (dialog.open && !pending) $('maintenanceOperation').focus();
  });
  $('maintenanceReview').addEventListener('click', async () => {
    const current = ++sequence; reset(); error(null); $('maintenanceResult').textContent = ''; busy(true);
    try {
      const result = await api('/api/maintenance', { action: 'preview', ...input() });
      if (current !== sequence || !dialog.open) return; preview = result;
      const box = $('maintenancePreview'); box.append(node('h3', `${result.scope === 'configuration' ? 'Настройки' : result.scope} · Изменений: ${result.changed}`));
      if (!result.changed) box.append(node('p', 'Изменений нет.'));
      for (const item of result.changes) {
        const details = node('details'); details.append(node('summary', item.label || item.ref),
          node('pre', `Сейчас:\n${typeof item.before === 'string' ? item.before : JSON.stringify(item.before)}\n\nПосле:\n${typeof item.after === 'string' ? item.after : JSON.stringify(item.after)}`, 'knowledge-text')); box.append(details);
      }
      box.append(node('p', `Проверено: ${new Date(result.observedAt).toLocaleString('ru')}`, 'caption'));
    } catch (problem) { if (current === sequence) error(problem); }
    finally { if (current === sequence) busy(false); }
  });
  $('maintenanceApply').addEventListener('click', async () => {
    if (pending || !preview?.changed) return;
    const request = { action: 'apply', ...input(), previewToken: preview.previewToken, confirm: true }; busy(true); error(null);
    try {
      const result = await api('/api/maintenance', request); reset();
      $('maintenanceResult').textContent = `${result.status === 'saved' ? 'Сохранено' : 'Без изменений'}: ${result.changed}. Резервная копия: ${result.backup || 'не нужна'}.${result.reindexRequired ? ' Требуется переиндексация знаний.' : ''} Модели в процессах и файлы клиентов не синхронизированы.`;
      await load();
      // A refresh failure cannot turn a committed mutation into an apparent failure.
      try { await onSaved(); } catch { error({ code: 'UNAVAILABLE', message: 'Изменения сохранены; обновить основной экран не удалось.' }); }
    } catch (problem) { reset(); error(problem); }
    finally { busy(false); if (dialog.open) $('maintenanceReview').focus(); }
  });
  for (const id of ['maintenanceOperation','maintenanceTarget','maintenanceBackup']) $(id).addEventListener('change', () => { sequence++; reset(); error(null); $('maintenanceResult').textContent = ''; controls(); });
  $('maintenanceRefresh').addEventListener('click', load);
  $('maintenanceClose').addEventListener('click', () => { if (!pending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    sequence++; reset();
    if (!$('openMaintenance').getClientRects().length) $('navigation').focus();
  });
}
