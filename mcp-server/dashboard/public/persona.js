const $ = id => document.getElementById(id);
const reasonLabels = { expired: 'Срок истёк', superseded: 'Заменена', disabled: 'Выключена',
  other_scope: 'Другой проект', client_scope: 'Проектные инструкции не входят в глобальный файл этого клиента' };

export function createPersonaPreview({ api, node, openDialog, scope, errorText, openRecord }) {
  let sequence = 0, preview = null, selectedKey = null;
  const dialog = $('personaDialog');
  function render() {
    if (!preview) return;
    $('personaField').value = preview.persona || '';
    const native = preview.coverage === 'native-builders';
    $('personaCoverage').textContent = native
      ? 'Настоящие построители OpenCode V1 и V2: глобальная память и выбранный проект. Инструкции передаются полностью, без лимита количества.'
      : 'Предпросмотр формата адаптера из глобальных инструкций. Содержимое файлов клиента и контекст активной сессии здесь не проверяются.';
    $('personaObserved').textContent = `Снимок памяти: ${new Date(preview.observedAt).toLocaleString('ru')}. Передача в активную сессию и использование агентом: нет данных.`;
    $('personaUnavailable').hidden = !preview.unavailable.length;
    $('personaUnavailable').textContent = preview.unavailable.length
      ? `Список неполный: недоступных хранилищ — ${preview.unavailable.length}. ${preview.unavailable.map(item => `${item.name} (${item.key})`).join('; ')}` : '';
    const filter = $('personaFilter').value;
    const records = preview.directives.filter(item => filter === 'all' || (filter === 'other' ? item.reasons.includes('other_scope') : !item.reasons.includes('other_scope')));
    const included = records.filter(item => item.included), excluded = records.filter(item => !item.included);
    $('personaSummary').textContent = `Включены как инструкции: ${included.length}. Исключены из инструкций: ${excluded.length}.`;
    $('personaContent').replaceChildren();
    for (const [items, label] of [[included, 'Включены'], [excluded, 'Исключены из инструкций']]) {
      const section = node('section', null, 'persona-section'); section.append(node('h3', label));
      if (!items.length) section.append(node('p', 'Инструкций в этой группе нет.', 'caption'));
      const list = node('ul', null, 'persona-records');
      for (const item of items) {
        const li = node('li');
        li.append(node('strong', item.title || 'Без заголовка'), node('p', `${item.scopeName} · ${item.key} · ${item.id || item.ref}`, 'caption'));
        li.append(node('p', item.included ? 'Включена' : item.reasons.map(reason => reasonLabels[reason] || reason).join('; ')));
        if (item.contextRole === 'fact') li.append(node('p', 'OpenCode передаёт эту запись как факт с отметкой истечения срока, без роли действующей инструкции.', 'caption'));
        if (item.legacy) li.append(node('p', 'Legacy-теги персоны учитываются движком.', 'caption'));
        const details = node('details'); details.append(node('summary', 'Текст инструкции'), node('p', item.body, 'knowledge-text')); li.append(details);
        const open = node('button', 'Открыть запись', 'button secondary'); open.type = 'button';
        open.addEventListener('click', async () => { dialog.close(); await openRecord(item); });
        li.append(open); list.append(li);
      }
      section.append(list); $('personaContent').append(section);
    }
    $('personaBlocks').replaceChildren();
    if (preview.adapter) {
      const details = node('details', null, 'persona-block');
      details.append(node('summary', `Формат клиента (шаблон): ${preview.client.name}`), node('pre', preview.adapter.text || 'Блок пуст.', 'knowledge-text'));
      $('personaBlocks').append(details);
    }
    for (const block of preview.blocks) {
      const details = node('details', null, 'persona-block');
      details.append(node('summary', `Исходный блок: ${block.label}`), node('pre', block.text || 'Блок пуст.', 'knowledge-text'));
      $('personaBlocks').append(details);
    }
  }
  async function load() {
    const current = ++sequence, client = $('personaClient').value;
    preview = null;
    $('personaContent').replaceChildren(); $('personaBlocks').replaceChildren();
    $('personaField').value = '';
    for (const id of ['personaCoverage', 'personaObserved', 'personaSummary']) $(id).textContent = '';
    $('personaUnavailable').hidden = true;
    $('personaError').hidden = true;
    $('personaLoading').hidden = false;
    $('personaResults').setAttribute('aria-busy', 'true'); $('personaRefresh').disabled = true;
    try {
      const result = await api(`/api/persona?key=${encodeURIComponent(selectedKey)}&client=${encodeURIComponent(client)}`);
      if (current !== sequence || !dialog.open) return;
      preview = result;
      $('personaClient').replaceChildren(...result.clients.map(item => { const option = node('option', item.name); option.value = item.id; return option; }));
      $('personaClient').value = result.client.id;
      render();
    } catch (error) {
      if (current !== sequence || !dialog.open) return;
      $('personaError').textContent = errorText(error); $('personaError').hidden = false;
    } finally {
      if (current === sequence) {
        $('personaLoading').hidden = true; $('personaResults').setAttribute('aria-busy', 'false'); $('personaRefresh').disabled = false;
      }
    }
  }
  $('personaClient').addEventListener('change', load);
  $('personaFilter').addEventListener('change', render);
  $('personaRefresh').addEventListener('click', load);
  dialog.addEventListener('close', () => { sequence++; preview = null; });
  return { open() { const target = scope(); if (!target || target.key === '__all__') return;
    selectedKey = target.key; $('personaScope').textContent = `${target.name} · ${target.key}`;
    $('personaFilter').value = 'scope'; openDialog('personaDialog'); void load(); } };
}
