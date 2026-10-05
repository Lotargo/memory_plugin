const $ = id => document.getElementById(id);
const conflicts = {
  'duplicate-body': 'Такой текст уже есть в целевом хранилище. Измените цель или разберите совпадение отдельно.',
  'ambiguous-target-ids': 'В целевом хранилище повторяются ID; сначала исправьте их.',
  'replacement-history': 'Перенос одной записи разделит историю замещения. Перенос цепочки пока недоступен.',
  'target-history-reference': 'ID записи уже упоминается в истории целевого хранилища.',
  'unresolved-source-links': 'Есть неоднозначные старые связи. Сначала разберите их в редакторе связей.',
  'source-unavailable': 'Связанный источник недоступен в исходной области.',
  'source-not-visible-in-target': 'Связанный источник не виден в целевой области. Для переноса разрешите открыть перечисленные источники целевой области.',
  'independent-graph-edges': 'Есть независимые графовые связи. Их автоматический перенос не поддерживается.',
  'independent-legacy-graph-edges': 'Есть неоднозначные старые графовые связи; сначала разберите их.',
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
  function error(message) { $('transferError').textContent = message; $('transferError').hidden = !message; }
  function errorMessage(problem) {
    if (problem.code === 'CONFLICT') return 'Данные изменились. Обновите предпросмотр. Если изменилась сама инструкция, откройте её заново из свежего списка.';
    if (problem.code === 'MIGRATION_REQUIRED') return 'Сначала подготовьте связи через «Добавить связь с источником → Подготовить связи». Перенос не запускает миграцию автоматически.';
    if (problem.code === 'RECOVERY_REQUIRED') return 'Публикация прервана. Проверьте обе области после восстановления движка; повторный перенос автоматически не выполняется.';
    return `${problem.code || 'Ошибка'}: ${problem.message}. При ошибке применения обновите обе области: перенос мог уже сохраниться.`;
  }
  function render() {
    const results = $('transferResults'); results.replaceChildren();
    results.append(node('h3', preview.directive.title), node('p', preview.directive.body, 'knowledge-text'));
    const list = node('ul');
    for (const text of [
      `Из: ${preview.source.name} · ${preview.source.key} · ${preview.source.ref}`,
      `В: ${preview.target.name} · ${preview.target.key} · ${preview.target.ref}`,
      preview.idChange.changed ? `ID изменится: ${preview.idChange.from || 'legacy без ID'} → ${preview.idChange.to}.` : 'ID сохранится.',
      'Дата, TTL, защита, выключенное состояние и теги сохранятся.',
      `Связей будет перенесено: ${preview.links.length}. Прежние области документов сохранятся.`,
      'Перед применением будет создан проверенный локальный резервный ZIP.',
      'Активная сессия может хранить прежний контекст; передача в неё и использование агентом не наблюдались.',
    ]) list.append(node('li', text));
    results.append(list);
    for (const item of preview.sources) results.append(node('p',
      `${item.title || item.docId}: ${item.addScope ? `открыть области ${item.addScope}`
        : item.scopes.some(key => key === 'global' || key === preview.target.key) ? 'доступ в целевой области уже есть' : 'доступа в целевой области нет'}. Текущие области: ${item.scopes.join(', ')}.`, 'caption'));
    if (preview.sharingGlobal) results.append(node('p', 'Глобальная область откроет эти источники всем проектам, использующим глобальные знания.', 'inline-error'));
    if (preview.conflicts.length) {
      const issues = node('ul', null, 'inline-error');
      for (const item of preview.conflicts) issues.append(node('li', conflicts[item.reason] || item.reason));
      results.append(issues);
    }
    $('transferShareConfirmation').hidden = !preview.sources.some(item => item.addScope);
    $('transferHint').textContent = preview.canApply ? 'Проверьте обе области и последствия, затем подтвердите перенос.' : 'Перенос заблокирован перечисленными конфликтами. Измените цель или устраните причины и обновите предпросмотр.';
  }
  async function review() {
    if (pending || !source) return;
    const current = ++sequence; resetPreview(); error('');
    const targetKey = $('transferTarget').value;
    if (!targetKey) { error('Выберите целевое хранилище.'); return; }
    busy(true);
    try {
      const [from, to] = await Promise.all([
        api(`/api/notebook?key=${encodeURIComponent(source.key)}`), api(`/api/notebook?key=${encodeURIComponent(targetKey)}`),
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
  $('transferTarget').addEventListener('change', () => { sequence++; resetPreview(); error(''); $('transferHint').textContent = 'Обновите предпросмотр для выбранной цели.'; });
  $('transferShare').addEventListener('change', () => { sequence++; resetPreview(); error(''); $('transferHint').textContent = 'Обновите предпросмотр после изменения доступа источников.'; });
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
    } catch (problem) { resetPreview(); error(errorMessage(problem)); $('transferHint').textContent = 'Прежний предпросмотр сброшен. Проверьте состояние и обновите его перед повторным применением.'; }
    finally { busy(false); }
  });
  return { async open({ key, record }) {
    source = { key, ref: record.ref, fingerprint: record.fingerprint }; sequence++;
    resetPreview(); error(''); $('transferShare').checked = false; $('transferTarget').replaceChildren();
    $('transferSource').textContent = `Исходная область: ${key} · ${record.ref}`;
    $('transferHint').textContent = 'Выберите цель и проверьте предпросмотр.';
    openDialog('transferDialog'); busy(true);
    const current = sequence;
    try {
      const targets = await api('/api/directive-transfer', { action: 'targets' });
      if (current !== sequence || !dialog.open) return;
      $('transferTarget').append(node('option', 'Выберите хранилище…'));
      $('transferTarget').firstChild.value = '';
      for (const item of targets.items.filter(item => item.key !== key && !item.unavailable && item.notebookAvailable !== false)) {
        const option = node('option', `${item.name} · ${item.key}`); option.value = item.key; $('transferTarget').append(option);
      }
    } catch (problem) { if (current === sequence) error(errorMessage(problem)); }
    finally { if (current === sequence) { busy(false); $('transferTarget').focus(); } }
  } };
}
