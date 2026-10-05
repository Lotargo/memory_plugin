const $ = id => document.getElementById(id);
const ownership = { 'unchanged-owned': 'Последняя запись сервиса не изменена', 'externally-edited': 'Файл изменён вне сервиса', untracked: 'Владение файлом не подтверждено' };

export function createPromptAdmin({ api, node, openDialog }) {
  const dialog = $('promptsDialog');
  let status = null, preview = null, sequence = 0, pending = false;
  function reset() { preview = null; $('promptsPreviewContent').replaceChildren(); $('promptsApply').disabled = true; }
  function error(problem) {
    $('promptsError').hidden = !problem;
    $('promptsError').textContent = !problem ? '' : problem.code === 'CONFLICT'
      ? 'Файл, владение, настройки клиента или глобальные инструкции изменились. Обновите статус и предпросмотр.'
      : problem.code === 'RECOVERY_REQUIRED' ? 'Есть прерванная операция или повреждённое состояние владения. Проверьте файлы и журнал; восстановление доступно через memory-cli prompts recover --confirm.'
      : `${problem.code || 'Ошибка'}: ${problem.message}. Перед повторной записью обновите статус.`;
  }
  function busy(value) {
    pending = value; dialog.setAttribute('aria-busy', String(value)); $('promptsLoading').hidden = !value;
    for (const id of ['promptsClient', 'promptsOperation', 'promptsRefresh', 'promptsReview', 'promptsClose']) $(id).disabled = value;
    $('promptsApply').disabled = value || !preview?.canApply || !preview.changed;
  }
  function renderStatus() {
    const box = $('promptsStatus'); box.replaceChildren();
    if (!status) return;
    box.append(node('p', `Состояние файлов: ${new Date(status.observedAt).toLocaleString('ru')}. Активная сессия и использование агентом: нет данных.`, 'caption'));
    box.append(node('p', 'OpenCode передаёт инструкции через native-контекст; отдельный глобальный файл здесь не создаётся.', 'caption'));
    if (status.recoveryRequired) box.append(node('p', 'Незавершённая операция: запись заблокирована до восстановления журнала.', 'inline-error'));
    const list = node('ul', null, 'prompt-status-list');
    for (const item of status.items) {
      const li = node('li'); li.append(node('strong', item.name), node('p', item.filePath, 'caption prompt-path'));
      li.append(node('p', item.unavailable ? `Статус недоступен: ${item.code}`
        : `${item.exists ? 'Файл существует' : 'Файла нет'} · prompt: ${item.prompt ? 'есть' : 'нет'} · persona: ${item.persona ? 'есть' : 'нет'}`));
      if (!item.unavailable) li.append(node('p', item.integration.pluginManaged ? 'Канал принадлежит marketplace-плагину. Файл пропускается при enable, disable и sync.'
        : `${ownership[item.ownership]}. ${item.integration.conflict ? 'Обнаружен конфликт подключений клиента.' : ''}`, 'caption'));
      list.append(li);
    }
    const selected = status.items.find(item => item.id === $('promptsClient').value);
    if (selected) {
      const card = node('div', null, 'prompt-selected-status');
      card.append(node('strong', selected.name), node('p', selected.filePath, 'caption prompt-path'));
      card.append(node('p', selected.unavailable ? `Статус недоступен: ${selected.code}` : `${selected.exists ? 'Файл существует' : 'Файла нет'} · prompt: ${selected.prompt ? 'есть' : 'нет'} · persona: ${selected.persona ? 'есть' : 'нет'}`));
      if (!selected.unavailable) card.append(node('p', selected.integration.pluginManaged ? 'Канал принадлежит marketplace-плагину; файлы не изменяются.' : ownership[selected.ownership], 'caption'));
      box.append(card);
    }
    const all = node('details'); all.append(node('summary', 'Статусы всех клиентов'), list); box.append(all);
  }
  async function load() {
    const current = ++sequence; reset(); error(null); $('promptsResult').textContent = ''; busy(true);
    try {
      const result = await api('/api/prompts');
      if (current !== sequence || !dialog.open) return;
      status = result; renderStatus();
    } catch (problem) { if (current === sequence) error(problem); }
    finally { if (current === sequence) busy(false); }
  }
  function fileDetails(label, text) {
    const details = node('details'); details.append(node('summary', label), node('pre', text || 'Пустой файл.', 'knowledge-text')); return details;
  }
  $('promptsReview').addEventListener('click', async () => {
    const current = ++sequence; reset(); error(null); $('promptsResult').textContent = ''; busy(true);
    try {
      const result = await api('/api/prompts', { action: 'preview', client: $('promptsClient').value, operation: $('promptsOperation').value });
      if (current !== sequence || !dialog.open) return;
      preview = result;
      const box = $('promptsPreviewContent');
      box.append(node('h3', `${result.target.name} · ${result.target.filePath}`), node('p', ownership[result.ownership], 'caption'));
      if (!result.canApply) box.append(node('p', 'Marketplace-плагин управляет этим клиентом. Запись файла недоступна.', 'inline-error'));
      else box.append(node('p', result.proposed.removeFile ? 'Будет удалён неизменённый файл, созданный сервисом.'
        : result.changed ? 'Изменятся только managed-блоки. Остальной текст сохранится. Перед записью будет создана локальная резервная копия.' : 'Изменений нет.'));
      box.append(node('p', 'Глобальные инструкции. Операция disable удаляет prompt/persona-блоки; MCP и плагин остаются подключёнными. Активная сессия может хранить прежний контекст.', 'caption'));
      box.append(fileDetails(`Текущий файл · SHA-256: ${result.current.hash || 'файла нет'}`, result.current.text));
      box.append(fileDetails(result.proposed.exists ? 'Файл после операции' : 'После операции файла не будет', result.proposed.text));
      box.append(fileDetails('Шаблон prompt-блока', result.operation === 'enable' ? result.prompt.expectedBlock : 'Prompt не добавляется этой операцией.'));
      box.append(fileDetails('Persona-блок из текущих глобальных инструкций', result.operation === 'disable' ? 'Persona будет удалена.' : result.persona.expectedBlock));
      if (result.target.includeSupported) {
        box.append(node('p', `Общий include-файл: ${result.sharedPrompt.path}. ${result.sharedPrompt.changes
          ? 'Будет обновлён; это также изменит содержимое include для других подключённых клиентов.' : !result.canApply ? 'Не изменяется: канал принадлежит плагину.'
            : result.sharedPrompt.exists ? 'Не изменится.' : 'Отсутствует; эта операция не создаёт prompt include.'}`, 'caption prompt-path'));
        box.append(fileDetails('Текущий общий include-файл', result.sharedPrompt.text));
        if (result.sharedPrompt.changes) box.append(fileDetails('Общий include-файл после операции', result.sharedPrompt.proposedText));
      }
    } catch (problem) { if (current === sequence) error(problem); }
    finally { if (current === sequence) busy(false); }
  });
  $('promptsApply').addEventListener('click', async () => {
    if (pending || !preview?.canApply || !preview.changed) return;
    const input = { action: 'apply', client: preview.target.id, operation: preview.operation, previewToken: preview.previewToken, confirm: true };
    busy(true); error(null);
    try {
      const result = await api('/api/prompts', input); reset();
      $('promptsResult').textContent = `${result.name}: ${result.status}. ${result.backup ? `Резервная копия: ${result.backup}.` : ''} Активная сессия: нет данных.`;
      status = await api('/api/prompts'); renderStatus();
    } catch (problem) { reset(); error(problem); }
    finally { busy(false); }
  });
  for (const id of ['promptsClient', 'promptsOperation']) $(id).addEventListener('change', () => { sequence++; reset(); renderStatus(); error(null); $('promptsResult').textContent = ''; });
  $('promptsRefresh').addEventListener('click', load);
  $('promptsClose').addEventListener('click', () => { if (!pending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => { sequence++; reset(); });
  return { open() { openDialog('promptsDialog'); void load(); } };
}
