const $ = id => document.getElementById(id);
const size = value => typeof value === 'number' && Number.isFinite(value) ? `${(value / 1024 ** 3).toLocaleString('ru', {maximumFractionDigits: 2})} ГиБ` : 'Недоступно';
const kinds = {dedicated: 'Выделенная память', shared: 'Общая память', unified: 'Unified Memory · общая память CPU и GPU', unknown: 'Тип памяти не определён'};

export function createResourceView({api, node}) {
  let active = false, timer, generation = 0, pending = false;
  function property(container, label, value) {container.append(node('dt', label), node('dd', value));}
  function render(data) {
    $('resourcesPlatform').textContent = `${data.platform.name} · ${data.platform.arch}${data.platform.environment === 'wsl' ? ' · WSL' : ''}`;
    const memory = $('resourcesRam'); memory.replaceChildren();
    property(memory, 'Всего RAM', size(data.ram.totalBytes));
    property(memory, data.ram.usedBasis === 'total-minus-available' ? 'Используется RAM' : 'RAM без свободных страниц', size(data.ram.usedBytes));
    property(memory, 'Доступно RAM', size(data.ram.availableBytes));
    property(memory, 'Свободно RAM', size(data.ram.freeBytes));
    if (data.ram.swap.usedBytes !== null) property(memory, 'Используется swap', `${size(data.ram.swap.usedBytes)} / ${size(data.ram.swap.totalBytes)}`);
    $('resourcesRamHint').textContent = data.ram.usedBasis === 'total-minus-available' ? 'Доступная RAM учитывает память, которую ОС может освободить для приложений.' : 'Показатель включает кэш и другую память, которую ОС может освободить. Доступный приложениям объём отдельно не измерен.';
    const gpus = $('resourcesGpu'); gpus.replaceChildren();
    if (!data.gpu.devices.length) gpus.append(node('p', data.gpu.status === 'empty' ? 'GPU не обнаружен.' : 'Данные GPU недоступны: драйвер или интерфейс мониторинга не найден.', 'caption'));
    for (const gpu of data.gpu.devices) {
      const section = node('section'); section.className = 'resource-gpu';
      section.append(node('h4', gpu.name), node('p', kinds[gpu.memoryKind] || kinds.unknown, 'caption'));
      const values = node('dl'); values.className = 'system-properties';
      if (gpu.memoryKind === 'unified') {
        property(values, 'Память GPU', 'Использует общую RAM; отдельный объём VRAM не применяется');
        property(values, 'Расход GPU', 'Недоступно через системный монитор');
      } else {
        property(values, 'Используется выделенной памяти', size(gpu.usedBytes));
        property(values, 'Всего выделенной памяти', size(gpu.totalBytes));
        if (gpu.sharedUsedBytes !== null || gpu.memoryKind === 'shared') property(values, 'Используется общей RAM', size(gpu.sharedUsedBytes));
      }
      section.append(values, node('p', `Источник: ${gpu.source}. Показатели GPU относятся ко всему адаптеру.`, 'caption')); gpus.append(section);
    }
    const processes = $('resourcesProcesses'); processes.replaceChildren();
    for (const process of data.processes) {
      property(processes, `${process.role === 'dashboard' ? 'Панель' : process.role === 'cli' ? 'CLI' : 'Клиент'} · PID ${process.pid}`, `${size(process.rssBytes)}${process.status === 'stale' ? ' · устаревшие данные' : ''}`);
    }
    $('resourcesObserved').textContent = `Обновлено: ${new Date(data.observedAt).toLocaleTimeString('ru')}. Автообновление каждые 3 с при видимой панели.`;
    $('resourcesState').textContent = '';
  }
  async function refresh() {
    if (!active || document.hidden || pending) return;
    const current = generation; pending = true;
    try {const data = await api('/api/resources'); if (active && current === generation && !document.hidden) render(data);}
    catch {if (active && current === generation) $('resourcesState').textContent = 'Мониторинг временно недоступен. Отображённые данные могли устареть; повторяем запрос.';}
    finally {pending = false; if (active && !document.hidden) {clearTimeout(timer); timer = setTimeout(refresh, 3000);}}
  }
  function stop() {active = false; generation++; clearTimeout(timer);}
  function start() {stop(); active = true; $('resourcesState').textContent = 'Получаем показатели RAM и GPU…'; refresh();}
  document.addEventListener('visibilitychange', () => {generation++; clearTimeout(timer); if (active && !document.hidden) refresh();});
  return {start, stop, refresh};
}
