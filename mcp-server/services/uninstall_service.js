// Fixed client-file removal. No client CLI, package manager, cloud or models.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { resolveClientPaths } from '../client_paths.js';
import { isMemoryMcpServerEntry, isMemoryPluginEntry } from '../client_registration.js';
import { removeCodexMemoryAgentConfig } from '../codex_config.js';
import { integrationStatus } from '../plugin_integration.js';
import { getGlobalPromptTargets } from '../prompt_manager.js';
import { preparePromptRemoval } from './prompt_service.js';
import { atomicWrite, withSnapshotLock } from '../storage/snapshot_lock.js';
import { MEMORY_DIR } from '../memory.js';
import { PERSONA_DELIVERY_PATHS, prepareNativePersonaRemoval } from './persona_delivery_service.js';
import { stripPersonaOverlayBlock } from '../prompt_manager.js';

const paths = resolveClientPaths();
const root = path.join(MEMORY_DIR, 'uninstall');
const packagedSkill = fileURLToPath(new URL('../../skills/using-memory', import.meta.url));
const clients = { opencode: 'OpenCode', codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini CLI', antigravity: 'Antigravity' };
const sha = data => createHash('sha256').update(data).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LIMIT = 512 * 1024, ARCHIVE_LIMIT = 8 * 1024 * 1024;
const notice = 'Удаляются только принадлежащие плагину глобальные регистрации, managed-блоки и неизменённый skill выбранного клиента. Память, модели, облако, npm-пакет, cache, проекты и работающая панель сохраняются. Активная сессия может требовать перезапуска клиента.';

function safe(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) fail('UNSUPPORTED', 'Linked client files or parent directories cannot be managed.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
}
function read(file, limit = LIMIT) {
  safe(file);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > limit) fail('UNSUPPORTED', 'Expected a bounded regular client file.');
    const bytes = fs.readFileSync(file);
    if (bytes.length > limit) fail('UNSUPPORTED', 'Client file exceeds the supported size.');
    return { exists: true, data: bytes.toString('base64'), hash: sha(bytes), mode: stat.mode & 0o777 };
  } catch (error) { if (error.code === 'ENOENT') return { exists: false, data: '', hash: null, mode: null }; throw error; }
}
function text(state) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(state.data, 'base64')); }
  catch { fail('UNSUPPORTED', 'Client configuration must be valid UTF-8.'); }
}
function fromText(value, before) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > LIMIT) fail('UNSUPPORTED', 'Proposed client file exceeds the supported size.');
  return { exists: true, data: bytes.toString('base64'), hash: sha(bytes), mode: before.mode ?? 0o600 };
}
const absent = () => ({ exists: false, data: '', hash: null, mode: null });
const same = (a, b) => a.exists === b.exists && a.hash === b.hash && a.mode === b.mode;
function tree(directory, relative = '', list = [], budget = { bytes: 0 }) {
  safe(directory);
  if (!fs.existsSync(directory)) return list;
  if (!fs.statSync(directory).isDirectory()) fail('UNSUPPORTED', 'Skill target must be a regular directory.');
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    if (list.length >= 200) fail('UNSUPPORTED', 'Skill directory exceeds the supported inventory.');
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    const file = path.join(directory, entry.name); safe(file);
    if (entry.isDirectory()) { list.push({ name, directory: true }); tree(file, name, list, budget); }
    else if (entry.isFile()) {
      const state = read(file); budget.bytes += Buffer.from(state.data,'base64').length;
      if (budget.bytes > 2 * 1024 * 1024) fail('UNSUPPORTED', 'Skill files exceed the supported byte limit.');
      list.push({ name, state });
    }
    else fail('UNSUPPORTED', 'Special or linked skill files are preserved.');
  }
  return list;
}
function definition(client) {
  const config = { opencode: paths.opencodeConfigPath, codex: paths.codexConfigPath, claude: paths.claudeConfigPath,
    gemini: paths.geminiSettingsPath, antigravity: paths.antigravityMcpConfigPath }[client];
  const skill = path.join({ opencode: paths.opencodeDir, codex: paths.codexDir, claude: paths.claudeDir,
    gemini: paths.geminiDir, antigravity: paths.antigravityConfigDir }[client], 'skills', 'using-memory');
  const prompt = getGlobalPromptTargets().find(item => item.name === clients[client])?.filePath;
  return { config, skill, prompt };
}
function allowedFiles(client) {
  const target = definition(client), files = new Map([['config', target.config], ['prompt-state', paths.promptStateFile]]);
  if (target.prompt) files.set('prompt', target.prompt);
  files.set('persona-state', PERSONA_DELIVERY_PATHS.state);
  files.set('persona-field', PERSONA_DELIVERY_PATHS.field);
  if (client === 'claude') {
    files.set('persona-style', PERSONA_DELIVERY_PATHS.claudeStyle);
    files.set('persona-settings', PERSONA_DELIVERY_PATHS.claudeSettings);
  }
  if (client === 'antigravity') files.set('persona-shared-gemini', PERSONA_DELIVERY_PATHS.gemini);
  for (const entry of tree(packagedSkill)) if (!entry.directory) files.set(`skill:${entry.name}`, path.join(target.skill, entry.name));
  return files;
}
function receiptFile(id) { return path.join(root, `${id}.receipt.json`); }
function backupFile(id) { return path.join(root, `${id}.backup.json`); }
function savePrivate(file, value) {
  safe(file); safe(path.dirname(file));
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  atomicWrite(file, JSON.stringify(value) + '\n', { renameRetries: 10, mode: 0o600 });
}
function receipt(id) {
  if (!ID.test(id || '')) fail('INVALID', 'Exact operation ID required.');
  const state = read(receiptFile(id), ARCHIVE_LIMIT);
  if (!state.exists) fail('NOT_FOUND', 'Operation receipt not found.');
  let record; try { record = JSON.parse(text(state)); } catch { fail('RECOVERY_REQUIRED', 'Invalid uninstall receipt.'); }
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('RECOVERY_REQUIRED', 'Invalid uninstall receipt.');
  const keys = ['format','operationId','client','operation','backupId','backupChecksum','files','changed','completed','skipped','status','phase','observedAt','error'];
  if (Object.keys(record).some(key => !keys.includes(key)) || record.format !== 'memory-client-removal' || record.operationId !== id || !Object.hasOwn(clients, record.client)
    || !['uninstall','restore'].includes(record.operation) || !['running','interrupted','completed'].includes(record.phase)
    || !['pending','saved','partial','restored'].includes(record.status)
    || !ID.test(record.backupId || '') || !/^[a-f0-9]{64}$/.test(record.backupChecksum || '')
    || !Array.isArray(record.files) || record.files.length > 205 || record.files.some(item => !item || !allowedFiles(record.client).has(item.id)
      || item.path !== allowedFiles(record.client).get(item.id)
      || Object.keys(item).some(key => !['id','path','action','beforeHash','afterHash','beforeBytes','afterBytes'].includes(key)))
    || typeof record.observedAt !== 'string' || !Number.isInteger(record.completed) || !Array.isArray(record.skipped)
    || record.skipped.some(item => !item || Object.keys(item).some(key => !['component','reason'].includes(key)))
    || record.error && (record.error.code !== 'RECOVERY_REQUIRED' || record.error.message !== 'Операция прервана. Проверьте квитанцию и восстановите файлы по свежему предпросмотру.'))
    fail('RECOVERY_REQUIRED', 'Invalid uninstall receipt.');
  return record;
}
function history() {
  safe(root);
  if (!fs.existsSync(root)) return [];
  const names = fs.readdirSync(root).filter(name => name.endsWith('.receipt.json'));
  if (names.length > 1000) fail('UNSUPPORTED', 'Uninstall history exceeds the supported limit.');
  if (names.some(name => !ID.test(name.slice(0,-13)))) fail('RECOVERY_REQUIRED', 'Unexpected uninstall receipt file.');
  return names.map(name => receipt(name.slice(0, -13))).sort((a,b) => b.observedAt.localeCompare(a.observedAt));
}
function brief(record) {
  const { files, ...metadata } = record; return metadata;
}
function stateValid(state) {
  return state && typeof state.exists === 'boolean' && typeof state.data === 'string'
    && state.data.length <= Math.ceil(LIMIT/3)*4
    && (state.exists ? /^[a-f0-9]{64}$/.test(state.hash || '') && sha(Buffer.from(state.data, 'base64')) === state.hash
      && Number.isInteger(state.mode) && state.mode >= 0 && state.mode <= 0o777
      : state.data === '' && state.hash === null && state.mode === null);
}
function loadBackup(record) {
  const disk = read(backupFile(record.backupId), ARCHIVE_LIMIT);
  if (!disk.exists || disk.hash !== record.backupChecksum) fail('CONFLICT', 'Recovery backup is missing or changed.');
  let archive; try { archive = JSON.parse(text(disk)); } catch { fail('RECOVERY_REQUIRED', 'Invalid recovery backup.'); }
  const allowed = allowedFiles(record.client), seen = new Set();
  if (archive.format !== 'memory-client-backup' || archive.id !== record.backupId || archive.client !== record.client
    || !Array.isArray(archive.files) || archive.files.length > 205) fail('RECOVERY_REQUIRED', 'Invalid recovery backup.');
  for (const file of archive.files) {
    if (!allowed.has(file.id) || file.path !== allowed.get(file.id) || seen.has(file.id) || !stateValid(file.before) || !stateValid(file.after))
      fail('RECOVERY_REQUIRED', 'Invalid fixed recovery target.');
    seen.add(file.id);
  }
  if (sha(JSON.stringify(archive.files.map(summary))) !== sha(JSON.stringify(record.files))) fail('RECOVERY_REQUIRED', 'Backup does not match its receipt.');
  return archive;
}
function summary(file) {
  return { id: file.id, path: file.path, action: file.after.exists ? 'update' : 'remove',
    beforeHash: file.before.hash, afterHash: file.after.hash,
    beforeBytes: Buffer.from(file.before.data, 'base64').length, afterBytes: Buffer.from(file.after.data, 'base64').length };
}
async function channel(client) {
  if (!['codex','claude'].includes(client)) return { pluginEnabled: false, mode: client === 'opencode' ? 'native-config' : 'direct' };
  const directories = []; let git = false;
  for (let dir = path.resolve(paths.cwd); ; dir = path.dirname(dir)) {
    directories.push(dir);
    if (fs.existsSync(path.join(dir, '.git'))) { git = true; break; }
    if (path.dirname(dir) === dir) break;
  }
  const selected = git ? directories.reverse() : [path.resolve(paths.cwd)];
  const files = client === 'codex' ? [paths.codexConfigPath, ...selected.map(dir => path.join(dir,'.codex','config.toml'))]
    : [paths.claudeConfigPath, path.join(paths.claudeDir,'settings.json'), ...selected.flatMap(dir =>
      [path.join(dir,'.claude','settings.json'),path.join(dir,'.claude','settings.local.json'),path.join(dir,'.mcp.json')])];
  for (const file of files) read(file);
  try { return await integrationStatus(client); }
  catch (error) {
    if (['UNSUPPORTED','RECOVERY_REQUIRED'].includes(error.code)) throw error;
    fail('UNSUPPORTED', 'Client channel configuration cannot be safely interpreted.');
  }
}
async function prepare(input, rows) {
  const client = input.client, target = definition(client), allowed = allowedFiles(client);
  // Validate known channel files/ancestors before the existing channel reader.
  for (const file of [target.config, target.prompt, paths.promptStateFile, paths.promptFile,
    path.join(paths.claudeDir, 'settings.json')].filter(Boolean)) safe(file);
  const integration = await channel(client), files = [], skipped = [], observations = [];
  if (integration.pluginEnabled) skipped.push({ component: 'client', reason: 'marketplace-managed' });
  const add = (id, before, after) => {
    observations.push([id, before]);
    if (!same(before, after)) files.push({ id, path: allowed.get(id), before, after });
  };
  let source = null;
  if (input.operation === 'restore') {
    source = receipt(input.backupId);
    if (source.operation !== 'uninstall' || source.client !== client) fail('INVALID', 'Select an uninstall receipt belonging to this client.');
    const archive = loadBackup(source);
    for (const file of archive.files) {
      const current = read(file.path);
      if (!same(current, file.before) && !same(current, file.after)) fail('CONFLICT', 'A client file changed after removal. Recovery cannot overwrite it.');
      if (!integration.pluginEnabled) add(file.id, current, file.before);
    }
  } else if (!integration.pluginEnabled) {
    const configState = read(target.config); observations.push(['config', configState]);
    if (!configState.exists) skipped.push({ component: 'registration', reason: 'missing' });
    else if (client === 'codex') {
      const result = removeCodexMemoryAgentConfig(text(configState));
      if (result.changed) add('config', configState, fromText(result.content, configState));
      else skipped.push({ component: 'registration', reason: result.status === 'conflict' ? 'foreign-registration' : 'missing' });
    } else {
      const raw = text(configState); let config;
      try { config = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { fail('UNSUPPORTED', 'Client JSON configuration is invalid.'); }
      if (!config || Array.isArray(config) || typeof config !== 'object') fail('UNSUPPORTED', 'Client configuration must be a JSON object.');
      let changed = false;
      if (client === 'opencode') {
        for (const field of ['plugin','plugins']) if (Array.isArray(config[field])) {
          const filtered = config[field].filter(entry => !isMemoryPluginEntry(entry));
          if (filtered.length !== config[field].length) { changed = true; if (filtered.length) config[field] = filtered; else delete config[field]; }
        }
      }
      const entry = config.mcpServers?.['memory-agent'];
      if (entry && isMemoryMcpServerEntry(entry)) { delete config.mcpServers['memory-agent']; changed = true; }
      else if (entry) skipped.push({ component: 'registration', reason: 'foreign-registration' });
      if (changed) add('config', configState, fromText((raw.startsWith('\uFEFF') ? '\uFEFF' : '') + JSON.stringify(config, null, 2) + (raw.includes('\r\n') ? '\r\n' : '\n'), configState));
      else if (!entry) skipped.push({ component: 'registration', reason: 'missing' });
    }
    const skillTree = tree(target.skill), expected = tree(packagedSkill);
    observations.push(['skill', skillTree]);
    if (!skillTree.length) skipped.push({ component: 'skill', reason: 'missing' });
    else if (skillTree.length !== expected.length || skillTree.some((item,i) => item.name !== expected[i].name || item.directory !== expected[i].directory || item.state?.hash !== expected[i].state?.hash))
      skipped.push({ component: 'skill', reason: 'modified-or-foreign' });
    else for (const item of skillTree) if (!item.directory) add(`skill:${item.name}`, item.state, absent());
    const prompt = await preparePromptRemoval(client);
    for (const file of prompt.files) {
      const id = file.path === paths.promptStateFile ? 'prompt-state' : 'prompt', before = read(file.path);
      if (text(before) !== file.before.text || before.exists !== file.before.exists) fail('CONFLICT', 'Prompt changed during review.');
      add(id, before, file.after.exists ? fromText(file.after.text, before) : absent());
    }
    const personality = await prepareNativePersonaRemoval(client);
    for (const file of personality.files) {
      const id = [...allowed].find(([, filePath]) => filePath === file.path)?.[0];
      if (!id) fail('UNSUPPORTED', 'Unexpected native personality removal target.');
      const before = read(file.path);
      if (before.exists !== file.before.exists || text(before) !== file.before.text) fail('CONFLICT', 'Personality changed during review.');
      const existing = files.find(item => item.path === file.path);
      if (existing) {
        // The legacy operation removes the memory prompt, the native one removes
        // personality. Merge both edits rather than restoring either block.
        if (existing.after.exists) existing.after = fromText(stripPersonaOverlayBlock(text(existing.after)), before);
      } else add(id, before, file.after.exists ? fromText(file.after.text, before) : absent());
    }
    // Even a currently empty prompt/state participates in stale-preview checks.
    for (const file of [target.prompt, paths.promptStateFile].filter(Boolean)) observations.push([file, read(file)]);
  }
  const pending = rows.filter(item => item.phase !== 'completed');
  const blocked = input.operation === 'uninstall' && pending.length > 0;
  const view = { client, name: clients[client], operation: input.operation, backupId: input.backupId || null,
    scope: 'global-client-files', integration: { pluginEnabled: integration.pluginEnabled, mode: integration.mode },
    files: files.map(summary), skipped, changed: files.length, canApply: !integration.pluginEnabled && !blocked,
    recoveryRequired: blocked, notice, observedAt: new Date().toISOString(), activeSession: 'not-observed', localOnly: true };
  view.previewToken = sha(JSON.stringify({ client, operation: input.operation, backupId: input.backupId || null,
    checksum: source?.backupChecksum, files, skipped, observations, integration, rows: rows.map(brief) }));
  return { view, files, source };
}
function publish(file, state, before) {
  safe(file);
  if (state.exists) {
    if (before.exists) atomicWrite(file, Buffer.from(state.data, 'base64'), { renameRetries: 10, mode: state.mode });
    else {
      const staged = `${file}.${randomUUID()}.restore`;
      try {
        atomicWrite(staged, Buffer.from(state.data, 'base64'), { renameRetries: 10, mode: state.mode });
        safe(file); fs.linkSync(staged, file);
      } finally { if (fs.existsSync(staged)) fs.unlinkSync(staged); }
    }
  } else if (fs.existsSync(file)) fs.unlinkSync(file);
}
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID', 'Object required.');
  const fields = { status: ['action'], receipt: ['action','operationId'],
    preview: ['action','client','operation','backupId'], apply: ['action','client','operation','backupId','previewToken','confirm'] };
  if (!Object.hasOwn(fields, input.action) || Object.keys(input).some(key => !fields[input.action].includes(key))) fail('INVALID', 'Unknown uninstall action or field.');
  if (['preview','apply'].includes(input.action)) {
    if (!Object.hasOwn(clients, input.client) || !['uninstall','restore'].includes(input.operation)) fail('INVALID', 'Select a fixed client and operation.');
    if (input.operation === 'restore' ? !ID.test(input.backupId || '') : input.backupId !== undefined) fail('INVALID', 'A restore requires an exact uninstall receipt ID.');
  }
  if (input.action === 'apply' && (input.confirm !== true || !/^[a-f0-9]{64}$/.test(input.previewToken || ''))) fail('CONFIRMATION', 'Review and confirm a fresh uninstall preview.');
}
export async function uninstallRequest(input, { afterBackup, afterFile } = {}) {
  validate(input); safe(MEMORY_DIR); safe(paths.agentConfigDir);
  return withSnapshotLock(MEMORY_DIR, () => withSnapshotLock(paths.agentConfigDir, async () => {
    const rows = history();
    if (input.action === 'receipt') return receipt(input.operationId);
    if (input.action === 'status') {
      const items = [];
      for (const client of Object.keys(clients)) {
        try { items.push((await prepare({ client, operation: 'uninstall' }, rows)).view); }
        catch (error) { items.push({ client, name: clients[client], canApply: false, unavailable: true,
          error: { code: ['CONFLICT','UNSUPPORTED','RECOVERY_REQUIRED'].includes(error.code) ? error.code : 'UNAVAILABLE', message: 'Не удалось безопасно прочитать файлы клиента.' } }); }
      }
      return { items, receipts: rows.map(brief), recoveryRequired: rows.some(item => item.phase !== 'completed'), notice,
        localOnly: true, activeSession: 'not-observed', observedAt: new Date().toISOString() };
    }
    const prepared = await prepare(input, rows), { view, files, source } = prepared;
    if (input.action === 'preview') return view;
    if (input.previewToken !== view.previewToken) fail('CONFLICT', 'Client files, channel or recovery state changed. Review again.');
    if (!view.canApply) fail(view.recoveryRequired ? 'RECOVERY_REQUIRED' : 'UNSUPPORTED', 'Restore the interrupted operation or manage the marketplace channel separately.');
    if (!files.length && !source) return { status: view.skipped.some(item => !['missing'].includes(item.reason)) ? 'partial' : 'unchanged', changed: 0, skipped: view.skipped };
    if (rows.length >= 1000) fail('UNSUPPORTED', 'Uninstall receipt history is full.');
    const operationId = randomUUID(), backupId = source?.backupId || operationId;
    let backupChecksum = source?.backupChecksum;
    if (!source) {
      const archive = { format: 'memory-client-backup', id: backupId, client: input.client, files };
      if (Buffer.byteLength(JSON.stringify(archive)) > ARCHIVE_LIMIT) fail('UNSUPPORTED', 'Recovery backup exceeds the supported size.');
      savePrivate(backupFile(backupId), archive); backupChecksum = read(backupFile(backupId), ARCHIVE_LIMIT).hash;
      // Verify exact file states from the written backup before the first mutation.
      loadBackup({ backupId, backupChecksum, client: input.client, files: files.map(summary) });
    }
    if (afterBackup) await afterBackup();
    if ((await prepare(input, history())).view.previewToken !== view.previewToken) fail('CONFLICT', 'Client changed during backup. No files were removed.');
    loadBackup({ backupId, backupChecksum, client: input.client, files: source?.files || files.map(summary) });
    const record = { format: 'memory-client-removal', operationId, client: input.client, operation: input.operation,
      backupId, backupChecksum, files: source?.files || files.map(summary), changed: files.length, completed: 0,
      skipped: view.skipped, status: 'pending', phase: 'running', observedAt: new Date().toISOString() };
    savePrivate(receiptFile(operationId), record);
    try {
      for (const file of files) {
        if (!same(read(file.path), file.before)) fail('CONFLICT', 'A client file changed during publication.');
        publish(file.path, file.after, file.before);
        if (!same(read(file.path), file.after)) fail('UNAVAILABLE', 'Client file publication could not be verified.');
        record.completed++; savePrivate(receiptFile(operationId), record);
        if (afterFile) await afterFile(record.completed);
      }
      record.phase = 'completed'; record.status = view.skipped.some(item => item.reason !== 'missing') ? 'partial' : 'saved';
      savePrivate(receiptFile(operationId), record);
      if (source) for (const prior of history().filter(item => item.backupId === backupId && item.phase !== 'completed')) {
        prior.phase = 'completed'; prior.status = 'restored'; delete prior.error; savePrivate(receiptFile(prior.operationId), prior);
      }
    } catch {
      record.phase = 'interrupted'; record.status = 'partial';
      record.error = { code: 'RECOVERY_REQUIRED', message: 'Операция прервана. Проверьте квитанцию и восстановите файлы по свежему предпросмотру.' };
      savePrivate(receiptFile(operationId), record);
    }
    return record;
  }));
}
