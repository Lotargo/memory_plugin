import { Marked } from '/vendor/marked/marked.esm.js';
import DOMPurify from '/vendor/dompurify/purify.es.mjs';
import katex from '/vendor/katex/katex.mjs';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const pending = new WeakMap();
let diagramId = 0, mermaidModule, diagramQueue = Promise.resolve();
const MAX_TEXT = 100_000, MAX_DIAGRAM = 12_000, MAX_DIAGRAMS = 12;
function formula(token) {
  try {
    return katex.renderToString(token.text, { displayMode: token.display, throwOnError: false,
      trust: false, strict: 'ignore', maxExpand: 500, maxSize: 10, output: 'htmlAndMathml', macros: {} });
  } catch { return `<code>${escape(token.raw)}</code>`; }
}
function math(name, level, pattern, start) {
  return { name, level, start: source => source.search(start), tokenizer(source) {
    const match = pattern.exec(source);
    if (match) return { type: name, raw: match[0], text: match[1].trim(), display: level === 'block' };
  }, renderer: formula };
}
function markdown(source, diagrams, headingLevel) {
  // A fresh parser/macros map for each document prevents one source changing
  // rendering of another. Code spans/fences are tokenized before inline math.
  const parser = new Marked({ gfm: true, breaks: false });
  parser.use({ extensions: [
    math('displayDollarMath', 'block', /^\$\$[ \t]*\n?([\s\S]+?)\$\$(?:[ \t]*\n|$)/, /\$\$/),
    math('displayBracketMath', 'block', /^\\\[([\s\S]+?)\\\](?:[ \t]*\n|$)/, /\\\[/),
    math('inlineDollarMath', 'inline', /^\$(?!\$)([^\n$]+?)\$(?!\d)/, /\$(?!\$)/),
    math('inlineParenMath', 'inline', /^\\\(([^\n]+?)\\\)/, /\\\(/),
  ], renderer: {
    heading(token) { const level = Math.min(6, token.depth + headingLevel - 1); return `<h${level}>${this.parser.parseInline(token.tokens)}</h${level}>`; },
    html(token) { return escape(token.text); },
    image(token) { return `<span class="image-description">${escape(token.text || 'Изображение')} (изображение)</span>`; },
    link(token) {
      const label = this.parser.parseInline(token.tokens);
      if (!/^(https?:\/\/|#)/i.test(token.href)) return label;
      return `<a href="${escape(token.href)}"${token.href.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"'}>${label}</a>`;
    },
    code(token) {
      if (token.lang?.trim().toLowerCase() === 'mermaid' && diagrams.length < MAX_DIAGRAMS) {
        const index = diagrams.push(token.text) - 1;
        return `<figure class="diagram" data-diagram="${index}"><div class="diagram-output" role="img" aria-label="Диаграмма Mermaid"></div><details><summary>Код диаграммы</summary><pre><code>${escape(token.text)}</code></pre></details></figure>`;
      }
      return `<pre><code>${escape(token.text)}</code></pre>`;
    },
  } });
  return parser.parse(source);
}
function diagramError(host, message) {
  const text = document.createElement('p'); text.className = 'caption'; text.textContent = message;
  host.replaceChildren(text);
  host.removeAttribute('role'); host.setAttribute('aria-label', message);
}
async function draw(host, source, isCurrent) {
  if (!isCurrent()) return;
  // Source-controlled configuration, click actions, external image nodes and
  // directives never become application configuration or resource requests.
  if (source.length > MAX_DIAGRAM || /%%\s*\{|^\s*---|^\s*click\s|@\s*\{|<[a-z!\/]|https?:|data:|url\s*\(/im.test(source)) {
    diagramError(host, 'Диаграмма содержит неподдерживаемые настройки или превышает лимит. Доступен исходный код.'); return;
  }
  try {
    mermaidModule ??= import('/vendor/mermaid/mermaid.esm.min.mjs');
    const { default: mermaid } = await mermaidModule;
    if (!isCurrent()) return;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
      fontFamily: 'system-ui, sans-serif', htmlLabels: false,
      flowchart: { htmlLabels: false }, maxTextSize: MAX_DIAGRAM, maxEdges: 200,
      secure: ['securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'htmlLabels', 'theme', 'flowchart', 'fontFamily'] });
    const { svg } = await mermaid.render(`memory-diagram-${++diagramId}`, source);
    if (!isCurrent()) return;
    const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['foreignObject', 'a', 'image', 'use', 'script', 'iframe'], FORBID_ATTR: ['href', 'xlink:href'], RETURN_DOM_FRAGMENT: true });
    host.replaceChildren(clean);
    host.setAttribute('role', 'img'); host.setAttribute('aria-label', 'Диаграмма Mermaid');
  } catch { if (isCurrent()) diagramError(host, 'Не удалось отобразить Mermaid. Проверьте код диаграммы.'); }
}

// Never changes stored text. Generation checks protect asynchronous diagrams
// when navigating to another record or appending a new raw page.
export function renderContent(element, source = '', { force = false, headingLevel = 3 } = {}) {
  if (!force && pending.get(element)?.source === source && pending.get(element)?.headingLevel === headingLevel) return;
  const generation = {}; pending.set(element, { generation, source, headingLevel });
  const isCurrent = () => pending.get(element)?.generation === generation && element.isConnected;
  element.classList.add('markdown-content');
  function fallback(reason) {
    const caption = document.createElement('p'); caption.className = 'caption'; caption.textContent = reason;
    const raw = document.createElement('pre'); raw.className = 'knowledge-text'; raw.textContent = source;
    element.replaceChildren(caption, raw);
  }
  if (source.length > MAX_TEXT) { fallback('Большой фрагмент показан исходным текстом.'); element.dataset.renderState = 'text-limit'; return; }
  try {
    const diagrams = [];
    const clean = DOMPurify.sanitize(markdown(source, diagrams, headingLevel), {
      USE_PROFILES: { html: true, mathMl: true, svg: true },
      FORBID_TAGS: ['img', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
      // KaTeX's generated span geometry needs inline styles. User HTML is
      // escaped before sanitization; SVG is sanitized separately above.
      RETURN_DOM_FRAGMENT: true,
    });
    element.replaceChildren(clean); element.dataset.renderState = 'ready';
    for (const figure of element.querySelectorAll('[data-diagram]')) {
      const host = figure.querySelector('.diagram-output'), definition = diagrams[Number(figure.dataset.diagram)];
      diagramError(host, 'Строим диаграмму…');
      diagramQueue = diagramQueue.catch(() => {}).then(() => draw(host, definition, isCurrent));
    }
  } catch { fallback('Оформление недоступно; показан исходный текст.'); element.dataset.renderState = 'text-fallback'; }
}

document.addEventListener('memory-theme-change', () => {
  for (const element of document.querySelectorAll('.markdown-content')) {
    const saved = pending.get(element);
    if (saved) renderContent(element, saved.source, { force: true, headingLevel: saved.headingLevel });
  }
});

export function connectContentToggle(button, rendered, raw) {
  button.addEventListener('click', () => {
    const showRaw = raw.hidden;
    raw.hidden = !showRaw; rendered.hidden = showRaw;
    button.textContent = showRaw ? 'Показать оформление' : 'Показать исходный текст';
    button.setAttribute('aria-pressed', String(showRaw));
  });
}
