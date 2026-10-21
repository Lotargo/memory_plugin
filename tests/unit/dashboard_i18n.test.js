import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { messages } from '../../mcp-server/dashboard/public/locales.js';
import { t, locale, setLanguage, setText, setAttr, initializeLanguage, formatText, joinText, dateText, countText, serviceText } from '../../mcp-server/dashboard/public/i18n.js';

const placeholders = text => [...text.matchAll(/\{(\d+)\}/g)].map(match => match[1]).sort();
for (const [id, translations] of Object.entries(messages)) {
  assert.deepEqual(Object.keys(translations).sort(), ['en','ru','zh-CN'], id);
  for (const language of ['en','ru','zh-CN']) {
    assert.ok(translations[language].trim(), `${id} / ${language}`);
    assert.deepEqual(placeholders(translations[language]), placeholders(translations.ru), `${id} placeholders / ${language}`);
  }
  assert.doesNotMatch(translations.en, /[А-Яа-яЁё]/, id);
  assert.doesNotMatch(translations['zh-CN'], /[А-Яа-яЁё]/, id);
}
const root = new URL('../../mcp-server/dashboard/public/', import.meta.url);
for (const name of readdirSync(root).filter(name => name.endsWith('.js') && !['locales.js','i18n.js'].includes(name))) {
  const source = readFileSync(new URL(name, root), 'utf8');
  for (const [, id] of source.matchAll(/\bt\('([^']+)'/g)) assert.ok(messages[id], `${name}: ${id}`);
}
const html = readFileSync(new URL('index.html', root), 'utf8');
assert.match(html, /<html lang="en">/);
assert.match(html, /<label for="language"/);
for (const [, id] of html.matchAll(/data-i18n="([^"]+)"/g)) assert.ok(messages[id]);

assert.equal(locale(), 'en');
const label = t('m1');
assert.equal(String(label), 'All records');
const originalDocument = globalThis.document;
const control = {value:'en', addEventListener() {}};
const callbacks = new Map();
let cookie = '';
globalThis.document = { documentElement:{lang:'en'}, getElementById: id => id === 'language' ? control : null,
  querySelectorAll: () => [], dispatchEvent() {}, addEventListener(type, callback) {callbacks.set(type, callback);},
  get cookie() {return cookie;}, set cookie(value) {cookie = value;}
};
function element() {
  return {isConnected:true, attributes:{}, firstChild:null,
    get textContent() {return this.firstChild?.data || '';},
    set textContent(value) {this.firstChild={nodeType:3,data:value,parentNode:this};},
    setAttribute(name, value) {this.attributes[name] = value;}
  };
}
try {
  const ui = element(), content = element(), attr = element();
  setText(ui, formatText(['',' · ',''], label, joinText([t('m2'), t('m3')], ' / ')));
  const originalTextNode = ui.firstChild;
  ui.counter = {text:'42'}; // Extra child must survive a language change.
  setText(content, 'Все записи'); // User text equal to a UI label stays untouched.
  setAttr(attr, 'aria-label', t('m852'));
  setLanguage('zh-CN');
  assert.equal(ui.textContent, '全部记录 · 指令 / 历史');
  assert.equal(ui.firstChild, originalTextNode);
  assert.equal(ui.counter.text, '42');
  assert.equal(content.textContent, 'Все записи');
  assert.equal(attr.attributes['aria-label'], '关闭');
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.match(cookie, /memory_panel_language=zh-CN; Path=\/; Max-Age=31536000; SameSite=Strict/);
  initializeLanguage();
  assert.equal(control.value, 'zh-CN', 'saved choice restored');
  cookie = 'memory_panel_language=invalid';
  // Fresh initialization must fall back to English, independent of browser language.
  setLanguage('en', {persist:false}); initializeLanguage();
  assert.equal(locale(), 'en');
  assert.equal(setLanguage('xx'), false);
  assert.equal(locale(), 'en');
  assert.equal(String(countText(21)), '21 records');
  assert.equal(String(countText(1, 'files')), '1 file');
  setLanguage('ru', {persist:false});
  assert.equal(String(countText(21)), '21 запись');
  assert.equal(String(countText(12, 'files')), '12 файлов');
  setLanguage('zh-CN', {persist:false});
  assert.equal(String(countText(21)), '21 条记录');
  assert.equal(String(dateText(new Date(2026, 9, 21), 'toLocaleDateString')), new Date(2026, 9, 21).toLocaleDateString('zh-CN'));
  assert.equal(String(serviceText('Алгоритм поиска')), '搜索算法');
  assert.equal(String(serviceText('Вес векторного поиска: укажите число от 0 до 1.')), '向量搜索权重：请输入 0 至 1 之间的数字。');
  assert.equal(String(serviceText('Сначала скачайте модель org/model.')), '请先下载模型 org/model。');
  // Runtime replacements clear old UI bindings, so later changes cannot overwrite data.
  setText(ui, 'User draft'); setLanguage('ru', {persist:false});
  assert.equal(ui.textContent, 'User draft');
  Object.defineProperty(document, 'cookie', {get() {throw Error('blocked');},set() {throw Error('blocked');}});
  assert.doesNotThrow(() => {initializeLanguage();setLanguage('en');});
} finally {globalThis.document = originalDocument;setLanguage('en', {persist:false});}
console.log('PASS dashboard i18n: complete catalogs, placeholders, default, reactive labels, preserved content, cookie and blocked storage.');
