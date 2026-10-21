import { dateText, formatText, joinText, scopeText, setText, t } from './i18n.js';
const $ = id => document.getElementById(id);
const reasonLabels = { expired: t('m5'), superseded: t('m6'), disabled: t('m7'),
  other_scope: t('m531'), client_scope: t('m532') };

export function createPersonaPreview({ api, node, openDialog, scope, errorText, openRecord }) {
  let sequence = 0, preview = null, selectedKey = null;
  const dialog = $('personaDialog');
  function render() {
    if (!preview) return;
    $('personaField').value = preview.persona || '';
    const native = preview.coverage === 'native-builders';
    setText($('personaCoverage'), native
      ? t('m533')
      : t('m534'));
    setText($('personaObserved'), t('m535', dateText(new Date(preview.observedAt), 'toLocaleString')));
    $('personaUnavailable').hidden = !preview.unavailable.length;
    setText($('personaUnavailable'), preview.unavailable.length
      ? t('m536', preview.unavailable.length, joinText(preview.unavailable.map(item => formatText`${item.name} (${item.key})`), '; ')) : '');
    const filter = $('personaFilter').value;
    const records = preview.directives.filter(item => filter === 'all' || (filter === 'other' ? item.reasons.includes('other_scope') : !item.reasons.includes('other_scope')));
    const included = records.filter(item => item.included), excluded = records.filter(item => !item.included);
    setText($('personaSummary'), t('m537', included.length, excluded.length));
    $('personaContent').replaceChildren();
    for (const [items, label] of [[included, t('m538')], [excluded, t('m539')]]) {
      const section = node('section', null, 'persona-section'); section.append(node('h3', label));
      if (!items.length) section.append(node('p', t('m540'), 'caption'));
      const list = node('ul', null, 'persona-records');
      for (const item of items) {
        const li = node('li');
        li.append(node('strong', item.title || t('m111')), node('p', formatText`${scopeText({name:item.scopeName,key:item.key})} · ${item.key} · ${item.id || item.ref}`, 'caption'));
        li.append(node('p', item.included ? t('m541') : joinText(item.reasons.map(reason => reasonLabels[reason] || reason), '; ')));
        if (item.contextRole === 'fact') li.append(node('p', t('m542'), 'caption'));
        if (item.legacy) li.append(node('p', t('m543'), 'caption'));
        const details = node('details'); details.append(node('summary', t('m544')), node('p', item.body, 'knowledge-text')); li.append(details);
        const open = node('button', t('m545'), 'button secondary'); open.type = 'button';
        open.addEventListener('click', async () => { dialog.close(); await openRecord(item); });
        li.append(open); list.append(li);
      }
      section.append(list); $('personaContent').append(section);
    }
    $('personaBlocks').replaceChildren();
    if (preview.adapter) {
      const details = node('details', null, 'persona-block');
      details.append(node('summary', t('m546', preview.client.name)), node('pre', preview.adapter.text || t('m547'), 'knowledge-text'));
      $('personaBlocks').append(details);
    }
    for (const block of preview.blocks) {
      const details = node('details', null, 'persona-block');
      details.append(node('summary', t('m548', block.label)), node('pre', block.text || t('m547'), 'knowledge-text'));
      $('personaBlocks').append(details);
    }
  }
  async function load() {
    const current = ++sequence, client = $('personaClient').value;
    preview = null;
    $('personaContent').replaceChildren(); $('personaBlocks').replaceChildren();
    $('personaField').value = '';
    for (const id of ['personaCoverage', 'personaObserved', 'personaSummary']) setText($(id), '');
    $('personaUnavailable').hidden = true;
    $('personaError').hidden = true;
    $('personaLoading').hidden = false;
    $('personaResults').setAttribute('aria-busy', 'true'); $('personaRefresh').disabled = true;
    try {
      const result = await api(formatText`/api/persona?key=${encodeURIComponent(selectedKey)}&client=${encodeURIComponent(client)}`);
      if (current !== sequence || !dialog.open) return;
      preview = result;
      $('personaClient').replaceChildren(...result.clients.map(item => { const option = node('option', item.name); option.value = item.id; return option; }));
      $('personaClient').value = result.client.id;
      render();
    } catch (error) {
      if (current !== sequence || !dialog.open) return;
      setText($('personaError'), errorText(error)); $('personaError').hidden = false;
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
    selectedKey = target.key; setText($('personaScope'), formatText`${scopeText(target)} · ${target.key}`);
    $('personaFilter').value = 'scope'; openDialog('personaDialog'); void load(); } };
}
