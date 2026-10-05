const $ = id => document.getElementById(id);
const modes = { none: 'Подключение не найдено', foreign: 'Чужая регистрация memory-agent', direct: 'Прямой MCP', marketplace: 'Marketplace', conflict: 'Конфликт каналов', 'native-plugin': 'Native plugin', disabled: 'Прямой MCP выключен', 'project-only': 'Только проектная регистрация' };
const outcomes = { passed: 'Проверка прошла', partial: 'Проверка завершена частично', failed: 'Ошибка проверки', unavailable: 'Проверка недоступна', 'timed-out': 'Время проверки истекло', stale: 'Конфигурация изменилась во время проверки' };
const reasons = { UNSUPPORTED_LAUNCHER: 'Проверка адаптера поддерживает один прямой Node/boot.js или Codex/Claude marketplace без проектных переопределений. Npx и произвольные команды не запускаются.',
  CLI_UNAVAILABLE: 'Executable клиента не найден в PATH.', TIMEOUT: 'Процесс не завершил проверку за 20 секунд; отправлено завершение дерева процессов.',
  OUTPUT_LIMIT: 'Вывод процесса превысил лимит 256 KiB.', PROTOCOL: 'Ответ процесса не соответствует ожидаемому протоколу.', RUNTIME_MISMATCH: 'Данные адаптера и runtime расходятся.',
  CONFLICT: 'Конфигурация изменилась. Обновите статус и запустите новую проверку.', BUSY: 'В панели уже выполняется проверка клиента.', PROBE_FAILED: 'Процесс завершился с ошибкой. Его исходный вывод не возвращается.', ENGINE_UNAVAILABLE: 'MCP ответил, но данные RAG или идентичности проекта недоступны. Полная работоспособность памяти не подтверждена.' };

