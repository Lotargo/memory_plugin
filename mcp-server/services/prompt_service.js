// Fixed client targets only. Preview is read-only; all adapters publish here.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { resolveClientPaths } from '../client_paths.js';
import { integrationStatus } from '../plugin_integration.js';
import { START_MARKER, END_MARKER, PERSONA_START_MARKER, PERSONA_END_MARKER,
  PROMPT_BLOCK, getGlobalPromptTargets, buildIncludeBlock, buildPersonaOverlayBlock } from '../prompt_manager.js';
import { atomicWrite, withSnapshotLock } from '../storage/snapshot_lock.js';
import { readMemory, MEMORY_DIR, GLOBAL_KEY } from '../memory.js';
import { isNativePersonaEnabled, PERSONA_DELIVERY_PATHS } from './persona_delivery_service.js';

const paths = resolveClientPaths();
const journalPath = path.join(paths.agentConfigDir, 'prompt-journal.json');
const ids = { 'Antigravity': 'antigravity', 'Gemini CLI': 'gemini', 'Codex': 'codex', 'Claude Code': 'claude' };
const targets = getGlobalPromptTargets().map(target => ({ ...target, id: ids[target.name] }));
const hash = text => createHash('sha256').update(text).digest('hex');
const fault = (code, message) => Object.assign(new Error(message), { code });
const allowedPaths = new Set([...targets.map(item => item.filePath), paths.promptFile, paths.promptStateFile]);

