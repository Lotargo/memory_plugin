import { dateText, formatText, setText, t } from './i18n.js';
const $ = id => document.getElementById(id);
const size = value => typeof value === 'number' && Number.isFinite(value) ? t('m635', dateText(value / 1024 ** 3, 'toLocaleString', {maximumFractionDigits: 2})) : t('m636');
const kinds = {dedicated: t('m637'), shared: t('m638'), unified: t('m639'), unknown: t('m640')};

export function createResourceView({api, node}) {
  let active = false, timer, generation = 0, pending = false;
  function property(container, label, value) {container.append(node('dt', label), node('dd', value));}
  function render(data) {
    setText($('resourcesPlatform'), formatText`${data.platform.name} · ${data.platform.arch}${data.platform.environment === 'wsl' ? ' · WSL' : ''}`);
    const memory = $('resourcesRam'); memory.replaceChildren();
    property(memory, t('m641'), size(data.ram.totalBytes));
    property(memory, data.ram.usedBasis === 'total-minus-available' ? t('m642') : t('m643'), size(data.ram.usedBytes));
    property(memory, t('m644'), size(data.ram.availableBytes));
    property(memory, t('m645'), size(data.ram.freeBytes));
    if (data.ram.swap.usedBytes !== null) property(memory, t('m646'), formatText`${size(data.ram.swap.usedBytes)} / ${size(data.ram.swap.totalBytes)}`);
    setText($('resourcesRamHint'), data.ram.usedBasis === 'total-minus-available' ? t('m647') : t('m648'));
    const gpus = $('resourcesGpu'); gpus.replaceChildren();
    if (!data.gpu.devices.length) gpus.append(node('p', data.gpu.status === 'empty' ? t('m649') : t('m650'), 'caption'));
    for (const gpu of data.gpu.devices) {
      const section = node('section'); section.className = 'resource-gpu';
      section.append(node('h4', gpu.name), node('p', kinds[gpu.memoryKind] || kinds.unknown, 'caption'));
      const values = node('dl'); values.className = 'system-properties';
      if (gpu.memoryKind === 'unified') {
        property(values, t('m651'), t('m652'));
        property(values, t('m653'), t('m654'));
      } else {
        property(values, t('m655'), size(gpu.usedBytes));
        property(values, t('m656'), size(gpu.totalBytes));
        if (gpu.sharedUsedBytes !== null || gpu.memoryKind === 'shared') property(values, t('m657'), size(gpu.sharedUsedBytes));
      }
      section.append(values, node('p', t('m658', gpu.source), 'caption')); gpus.append(section);
    }
    const processes = $('resourcesProcesses'); processes.replaceChildren();
    for (const process of data.processes) {
      property(processes, formatText`${process.role === 'dashboard' ? t('m659') : process.role === 'cli' ? 'CLI' : t('m660')} · PID ${process.pid}`, formatText`${size(process.rssBytes)}${process.status === 'stale' ? t('m661') : ''}`);
    }
    setText($('resourcesObserved'), t('m662', dateText(new Date(data.observedAt), 'toLocaleTimeString')));
    setText($('resourcesState'), '');
  }
  async function refresh() {
    if (!active || document.hidden || pending) return;
    const current = generation; pending = true;
    try {const data = await api('/api/resources'); if (active && current === generation && !document.hidden) render(data);}
    catch {if (active && current === generation) setText($('resourcesState'), t('m663'));}
    finally {pending = false; if (active && !document.hidden) {clearTimeout(timer); timer = setTimeout(refresh, 3000);}}
  }
  function stop() {active = false; generation++; clearTimeout(timer);}
  function start() {stop(); active = true; setText($('resourcesState'), t('m664')); refresh();}
  document.addEventListener('visibilitychange', () => {generation++; clearTimeout(timer); if (active && !document.hidden) refresh();});
  return {start, stop, refresh};
}
