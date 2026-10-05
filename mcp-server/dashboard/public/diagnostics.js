const $ = id => document.getElementById(id);
export function createDiagnostics({ api, node, openDialog, allowDiscard, closeNavigation }) {
  const dialog = $('diagnosticsDialog'); let status = null, preview = null, pending = false;
  const names = { 'graph-check': 'Проверка движка', 'cleanup-blobs': 'Очистка файлов', 'restore-blobs': 'Восстановление файлов', 'resume-cleanup': 'Продолжение очистки' };
  const checkNames = { 'isolated-store': 'Отдельное временное хранилище', 'notebook-write-readback': 'Запись и чтение Notebook',
    'scoped-link-graph-projection': 'Связь с источником и проекция в графе', 'saved-source-lines': 'Текст сохранённого источника', 'lexical-retrieval-without-models': 'Поиск без загрузки моделей' };
  const fileCount = count => `${count} ${count % 100 >= 11 && count % 100 <= 14 ? 'файлов' : count % 10 === 1 ? 'файл' : count % 10 >= 2 && count % 10 <= 4 ? 'файла' : 'файлов'}`;
  function input() { const operation = $('diagnosticsOperation').value; return { operation,
    ...(['restore-blobs','resume-cleanup'].includes(operation) ? { backupId: $('diagnosticsBackup').value } : {}) }; }
  function error(problem) {
    $('diagnosticsError').hidden = !problem;
    $('diagnosticsError').textContent = !problem ? '' : problem.code === 'CONFLICT'
      ? 'Файлы, привязки или состояние восстановления изменились. Обновите состояние и проверьте список снова.' : `${problem.code || 'Ошибка'}: ${problem.message}`;
  }
  function reset() { preview = null; $('diagnosticsPreview').replaceChildren(); }
  function controls() {
    const { operation, backupId } = input(), run = operation === 'graph-check', recovery = ['restore-blobs','resume-cleanup'].includes(operation);
    $('diagnosticsBackupField').hidden = !recovery;
    $('diagnosticsHint').textContent = run
      ? 'Проверка выполняется в отдельном процессе с временной памятью. Создаёт тестовый Notebook, источник и связь, читает текст и проверяет поиск. Модели и облако не используются. Временная память удаляется после проверки; это не проверка активной сессии клиента.'
      : 'Файлы всех локальных областей RAG. Notebook, индекс, модели, файлы клиентов и история снимков сохраняются. Неиспользуемые файлы резервируются в проверенный ZIP. Уменьшение рабочего хранилища не означает освобождение того же объёма на диске: ZIP остаётся для восстановления.';
    if (!run && status?.recoveryRequired) $('diagnosticsHint').textContent += ' Есть незавершённая операция: выберите её квитанцию и продолжите очистку либо восстановите файлы.';
    dialog.setAttribute('aria-busy', String(pending));
    for (const id of ['diagnosticsOperation','diagnosticsBackup','diagnosticsRefresh','diagnosticsClose']) $(id).disabled = pending;
    $('diagnosticsReview').textContent = run ? 'Запустить проверку' : 'Проверить список файлов';
    $('diagnosticsReview').disabled = pending || !run && (!status || recovery && !backupId || operation === 'cleanup-blobs' && status.recoveryRequired);
    $('diagnosticsApply').disabled = pending || !preview || !preview.changed && operation === 'cleanup-blobs';
  }
  function backups() {
    const selected = $('diagnosticsBackup').value, resume = input().operation === 'resume-cleanup';
    $('diagnosticsBackup').replaceChildren(...(status?.receipts || []).filter(item => !item.unavailable && (!resume || item.operation !== 'restore-blobs')).map(item => {
      const option = node('option', `${names[item.operation]} · ${item.status} · ${item.operationId}`); option.value = item.operationId; return option;
    }));
    if ([...$('diagnosticsBackup').options].some(item => item.value === selected)) $('diagnosticsBackup').value = selected;
  }
  async function load() {
    reset(); error(null); pending = true; controls();
    try {
      status = await api('/api/diagnostics'); backups();
      $('diagnosticsCounts').textContent = `Неиспользуемые файлы: ${status.unusedFiles}. Рабочий объём: ${status.unusedBytes.toLocaleString('ru')} байт. Пропущено: ${status.skipped.length}. Проверено: ${new Date(status.observedAt).toLocaleString('ru')}.`;
      $('diagnosticsReceipts').hidden = !status.receipts.length;
      $('diagnosticsReceiptList').replaceChildren(...status.receipts.map(item => node('li', item.unavailable
        ? `${item.operationId}: квитанция недоступна (${item.unavailable})`
        : `${names[item.operation]} · ${item.status} / ${item.phase} · обработано ${item.completed} · ${item.operationId} · ZIP: ${item.backup}`)));
    } catch (problem) {
      status = null; $('diagnosticsCounts').textContent = 'Состояние файлов недоступно. Изолированная проверка движка остаётся доступной.';
      $('diagnosticsBackup').replaceChildren(); $('diagnosticsReceipts').hidden = true; error(problem);
    }
    finally { pending = false; controls(); }
  }
  $('openDiagnostics').addEventListener('click', async () => {
    if (!(await allowDiscard())) return; closeNavigation(); openDialog('diagnosticsDialog'); $('diagnosticsResult').textContent = '';
    await load(); if (dialog.open) $('diagnosticsOperation').focus();
  });
  $('diagnosticsReview').addEventListener('click', async () => {
    reset(); error(null); const request = input(); pending = true; controls();
    $('diagnosticsResult').textContent = request.operation === 'graph-check' ? 'Проверка во временном хранилище…' : 'Проверяется список файлов…';
    try {
      const result = await api('/api/diagnostics', { action: request.operation === 'graph-check' ? 'run' : 'preview', ...request });
      $('diagnosticsResult').textContent = '';
      if (request.operation === 'graph-check') {
        const box = $('diagnosticsPreview'); box.append(node('h3', result.status === 'passed' ? 'Проверка движка пройдена' : 'Проверка движка не пройдена'));
        const list = node('ul'); for (const item of result.checks) list.append(node('li', `${checkNames[item.name] || item.name}: ${item.status === 'passed' ? 'пройдено' : item.status}`)); box.append(list);
        box.append(node('p', `Рабочая память не изменялась. Временное хранилище: ${result.temporaryCleanup === 'completed' ? 'удалено' : 'очистка не подтверждена'}. Проверено: ${new Date(result.observedAt).toLocaleString('ru')}.`));
        if (result.error) error(result.error);
      } else {
        preview = result; const box = $('diagnosticsPreview'); box.append(node('h3', `${names[result.operation]}: ${fileCount(result.changed)}`),
          node('p', `Рабочий объём: ${result.bytes.toLocaleString('ru')} байт. ${result.operation === 'restore-blobs' ? 'Будут восстановлены отсутствующие файлы.' : 'Будут убраны перечисленные неиспользуемые файлы; резервный ZIP сохранится.'}`));
        const list = node('ul'); for (const item of result.files) list.append(node('li', `${item.hash} · ${item.bytes} байт`)); box.append(list);
        if (result.skipped.length) { const details = node('details'); details.append(node('summary', `Пропущено: ${result.skipped.length}`),node('pre',JSON.stringify(result.skipped,null,2),'knowledge-text')); box.append(details); }
        if (!result.changed) box.append(node('p', request.operation === 'cleanup-blobs' ? 'Неиспользуемых файлов нет.' : 'Изменять файлы не требуется. Подтверждение завершит восстановление состояния операции.'));
      }
    } catch (problem) { $('diagnosticsResult').textContent = ''; error(problem); }
    finally { pending = false; controls(); if (dialog.open) $('diagnosticsReview').focus(); }
  });
  $('diagnosticsApply').addEventListener('click', async () => {
    if (pending || !preview) return; const request = { action: 'apply', ...input(), previewToken: preview.previewToken, confirm: true };
    pending = true; error(null); controls(); $('diagnosticsResult').textContent = 'Выполняется подтверждённая операция…';
    try {
      const result = await api('/api/diagnostics', request); reset();
      const message = `${result.status === 'saved' ? 'Выполнено' : result.status === 'partial' ? 'Выполнено частично' : 'Без изменений'}. Обработано: ${result.completed || 0}. Квитанция: ${result.operationId || 'не нужна'}. ZIP: ${result.backup || 'не нужен'}.`;
      await load(); $('diagnosticsResult').textContent = message; if (result.error) error(result.error);
    } catch (problem) {
      reset(); error(problem); $('diagnosticsResult').textContent = !problem.status || problem.status >= 500
        ? 'Ответ мог быть потерян. Обновите состояние и проверьте квитанции перед повтором операции.' : '';
    } finally { pending = false; controls(); if (dialog.open) $('diagnosticsReview').focus(); }
  });
  $('diagnosticsOperation').addEventListener('change', () => { reset(); error(null); $('diagnosticsResult').textContent = ''; backups(); controls(); });
  $('diagnosticsBackup').addEventListener('change', () => { reset(); error(null); $('diagnosticsResult').textContent = ''; controls(); });
  $('diagnosticsRefresh').addEventListener('click', load);
  $('diagnosticsClose').addEventListener('click', () => { if (!pending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => { reset(); if (!$('openDiagnostics').getClientRects().length) $('navigation').focus(); });
}
