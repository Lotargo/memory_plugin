import { concatText, countText, dateText, formatText, joinText, locale, setAttr, setText, t } from './i18n.js';
import { createPromptAdmin } from './prompts.js';
import { createMaintenance } from './maintenance.js';
import { createDiagnostics } from './diagnostics.js';
import { createUninstall } from './uninstall.js';
import { createClients } from './clients.js';
import { createKnowledgeBrowser } from './knowledge.js';
import { renderContent, connectContentToggle } from './content.js';
import { createLinkEditor } from './links.js';
import { createProjectManager } from './projects.js';
import { createSettings } from './settings.js';
import { createModels } from './models.js';
import { filterNotebookRecords, historicalRecord } from './notebook_filters.js';
import { createPersonaPreview } from './persona.js';
import { createDirectiveTransfer } from './directive_transfer.js';
import { createProjectPicker } from './project_picker.js';
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
const names = { notebook: t('m1'), persona: t('m2'), archive: t('m3'), knowledge: t('m4') };
const reasons = { expired: t('m5'), superseded: t('m6'), disabled: t('m7'), invalid: t('m8') };
const fields = ['title', 'body', 'kind', 'ttl', 'tags', 'keep', 'disabled'];
const fieldNames = { title: t('m9'), body: t('m10'), kind: t('m11'), ttl: t('m12'), tags: t('m13'), keep: t('m14'), disabled: t('m15') };
const focusBeforeDialog = new WeakMap();
let reviewed, reviewedChanged, deleting;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) setText(element, text);
  if (className) element.className = className;
  return element;
}
function notice(text = '', error = false) {
  setText($('message'), text);
  $('message').hidden = !text;
  $('message').classList.toggle('error', error);
}
function inlineError(id, text = '') { setText($(id), text); $(id).hidden = !text; }
function openDialog(id) {
  const dialog = $(id);
  if (dialog.open) return;
  focusBeforeDialog.set(dialog, document.activeElement);
  dialog.showModal();
}
document.querySelectorAll('dialog').forEach(dialog => {
  // Backdrop dismissal requests cancel, preserving the same guards as Escape.
  dialog.setAttribute('closedby', 'any');
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
  if (error.status === 401) return t('m16');
  if (error.code === 'MIGRATION_REQUIRED') return t('m17');
  if (error.code === 'CONFLICT') return t('m18');
  if (error.code === 'UNSUPPORTED') return /source links/.test(error.message)
    ? t('m19')
    : t('m20');
  if (error.code === 'NOT_FOUND') return t('m21');
  if (error.code === 'INVALID') return /already exists/.test(error.message) ? t('m22') : t('m23');
  return t('m24');
}
async function api(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(connectionToken ? { Authorization: formatText`Bearer ${connectionToken}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
const projectPicker = createProjectPicker({ node, targets: () => state.overview?.targets || [], label: projectName, select: selectTarget });
createProjectManager({ api, node, scopeKey: () => $('target').value, openDialog, allowDiscard, closeNavigation, onSaved: async result => {
  state.edit=null;
  await refresh();
  if(result.targetKey && state.overview?.targets.some(target=>target.key===result.targetKey)) await selectTarget(result.targetKey);
  notice(result.backup ? t('m25', result.backup) : t('m26'));
} });
const selected = () => state.notebook?.records.find(record => record.ref === state.selectedRef);
const directiveTransfer = createDirectiveTransfer({ api, node, openDialog, onSaved: async result => {
  state.edit = null; await refresh(); await selectTarget(result.targetKey);
  await selectView('persona'); $('statusFilter').value = 'all'; $('search').value = ''; resetNotebookFilters(); renderList();
  await selectRecord(result.ref); $('recordTitle').focus();
  notice(t('m27', result.backup, result.status === 'partial' ? t('m28') : ''));
} });
createSettings({api,node,openDialog,allowDiscard,closeNavigation,onChanged:refresh,onOpen:()=>{state.edit=null;render();}});
createModels({api,node,openDialog,allowDiscard,closeNavigation,onChanged:refresh});
const readOnly = () => !!(state.notebook?.readOnly || state.overview?.readOnly);
const scope = () => state.notebook?.target || state.overview?.targets.find(target => target.key === $('target').value);
const prompts = createPromptAdmin({ api, node, openDialog });
createDiagnostics({ api, node, openDialog, allowDiscard, closeNavigation });
createUninstall({ api, node, openDialog, allowDiscard, closeNavigation });
createClients({ api, node, openDialog, allowDiscard, closeNavigation });
createMaintenance({ api, node, openDialog, allowDiscard, closeNavigation, scopeKey: () => $('target').value,
  onSaved: async () => { state.edit = null; await refresh(); } });
const persona = createPersonaPreview({ api, node, openDialog, scope, errorText, openRecord: async item => {
  await selectTarget(item.key); await selectView('persona'); $('statusFilter').value = 'all';
  const record = state.notebook?.records.find(record => record.ref === item.ref);
  if (!record || !item.id && record.fingerprint !== item.fingerprint) {
    state.selectedRef = null; render();
    notice(t('m29'), true); return;
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
  if (state.allStores) records.sort((a, b) => formatText`${b.date || ''} ${b.time || ''}`.localeCompare(formatText`${a.date || ''} ${a.time || ''}`));
  return filterNotebookRecords(records, { view: state.view, status: $('statusFilter').value, kind: $('kindFilter').value,
    tags: $('tagsFilter').value, since: $('sinceFilter').value, until: $('untilFilter').value, query: $('search').value });
}
function renderNavigation() {
  const records = state.notebook?.records || [];
  setText($('notebookCount'), records.filter(record => !historical(record)).length);
  setText($('directiveCount'), records.filter(record => record.kind === 'directive' && !historical(record)).length);
  setText($('archiveCount'), records.filter(historical).length);
  document.querySelectorAll('[data-view]').forEach(button => {
    if (button.dataset.view === state.view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  setText($('viewTitle'), names[state.view]);
  $('promptFiles').hidden = state.view !== 'persona';
  $('personaPreview').hidden = state.view !== 'persona';
  $('personaPreview').disabled = !state.notebook || state.busy || state.allStores;
  setText($('personaPreview'), state.allStores ? t('m30') : '', 'title');
  setText($('scopeName'), scope() ? projectName(scope()) : t('m31'));
  setText($('scopeHint'), state.allStores ? t('m32') : scope()?.key === 'global' ? t('m33') : t('m34'));
  setText($('create'), state.view === 'persona' ? t('m35') : t('m36'));
  $('create').hidden = state.view === 'knowledge';
  $('notebookArea').hidden = state.view === 'knowledge';
  $('knowledgeArea').hidden = state.view !== 'knowledge';
  setText($('statusFilter').options[0], state.view === 'archive' ? t('m37') : t('m38'));
  $('create').disabled = !state.notebook || state.busy || state.loading || readOnly();
  $('target').disabled = state.busy || state.loading || !state.overview?.targets.length;
  projectPicker.sync();
  setText($('create'), state.allStores ? t('m39') : readOnly() ? t('m40') : '', 'title');
  $('allStores').disabled = state.busy || state.loading;
  $('collectionHint').hidden = !state.allStores;
  $('create').classList.toggle('primary', !state.edit);
  $('create').classList.toggle('secondary', !!state.edit);
  setText(document, formatText`Memory — ${names[state.view]}`, 'title');
}
function renderTargets(key) {
  const projects = state.overview.targets.filter(target => target.key !== 'global')
    .sort((a, b) => projectName(a).localeCompare(projectName(b), locale(), { numeric: true }));
  const groups = [
    { label: null, targets: state.overview.targets.filter(target => target.key === 'global') },
    { label: t('m41'), targets: projects.filter(target => !target.unavailable && target.key.startsWith('git:')) },
    { label: t('m42'), targets: projects.filter(target => !target.unavailable && !target.key.startsWith('git:')) },
    { label: t('m43'), targets: projects.filter(target => target.unavailable) }
  ];
  $('target').replaceChildren();
  for (const group of groups) {
    if (!group.targets.length) continue;
    const parent = group.label ? node('optgroup') : $('target');
    if (group.label) setText(parent, group.label, 'label');
    for (const target of group.targets) {
      const name = target.key === 'global' ? t('m31') : projectName(target);
      const option = node('option', name.length > 80 ? formatText`${name.slice(0, 77)}…` : name);
      option.value = target.key; option.disabled = !!target.unavailable;
      setText(option, target.key, 'title');
      parent.append(option);
    }
    if (group.label) $('target').append(parent);
  }
  $('target').value = state.overview.targets.some(target => target.key === key && !target.unavailable) ? key : 'global';
  setText($('projectCount'), projects.length || '');
  setText($('version'), formatText`v${state.overview.version}`);
}
function projectName(target) {
  if (target.key === 'global') return t('m31');
  // Display labels only: the exact store key still addresses every operation.
  if (target.name.length > 120 || /<!--|-->|[<>\r\n]/.test(target.name)) return t('m44');
  if (target.name.startsWith('git_') || target.name.startsWith('git:')) {
    if (target.key.startsWith('git:') && target.key.includes('/')) return target.key.split('/').at(-1);
    const repository = /^git_(?:github_com|gitlab_com|bitbucket_org)_[^_]+_(.+)$/.exec(target.name);
    if (repository) return repository[1];
    const local = /^git_local_(.+)_(\d{8,})$/.exec(target.name);
    if (local) return formatText`${local[1]} · ${local[2].slice(-4)}`;
  }
  return target.name;
}
function renderList() {
  const records = filteredRecords();
  $('records').replaceChildren(); $('records').setAttribute('aria-busy', String(state.loading));
  setText($('resultCount'), state.loading ? '—' : countText(records.length));
  $('listState').hidden = !state.loading && !!records.length;
  setText($('listState'), state.loading ? t('m48') : !state.notebook ? t('m49') : $('search').value ? t('m50') : state.view === 'archive' ? t('m51') : t('m52'));
  const invalidDates = !!($('sinceFilter').value && $('untilFilter').value && $('sinceFilter').value > $('untilFilter').value);
  inlineError('dateFilterError', invalidDates ? t('m53') : '');
  for (const field of ['sinceFilter', 'untilFilter']) {
    if (invalidDates) $(field).setAttribute('aria-invalid', 'true'); else $(field).removeAttribute('aria-invalid');
  }
  const unavailable = state.notebook?.unavailable || [];
  $('collectionStatus').hidden = !unavailable.length;
  setText($('collectionStatus'), unavailable.length ? t('m54', joinText(unavailable.map(target => formatText`${projectName(target)} (${target.code})`), ', ')) : '');
  for (const record of records) {
    const li = node('li'), button = node('button', null, 'record-row'); button.type = 'button';
    button.setAttribute('aria-pressed', String(record.ref === state.selectedRef));
    const top = node('span', null, 'row-top');
    top.append(node('span', record.invalid ? t('m55') : record.kind === 'directive' ? t('m56') : t('m57')), node('span', record.date || t('m58'), 'row-date'));
    button.append(top, node('span', record.title || t('m59'), 'row-title'), node('span', record.body, 'row-summary'));
    if (record.sourceKey) button.append(node('span', formatText`${projectName({ name: record.sourceName, key: record.sourceKey })} · ${record.sourceKey}`, 'row-scope'));
    const statuses = record.reasons.map(reason => reasons[reason]);
    if (record.meta?.keep === '1') statuses.push(t('m60'));
    if (statuses.length) button.append(node('span', joinText(statuses, ' · '), 'row-state'));
    button.addEventListener('click', () => selectRecord(record.ref)); li.append(button); $('records').append(li);
  }
  setText($('updatedAt'), state.notebook ? t('m61', dateText(new Date(state.notebook.observedAt), 'toLocaleTimeString', { hour: '2-digit', minute: '2-digit' })) : t('m62'));
  setText($('modeLabel'), state.overview?.mode || '');
}
function property(container, label, value, className) { container.append(node('dt', label), node('dd', value || '—', className)); }
function renderReader() {
  const record = selected();
  $('detailEmpty').hidden = !!record || !!state.edit;
  $('reader').hidden = !record || !!state.edit;
  $('editForm').hidden = !state.edit;
  if (!record || state.edit) return;
  setText($('recordType'), record.kind === 'directive' ? t('m56') : t('m57'));
  setText($('recordTitle'), record.title || t('m59'));
  setText($('recordRaw'), record.body);
  renderContent($('recordBody'), record.body);
  $('recordStatuses').replaceChildren();
  for (const reason of record.reasons) $('recordStatuses').append(node('span', reasons[reason], 'status-label inactive'));
  if (record.meta?.keep === '1') $('recordStatuses').append(node('span', t('m63'), 'status-label'));
  $('recordTags').replaceChildren();
  for (const tag of (record.meta?.tags || '').split(',').filter(Boolean)) $('recordTags').append(node('span', formatText`#${tag.trim()}`));
  $('recordProperties').replaceChildren();
  property($('recordProperties'), t('m64'), record.sourceKey ? projectName({key:record.sourceKey,name:record.sourceName}) : projectName(scope()));
  property($('recordProperties'), t('m65'), record.sourceKey || scope()?.key, 'identifier');
  property($('recordProperties'), t('m66'), record.id || t('m67'), 'identifier');
  property($('recordProperties'), t('m68'), joinText([record.date, record.time].filter(Boolean), ' '));
  property($('recordProperties'), t('m12'), record.meta?.ttl || t('m69'));
  if (record.meta?.supersededBy) property($('recordProperties'), t('m70'), record.meta.supersededBy, 'identifier');
  if (record.meta?.supersedes) property($('recordProperties'), t('m71'), record.meta.supersedes, 'identifier');
  $('sourcesSection').hidden = !record.links?.length; $('recordSources').replaceChildren();
  for (const link of record.links || []) {
    const item = node('li');
    const source = node('button', link.visible ? formatText`${link.title || link.docId}${link.startLine ? formatText` · ${link.status === 'valid' ? t('m72') : t('m73')} ${link.startLine}–${link.endLine || link.startLine}` : ''}` : t('m74'), 'button ghost');
    source.type = 'button'; source.disabled = !link.visible;
    source.addEventListener('click', async () => { if (record.sourceKey) await selectTarget(record.sourceKey); await selectView('knowledge'); await knowledge.open(link.docId, link.startLine || undefined); });
    item.append(source, node('span', formatText` · ${link.status}`, 'caption'));
    for (const [label, operation] of [[t('m75'), 'update'], [t('m76'), 'delete']]) {
      const action = node('button', label, 'button ghost'); action.type = 'button'; setAttr(action, 'aria-label', formatText`${label} ${link.id}`);
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
  setText($('edit'), readOnly() ? t('m40') : '', 'title');
}
$('recordAddLink').addEventListener('click', () => { if (selected()) linkEditor.open({ factRef: selected().ref }); });
function render() { renderNavigation(); renderList(); renderReader(); }
async function loadTarget(key, keepRef = null) {
  knowledge.deactivate();
  const sequence = ++state.sequence;
  state.notebook = null; state.selectedRef = null; state.edit = null; state.loading = true; render();
  try {
    const notebook = await api(state.allStores ? '/api/notebooks' : formatText`/api/notebook?key=${encodeURIComponent(key)}`);
    if (sequence !== state.sequence) return;
    state.notebook = notebook;
    if (notebook.readOnly) notice(state.allStores ? t('m77') : t('m78'));
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
  for (const field of ['title', 'body', 'ttl', 'tags']) { $(field).removeAttribute('aria-invalid'); inlineError(formatText`${field}Error`); }
  inlineError('editorError');
}
function updateDraft() {
  if (!state.edit) return;
  setText($('draftState'), dirty() ? t('m79') : t('m80'));
  $('disabledOption').hidden = $('kind').value !== 'directive';
}
async function startEdit(record = null, action = record ? 'update' : 'create') {
  if (!state.notebook || readOnly() || !(await allowDiscard())) return;
  if (action === 'supersede' && record?.reasons.includes('superseded')) return;
  state.edit = { key: state.notebook.target.key, version: state.notebook.version, ref: record?.ref || null, action, baseline: values(record) };
  for (const field of fields) { if (['keep', 'disabled'].includes(field)) $(field).checked = state.edit.baseline[field]; else $(field).value = state.edit.baseline[field]; }
  setText($('editorHeading'), action === 'supersede' ? t('m81') : record ? t('m82') : t('m83'));
  setText($('editScope'), formatText`${projectName(scope())} · ${scope().key}${record?.id ? formatText` · ID ${record.id}` : ''}`);
  clearFieldErrors(); updateDraft(); document.body.classList.add('detail-open'); render(); $('title').focus();
}
function validate(input) {
  clearFieldErrors();
  const errors = {};
  for (const field of ['title', 'body']) {
    if (!input[field]) errors[field] = field === 'title' ? t('m84') : t('m85');
    else if (/[\r\n]|<!--|-->/.test(input[field])) errors[field] = t('m86');
  }
  if (input.title.includes('*')) setText(errors, t('m87'), 'title');
  if (input.ttl && (!/^\d+\s*[hdwm]?$/.test(input.ttl) || !(parseInt(input.ttl, 10) > 0))) errors.ttl = t('m88');
  if (input.ttl.length > 20) errors.ttl = t('m89');
  if (/[\r\n:]|<!--|-->/.test(input.tags)) errors.tags = t('m90');
  for (const [field, text] of Object.entries(errors)) { $(field).setAttribute('aria-invalid', 'true'); inlineError(formatText`${field}Error`, text); }
  if (Object.keys(errors).length) $(Object.keys(errors)[0]).focus();
  return !Object.keys(errors).length;
}
function displayValue(field, value) {
  if (typeof value === 'boolean') return value ? t('m91') : t('m92');
  if (field === 'kind') return value === 'directive' ? t('m56') : t('m57');
  return value || (field === 'ttl' ? t('m69') : t('m93'));
}
function review(event) {
  event.preventDefault();
  if (!state.edit || state.busy) return;
  const input = formValues();
  if (!validate(input)) return;
  const changed = fields.filter(field => input[field] !== state.edit.baseline[field]);
  if (state.edit.ref && !changed.length) { if ($('reviewDialog').open) $('reviewDialog').close(); inlineError('editorError', t('m94')); return; }
  reviewed = { ...input }; reviewedChanged = changed; $('changeList').replaceChildren();
  if (state.edit.action === 'supersede') $('changeList').append(node('p', t('m95'), 'notice'));
  for (const field of state.edit.ref ? changed : fields.filter(field => input[field])) {
    const section = node('section', null, 'change-item'); section.append(node('h3', fieldNames[field]));
    const changes = node('div', null, 'change-values');
    if (state.edit.ref) { const before = node('div', null, 'change-value'); before.append(node('span', t('m96'), 'caption'), node('span', displayValue(field, state.edit.baseline[field]))); changes.append(before); }
    const after = node('div', null, 'change-value after'); after.append(node('span', state.edit.ref ? t('m97') : t('m83'), 'caption'), node('span', displayValue(field, input[field]))); changes.append(after); section.append(changes); $('changeList').append(section);
  }
  setText($('reviewScope'), formatText`${projectName(scope())} · ${state.edit.key}${state.edit.ref ? formatText` · ${state.edit.ref}` : ''}`);
  setText($('reviewHeading'), state.edit.action === 'supersede' ? t('m98') : state.edit.ref ? t('m99') : t('m100'));
  inlineError('reviewError'); $('refreshConflict').hidden = true; openDialog('reviewDialog');
}
function setBusy(busy) {
  state.busy = busy;
  $('confirmSave').disabled = busy; setText($('confirmSave'), busy ? t('m101') : t('m102'));
  $('reviewDialog').setAttribute('aria-busy', String(busy));
  $('refreshConflict').disabled = busy;
  $('confirmDelete').disabled = busy || (deleting?.protected && !$('protectedConfirm').checked);
  setText($('confirmDelete'), busy ? t('m103') : t('m104'));
  $('deleteDialog').setAttribute('aria-busy', String(busy));
  $('refresh').disabled = busy; renderNavigation(); renderReader();
}
function acceptMutation(result, message) {
  state.notebook = result.notebook; state.selectedRef = result.ref || filteredRecords()[0]?.ref || null; state.edit = null;
  render();
  const context = result.persona.length ? t('m105') : '';
  notice(result.status === 'partial' ? t('m106') : concatText(message, context), result.status === 'partial');
}
async function save() {
  if (!state.edit || !reviewed || state.busy) return;
  let saved = false;
  setBusy(true); inlineError('reviewError');
  try {
    const result = await api('/api/notebook', { key: state.edit.key, expectedVersion: state.edit.version, ref: state.edit.ref, action: state.edit.action, fields: reviewed });
    $('reviewDialog').close(); acceptMutation(result, t('m107')); saved = true;
  } catch (error) { inlineError('reviewError', errorText(error)); $('refreshConflict').hidden = error.code !== 'CONFLICT'; }
  finally { setBusy(false); if (saved) $('edit').focus(); else ($('refreshConflict').hidden ? $('confirmSave') : $('refreshConflict')).focus(); }
}
async function refreshConflict() {
  if (!state.edit || !reviewed || state.busy) return;
  setBusy(true);
  let refreshed = false;
  try {
    const notebook = await api(formatText`/api/notebook?key=${encodeURIComponent(state.edit.key)}`);
    const matches = notebook.records.filter(record => record.ref === state.edit.ref);
    if (state.edit.ref && (matches.length !== 1 || state.edit.ref.startsWith('legacy:'))) {
      inlineError('reviewError', t('m108'));
      return;
    }
    if (state.edit.action === 'supersede' && matches[0]?.reasons.includes('superseded')) {
      inlineError('reviewError', t('m109'));
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
    if (refreshed) { review({ preventDefault() {} }); notice(t('m110')); }
  }
}
function requestDelete() {
  const record = selected(); if (!record || record.invalid || state.busy || readOnly()) return;
  deleting = { key: scope().key, expectedVersion: state.notebook.version, ref: record.ref, protected: record.meta?.keep === '1' };
  setText($('deleteSummary'), formatText`«${record.title || t('m111')}» · ${projectName(scope())} · ${scope().key} · ${record.ref}${record.links?.length ? t('m112', record.links.length, joinText(record.links.map(link => link.id), ', ')) : ''}`);
  $('protectedLabel').hidden = !deleting.protected; $('protectedConfirm').checked = false;
  $('confirmDelete').disabled = deleting.protected; inlineError('deleteError'); openDialog('deleteDialog');
  $('deleteDialog').querySelector('[data-close]').focus();
}
async function removeRecord() {
  if (!deleting || state.busy || deleting.protected && !$('protectedConfirm').checked) return;
  setBusy(true); inlineError('deleteError');
  try {
    const result = await api('/api/notebook', { ...deleting, action: 'delete', confirmDelete: true, confirmProtected: $('protectedConfirm').checked });
    $('deleteDialog').close(); acceptMutation(result, t('m113'));
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
  for (const [label, value] of [[t('m114'), overview?.version], [t('m115'), overview?.mode], [t('m116'), overview?.memoryDir], [t('m117'), overview ? String(overview.targets.filter(target => target.key !== 'global').length) : t('m118')], [t('m119'), overview ? dateText(new Date(overview.observedAt), 'toLocaleString') : t('m62')], [t('m120'), t('m121')], [t('m122'), t('m123')], [t('m124'), t('m121')]]) property($('systemProperties'), label, value);
  openDialog('systemDialog');
}
function closeNavigation() { projectPicker.close(); if ($('navigationDialog').open) $('navigationDialog').close(); }
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
  if (event.key === '/' && !document.querySelector('dialog[open], :popover-open') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { event.preventDefault(); $('search').focus(); }
});
async function checkPanelBuild() {
  try { $('buildNotice').hidden = !(await api('/api/runtime/update')).filesChanged; } catch {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkPanelBuild(); });
checkPanelBuild();
window.addEventListener('beforeunload', event => { if (dirty() || state.busy) { event.preventDefault(); event.returnValue = ''; } });
refresh();
