import { dateText, formatText, setText, t } from './i18n.js';
const $ = id => document.getElementById(id);
const modes = { none: t('m125'), foreign: t('m126'), direct: t('m127'), marketplace: 'Marketplace', conflict: t('m128'), 'native-plugin': 'Native plugin', disabled: t('m129'), 'project-only': t('m130') };
const outcomes = { passed: t('m131'), partial: t('m132'), failed: t('m133'), unavailable: t('m134'), 'timed-out': t('m135'), stale: t('m136') };
const reasons = { UNSUPPORTED_LAUNCHER: t('m137'),
  CLI_UNAVAILABLE: t('m138'), TIMEOUT: t('m139'),
  OUTPUT_LIMIT: t('m140'), PROTOCOL: t('m141'), RUNTIME_MISMATCH: t('m142'),
  CONFLICT: t('m143'), BUSY: t('m144'), PROBE_FAILED: t('m145'), ENGINE_UNAVAILABLE: t('m146') };

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
    setText($('clientsError'), error ? reasons[error.code] || t('m147') : '');
  }
  function result(value) {
    const box = $('clientsResult'); box.replaceChildren(); if (!value) return;
    box.append(node('h3', value.stale ? outcomes.stale : outcomes[value.status] || value.status));
    box.append(node('p', t('m148', value.operation === 'version' ? t('m149') : t('m150'), dateText(new Date(value.finishedAt), 'toLocaleString'), value.durationMs, value.cliVersion ? formatText` · ${value.cliVersion}` : '', value.toolCount ? t('m151', value.toolCount) : '')));
    if (value.code) box.append(node('p', reasons[value.code] || t('m152'), 'inline-error'));
    if (value.installed) box.append(node('p', t('m153')));
    const list = node('ul'); for (const check of value.checks || []) list.append(node('li', formatText`${check.level}: ${check.label}`)); box.append(list);
    box.append(node('p', t('m154'), 'caption'));
  }
  function render() {
    const box = $('clientsStatus'); box.replaceChildren(); const item = selected(); if (!item) return;
    box.append(node('h3', item.name), node('p', t('m155', dateText(new Date(item.observedAt), 'toLocaleString')), 'caption'));
    box.append(node('p', t('m156', item.workspace), 'caption prompt-path'));
    if (item.status === 'unavailable') box.append(node('p', t('m157', item.code), 'inline-error'));
    else {
      const c = item.channel;
      box.append(node('p', modes[c.mode] || c.mode));
      box.append(node('p', t('m158', c.direct ? c.directEnabled ? t('m159') : t('m160') : t('m161'), c.marketplace ? t('m162') : t('m163'), c.project ? t('m164') : t('m165'))));
      if (c.conflict || c.foreign) box.append(node('p', c.conflict ? t('m166') : t('m167'), 'inline-error'));
      if (c.marketplace && c.directEnabled) box.append(node('p', t('m168'), 'inline-error'));
      box.append(node('p', formatText`Skill: ${item.components.skill.exists ? t('m169') : t('m170')}. Prompt: ${item.components.prompt.channel === 'native-context' ? t('m171') : item.components.prompt.prompt ? t('m172') : t('m173')}.`, 'caption'));
    }
    box.append(node('p', item.executable.supported ? item.executable.available ? t('m174', item.executable.path) : t('m138') : t('m175'), 'caption prompt-path'));
    box.append(node('p', t('m176'), 'caption'));
    const details = node('details'), files = node('ul'); details.append(node('summary',t('m177')));
    for (const file of item.files) files.append(node('li', formatText`${file.path} · ${file.exists ? formatText`SHA-256 ${file.hash}` : t('m178')}`, 'prompt-path'));
    details.append(files); box.append(details); result(item.lastProbe); controls();
  }
  async function load() {
    const current = ++sequence; pending = true; controls(); problem(null); setText($('clientsProgress'), t('m179'));
    try { const value = await api('/api/clients'); if (current !== sequence || !dialog.open) return; status = value; render(); }
    catch (error) { status = null; $('clientsStatus').replaceChildren(); result(null); problem(error); }
    finally { if (current === sequence) { pending = false; controls(); setText($('clientsProgress'), ''); } }
  }
  $('openClients').addEventListener('click', async () => { if (!await allowDiscard()) return; closeNavigation(); openDialog('clientsDialog'); await load(); $('clientsClient').focus(); });
  $('clientsClient').addEventListener('change', () => { problem(null); render(); });
  $('clientsRefresh').addEventListener('click', async () => { await load(); $('clientsRefresh').focus(); });
  $('clientsRun').addEventListener('click', async () => {
    const item = selected(); if (pending || !item?.version) return;
    pending = true; controls(); problem(null); result(null); setText($('clientsProgress'), t('m180'));
    try {
      const value = await api('/api/clients', { action: 'probe', client: item.client, operation: $('clientsOperation').value, expectedVersion: item.version });
      result(value);
      // Do not replace the displayed version with an unreviewed fresh snapshot.
      item.lastProbe = value;
    } catch (error) { problem(error); }
    finally { pending = false; controls(); setText($('clientsProgress'), ''); $('clientsRun').focus(); }
  });
  $('clientsClose').addEventListener('click', () => { if (!pending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    sequence++;
    const trigger = $('openClients').getClientRects().length ? $('openClients') : $('navigation');
    if (trigger.getClientRects().length) trigger.focus();
  });
}