export function createClients({ api, node, openDialog, allowDiscard, closeNavigation }) {
  const dialog = $('clientsDialog'); let status, pending = false, sequence = 0;
  const selected = () => status?.items.find(item => item.client === $('clientsClient').value);
  function controls() {
    dialog.setAttribute('aria-busy', String(pending));
    for (const id of ['clientsClient','clientsOperation','clientsRefresh','clientsClose']) $(id).disabled = pending;
    $('clientsRun').disabled = pending || !selected()?.version;
  }
  function problem(error) {
    $('clientsError').hidden = !error;
    $('clientsError').textContent = error ? reasons[error.code] || 'Не удалось получить состояние клиента. Обновите статус.' : '';
  }
  function result(value) {
    const box = $('clientsResult'); box.replaceChildren(); if (!value) return;
    box.append(node('h3', value.stale ? outcomes.stale : outcomes[value.status] || value.status));
    box.append(node('p', `${value.operation === 'version' ? 'Версия CLI' : 'Адаптер памяти'} · ${new Date(value.finishedAt).toLocaleString('ru')} · ${value.durationMs} мс${value.cliVersion ? ` · ${value.cliVersion}` : ''}${value.toolCount ? ` · ${value.toolCount} MCP-инструментов` : ''}`));
    if (value.code) box.append(node('p', reasons[value.code] || 'Проверка не завершилась. Обновите статус.', 'inline-error'));
    if (value.installed) box.append(node('p', 'Клиентский список подтвердил enabled marketplace-плагин; результат проверки установленного адаптера приведён ниже.'));
    const list = node('ul'); for (const check of value.checks || []) list.append(node('li', `${check.level}: ${check.label}`)); box.append(list);
    box.append(node('p', 'Активная сессия, автоматическая доставка инструкций и использование агентом: нет данных.', 'caption'));
  }
  function render() {
    const box = $('clientsStatus'); box.replaceChildren(); const item = selected(); if (!item) return;
    box.append(node('h3', item.name), node('p', `Источник: локальные файлы и PATH. ${new Date(item.observedAt).toLocaleString('ru')}.`, 'caption'));
    box.append(node('p', `Каталог панели: ${item.workspace}`, 'caption prompt-path'));
    if (item.status === 'unavailable') box.append(node('p', `Файлы недоступны (${item.code}). Другие клиенты доступны отдельно.`, 'inline-error'));
    else {
      const c = item.channel;
      box.append(node('p', modes[c.mode] || c.mode));
      box.append(node('p', `Глобальный MCP: ${c.direct ? c.directEnabled ? 'принадлежит плагину' : 'выключен' : 'не найден'} · marketplace: ${c.marketplace ? 'включён в конфигурации' : 'не включён'} · проектная регистрация: ${c.project ? 'найдена' : 'не найдена'}`));
      if (c.conflict || c.foreign) box.append(node('p', c.conflict ? 'Найдено несколько каналов/регистраций. Проверка адаптера заблокирована до устранения конфликта.' : 'Регистрация memory-agent принадлежит другому приложению. Её команда не запускается.', 'inline-error'));
      if (c.marketplace && c.directEnabled) box.append(node('p', 'Каналы marketplace и прямого MCP присутствуют одновременно.', 'inline-error'));
      box.append(node('p', `Skill: ${item.components.skill.exists ? 'файл есть; владение не проверено' : 'файла нет'}. Prompt: ${item.components.prompt.channel === 'native-context' ? 'native-контекст OpenCode' : item.components.prompt.prompt ? 'managed-блок есть' : 'managed-блока нет'}.`, 'caption'));
    }
    box.append(node('p', item.executable.supported ? item.executable.available ? `Executable в PATH: ${item.executable.path}` : 'Executable клиента не найден в PATH.' : 'Для Antigravity native CLI-проверка не поддерживается.', 'caption prompt-path'));
    box.append(node('p', 'Установка и загрузка в активную сессию не подтверждены чтением конфигурации.', 'caption'));
    const details = node('details'), files = node('ul'); details.append(node('summary','Проверенные файлы и версии'));
    for (const file of item.files) files.append(node('li', `${file.path} · ${file.exists ? `SHA-256 ${file.hash}` : 'отсутствует'}`, 'prompt-path'));
    details.append(files); box.append(details); result(item.lastProbe); controls();
  }
  async function load() {
    const current = ++sequence; pending = true; controls(); problem(null); $('clientsProgress').textContent = 'Читаем локальные файлы…';
    try { const value = await api('/api/clients'); if (current !== sequence || !dialog.open) return; status = value; render(); }
    catch (error) { status = null; $('clientsStatus').replaceChildren(); result(null); problem(error); }
    finally { if (current === sequence) { pending = false; controls(); $('clientsProgress').textContent = ''; } }
  }
  $('openClients').addEventListener('click', async () => { if (!await allowDiscard()) return; closeNavigation(); openDialog('clientsDialog'); await load(); $('clientsClient').focus(); });
  $('clientsClient').addEventListener('change', () => { problem(null); render(); });
  $('clientsRefresh').addEventListener('click', async () => { await load(); $('clientsRefresh').focus(); });
  $('clientsRun').addEventListener('click', async () => {
    const item = selected(); if (pending || !item?.version) return;
    pending = true; controls(); problem(null); result(null); $('clientsProgress').textContent = 'Выполняется отдельный процесс проверки. Лимит — 20 секунд…';
    try {
      const value = await api('/api/clients', { action: 'probe', client: item.client, operation: $('clientsOperation').value, expectedVersion: item.version });
      result(value);
      // Do not replace the displayed version with an unreviewed fresh snapshot.
      item.lastProbe = value;
    } catch (error) { problem(error); }
    finally { pending = false; controls(); $('clientsProgress').textContent = ''; $('clientsRun').focus(); }
  });
  $('clientsClose').addEventListener('click', () => { if (!pending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    sequence++;
    const trigger = $('openClients').getClientRects().length ? $('openClients') : $('navigation');
    if (trigger.getClientRects().length) trigger.focus();
  });
}
