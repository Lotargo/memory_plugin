import { messages } from './locales.js';

export const languages = Object.freeze(['en', 'ru', 'zh-CN']);
export const languageCookie = 'memory_panel_language';
let language = 'en';
const bindings = new Map();
const byElement = new WeakMap();

// Only explicit UI messages are reactive. Stored content stays plain text,
// even when it happens to match a translated interface label.
class Message {
  constructor(render) { this.render = render; }
  toString() { return this.render(); }
  valueOf() { return this.toString(); }
  [Symbol.toPrimitive]() { return this.toString(); }
  get length() { return this.toString().length; }
  slice(...args) { return this.toString().slice(...args); }
  startsWith(...args) { return this.toString().startsWith(...args); }
  includes(...args) { return this.toString().includes(...args); }
  trim() { return this.toString().trim(); }
  toLocaleLowerCase(...args) { return this.toString().toLocaleLowerCase(...args); }
  localeCompare(...args) { return this.toString().localeCompare(...args); }
}

export const locale = () => language;
export const scopeText = target => target?.key === 'global' ? t('m31') : target?.name;
export function t(id, ...values) {
  if (!messages[id]) throw new Error(`Unknown UI message: ${id}`);
  return new Message(() => messages[id][language].replace(/\{(\d+)\}/g, (_, index) => String(values[index] ?? '')));
}
export function formatText(parts, ...values) {
  const render = () => parts.reduce((text, part, index) => text + part + (index < values.length ? String(values[index]) : ''), '');
  return values.some(value => value instanceof Message) ? new Message(render) : render();
}
export function joinText(values, separator = ',') {
  return values.some(value => value instanceof Message)
    ? new Message(() => values.map(value => value == null ? '' : String(value)).join(separator)) : values.join(separator);
}
export function concatText(left, right) {
  return left instanceof Message || right instanceof Message ? new Message(() => String(left) + String(right)) : left + right;
}
export function dateText(value, method = 'toLocaleString', options) {
  return new Message(() => value[method](language, options));
}
export function countText(value, kind = 'records') {
  return new Message(() => {
    const form = new Intl.PluralRules(language).select(value);
    const words = kind === 'files'
      ? {one:'m202', few:'m203', many:'m201', other:'m203'}
      : {one:'m45', few:'m46', many:'m47', other:'m46'};
    const word = t(words[form]);
    return `${new Intl.NumberFormat(language).format(value)} ${word}`;
  });
}

function bind(element, key, value, attribute) {
  let properties = byElement.get(element);
  if (!properties) { properties = new Map(); byElement.set(element, properties); }
  const previous = properties.get(key);
  if (previous) bindings.delete(previous);
  properties.delete(key);
  const apply = () => {
    const text = String(value ?? '');
    if (attribute) element.setAttribute(key, text); else element[key] = text;
  };
  apply();
  if (value instanceof Message) {
    const binding = { element: new WeakRef(element), key, value, attribute,
      // Update the owned text node, preserving counters/icons appended later.
      textNode: !attribute && key === 'textContent' && element.firstChild?.nodeType === 3 ? new WeakRef(element.firstChild) : null };
    properties.set(key, binding); bindings.set(binding, true);
  }
  return value;
}
export const setText = (element, value, property = 'textContent') => bind(element, property, value, false);
export const setAttr = (element, name, value) => bind(element, name, value, true);
export function appendText(element, value, property = 'textContent') {
  return setText(element, concatText(byElement.get(element)?.get(property)?.value ?? element[property], value), property);
}

// Translate trusted service-owned UI metadata/errors only, never record bodies,
// document titles, model IDs, paths, or other user content.
const sourceIds = new Map(Object.entries(messages).map(([id, value]) => [value.ru, id]));
export function serviceText(value) {
  if (sourceIds.has(value)) return t(sourceIds.get(value));
  // Structured validation errors from settings include a trusted field label.
  if (typeof value === 'string') for (const id of ['m1123','m1124','m1125','m1126','s23']) {
    const parts = messages[id].ru.split(/\{\d+\}/);
    const pattern = parts.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([\\s\\S]*?)');
    const match = new RegExp(`^${pattern}$`).exec(value);
    if (match) return t(id, ...match.slice(1).map(serviceText));
  }
  return value;
}

export function setLanguage(value, { persist = true } = {}) {
  if (!languages.includes(value)) return false;
  language = value;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
    const control = document.getElementById('language');
    if (control) control.value = language;
    for (const binding of bindings.keys()) {
      const element = binding.element.deref();
      if (!element || !element.isConnected) { bindings.delete(binding); continue; }
      if (binding.textNode) {
        const textNode = binding.textNode.deref();
        if (textNode?.parentNode === element) textNode.data = String(binding.value);
        else bindings.delete(binding);
      } else if (binding.attribute) element.setAttribute(binding.key, String(binding.value));
      else element[binding.key] = String(binding.value);
    }
    if (persist) try {
      // Same host-scoped persistence as theme: survives loopback port changes.
      document.cookie = `${languageCookie}=${language}; Path=/; Max-Age=31536000; SameSite=Strict`;
    } catch { /* Switching still works when storage is blocked. */ }
    document.dispatchEvent(new Event('memory-language-change'));
  }
  return true;
}

export function initializeLanguage() {
  let saved;
  try { saved = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${languageCookie}=`))?.split('=')[1]; } catch { /* English fallback. */ }
  language = languages.includes(saved) ? saved : 'en';
  for (const element of document.querySelectorAll('[data-i18n]')) setText(element, t(element.dataset.i18n));
  for (const element of document.querySelectorAll('[data-i18n-attrs]')) {
    for (const [attribute, id] of Object.entries(JSON.parse(element.dataset.i18nAttrs))) setAttr(element, attribute, t(id));
  }
  setLanguage(language, { persist: false });
  document.getElementById('language')?.addEventListener('change', event => setLanguage(event.target.value));
}

if (typeof document !== 'undefined' && document.querySelectorAll) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeLanguage, { once: true });
  else initializeLanguage();
}
