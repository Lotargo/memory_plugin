import { createPromptAdmin } from './prompts.js';
import { createMaintenance } from './maintenance.js';
import { createKnowledgeBrowser } from './knowledge.js';
import { renderContent, connectContentToggle } from './content.js';
import { createLinkEditor } from './links.js';
import { createProjectManager } from './projects.js';
import { createSettings } from './settings.js';
import { createModels } from './models.js';
import { filterNotebookRecords, historicalRecord } from './notebook_filters.js';
import { createPersonaPreview } from './persona.js';
import { createDirectiveTransfer } from './directive_transfer.js';
const $ = id => document.getElementById(id);
// Programmatic heading focus still announces navigation, while pointer clicks
// never draw a selection-like rectangle around the entire content block.
document.addEventListener('pointerdown', () => { document.documentElement.dataset.input = 'pointer'; }, { capture: true });
document.addEventListener('keydown', event => { if (!event.metaKey && !event.ctrlKey && !event.altKey) document.documentElement.dataset.input = 'keyboard'; }, { capture: true });
connectContentToggle($('recordTextToggle'), $('recordBody'), $('recordRaw'));
const state = { overview: null, notebook: null, view: 'notebook', selectedRef: null, edit: null, busy: false, loading: false, sequence: 0, allStores: false };
const fragment = location.hash.slice(1);
const connectionToken = /^[a-f0-9]{64}$/.test(fragment) ? fragment : '';
history.replaceState(null, '', location.pathname);
const names = { notebook: 'Notebook', persona: 'Инструкции', archive: 'История', knowledge: 'Знания' };
const reasons = { expired: 'Срок истёк', superseded: 'Заменена', disabled: 'Выключена', invalid: 'Повреждённый формат' };
const fields = ['title', 'body', 'kind', 'ttl', 'tags', 'keep', 'disabled'];
const fieldNames = { title: 'Заголовок', body: 'Текст записи', kind: 'Тип', ttl: 'Срок действия', tags: 'Теги', keep: 'Защита от удаления', disabled: 'Инструкция выключена' };
const focusBeforeDialog = new WeakMap();
const recordPlural = new Intl.PluralRules('ru');
let reviewed, reviewedChanged, deleting;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function notice(text = '', error = false) {
  $('message').textContent = text;
  $('message').hidden = !text;
  $('message').classList.toggle('error', error);
}
function inlineError(id, text = '') { $(id).textContent = text; $(id).hidden = !text; }
function openDialog(id) {
  const dialog = $(id);
  if (dialog.open) return;
  focusBeforeDialog.set(dialog, document.activeElement);
  dialog.showModal();
}
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('close', () => {
    const previous = focusBeforeDialog.get(dialog);
    if (previous?.isConnected && previous.getClientRects().length) previous.focus();
  });
  dialog.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
});
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => {
  if (!state.busy) $(button.dataset.close).close();
}));
function errorText(error) {
  if (error.status === 401) return 'Подключение истекло или адрес неполный. Откройте полный адрес, выведенный командой memory-plugin web.';
  if (error.code === 'MIGRATION_REQUIRED') return 'Память из прежнего облачного режима требует восстановления. Откройте «Настройки», примените режим «Локально + облачные снимки» для резервирования обеих копий, затем загрузите локальный список снимков и восстановите подготовленный облачный архив после проверки предпросмотра.';
  if (error.code === 'CONFLICT') return 'Память изменилась в другом клиенте. Ваш текст остаётся в редакторе. Обновите данные и сравните правку с текущей записью перед повторным сохранением.';
  if (error.code === 'UNSUPPORTED') return /source links/.test(error.message)
    ? 'Запись связана с источниками. Откройте «Добавить связь» и выполните «Подготовить связи», чтобы безопасно менять текст и удалять связанные записи. Метаданные доступны сейчас.'
    : 'Эта операция пока недоступна для выбранного хранилища. Проверьте режим и идентичность проекта в CLI.';
  if (error.code === 'NOT_FOUND') return 'Хранилище больше не доступно. Обновите список областей.';
  if (error.code === 'INVALID') return /already exists/.test(error.message) ? 'Запись с таким текстом уже есть в этой области.' : 'Не удалось сохранить поля записи. Проверьте текст, теги и срок действия.';
  return 'Не удалось обратиться к хранилищу. Проверьте, что локальная панель запущена, и повторите действие.';
}
async function api(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(connectionToken ? { Authorization: `Bearer ${connectionToken}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { code: result.code, status: response.status });
  return result;
}
const linkEditor = createLinkEditor({ api, node, notice, scopeKey: () => $('target').value, onSaved: async () => {
  if (state.view === 'knowledge') await knowledge.refreshLinks();
  else await loadTarget($('target').value, state.selectedRef);
} });
const knowledge = createKnowledgeBrowser({ api, node, notice, scopeKey: () => $('target').value, editLink: options => linkEditor.open(options), openFact: async (key, ref) => {
  await selectView('notebook'); await selectTarget(key); await selectRecord(ref);
  $('recordTitle').focus();
} });
const historical = historicalRecord;
createProjectManager({ api, node, scopeKey: () => $('target').value, openDialog, allowDiscard, closeNavigation, onSaved: async result => {
  state.edit=null;
  await refresh();
  if(result.targetKey && state.overview?.targets.some(target=>target.key===result.targetKey)) await selectTarget(result.targetKey);
  notice(`Операция с проектом завершена. Резервный снимок: ${result.backup}`);
} });
const selected = () => state.notebook?.records.find(record => record.ref === state.selectedRef);
const directiveTransfer = createDirectiveTransfer({ api, node, openDialog, onSaved: async result => {
  state.edit = null; await refresh(); await selectTarget(result.targetKey);
  await selectView('persona'); $('statusFilter').value = 'all'; $('search').value = ''; resetNotebookFilters(); renderList();
  await selectRecord(result.ref); $('recordTitle').focus();
  notice(`Инструкция перенесена. Резервный снимок: ${result.backup}.${result.status === 'partial' ? ' Синхронизация клиентских файлов выполнена частично; проверьте её через sync-persona.' : ''} Активные сессии могут хранить прежний контекст.`);
} });
createSettings({api,node,openDialog,allowDiscard,closeNavigation,onChanged:refresh,onOpen:()=>{state.edit=null;render();}});
createModels({api,node,openDialog,allowDiscard,closeNavigation,onChanged:refresh});
const readOnly = () => !!(state.notebook?.readOnly || state.overview?.readOnly);
const scope = () => state.notebook?.target || state.overview?.targets.find(target => target.key === $('target').value);
const prompts = createPromptAdmin({ api, node, openDialog });
createMaintenance({ api, node, openDialog, allowDiscard, closeNavigation, scopeKey: () => $('target').value,
  onSaved: async () => { state.edit = null; await refresh(); } });
const persona = createPersonaPreview({ api, node, openDialog, scope, errorText, openRecord: async item => {
  await selectTarget(item.key); await selectView('persona'); $('statusFilter').value = 'all';
  const record = state.notebook?.records.find(record => record.ref === item.ref);
  if (!record || !item.id && record.fingerprint !== item.fingerprint) {
    state.selectedRef = null; render();
    notice('Запись изменилась после предпросмотра. Обновите предпросмотр и откройте её снова.', true); return;
  }
  await selectRecord(item.ref); $('recordTitle').focus();
} });
function values(record) {
  return { title: record?.title || '', body: record?.body || '', kind: record?.kind || (state.view === 'persona' ? 'directive' : 'fact'), ttl: record?.meta?.ttl || '', tags: record?.meta?.tags || '', keep: record?.meta?.keep === '1', disabled: record?.meta?.disabled === '1' };
}
function formValues() {
  return Object.fromEntries(fields.map(field => [field, ['keep', 'disabled'].includes(field) ? $(field).checked : $(field).value.trim()]));
}
const dirty = () => state.edit && JSON.stringify(formValues()) !== JSON.stringify(state.edit.baseline);
async function allowDiscard() {
  if (state.busy || state.loading) return false;
  if (!dirty()) return true;
  if ($('discardDialog').open) return false;
  openDialog('discardDialog');
  return new Promise(resolve => {
    const dialog = $('discardDialog');
    const leave = () => dialog.close('discard');
    const stay = () => dialog.close('stay');
    const finish = () => {
      $('discardChanges').removeEventListener('click', leave);
      $('keepEditing').removeEventListener('click', stay);
      resolve(dialog.returnValue === 'discard');
    };
    dialog.returnValue = '';
    $('discardChanges').addEventListener('click', leave);
    $('keepEditing').addEventListener('click', stay);
    dialog.addEventListener('close', finish, { once: true });
    $('keepEditing').focus();
  });
}
function filteredRecords() {
  const records = [...(state.notebook?.records || [])].reverse();
  if (state.allStores) records.sort((a, b) => `${b.date || ''} ${b.time || ''}`.localeCompare(`${a.date || ''} ${a.time || ''}`));
  return filterNotebookRecords(records, { view: state.view, status: $('statusFilter').value, kind: $('kindFilter').value,
    tags: $('tagsFilter').value, since: $('sinceFilter').value, until: $('untilFilter').value, query: $('search').value });
}
function renderNavigation() {
  const records = state.notebook?.records || [];
  $('notebookCount').textContent = records.filter(record => !historical(record)).length;
  $('directiveCount').textContent = records.filter(record => record.kind === 'directive' && !historical(record)).length;
  $('archiveCount').textContent = records.filter(historical).length;
  document.querySelectorAll('[data-view]').forEach(button => {
    if (button.dataset.view === state.view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('viewTitle').textContent = names[state.view];
  $('promptFiles').hidden = state.view !== 'persona';
  $('personaPreview').hidden = state.view !== 'persona';
  $('personaPreview').disabled = !state.notebook || state.busy || state.allStores;
  $('personaPreview').title = state.allStores ? 'Выберите конкретный проект для предпросмотра.' : '';
  $('scopeName').textContent = scope() ? projectName(scope()) : 'Глобальная память';
  $('scopeHint').textContent = state.allStores ? 'Общий список; выберите проект для правки' : scope()?.key === 'global' ? 'Доступна во всех проектах' : 'Только выбранный проект';
  $('create').textContent = state.view === 'persona' ? '+ Новая инструкция' : '+ Новая запись';
  $('create').hidden = state.view === 'knowledge';
  $('notebookArea').hidden = state.view === 'knowledge';
  $('knowledgeArea').hidden = state.view !== 'knowledge';
  $('statusFilter').options[0].textContent = state.view === 'archive' ? 'Истёкшие и заменённые' : 'Текущие записи';
  $('create').disabled = !state.notebook || state.busy || state.loading || readOnly();
  $('target').disabled = state.busy || state.loading || !state.overview?.targets.length;
  $('create').title = state.allStores ? 'Выберите хранилище для новой записи.' : readOnly() ? 'Редактирование в этом режиме недоступно.' : '';
  $('allStores').disabled = state.busy || state.loading;
  $('collectionHint').hidden = !state.allStores;
  $('create').classList.toggle('primary', !state.edit);
  $('create').classList.toggle('secondary', !!state.edit);
  document.title = `Memory — ${names[state.view]}`;
  document.querySelectorAll('[data-project]').forEach(button => {
    button.disabled = state.busy || state.loading || !!state.overview?.targets.find(target => target.key === button.dataset.project)?.unavailable;
    if (button.dataset.project === $('target').value) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
}
function renderTargets(key) {
  $('target').replaceChildren(); $('projects').replaceChildren();
  for (const target of state.overview.targets) {
    const name = projectName(target);
    const option = node('option', name.length > 80 ? `${name.slice(0, 77)}…` : name); option.value = target.key; option.disabled = !!target.unavailable;
    $('target').append(option);
  }
  $('target').value = state.overview.targets.some(target => target.key === key && !target.unavailable) ? key : 'global';
  renderProjects();
  $('version').textContent = `v${state.overview.version}`;
}
function projectName(target) {
  // Display labels only: the exact store key still addresses every operation.
  if (target.name.length > 120 || /<!--|-->|[<>\r\n]/.test(target.name)) return 'Неизвестное хранилище';
  if (target.name.startsWith('git_') || target.name.startsWith('git:')) {
    if (target.key.startsWith('git:') && target.key.includes('/')) return target.key.split('/').at(-1);
    const repository = /^git_(?:github_com|gitlab_com|bitbucket_org)_[^_]+_(.+)$/.exec(target.name);
    if (repository) return repository[1];
    const local = /^git_local_(.+)_(\d{8,})$/.exec(target.name);
    if (local) return `${local[1]} · ${local[2].slice(-4)}`;
  }
  return target.name;
}
function renderProjects() {
  const all = state.overview?.targets.filter(target => target.key !== 'global') || [];
  const terms = $('projectSearch').value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = all.filter(target => {
    const text = `${projectName(target)} ${target.name} ${target.key} ${target.aliases.map(alias => alias.alias).join(' ')}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  }).sort((a, b) => projectName(a).localeCompare(projectName(b), 'ru', { numeric: true }));
  $('projects').replaceChildren();
  $('projectCount').textContent = terms.length ? `${matches.length}/${all.length}` : all.length || '';
  const groups = [
    { title: null, targets: matches.filter(target => !target.unavailable && target.key.startsWith('git:')) },
    { title: 'Другие хранилища', targets: matches.filter(target => !target.unavailable && !target.key.startsWith('git:')) },
    { title: 'Требуют проверки', targets: matches.filter(target => target.unavailable) }
  ];
  for (const group of groups) {
    if (!group.targets.length) continue;
    const list = node('ul');
    for (const target of group.targets) {
      const item = node('li'), button = node('button'), marker = node('span', null, 'project-marker');
      marker.setAttribute('aria-hidden', 'true');
      button.append(marker, node('span', projectName(target), 'project-name')); button.type = 'button'; button.dataset.project = target.key;
      button.disabled = !!target.unavailable || state.busy || state.loading;
      button.title = `${target.key}${target.unavailable ? '\nТребуется исправление идентичности в CLI' : ''}`;
      if (target.unavailable) button.setAttribute('aria-label', `${projectName(target)} — требуется проверка идентичности`);
      if (target.key === $('target').value) button.setAttribute('aria-current', 'true');
      button.addEventListener('click', () => selectTarget(target.key)); item.append(button); list.append(item);
    }
    if (group.title) {
      const details = node('details', null, 'project-group'), summary = node('summary', group.title);
      summary.append(node('span', String(group.targets.length), 'nav-count'));
      details.open = !!terms.length || group.targets.some(target => target.key === $('target').value);
      details.append(summary, list); $('projects').append(details);
    } else $('projects').append(list);
  }
  if (!matches.length) $('projects').append(node('p', all.length ? 'Проект не найден' : 'Пока нет проектов', 'caption'));
}
function renderList() {
  const records = filteredRecords();
  $('records').replaceChildren(); $('records').setAttribute('aria-busy', String(state.loading));
  $('resultCount').textContent = state.loading ? '—' : `${records.length} ${{one:'запись',few:'записи',many:'записей',other:'записи'}[recordPlural.select(records.length)]}`;
  $('listState').hidden = !state.loading && !!records.length;
  $('listState').textContent = state.loading ? 'Загружаем память…' : !state.notebook ? 'Данные недоступны' : $('search').value ? 'Ничего не найдено. Попробуйте другой запрос.' : state.view === 'archive' ? 'Истёкших и заменённых записей нет.' : 'В этой области пока нет записей с выбранным состоянием.';
  const invalidDates = !!($('sinceFilter').value && $('untilFilter').value && $('sinceFilter').value > $('untilFilter').value);
  inlineError('dateFilterError', invalidDates ? 'Начальная дата должна быть не позже конечной.' : '');
  for (const field of ['sinceFilter', 'untilFilter']) {
    if (invalidDates) $(field).setAttribute('aria-invalid', 'true'); else $(field).removeAttribute('aria-invalid');
  }
  const unavailable = state.notebook?.unavailable || [];
  $('collectionStatus').hidden = !unavailable.length;
  $('collectionStatus').textContent = unavailable.length ? `Неполный список. Недоступные хранилища: ${unavailable.map(target => `${projectName(target)} (${target.code})`).join(', ')}.` : '';
  for (const record of records) {
    const li = node('li'), button = node('button', null, 'record-row'); button.type = 'button';
    button.setAttribute('aria-pressed', String(record.ref === state.selectedRef));
    const top = node('span', null, 'row-top');
    top.append(node('span', record.invalid ? 'Требует исправления' : record.kind === 'directive' ? 'Инструкция' : 'Факт'), node('span', record.date || 'Без даты', 'row-date'));
    button.append(top, node('span', record.title || 'Запись без заголовка', 'row-title'), node('span', record.body, 'row-summary'));
    if (record.sourceKey) button.append(node('span', `${projectName({ name: record.sourceName, key: record.sourceKey })} · ${record.sourceKey}`, 'row-scope'));
    const statuses = record.reasons.map(reason => reasons[reason]);
    if (record.meta?.keep === '1') statuses.push('Защищена');
    if (statuses.length) button.append(node('span', statuses.join(' · '), 'row-state'));
    button.addEventListener('click', () => selectRecord(record.ref)); li.append(button); $('records').append(li);
  }
  $('updatedAt').textContent = state.notebook ? `Обновлено ${new Date(state.notebook.observedAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}` : 'Нет актуальных данных';
  $('modeLabel').textContent = state.overview?.mode || '';
}
function property(container, label, value, className) { container.append(node('dt', label), node('dd', value || '—', className)); }
function renderReader() {
  const record = selected();
  $('detailEmpty').hidden = !!record || !!state.edit;
  $('reader').hidden = !record || !!state.edit;
  $('editForm').hidden = !state.edit;
  if (!record || state.edit) return;
  $('recordType').textContent = record.kind === 'directive' ? 'Инструкция' : 'Факт';
  $('recordTitle').textContent = record.title || 'Запись без заголовка';
  $('recordRaw').textContent = record.body;
  renderContent($('recordBody'), record.body);
  $('recordStatuses').replaceChildren();
  for (const reason of record.reasons) $('recordStatuses').append(node('span', reasons[reason], 'status-label inactive'));
  if (record.meta?.keep === '1') $('recordStatuses').append(node('span', 'Защищена от удаления', 'status-label'));
  $('recordTags').replaceChildren();
  for (const tag of (record.meta?.tags || '').split(',').filter(Boolean)) $('recordTags').append(node('span', `#${tag.trim()}`));
  $('recordProperties').replaceChildren();
  property($('recordProperties'), 'Область', record.sourceName || scope()?.name);
  property($('recordProperties'), 'Ключ хранилища', record.sourceKey || scope()?.key, 'identifier');
  property($('recordProperties'), 'ID записи', record.id || 'Legacy — присвоится при сохранении', 'identifier');
  property($('recordProperties'), 'Создана', [record.date, record.time].filter(Boolean).join(' '));
  property($('recordProperties'), 'Срок действия', record.meta?.ttl || 'Без ограничения');
  if (record.meta?.supersededBy) property($('recordProperties'), 'Заменена записью', record.meta.supersededBy, 'identifier');
  if (record.meta?.supersedes) property($('recordProperties'), 'Заменяет запись', record.meta.supersedes, 'identifier');
  $('sourcesSection').hidden = !record.links?.length; $('recordSources').replaceChildren();
  for (const link of record.links || []) {
    const item = node('li');
    const source = node('button', link.visible ? `${link.title || link.docId}${link.startLine ? ` · ${link.status === 'valid' ? 'строки' : 'запрошены строки'} ${link.startLine}–${link.endLine || link.startLine}` : ''}` : 'Источник недоступен в этой области', 'button ghost');
    source.type = 'button'; source.disabled = !link.visible;
    source.addEventListener('click', async () => { if (record.sourceKey) await selectTarget(record.sourceKey); await selectView('knowledge'); await knowledge.open(link.docId, link.startLine || undefined); });
    item.append(source, node('span', ` · ${link.status}`, 'caption'));
    for (const [label, operation] of [['Изменить связь', 'update'], ['Удалить связь', 'delete']]) {
      const action = node('button', label, 'button ghost'); action.type = 'button'; action.setAttribute('aria-label', `${label} ${link.id}`);
      action.disabled = state.allStores || state.busy || readOnly();
      action.addEventListener('click', () => linkEditor.open({ linkId: link.id, operation })); item.append(action);
    }
    $('recordSources').append(item);
  }
  $('edit').disabled = !!record.invalid || state.busy || readOnly(); $('delete').disabled = !!record.invalid || state.busy || readOnly();
  $('supersede').disabled = !!record.invalid || record.reasons.includes('superseded') || state.busy || readOnly();
  $('transferDirective').hidden = record.kind !== 'directive';
  $('transferDirective').disabled = !!record.invalid || state.busy || state.loading || readOnly();
  $('recordAddLink').disabled = !!record.invalid || state.busy || readOnly();
  $('openRecordStore').hidden = !state.allStores;
  $('openRecordStore').disabled = state.busy || state.loading;
  $('edit').title = readOnly() ? 'Редактирование в этом режиме недоступно.' : '';
}
$('recordAddLink').addEventListener('click', () => { if (selected()) linkEditor.open({ factRef: selected().ref }); });
function render() { renderNavigation(); renderList(); renderReader(); }
async function loadTarget(key, keepRef = null) {
  knowledge.deactivate();
  const sequence = ++state.sequence;
  state.notebook = null; state.selectedRef = null; state.edit = null; state.loading = true; render();
  try {
    const notebook = await api(state.allStores ? '/api/notebooks' : `/api/notebook?key=${encodeURIComponent(key)}`);
    if (sequence !== state.sequence) return;
    state.notebook = notebook;
    if (notebook.readOnly) notice(state.allStores ? 'Общий список доступен для просмотра. Для правки откройте хранилище выбранной записи.' : 'В этом режиме доступен только просмотр.');
    state.selectedRef = notebook.records.some(record => record.ref === keepRef) ? keepRef : matchMedia('(min-width:721px)').matches ? filteredRecords()[0]?.ref : null;
  } catch (error) { if (sequence === state.sequence) notice(errorText(error), true); }
  finally { if (sequence === state.sequence) { state.loading = false; render(); if (state.view === 'knowledge') await knowledge.activate({ reload: true }); } }
}
async function refresh() {
  if (!(await allowDiscard())) return;
  const key = $('target').value, ref = state.selectedRef;
  state.edit = null; state.loading = true; $('refresh').disabled = true; notice(); renderNavigation();
  try {
    state.overview = await api('/api/overview');
    renderTargets(key);
    if (state.overview.unavailable) {
      state.notebook = null; state.loading = false; render();
      notice(errorText({ code: state.overview.code, message: state.overview.unavailable }), true);
    } else await loadTarget($('target').value, ref);
  } catch (error) { state.notebook = null; state.loading = false; render(); notice(errorText(error), true); }
  finally { $('refresh').disabled = false; }
}
async function selectTarget(key) {
  if (!(await allowDiscard())) { $('target').value = state.notebook?.target.key || 'global'; return; }
  $('target').value = key;
  state.allStores = false; $('allStores').checked = false;
  const selectedGroup = [...$('projects').querySelectorAll('[data-project]')].find(button => button.dataset.project === key)?.closest('details');
  if (selectedGroup) selectedGroup.open = true;
  closeNavigation(); document.body.classList.remove('detail-open'); notice();
  await loadTarget(key);
}
async function selectView(view) {
  if (!(await allowDiscard())) return;
  state.edit = null; state.view = view; $('search').value = ''; $('statusFilter').value = 'active';
  resetNotebookFilters();
  if (view === 'knowledge' && state.allStores) {
    state.allStores = false; $('allStores').checked = false;
    await loadTarget($('target').value);
  }
  state.selectedRef = matchMedia('(min-width:721px)').matches ? filteredRecords()[0]?.ref : null;
  closeNavigation(); document.body.classList.remove('detail-open'); notice(); render();
  if (view === 'knowledge') await knowledge.activate(); else knowledge.deactivate();
}
async function selectRecord(ref) {
  if (!(await allowDiscard())) return;
  state.edit = null; state.selectedRef = ref; document.body.classList.add('detail-open'); render();
  if (matchMedia('(max-width:720px)').matches) $('backToList').focus();
}
function clearFieldErrors() {
  for (const field of ['title', 'body', 'ttl', 'tags']) { $(field).removeAttribute('aria-invalid'); inlineError(`${field}Error`); }
  inlineError('editorError');
}
function updateDraft() {
  if (!state.edit) return;
  $('draftState').textContent = dirty() ? 'Не сохранено' : 'Без изменений';
  $('disabledOption').hidden = $('kind').value !== 'directive';
}
async function startEdit(record = null, action = record ? 'update' : 'create') {
  if (!state.notebook || readOnly() || !(await allowDiscard())) return;
  if (action === 'supersede' && record?.reasons.includes('superseded')) return;
  state.edit = { key: state.notebook.target.key, version: state.notebook.version, ref: record?.ref || null, action, baseline: values(record) };
  for (const field of fields) { if (['keep', 'disabled'].includes(field)) $(field).checked = state.edit.baseline[field]; else $(field).value = state.edit.baseline[field]; }
  $('editorHeading').textContent = action === 'supersede' ? 'Замещение новой записью' : record ? 'Редактирование записи' : 'Новая запись';
  $('editScope').textContent = `${scope().name} · ${scope().key}${record?.id ? ` · ID ${record.id}` : ''}`;
  clearFieldErrors(); updateDraft(); document.body.classList.add('detail-open'); render(); $('title').focus();
}
function validate(input) {
  clearFieldErrors();
  const errors = {};
  for (const field of ['title', 'body']) {
    if (!input[field]) errors[field] = field === 'title' ? 'Укажите заголовок.' : 'Введите текст записи.';
    else if (/[\r\n]|<!--|-->/.test(input[field])) errors[field] = 'Используйте одну строку без комментариев метаданных.';
  }
  if (input.title.includes('*')) errors.title = 'Заголовок не должен содержать звёздочки.';
  if (input.ttl && (!/^\d+\s*[hdwm]?$/.test(input.ttl) || !(parseInt(input.ttl, 10) > 0))) errors.ttl = 'Укажите положительный срок, например 90d, 2w или 24h.';
  if (input.ttl.length > 20) errors.ttl = 'Срок должен быть короче 21 символа.';
  if (/[\r\n:]|<!--|-->/.test(input.tags)) errors.tags = 'Теги разделяются запятыми; двоеточия и комментарии не поддерживаются.';
  for (const [field, text] of Object.entries(errors)) { $(field).setAttribute('aria-invalid', 'true'); inlineError(`${field}Error`, text); }
  if (Object.keys(errors).length) $(Object.keys(errors)[0]).focus();
  return !Object.keys(errors).length;
}
function displayValue(field, value) {
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (field === 'kind') return value === 'directive' ? 'Инструкция' : 'Факт';
  return value || (field === 'ttl' ? 'Без ограничения' : 'Не указано');
}
function review(event) {
  event.preventDefault();
  if (!state.edit || state.busy) return;
  const input = formValues();
  if (!validate(input)) return;
  const changed = fields.filter(field => input[field] !== state.edit.baseline[field]);
  if (state.edit.ref && !changed.length) { if ($('reviewDialog').open) $('reviewDialog').close(); inlineError('editorError', 'Изменений нет. Измените поле или отмените редактирование.'); return; }
  reviewed = { ...input }; reviewedChanged = changed; $('changeList').replaceChildren();
  if (state.edit.action === 'supersede') $('changeList').append(node('p', 'Прежняя запись останется в истории вместе со своими источниками. Новая получит отдельный ID и новую дату; срок действия начнётся заново. Связи с источниками не копируются.', 'notice'));
  for (const field of state.edit.ref ? changed : fields.filter(field => input[field])) {
    const section = node('section', null, 'change-item'); section.append(node('h3', fieldNames[field]));
    const changes = node('div', null, 'change-values');
    if (state.edit.ref) { const before = node('div', null, 'change-value'); before.append(node('span', 'Было', 'caption'), node('span', displayValue(field, state.edit.baseline[field]))); changes.append(before); }
    const after = node('div', null, 'change-value after'); after.append(node('span', state.edit.ref ? 'Станет' : 'Новая запись', 'caption'), node('span', displayValue(field, input[field]))); changes.append(after); section.append(changes); $('changeList').append(section);
  }
  $('reviewScope').textContent = `${scope().name} · ${state.edit.key}${state.edit.ref ? ` · ${state.edit.ref}` : ''}`;
  $('reviewHeading').textContent = state.edit.action === 'supersede' ? 'Замещение записи' : state.edit.ref ? 'Проверка изменений' : 'Создание записи';
  inlineError('reviewError'); $('refreshConflict').hidden = true; openDialog('reviewDialog');
}
function setBusy(busy) {
  state.busy = busy;
  $('confirmSave').disabled = busy; $('confirmSave').textContent = busy ? 'Сохраняем…' : 'Сохранить запись';
  $('reviewDialog').setAttribute('aria-busy', String(busy));
  $('refreshConflict').disabled = busy;
  $('confirmDelete').disabled = busy || (deleting?.protected && !$('protectedConfirm').checked);
  $('confirmDelete').textContent = busy ? 'Удаляем…' : 'Удалить запись';
  $('deleteDialog').setAttribute('aria-busy', String(busy));
  $('refresh').disabled = busy; renderNavigation(); renderReader();
}
function acceptMutation(result, message) {
  state.notebook = result.notebook; state.selectedRef = result.ref || filteredRecords()[0]?.ref || null; state.edit = null;
  render();
  const context = result.persona.length ? ' Для активных сессий обновите контекст клиента.' : '';
  notice(result.status === 'partial' ? 'Запись сохранена, но синхронизация инструкций клиента завершилась с ошибкой. Повторите синхронизацию в CLI.' : message + context, result.status === 'partial');
}
async function save() {
  if (!state.edit || !reviewed || state.busy) return;
  let saved = false;
  setBusy(true); inlineError('reviewError');
  try {
    const result = await api('/api/notebook', { key: state.edit.key, expectedVersion: state.edit.version, ref: state.edit.ref, action: state.edit.action, fields: reviewed });
    $('reviewDialog').close(); acceptMutation(result, 'Запись сохранена.'); saved = true;
  } catch (error) { inlineError('reviewError', errorText(error)); $('refreshConflict').hidden = error.code !== 'CONFLICT'; }
  finally { setBusy(false); if (saved) $('edit').focus(); else ($('refreshConflict').hidden ? $('confirmSave') : $('refreshConflict')).focus(); }
}
async function refreshConflict() {
  if (!state.edit || !reviewed || state.busy) return;
  setBusy(true);
  let refreshed = false;
  try {
    const notebook = await api(`/api/notebook?key=${encodeURIComponent(state.edit.key)}`);
    const matches = notebook.records.filter(record => record.ref === state.edit.ref);
    if (state.edit.ref && (matches.length !== 1 || state.edit.ref.startsWith('legacy:'))) {
      inlineError('reviewError', 'Запись удалена, её ID неоднозначен или это legacy-запись. Черновик оставлен в редакторе. Обновите список и выберите запись заново; автоматическое сопоставление недоступно.');
      return;
    }
    if (state.edit.action === 'supersede' && matches[0]?.reasons.includes('superseded')) {
      inlineError('reviewError', 'Запись уже заменена другим клиентом. Черновик сохранён; отмените замещение и откройте актуальную запись.');
      return;
    }
    const baseline = state.edit.ref ? values(matches[0]) : state.edit.baseline;
    // Carry only fields the user changed; retain unrelated edits from the other client.
    const merged = state.edit.ref ? { ...baseline, ...Object.fromEntries(reviewedChanged.map(field => [field, reviewed[field]])) } : reviewed;
    state.notebook = notebook; state.edit.version = notebook.version; state.edit.baseline = baseline;
    for (const field of fields) { if (['keep', 'disabled'].includes(field)) $(field).checked = merged[field]; else $(field).value = merged[field]; }
    if (merged.kind === 'fact') $('disabled').checked = false;
    updateDraft(); render(); refreshed = true;
  } catch (error) { inlineError('reviewError', errorText(error)); }
  finally {
    setBusy(false);
    if (refreshed) { review({ preventDefault() {} }); notice('Данные обновлены. Проверьте правку относительно текущей записи; сохранение ещё не выполнено.'); }
  }
}
function requestDelete() {
  const record = selected(); if (!record || record.invalid || state.busy || readOnly()) return;
  deleting = { key: scope().key, expectedVersion: state.notebook.version, ref: record.ref, protected: record.meta?.keep === '1' };
  $('deleteSummary').textContent = `«${record.title || 'Без заголовка'}» · ${scope().name} · ${scope().key} · ${record.ref}${record.links?.length ? `\nБудут удалены связи (${record.links.length}): ${record.links.map(link => link.id).join(', ')}. Источники сохранятся.` : ''}`;
  $('protectedLabel').hidden = !deleting.protected; $('protectedConfirm').checked = false;
  $('confirmDelete').disabled = deleting.protected; inlineError('deleteError'); openDialog('deleteDialog');
  $('deleteDialog').querySelector('[data-close]').focus();
}
async function removeRecord() {
  if (!deleting || state.busy || deleting.protected && !$('protectedConfirm').checked) return;
  setBusy(true); inlineError('deleteError');
  try {
    const result = await api('/api/notebook', { ...deleting, action: 'delete', confirmDelete: true, confirmProtected: $('protectedConfirm').checked });
    $('deleteDialog').close(); acceptMutation(result, 'Запись удалена из выбранной области.');
    if (matchMedia('(max-width:720px)').matches) document.body.classList.remove('detail-open');
  } catch (error) { inlineError('deleteError', errorText(error)); }
  finally { setBusy(false); }
}
async function previewPersona() {
  if (!state.notebook || state.busy) return;
  persona.open();
}
function showSystem() {
  $('systemProperties').replaceChildren();
  const overview = state.overview;
  for (const [label, value] of [['Версия', overview?.version], ['Режим', overview?.mode], ['Хранилище', overview?.memoryDir], ['Известных проектов', overview ? String(overview.targets.filter(target => target.key !== 'global').length) : 'Не проверено'], ['Проверено', overview ? new Date(overview.observedAt).toLocaleString('ru') : 'Нет актуальных данных'], ['Модели', 'Состояние не проверялось'], ['Облако', 'Запросы не выполнялись'], ['Клиенты', 'Состояние не проверялось']]) property($('systemProperties'), label, value);
  openDialog('systemDialog');
}
function closeNavigation() { if ($('navigationDialog').open) $('navigationDialog').close(); }
$('navigation').addEventListener('click', () => { $('mobileNavHost').append($('sidebar')); openDialog('navigationDialog'); });
$('navigationDialog').addEventListener('close', () => $('shell').prepend($('sidebar')));
$('target').addEventListener('change', event => selectTarget(event.target.value));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => selectView(button.dataset.view)));
$('search').addEventListener('input', renderList); $('statusFilter').addEventListener('change', renderList);
for (const id of ['kindFilter', 'tagsFilter', 'sinceFilter', 'untilFilter']) $(id).addEventListener('input', renderList);
function resetNotebookFilters() {
  $('kindFilter').value = 'all';
  for (const id of ['tagsFilter', 'sinceFilter', 'untilFilter']) $(id).value = '';
}
$('clearNotebookFilters').addEventListener('click', () => { resetNotebookFilters(); $('search').value = ''; $('statusFilter').value = 'active'; renderList(); });
$('allStores').addEventListener('change', async () => {
  const next = $('allStores').checked;
  if (!(await allowDiscard())) { $('allStores').checked = state.allStores; return; }
  state.allStores = next; document.body.classList.remove('detail-open'); notice(); await loadTarget($('target').value);
});
$('openRecordStore').addEventListener('click', async () => {
  const record = selected(); if (!record?.sourceKey) return;
  await selectTarget(record.sourceKey); await selectRecord(record.sourceRef); $('recordTitle').focus();
});
$('projectSearch').addEventListener('input', renderProjects);
$('refresh').addEventListener('click', refresh); $('create').addEventListener('click', () => startEdit());
$('edit').addEventListener('click', () => startEdit(selected())); $('delete').addEventListener('click', requestDelete);
$('supersede').addEventListener('click', () => startEdit(selected(), 'supersede'));
$('transferDirective').addEventListener('click', async () => {
  const record = selected(); if (!record || readOnly() || !(await allowDiscard())) return;
  state.edit = null; await directiveTransfer.open({ key: scope().key, record });
});
$('backToList').addEventListener('click', () => { document.body.classList.remove('detail-open'); $('search').focus(); });
$('editForm').noValidate = true; $('editForm').addEventListener('submit', review);
$('editForm').addEventListener('input', updateDraft);
$('kind').addEventListener('change', () => { if ($('kind').value === 'fact') $('disabled').checked = false; updateDraft(); });
$('cancelEdit').addEventListener('click', async () => { if (await allowDiscard()) { state.edit = null; render(); if (selected()) $('edit').focus(); else document.body.classList.remove('detail-open'); } });
$('confirmSave').addEventListener('click', save); $('confirmDelete').addEventListener('click', removeRecord);
$('refreshConflict').addEventListener('click', refreshConflict);
$('protectedConfirm').addEventListener('change', () => { $('confirmDelete').disabled = !$('protectedConfirm').checked; });
$('promptFiles').addEventListener('click', () => prompts.open());
$('personaPreview').addEventListener('click', previewPersona); $('system').addEventListener('click', showSystem);
document.addEventListener('keydown', event => {
  if (event.key === '/' && !document.querySelector('dialog[open]') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { event.preventDefault(); $('search').focus(); }
});
window.addEventListener('beforeunload', event => { if (dirty() || state.busy) { event.preventDefault(); event.returnValue = ''; } });
refresh();
