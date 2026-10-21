import { formatText, joinText, locale, setText, t } from './i18n.js';
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
    const name = target.key === 'global' ? t('m31') : label(target);
    text.append(node('span', name, 'scope-option-name'));
    if (target.key === 'global') text.append(node('span', t('m588'), 'scope-option-hint'));
    if (target.unavailable) text.append(node('span', t('m589'), 'scope-option-hint'));
    const check = node('span', target.key === current.value ? '✓' : '', 'scope-option-check');
    check.setAttribute('aria-hidden', 'true'); button.append(text, check);
    if (target.key === current.value) button.setAttribute('aria-current', 'true');
    button.disabled = current.disabled || !!target.unavailable; setText(button, formatText`${name}
${target.key}`, 'title');
    button.addEventListener('click', () => { close(); void select(target.key); });
    return button;
  }
  function render() {
    const all = targets();
    const terms = search.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const projects = all.filter(target => target.key !== 'global');
    const matches = projects.filter(target => {
      const text = formatText`${label(target)} ${target.name} ${target.key} ${joinText((target.aliases || []).map(alias => alias.alias), ' ')}`.toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    }).sort((a, b) => label(a).localeCompare(label(b), locale(), { numeric: true }));
    global.replaceChildren(...all.filter(target => target.key === 'global').map(option));
    list.replaceChildren();
    const groups = [
      [t('m41'), matches.filter(target => !target.unavailable && target.key.startsWith('git:'))],
      [t('m42'), matches.filter(target => !target.unavailable && !target.key.startsWith('git:'))],
      [t('m43'), matches.filter(target => target.unavailable)]
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
      const empty = node('p', projects.length ? t('m590') : t('m591'), 'scope-empty'); list.append(empty);
      if (terms.length) {
        const reset = node('button', t('m592'), 'button ghost'); reset.type = 'button';
        reset.addEventListener('click', () => { search.value = ''; render(); search.focus(); }); list.append(reset);
      }
    }
    setText(count, terms.length ? t('m593', matches.length) : t('m594', projects.length));
  }
  function position() {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 20, above = rect.top - 20;
    const down = below >= 320 || below >= above;
    popup.style.width = formatText`${width}px`;
    popup.style.left = formatText`${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
    popup.style.top = down ? formatText`${(rect.bottom + 8)}px` : 'auto';
    popup.style.bottom = down ? 'auto' : formatText`${(window.innerHeight - rect.top + 8)}px`;
    popup.style.maxHeight = formatText`${Math.max(140, Math.min(460, down ? below : above))}px`;
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
      setText(document.getElementById('projectPickerName'), selected?.key === 'global' ? t('m31') : selected ? label(selected) : t('m595'));
      trigger.disabled = current.disabled;
      if (opened()) render();
    },
    close
  };
}
