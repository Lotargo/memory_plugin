// Native personality projections. No Notebook mutations, client processes or cloud access.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { resolveClientPaths } from '../client_paths.js';
import { readMemory, notebookVersion, GLOBAL_KEY, MEMORY_DIR } from '../memory.js';
import { compilePersona, renderClaudePersona, PERSONA_INSTRUCTION } from '../context/persona_context.js';
import { buildPersonaOverlayBlock, stripPersonaOverlayBlock, upsertPromptBlock,
  START_MARKER, END_MARKER, PERSONA_START_MARKER, PERSONA_END_MARKER } from '../prompt_manager.js';
import { atomicWrite, withSnapshotLock } from '../storage/snapshot_lock.js';

const paths = resolveClientPaths();
export const PERSONA_DELIVERY_PATHS = Object.freeze({
  field: path.join(paths.agentConfigDir, 'persona.md'),
  state: path.join(paths.agentConfigDir, 'persona-state.json'),
  journal: path.join(paths.agentConfigDir, 'persona-journal.json'),
  prompt: paths.promptFile,
  promptState: paths.promptStateFile,
  codex: path.join(paths.codexDir, 'AGENTS.md'),
  claude: path.join(paths.claudeDir, 'CLAUDE.md'),
  claudeStyle: path.join(paths.claudeDir, 'output-styles', 'memory-persona.md'),
  claudeSettings: path.join(paths.claudeDir, 'settings.json'),
  gemini: path.join(paths.geminiDir, 'GEMINI.md'),
  antigravity: path.join(paths.antigravityConfigDir, 'AGENTS.md'),
});
const P = PERSONA_DELIVERY_PATHS;
const names = { opencode: 'OpenCode', codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini CLI', antigravity: 'Antigravity' };
const allowed = new Set(Object.values(P));
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function safe(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) fail('UNSUPPORTED', 'Linked personality files or parent directories are preserved.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
}
function read(file, limit = 512 * 1024) {
  safe(file);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > limit) fail('UNSUPPORTED', 'Expected a bounded UTF-8 personality file.');
    const bytes = fs.readFileSync(file);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { fail('UNSUPPORTED', 'Personality file is not valid UTF-8.'); }
    return { exists: true, text, hash: sha(text) };
  } catch (error) { if (error.code === 'ENOENT') return { exists: false, text: '', hash: null }; throw error; }
}
function json(disk) {
  if (!disk.exists) return {};
  let value;
  try { value = JSON.parse(disk.text.replace(/^\uFEFF/, '')); } catch { fail('UNSUPPORTED', 'Personality JSON is invalid.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('UNSUPPORTED', 'Expected a personality JSON object.');
  return value;
}
function state(disk = read(P.state)) {
  if (!disk.exists) return { schema: 1, clients: [], knownClients: [], owned: {} };
  const value = json(disk);
  if (value.schema !== 1 || !Array.isArray(value.clients) || value.clients.some(id => !Object.hasOwn(names, id))
    || new Set(value.clients).size !== value.clients.length || !value.owned || typeof value.owned !== 'object'
    || Array.isArray(value.owned) || Object.entries(value.owned).some(([file, owner]) => !allowed.has(file)
      || !owner || typeof owner !== 'object' || Array.isArray(owner) || Object.keys(owner).some(key => !['hash','existedBefore'].includes(key))
      || !/^[a-f0-9]{64}$/.test(owner.hash || '') || typeof owner.existedBefore !== 'boolean')
    || Object.keys(value).some(key => !['schema', 'clients', 'knownClients', 'owned', 'claudeSelection'].includes(key))
    || value.knownClients !== undefined && (!Array.isArray(value.knownClients) || value.knownClients.some(id => !Object.hasOwn(names, id))
      || new Set(value.knownClients).size !== value.knownClients.length || value.clients.some(id => !value.knownClients.includes(id))))
    fail('RECOVERY_REQUIRED', 'Invalid personality ownership state.');
  if (value.claudeSelection && (typeof value.claudeSelection !== 'object' || Array.isArray(value.claudeSelection)
    || Object.keys(value.claudeSelection).some(key => !['hadValue','value'].includes(key)) || typeof value.claudeSelection.hadValue !== 'boolean'
    || value.claudeSelection.hadValue && typeof value.claudeSelection.value !== 'string')) fail('RECOVERY_REQUIRED', 'Invalid previous Claude style.');
  return value;
}
export function isNativePersonaEnabled(name = null) {
  const disk = read(P.state), value = state(disk);
  // An initialized controller with zero selected clients stays initialized.
  // Otherwise the legacy automatic writer would recreate disabled projections.
  return name ? value.clients.some(id => names[id] === name || id === name) : disk.exists;
}
function managed(text, block) {
  // Fail closed on broken/embedded control markers; do not let directive text control files.
  const starts = text.split(PERSONA_START_MARKER).length - 1, ends = text.split(PERSONA_END_MARKER).length - 1;
  if (starts !== ends || starts > 1 || starts && text.indexOf(PERSONA_END_MARKER) < text.indexOf(PERSONA_START_MARKER))
    fail('UNSUPPORTED', 'Repair ambiguous legacy persona markers before migration.');
  if (!block) return stripPersonaOverlayBlock(text);
  if (!starts) return `${text}${text ? '\n\n' : ''}${block}\n`;
  const start = text.indexOf(PERSONA_START_MARKER), end = text.indexOf(PERSONA_END_MARKER) + PERSONA_END_MARKER.length;
  return text.slice(0, start) + block + text.slice(end);
}
function same(a, b) { return a.exists === b.exists && a.text === b.text; }
function summary(file) { return { path: file.path, action: file.after.exists ? 'write' : 'remove',
  beforeHash: file.before.hash, afterHash: file.after.exists ? sha(file.after.text) : null,
  beforeBytes: Buffer.byteLength(file.before.text), afterBytes: Buffer.byteLength(file.after.text) }; }
function noJournal() {
  if (read(P.journal, 8 * 1024 * 1024).exists || read(path.join(paths.agentConfigDir, 'prompt-journal.json'), 8 * 1024 * 1024).exists)
    fail('RECOVERY_REQUIRED', 'An interrupted personality or prompt operation needs recovery.');
}

function prepareRestore(backupId) {
  noJournal();
  if (!uuid.test(backupId || '')) fail('INVALID', 'Select an exact personality backup ID.');
  const backup = path.join(paths.promptBackupDir, `persona-${backupId}.json`);
  const disk = read(backup, 8 * 1024 * 1024), checksum = read(`${backup}.sha256`);
  if (!disk.exists || !checksum.exists || checksum.text.trim() !== sha(disk.text)) fail('CONFLICT', 'Personality backup is missing or changed.');
  const archive = json(disk);
  if (archive.schema !== 1 || archive.backupId !== backupId) fail('RECOVERY_REQUIRED', 'Invalid personality backup.');
  validRecords(archive.files);
  const files = [], observations = [];
  for (const file of archive.files) {
    const current = read(file.path); observations.push([file.path, current]);
    if (!same(current, file.after) && !same(current, file.before)) fail('CONFLICT', 'A personality file changed after this backup; restore preserves it.');
    if (!same(current, file.before)) files.push({ path: file.path, before: current, after: file.before });
  }
  return { files, view: { operation: 'restore', backupId, files: files.map(summary), changed: files.length,
    notebookChanged: false, activeSession: 'not-observed',
    previewToken: sha(JSON.stringify({ backupId, checksum: checksum.text, observations, files })) } };
}

async function prepare(operation, selected) {
  noJournal();
  const stateDisk = read(P.state), beforeState = state(stateDisk);
  const entries = await readMemory(GLOBAL_KEY), compiled = compilePersona(entries);
  if (compiled.persona.includes('<!-- START MEMORY') || compiled.persona.includes('<!-- END MEMORY'))
    fail('UNSUPPORTED', 'Directive text contains reserved managed markers.');
  const clients = selected || (operation === 'migrate' ? Object.keys(names) : beforeState.clients);
  if (operation === 'sync' && clients.some(id => !beforeState.clients.includes(id))) fail('INVALID', 'Migrate the selected client before syncing its personality.');
  const next = structuredClone(beforeState);
  next.knownClients = [...new Set([...(beforeState.knownClients || beforeState.clients), ...clients])];
  next.clients = operation === 'disable' ? next.clients.filter(id => !clients.includes(id))
    : [...new Set([...next.clients, ...clients])];
  const observations = new Map([[P.state, stateDisk]]), proposals = new Map(), modes = [];
  const observe = file => { if (!observations.has(file)) observations.set(file, read(file)); return observations.get(file); };
  const add = (file, text, exists = true, owned = false) => {
    const before = observe(file), owner = next.owned[file];
    if (owned && before.exists && (!owner || owner.hash !== before.hash)) fail('CONFLICT', 'A generated personality file is foreign or modified; it is preserved.');
    if (Buffer.byteLength(text) > 512 * 1024) fail('UNSUPPORTED', 'Personality projection exceeds 512 KiB.');
    proposals.set(file, { path: file, before, after: { exists, text: exists ? text : '' } });
    if (owned && exists) next.owned[file] = { hash: sha(text), existedBefore: owner?.existedBefore ?? before.exists };
    else if (owned) delete next.owned[file];
  };
  const block = operation === 'disable' ? '' : buildPersonaOverlayBlock(entries);
  if (clients.includes('codex')) {
    add(P.codex, managed(observe(P.codex).text, block), observe(P.codex).exists || Boolean(block));
    modes.push({ client: 'codex', mode: 'global-instructions' });
  }
  if (clients.includes('claude')) {
    const settingsDisk = observe(P.claudeSettings), settings = json(settingsDisk);
    const originalSettings = JSON.stringify(settings);
    if (operation === 'disable') {
      if (settings.outputStyle === 'memory-persona' && next.claudeSelection) {
        if (next.claudeSelection.hadValue) settings.outputStyle = next.claudeSelection.value;
        else delete settings.outputStyle;
      }
      delete next.claudeSelection;
      if (next.owned[P.claudeStyle]) add(P.claudeStyle, '', false, true);
      add(P.claude, managed(observe(P.claude).text, ''), observe(P.claude).exists);
      modes.push({ client: 'claude', mode: 'disabled' });
    } else {
      const selectedStyle = settings.outputStyle;
      const activate = selectedStyle === undefined || selectedStyle === 'default' || selectedStyle === 'Default' || selectedStyle === 'memory-persona';
      if (activate && compiled.persona) {
        if (!next.claudeSelection) next.claudeSelection = { hadValue: Object.hasOwn(settings, 'outputStyle'),
          ...(Object.hasOwn(settings, 'outputStyle') ? { value: settings.outputStyle } : {}) };
        settings.outputStyle = 'memory-persona';
        add(P.claudeStyle, renderClaudePersona(compiled.persona), true, true);
        add(P.claude, managed(observe(P.claude).text, ''), observe(P.claude).exists);
        modes.push({ client: 'claude', mode: 'output-style' });
      } else {
        // Keep a user's chosen style and append the same field as persistent guidance.
        if (!compiled.persona && settings.outputStyle === 'memory-persona' && next.claudeSelection) {
          if (next.claudeSelection.hadValue) settings.outputStyle = next.claudeSelection.value;
          else delete settings.outputStyle;
          delete next.claudeSelection;
        }
        if (next.owned[P.claudeStyle]) add(P.claudeStyle, '', false, true);
        add(P.claude, managed(observe(P.claude).text, block), observe(P.claude).exists || Boolean(block));
        modes.push({ client: 'claude', mode: 'global-instructions', preservedUserStyle: selectedStyle !== undefined && selectedStyle !== 'memory-persona' });
      }
    }
    if (JSON.stringify(settings) !== originalSettings) add(P.claudeSettings,
      (settingsDisk.text.startsWith('\uFEFF') ? '\uFEFF' : '') + JSON.stringify(settings, null, 2) + '\n');
  }
  if (clients.some(id => ['gemini', 'antigravity'].includes(id))) {
    // Both discover this global file. Emit the personality once.
    const remainsEnabled = next.clients.some(id => ['gemini', 'antigravity'].includes(id));
    add(P.gemini, managed(observe(P.gemini).text, remainsEnabled ? buildPersonaOverlayBlock(entries) : ''),
      observe(P.gemini).exists || Boolean(remainsEnabled && compiled.persona));
    if (clients.includes('antigravity')) add(P.antigravity, managed(observe(P.antigravity).text, ''), observe(P.antigravity).exists);
    for (const client of clients.filter(id => ['gemini', 'antigravity'].includes(id))) modes.push({ client, mode: 'shared-global-instructions' });
  }
  if (clients.includes('opencode')) modes.push({ client: 'opencode', mode: 'native-context' });
  if (operation !== 'disable') {
    // Refresh only existing memory-prompt blocks, never add registrations or prompts.
    // This also makes the startup exclusion policy match the shared active builder.
    const promptFiles = [P.prompt, ...clients.map(id => P[id]).filter(Boolean)];
    for (const file of new Set(promptFiles)) {
      const current = proposals.get(file)?.after || observe(file);
      if (!current.text.includes(START_MARKER)) continue;
      if (current.text.split(START_MARKER).length !== 2 || current.text.split(END_MARKER).length !== 2)
        fail('UNSUPPORTED', 'Repair ambiguous memory prompt markers before personality migration.');
      const existingBlock = current.text.slice(current.text.indexOf(START_MARKER) + START_MARKER.length, current.text.indexOf(END_MARKER)).trim();
      // Keep imports in Claude/Gemini; update their shared source separately.
      if (existingBlock.startsWith('@')) continue;
      add(file, upsertPromptBlock(current.text), current.exists);
    }
    const ownershipDisk = observe(P.promptState), ownership = json(ownershipDisk);
    for (const [file, proposal] of proposals) if ([P.codex, P.claude, P.gemini, P.antigravity].includes(file) && ownership[file]) {
      const previous = ownership[file];
      if (!/^[a-f0-9]{64}$/.test(previous.hash || '') || typeof previous.existedBefore !== 'boolean')
        fail('RECOVERY_REQUIRED', 'Invalid legacy prompt ownership record.');
      ownership[file] = { ...previous, hash: sha(proposal.after.text) };
    }
    if (ownershipDisk.exists && JSON.stringify(ownership) !== JSON.stringify(json(ownershipDisk)))
      add(P.promptState, JSON.stringify(ownership, null, 2) + '\n');
  }
  const field = next.clients.length ? `${PERSONA_INSTRUCTION}\n\n${compiled.persona}\n` : '';
  add(P.field, field, next.clients.length > 0, true);
  add(P.state, JSON.stringify(next, null, 2) + '\n');
  const files = [...proposals.values()].filter(file => !same(file.before, file.after));
  const sourceVersion = notebookVersion(entries);
  const token = sha(JSON.stringify({ operation, clients, sourceVersion, observations: [...observations], files, next }));
  return { files, observations, entries, next, view: { operation, clients, persona: compiled.persona,
    directiveCount: compiled.active.length, sourceIds: compiled.sourceIds, excluded: compiled.excluded,
    sourceVersion, fieldPath: P.field, modes, files: files.map(summary), changed: files.length,
    previewToken: token, notebookChanged: false, activeSession: 'not-observed' } };
}
function publish(file, value) {
  safe(file);
  if (value.exists && !fs.existsSync(file)) {
    const staged = `${file}.${randomUUID()}.persona`;
    try {
      atomicWrite(staged, value.text, { renameRetries: 10, mode: 0o600 });
      safe(file); fs.linkSync(staged, file); // Creation must not clobber a concurrent file.
    } finally { if (fs.existsSync(staged)) fs.unlinkSync(staged); }
  } else if (value.exists) atomicWrite(file, value.text, { renameRetries: 10, mode: 0o600 });
  else if (fs.existsSync(file)) fs.unlinkSync(file);
}
function validRecords(records) {
  if (!Array.isArray(records) || !records.length || records.length > allowed.size) fail('RECOVERY_REQUIRED', 'Invalid personality recovery records.');
  const seen = new Set();
  for (const file of records) {
    if (!allowed.has(file.path) || file.path === P.journal || seen.has(file.path)) fail('RECOVERY_REQUIRED', 'Unexpected personality recovery path.');
    seen.add(file.path);
    for (const key of ['before', 'after']) if (!file[key] || typeof file[key].exists !== 'boolean'
      || typeof file[key].text !== 'string' || Buffer.byteLength(file[key].text) > 512 * 1024
      || !file[key].exists && file[key].text !== '') fail('RECOVERY_REQUIRED', 'Invalid personality recovery state.');
  }
}
function recover() {
  const disk = read(P.journal, 8 * 1024 * 1024);
  if (!disk.exists) return { status: 'up_to_date' };
  const record = json(disk); validRecords(record.files);
  if (!['pending', 'committed'].includes(record.phase)) fail('RECOVERY_REQUIRED', 'Invalid personality journal phase.');
  for (const file of record.files) {
    const current = read(file.path);
    if (!(record.phase === 'committed' ? same(current, file.after) : same(current, file.before) || same(current, file.after)))
      fail('CONFLICT', 'A personality file changed after interruption; recovery preserves it.');
  }
  if (record.phase === 'pending') for (const file of [...record.files].reverse()) publish(file.path, file.before);
  fs.unlinkSync(P.journal);
  return { status: record.phase === 'pending' ? 'rolled_back' : 'committed' };
}
function commit(files) {
  if (!files.length) return null;
  const backupId = randomUUID(), backup = path.join(paths.promptBackupDir, `persona-${backupId}.json`);
  safe(backup);
  const journal = { schema: 1, phase: 'pending', backupId, files };
  atomicWrite(backup, JSON.stringify(journal) + '\n', { renameRetries: 10, mode: 0o600 });
  const verified = json(read(backup, 8 * 1024 * 1024));
  if (JSON.stringify(verified) !== JSON.stringify(journal)) fail('RECOVERY_REQUIRED', 'Personality backup verification failed.');
  atomicWrite(`${backup}.sha256`, sha(read(backup, 8 * 1024 * 1024).text) + '\n', { mode: 0o600 });
  atomicWrite(P.journal, JSON.stringify(journal) + '\n', { renameRetries: 10, mode: 0o600 });
  try {
    for (const file of files) {
      if (!same(read(file.path), file.before)) fail('CONFLICT', 'A personality file changed during publication.');
      publish(file.path, file.after);
    }
    journal.phase = 'committed';
    atomicWrite(P.journal, JSON.stringify(journal) + '\n', { renameRetries: 10, mode: 0o600 });
    fs.unlinkSync(P.journal);
    return { backupId, backup };
  } catch (error) {
    try { recover(); } catch { fail('RECOVERY_REQUIRED', 'Personality publication was interrupted; recover before retrying.'); }
    throw error;
  }
}

export async function personaDeliveryRequest(input = {}) {
  const fields = { status: ['action'], preview: ['action', 'operation', 'clients', 'backupId'],
    apply: ['action', 'operation', 'clients', 'backupId', 'previewToken', 'confirm'], recover: ['action', 'confirm'] };
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(fields, input.action)
    || Object.keys(input).some(key => !fields[input.action].includes(key))) fail('INVALID', 'Unknown personality request.');
  if (Object.hasOwn(input, 'clients') && (!Array.isArray(input.clients) || !input.clients.length || new Set(input.clients).size !== input.clients.length
    || input.clients.some(id => !Object.hasOwn(names, id)))) fail('INVALID', 'Select exact supported personality clients.');
  if (input.action === 'status') {
    const current = state();
    return { enabled: current.clients.length > 0, clients: current.clients, fieldPath: P.field,
      recoveryRequired: read(P.journal, 8 * 1024 * 1024).exists, activeSession: 'not-observed' };
  }
  if (input.action === 'recover') {
    if (input.confirm !== true) fail('CONFIRMATION', 'Confirm personality journal recovery.');
    return withSnapshotLock(MEMORY_DIR, () => withSnapshotLock(paths.agentConfigDir, recover));
  }
  if (!['migrate', 'sync', 'disable', 'restore'].includes(input.operation)) fail('INVALID', 'Select migrate, sync, disable or restore.');
  if (input.operation === 'disable' && (!input.clients || input.clients.includes('opencode')))
    fail('UNSUPPORTED', 'Select a managed-file client. OpenCode uses native context; disable Notebook directives or remove its plugin.');
  if (input.operation !== 'restore' && input.backupId || input.operation === 'restore' && input.clients) fail('INVALID', 'Backup ID belongs only to restore.');
  const preparedOperation = () => input.operation === 'restore' ? prepareRestore(input.backupId) : prepare(input.operation, input.clients);
  if (input.action === 'preview') return (await preparedOperation()).view;
  if (input.confirm !== true || !/^[a-f0-9]{64}$/.test(input.previewToken || '')) fail('CONFIRMATION', 'Confirm a fresh personality preview.');
  return withSnapshotLock(MEMORY_DIR, () => withSnapshotLock(paths.agentConfigDir, async () => {
    const prepared = await preparedOperation();
    if (prepared.view.previewToken !== input.previewToken) fail('CONFLICT', 'Notebook, client files or personality ownership changed; refresh the preview.');
    const backup = commit(prepared.files);
    return { ...prepared.view, status: backup ? 'saved' : 'up_to_date', ...backup };
  }));
}

// Removal participates in the existing uninstall preview/backup/CAS transaction.
export async function prepareNativePersonaRemoval(client) {
  if (!isNativePersonaEnabled(client)) return { files: [] };
  return { files: (await prepare('disable', [client])).files };
}

export async function syncNativePersona(targetNames = null) {
  if (targetNames !== null && (!Array.isArray(targetNames) || targetNames.some(name => !Object.values(names).includes(name)))) fail('INVALID', 'Unknown personality target.');
  const current = state();
  const clients = current.clients.filter(id => !targetNames || targetNames.includes(names[id]));
  if (!clients.length) return [];
  const input = { operation: 'sync', clients };
  const preview = await personaDeliveryRequest({ action: 'preview', ...input });
  const result = await personaDeliveryRequest({ action: 'apply', ...input, previewToken: preview.previewToken, confirm: true });
  return result.modes.map(item => ({ name: names[item.client], filePath: item.client === 'claude' && item.mode === 'output-style' ? P.claudeStyle : P[item.client] || P.field,
    status: result.status === 'saved' ? 'synced' : 'up_to_date', mode: item.mode, activeSession: 'not-observed' }));
}

export async function initializeNativePersona(targetNames = null) {
  const clients = Object.keys(names).filter(id => !targetNames || targetNames.includes(names[id]));
  if (!clients.length) return [];
  const current = state(), known = current.knownClients || current.clients;
  const missing = clients.filter(id => !known.includes(id));
  if (!missing.length) return syncNativePersona(targetNames);
  const input = { operation: 'migrate', clients: missing };
  const preview = await personaDeliveryRequest({ action: 'preview', ...input });
  const result = await personaDeliveryRequest({ action: 'apply', ...input, previewToken: preview.previewToken, confirm: true });
  const initialized = result.modes.map(item => ({ name: names[item.client], status: result.status, mode: item.mode }));
  const synced = await syncNativePersona(targetNames);
  return [...initialized, ...synced.filter(item => !initialized.some(created => created.name === item.name))];
}

// The legacy uninstall command has already reviewed its fixed client flags.
// Keep marketplace personality while removing only a duplicate direct integration.
export async function removeNativePersonaForUninstall(clients, { dryRun = false } = {}) {
  if (!Array.isArray(clients) || clients.some(id => !Object.hasOwn(names, id))) fail('INVALID', 'Unknown personality uninstall client.');
  if (!isNativePersonaEnabled()) return { status: 'up_to_date', changed: 0, files: [] };
  return withSnapshotLock(MEMORY_DIR, () => withSnapshotLock(paths.agentConfigDir, async () => {
    const { integrationStatus } = await import('../plugin_integration.js');
    const selected = [];
    for (const client of clients) {
      if (['codex', 'claude'].includes(client) && (await integrationStatus(client)).pluginEnabled) continue;
      if (isNativePersonaEnabled(client)) selected.push(client);
    }
    if (!selected.length) return { status: 'up_to_date', changed: 0, files: [] };
    const prepared = await prepare('disable', selected);
    if (dryRun) return { ...prepared.view, persona: undefined, status: 'preview' };
    const backup = commit(prepared.files);
    return { ...prepared.view, persona: undefined, status: backup ? 'saved' : 'up_to_date', ...backup };
  }));
}