function safePath(file) {
  // Do not follow user-created links/junctions outside the fixed client targets.
  for (let current = file; ; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw fault('UNSUPPORTED', 'Linked client files or parent directories cannot be managed.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
}
function read(file) {
  safePath(file);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > (file === journalPath ? 4 * 1024 * 1024 : 512 * 1024)) throw fault('UNSUPPORTED', 'Expected a regular UTF-8 client file up to 512 KiB.');
    const bytes = fs.readFileSync(file);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw fault('UNSUPPORTED', 'Client file is not valid UTF-8.'); }
    return { exists: true, text, hash: hash(text) };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, text: '', hash: null };
    if (error.code) throw error;
    throw fault('UNAVAILABLE', 'Cannot read the client file.');
  }
}
function stateOf(file) {
  let value;
  try { value = file.exists ? JSON.parse(file.text) : {}; } catch { throw fault('RECOVERY_REQUIRED', 'Prompt ownership state is invalid; inspect it before writing.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fault('RECOVERY_REQUIRED', 'Invalid prompt ownership state.');
  for (const target of targets) {
    const item = value[target.filePath];
    if (item !== undefined && (!item || typeof item !== 'object' || !/^[a-f0-9]{64}$/.test(item.hash) || typeof item.existedBefore !== 'boolean'))
      throw fault('RECOVERY_REQUIRED', 'Invalid client file ownership record.');
  }
  return value;
}
const markerKinds = [
  { kind: 'prompt', start: START_MARKER, end: END_MARKER },
  { kind: 'persona', start: PERSONA_START_MARKER, end: PERSONA_END_MARKER },
];
function blocks(text) {
  const tokens = [];
  for (const item of markerKinds) for (const [type, marker] of [['start', item.start], ['end', item.end]]) {
    let at = -1;
    while ((at = text.indexOf(marker, at + 1)) !== -1) tokens.push({ at, marker, kind: item.kind, type });
  }
  tokens.sort((a, b) => a.at - b.at);
  const spans = []; let active = null;
  for (const token of tokens) {
    if (token.type === 'start' && !active) active = token;
    else if (token.type === 'end' && active?.kind === token.kind) {
      spans.push({ kind: active.kind, start: active.at, end: token.at + token.marker.length }); active = null;
    } else throw fault('UNSUPPORTED', 'Managed markers are incomplete or nested. Repair them before synchronizing.');
  }
  if (active) throw fault('UNSUPPORTED', 'Managed markers are incomplete. Repair them before synchronizing.');
  return spans;
}
function replaceBlock(text, kind, replacement) {
  const spans = blocks(text).filter(item => item.kind === kind);
  if (!spans.length) return replacement ? `${text}${text ? '\n\n' : ''}${replacement}\n` : text;
  let result = '', from = 0;
  for (const [i, span] of spans.entries()) { result += text.slice(from, span.start) + (i === 0 ? replacement : ''); from = span.end; }
  return result + text.slice(from);
}
async function channel(target) {
  if (!['codex', 'claude'].includes(target.id)) return { pluginManaged: false, mode: 'managed-file', conflict: false };
  const status = await integrationStatus(target.id);
  return { pluginManaged: status.pluginEnabled, mode: status.mode, conflict: status.conflict,
    direct: status.direct, foreignDirect: status.foreignDirect, projectDirect: status.projectDirect };
}
function ensureNoJournal() {
  safePath(journalPath);
  if (fs.existsSync(journalPath)) throw fault('RECOVERY_REQUIRED', 'An interrupted prompt operation requires recovery before another preview.');
  safePath(PERSONA_DELIVERY_PATHS.journal);
  if (fs.existsSync(PERSONA_DELIVERY_PATHS.journal)) throw fault('RECOVERY_REQUIRED', 'An interrupted personality operation requires memory-cli persona recover --confirm.');
}
async function snapshot(target, entries) {
  const current = read(target.filePath), shared = read(paths.promptFile), stateFile = read(paths.promptStateFile);
  const state = stateOf(stateFile), integration = await channel(target);
  const persona = buildPersonaOverlayBlock(entries);
  // Directives containing management delimiters must never become file controls.
  if (persona && (blocks(persona).length !== 1 || blocks(persona)[0].kind !== 'persona')) throw fault('UNSUPPORTED', 'Directive text contains reserved managed markers.');
  const spans = blocks(current.text), owner = state[target.filePath];
  return { current, shared, stateFile, state, integration, persona, spans, owner,
    nativePersona: isNativePersonaEnabled() };
}
function plan(target, operation, snap) {
  let text = snap.current.text;
  const prompt = target.includeSupported ? buildIncludeBlock(paths.promptFile) : PROMPT_BLOCK;
  if (operation === 'enable') text = replaceBlock(text, 'prompt', prompt);
  if (operation === 'disable') text = replaceBlock(text, 'prompt', '');
  if (snap.nativePersona) {
    // Personality has its own lifecycle. Memory-prompt operations must not reintroduce
    // old Claude/Antigravity overlays or disable native Codex/Gemini personality.
    if (!['codex', 'gemini'].includes(target.id)) text = replaceBlock(text, 'persona', '');
  } else text = replaceBlock(text, 'persona', operation === 'disable' ? '' : snap.persona);
  blocks(text);
  if (Buffer.byteLength(text, 'utf8') > 512 * 1024) throw fault('UNSUPPORTED', 'The proposed client file exceeds 512 KiB.');
  // Only delete an unmodified file we originally created. Unknown ownership is
  // never permission to remove a file, even if it contains only managed blocks.
  const removeFile = operation === 'disable' && snap.current.exists && !text.trim()
    && snap.owner?.existedBefore === false && snap.owner.hash === snap.current.hash;
  const exists = removeFile ? false : snap.current.exists || Boolean(text);
  const sharedText = operation === 'enable' && target.includeSupported ? `${PROMPT_BLOCK}\n` : snap.shared.text;
  const sharedExists = operation === 'enable' && target.includeSupported || snap.shared.exists;
  const changed = exists !== snap.current.exists || text !== snap.current.text || sharedExists !== snap.shared.exists || sharedText !== snap.shared.text
    || operation === 'disable' && Boolean(snap.owner);
  return { text: removeFile ? '' : text, exists, removeFile, prompt, sharedText, sharedExists, changed };
}
function version(target, operation, snap, proposal, entries) {
  return hash(JSON.stringify({ target: target.id, operation, current: snap.current, shared: snap.shared,
    state: snap.stateFile, integration: snap.integration, nativePersona: snap.nativePersona, entries, proposal }));
}
async function preview(target, operation, entries) {
  ensureNoJournal();
  const snap = await snapshot(target, entries), proposal = plan(target, operation, snap);
  const own = snap.owner ? snap.owner.hash === snap.current.hash ? 'unchanged-owned' : 'externally-edited' : 'untracked';
  return { target, operation, observedAt: new Date().toISOString(), scope: GLOBAL_KEY,
    activeSession: 'not-observed', agentUsage: 'not-observed', integration: snap.integration,
    ownership: own, existedBefore: snap.owner?.existedBefore ?? null,
    prompt: { present: snap.spans.some(item => item.kind === 'prompt'), expectedBlock: proposal.prompt },
    persona: { present: snap.spans.some(item => item.kind === 'persona'), expectedBlock: snap.persona },
    current: snap.current, proposed: snap.integration.pluginManaged ? { exists: snap.current.exists, text: snap.current.text, removeFile: false }
      : { exists: proposal.exists, text: proposal.text, removeFile: proposal.removeFile },
    sharedPrompt: { path: paths.promptFile, ...snap.shared, proposedText: snap.integration.pluginManaged ? snap.shared.text : proposal.sharedText,
      changes: !snap.integration.pluginManaged && (proposal.sharedText !== snap.shared.text || proposal.sharedExists !== snap.shared.exists) },
    changed: !snap.integration.pluginManaged && proposal.changed,
    canApply: !snap.integration.pluginManaged, previewToken: version(target, operation, snap, proposal, entries) };
}
function same(a, b) { return a.exists === b.exists && (!a.exists || a.text === b.text); }
// Internal removal plan for the reviewed integration service. It uses the same
// marker/ownership rules as A3, without publishing or exposing file contents.
export async function preparePromptRemoval(client) {
  const target = targets.find(item => item.id === client);
  if (!target) return { files: [], pluginManaged: false };
  ensureNoJournal();
  const snap = await snapshot(target, []), proposal = plan(target, 'disable', snap);
  if (snap.integration.pluginManaged) return { files: [], pluginManaged: true };
  const files = [];
  const add = (file, before, after) => {
    if (!same(before, after)) files.push({ path: file, before, after });
  };
  add(target.filePath, snap.current, { exists: proposal.exists, text: proposal.text });
  if (snap.owner) {
    const state = { ...snap.state }; delete state[target.filePath];
    add(paths.promptStateFile, snap.stateFile, { exists: true, text: JSON.stringify(state, null, 2) + '\n' });
  }
  return { files, pluginManaged: false };
}
function publish(file, value) {
  safePath(file);
  if (value.exists) atomicWrite(file, value.text, { renameRetries: 10 });
  else if (fs.existsSync(file)) fs.unlinkSync(file);
}
function recovery() {
  const disk = read(journalPath);
  if (!disk.exists) return { recovered: false };
  let journal;
  try { journal = JSON.parse(disk.text); } catch { throw fault('RECOVERY_REQUIRED', 'Invalid prompt journal.'); }
  if (!journal || !['pending', 'committed'].includes(journal.phase) || !Array.isArray(journal.files) || !journal.files.length || journal.files.length > 3)
    throw fault('RECOVERY_REQUIRED', 'Invalid prompt journal.');
  const seen = new Set();
  for (const record of journal.files) {
    if (!allowedPaths.has(record.path) || seen.has(record.path)) throw fault('RECOVERY_REQUIRED', 'Unexpected prompt recovery target.');
    seen.add(record.path);
    for (const key of ['before', 'after']) if (!record[key] || typeof record[key].exists !== 'boolean' || typeof record[key].text !== 'string')
      throw fault('RECOVERY_REQUIRED', 'Invalid prompt recovery content.');
    const now = read(record.path);
    if (!(journal.phase === 'committed' ? same(now, record.after) : same(now, record.before) || same(now, record.after)))
      throw fault('RECOVERY_REQUIRED', 'A client file changed after interruption; automatic recovery cannot overwrite it.');
  }
  if (journal.phase === 'pending') for (const record of [...journal.files].reverse()) publish(record.path, record.before);
  fs.unlinkSync(journalPath);
  return { recovered: true, disposition: journal.phase === 'pending' ? 'rolled-back' : 'committed' };
}
function commit(files) {
  const journal = { phase: 'pending', files };
  const backup = path.join(paths.promptBackupDir, `prompt-${randomUUID()}.json`);
  // A durable local backup precedes every changed file, including disable.
  atomicWrite(backup, JSON.stringify(journal, null, 2) + '\n', { renameRetries: 10 });
  atomicWrite(journalPath, JSON.stringify(journal) + '\n', { renameRetries: 10 });
  try {
    for (const record of files) {
      if (!same(read(record.path), record.before)) throw fault('CONFLICT', 'Client file changed during publication.');
      publish(record.path, record.after);
    }
    journal.phase = 'committed';
    atomicWrite(journalPath, JSON.stringify(journal) + '\n', { renameRetries: 10 });
    fs.unlinkSync(journalPath);
    return backup;
  } catch (error) {
    try { recovery(); } catch { throw fault('RECOVERY_REQUIRED', 'Prompt publication was interrupted. Review client files and the retained journal before retrying.'); }
    throw error;
  }
}
async function apply(target, operation, entries, token, migration = false) {
  ensureNoJournal();
  const snap = await snapshot(target, entries), proposal = plan(target, operation, snap);
  if (token !== version(target, operation, snap, proposal, entries)) throw fault('CONFLICT', 'File, ownership, client integration or global directives changed. Refresh the preview.');
  if (snap.integration.pluginManaged && !migration) return { name: target.name, filePath: target.filePath, status: 'plugin_managed', activeSession: 'not-observed' };
  if (!proposal.changed) return { name: target.name, filePath: target.filePath, status: 'up_to_date', activeSession: 'not-observed' };
  const state = { ...snap.state };
  if (operation === 'disable') delete state[target.filePath];
  else state[target.filePath] = { hash: hash(proposal.text), existedBefore: snap.owner?.existedBefore ?? snap.current.exists };
  if (Buffer.byteLength(JSON.stringify(state), 'utf8') > 512 * 1024) throw fault('UNSUPPORTED', 'Prompt ownership state exceeds the supported size.');
  const files = [];
  const add = (file, before, after) => { if (!same(before, after)) files.push({ path: file, before: { exists: before.exists, text: before.text }, after }); };
  add(paths.promptFile, snap.shared, { exists: Boolean(proposal.sharedExists), text: proposal.sharedText });
  add(target.filePath, snap.current, { exists: proposal.exists, text: proposal.text });
  add(paths.promptStateFile, snap.stateFile, { exists: true, text: JSON.stringify(state, null, 2) + '\n' });
  // No await between final checks and atomic publication; cooperating writers use
  // the same lock. External writers are checked again per file in commit().
  const fresh = await snapshot(target, entries);
  if (version(target, operation, fresh, plan(target, operation, fresh), entries) !== token) throw fault('CONFLICT', 'Client state changed. Refresh the preview.');
  const backup = commit(files);
  return { name: target.name, filePath: target.filePath, status: proposal.removeFile ? 'deleted_new_file'
    : operation === 'disable' ? 'removed' : operation === 'enable' ? snap.current.exists ? 'enabled' : 'created_new_file' : snap.persona ? 'synced' : 'removed',
    backup, hash: proposal.exists ? hash(proposal.text) : null, activeSession: 'not-observed' };
}

export async function promptRequest(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fault('INVALID', 'Object required.');
  const allowed = { status: ['action'], preview: ['action', 'client', 'operation'], apply: ['action', 'client', 'operation', 'previewToken', 'confirm'], recover: ['action', 'confirm'] };
  if (!allowed[input.action] || Object.keys(input).some(key => !allowed[input.action].includes(key))) throw fault('INVALID', 'Unknown prompt field or action.');
  if (input.action === 'recover') {
    if (input.confirm !== true) throw fault('CONFIRMATION', 'Confirm recovery of the interrupted prompt operation.');
    return withSnapshotLock(MEMORY_DIR, () => withSnapshotLock(paths.agentConfigDir, () => recovery()));
  }
  if (input.action === 'status') {
    const items = [];
    for (const target of targets) try {
      const current = read(target.filePath), spans = blocks(current.text), integration = await channel(target);
      const state = stateOf(read(paths.promptStateFile)), own = state[target.filePath];
      items.push({ ...target, exists: current.exists, hash: current.hash, prompt: spans.some(item => item.kind === 'prompt'),
        persona: spans.some(item => item.kind === 'persona'), integration,
        ownership: own ? own.hash === current.hash ? 'unchanged-owned' : 'externally-edited' : 'untracked', activeSession: 'not-observed' });
    } catch (error) { items.push({ ...target, unavailable: true, code: ['UNSUPPORTED', 'RECOVERY_REQUIRED'].includes(error.code) ? error.code : 'UNAVAILABLE' }); }
    return { items, observedAt: new Date().toISOString(), activeSession: 'not-observed', recoveryRequired: fs.existsSync(journalPath),
      native: { id: 'opencode', name: 'OpenCode', channel: 'native-context', fileManaged: false, activeSession: 'not-observed' } };
  }
  const target = targets.find(item => item.id === input.client);
  if (!target || !['enable', 'disable', 'sync'].includes(input.operation)) throw fault('INVALID', 'Select an exact client and enable, disable or sync.');
  if (input.action === 'preview') return preview(target, input.operation, await readMemory(GLOBAL_KEY));
  if (input.confirm !== true || !/^[a-f0-9]{64}$/.test(input.previewToken || '')) throw fault('CONFIRMATION', 'Confirm a fresh file preview.');
  return withSnapshotLock(MEMORY_DIR, () => withSnapshotLock(paths.agentConfigDir,
    async () => apply(target, input.operation, await readMemory(GLOBAL_KEY), input.previewToken)));
}

// Setup, TUI/CLI and Notebook/MCP automatic sync keep their existing signatures.
// Each target gets its own result; one inaccessible file does not hide the rest.
export async function managePromptTargets(operation, names = null, suppliedEntries = null) {
  if (names !== null && (!Array.isArray(names) || names.some(name => !targets.some(item => item.name === name)))) throw fault('INVALID', 'Unknown client target.');
  return withSnapshotLock(MEMORY_DIR, () => withSnapshotLock(paths.agentConfigDir, async () => {
    const entries = suppliedEntries ?? await readMemory(GLOBAL_KEY), results = [];
    for (const target of targets.filter(item => !names || names.includes(item.name))) try {
      const view = await preview(target, operation, entries);
      results.push(await apply(target, operation, entries, view.previewToken));
    } catch (error) { results.push({ name: target.name, filePath: target.filePath, status: 'failed', code: error.code || 'UNAVAILABLE',
      error: ['UNSUPPORTED', 'CONFLICT', 'RECOVERY_REQUIRED'].includes(error.code) ? error.message : 'Client file operation failed; inspect the current state before retrying.' }); }
    return results;
  }));
}

export async function syncSharedPrompt() {
  return withSnapshotLock(MEMORY_DIR, () => withSnapshotLock(paths.agentConfigDir, () => {
    ensureNoJournal(); const before = read(paths.promptFile), after = { exists: true, text: `${PROMPT_BLOCK}\n` };
    if (!same(before, after)) commit([{ path: paths.promptFile, before: { exists: before.exists, text: before.text }, after }]);
    return paths.promptFile;
  }));
}

// Migration is an explicit channel switch, not a normal marketplace file action.
// Capture the old direct integration before native installation. The closure can
// remove only its unchanged, tracked file after the new plugin is enabled.
// No browser/CLI request field can opt out of marketplace ownership checks.
export async function preparePromptMigrationCleanup(client) {
  const target = targets.find(item => item.id === client && ['codex', 'claude'].includes(client));
  if (!target) throw fault('INVALID', 'Unsupported prompt migration client.');
  ensureNoJournal();
  const captured = await snapshot(target, await readMemory(GLOBAL_KEY));
  if (!captured.integration.direct || !captured.spans.length) return async () => ({ status: 'skipped' });
  if (!captured.owner || captured.owner.hash !== captured.current.hash)
    throw fault('CONFLICT', 'The old direct prompt file is untracked or modified. Review it before switching integration channels.');
  return () => withSnapshotLock(MEMORY_DIR, () => withSnapshotLock(paths.agentConfigDir, async () => {
    const entries = await readMemory(GLOBAL_KEY), fresh = await snapshot(target, entries);
    if (!fresh.integration.pluginManaged || !same(fresh.current, captured.current) || !same(fresh.stateFile, captured.stateFile))
      throw fault('CONFLICT', 'The direct prompt file or ownership changed during marketplace migration.');
    return apply(target, 'disable', entries, version(target, 'disable', fresh, plan(target, 'disable', fresh), entries), true);
  }));
}
