// A styled projection of the existing scope selector, using native popover/buttons.
export function createProjectPicker({ node, targets, label, select }) {
  const trigger = document.getElementById('projectPickerTrigger');
  const popup = document.getElementById('projectPicker');
  const current = document.getElementById('target');
  const search = document.getElementById('projectPickerSearch');
  const global = document.getElementById('projectPickerGlobal');
  const list = document.getElementById('projectPickerList');
  const count = document.getElementById('projectPickerCount');
  const supported = typeof popup.showPopover === 'function';

  if (!supported) {
    trigger.hidden = true; popup.hidden = true; current.hidden = false;
    current.removeAttribute('aria-hidden'); current.removeAttribute('tabindex');
    return { sync() {}, close() {} };
  }
  const opened = () => popup.matches(':popover-open');
  function close() { if (opened()) popup.hidePopover(); }
  function option(target) {
    const button = node('button', null, 'scope-option'); button.type = 'button';
    const text = node('span', null, 'scope-option-text');
    const name = target.key === 'global' ? 'Глобальная память' : label(target);
    text.append(node('span', name, 'scope-option-name'));
    if (target.key === 'global') text.append(node('span', 'Для всех проектов', 'scope-option-hint'));
    if (target.unavailable) text.append(node('span', 'Требует проверки', 'scope-option-hint'));
    const check = node('span', target.key === current.value ? '✓' : '', 'scope-option-check');
    check.setAttribute('aria-hidden', 'true'); button.append(text, check);
    if (target.key === current.value) button.setAttribute('aria-current', 'true');
    button.disabled = current.disabled || !!target.unavailable; button.title = `${name}\n${target.key}`;
    button.addEventListener('click', () => { close(); void select(target.key); });
    return button;
  }
  function render() {
    const all = targets();
    const terms = search.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const projects = all.filter(target => target.key !== 'global');
    const matches = projects.filter(target => {
      const text = `${label(target)} ${target.name} ${target.key} ${(target.aliases || []).map(alias => alias.alias).join(' ')}`.toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    }).sort((a, b) => label(a).localeCompare(label(b), 'ru', { numeric: true }));
    global.replaceChildren(...all.filter(target => target.key === 'global').map(option));
    list.replaceChildren();
    const groups = [
      ['Проекты', matches.filter(target => !target.unavailable && target.key.startsWith('git:'))],
      ['Другие хранилища', matches.filter(target => !target.unavailable && !target.key.startsWith('git:'))],
      ['Требуют проверки', matches.filter(target => target.unavailable)]
    ];
    for (const [name, entries] of groups) {
      if (!entries.length) continue;
      const section = node('section', null, 'scope-group');
      const heading = node('h3', name); heading.append(node('span', String(entries.length), 'nav-count'));
      const items = node('ul');
      for (const target of entries) { const li = node('li'); li.append(option(target)); items.append(li); }
      section.append(heading, items); list.append(section);
    }
    if (!matches.length) {
      const empty = node('p', projects.length ? 'Проект не найден' : 'Пока нет проектов', 'scope-empty'); list.append(empty);
      if (terms.length) {
        const reset = node('button', 'Очистить поиск', 'button ghost'); reset.type = 'button';
        reset.addEventListener('click', () => { search.value = ''; render(); search.focus(); }); list.append(reset);
      }
    }
    count.textContent = terms.length ? `Найдено: ${matches.length}` : `Проектов и хранилищ: ${projects.length}`;
  }
  function position() {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 20, above = rect.top - 20;
    const down = below >= 320 || below >= above;
    popup.style.width = `${width}px`;
    popup.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
    popup.style.top = down ? `${rect.bottom + 8}px` : 'auto';
    popup.style.bottom = down ? 'auto' : `${window.innerHeight - rect.top + 8}px`;
    popup.style.maxHeight = `${Math.max(140, Math.min(460, down ? below : above))}px`;
  }
  popup.addEventListener('beforetoggle', event => {
    trigger.setAttribute('aria-expanded', String(event.newState === 'open'));
    if (event.newState === 'open') { search.value = ''; render(); position(); }
  });
  search.addEventListener('input', render);
  window.addEventListener('resize', () => { if (opened()) position(); });
  document.addEventListener('scroll', event => { if (opened() && !popup.contains(event.target)) position(); }, { capture: true, passive: true });
  return {
    sync() {
      const selected = targets().find(target => target.key === current.value);
      document.getElementById('projectPickerName').textContent = selected?.key === 'global' ? 'Глобальная память' : selected ? label(selected) : 'Выбрать область';
      trigger.disabled = current.disabled;
      if (opened()) render();
    },
    close
  };
}
