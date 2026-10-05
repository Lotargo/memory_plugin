// Reviewed local maintenance. No shell, network, models or arbitrary paths.
import fs from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MEMORY_DIR, GLOBAL_KEY, readMemory, storeFilePath } from '../memory.js';
import { getConfig, updateConfig, DEFAULT_CONFIG, assertLocalMemoryReady } from '../config/config_manager.js';
import { SETTINGS_FIELDS, validateFields } from './settings_service.js';
import { listNotebookTargets, readNotebook, serviceError } from './notebook_service.js';
import { factMeta, parseFactEntry, withMeta, withTitle } from '../fact_format.js';
import { markLegacyPersonaDirectives } from '../persona_migration.js';
import { getDatabase, BLOBS_DIR } from '../db/database.js';
import { hasKnowledgeSchema } from '../storage/knowledge_schema.js';
import { persistNotebookKnowledge } from './knowledge_links_service.js';
import { withSnapshotLock, atomicWrite } from '../storage/snapshot_lock.js';
import { captureLocal, sha256, stateHash } from '../admin/full_snapshot.js';

const configKeys = SETTINGS_FIELDS.filter(item => item.group !== 'web').map(item => item.key);
const backupDir = join(MEMORY_DIR, 'maintenance');
const configPath = join(MEMORY_DIR, 'config.json');
const fail = (code, text) => { throw serviceError(code, text); };
const values = config => Object.fromEntries(configKeys.map(key => [key, config[key]]));
const fileHash = file => fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null;
function safeFile(file) {
  for (let current = file; ; current = join(current, '..')) {
    try { if (fs.lstatSync(current).isSymbolicLink()) fail('UNSUPPORTED', 'Linked maintenance files or parent directories cannot be managed.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = join(current, '..'); if (parent === current) break;
  }
}
function validate(input) {
  const allowed = { status: ['action'], preview: ['action','operation','key','backupId'], apply: ['action','operation','key','backupId','previewToken','confirm'] };
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(allowed,input.action) || Object.keys(input).some(key => !allowed[input.action].includes(key))) fail('INVALID', 'Unknown maintenance field or action.');
  if (input.action === 'status') return;
  if (!['reset-settings','restore-settings','migrate-titles','migrate-persona'].includes(input.operation)) fail('INVALID', 'Unknown maintenance operation.');
  for (const key of ['key','backupId','previewToken']) if (input[key] !== undefined && (typeof input[key] !== 'string' || !input[key] || input[key].length > 4096 || /[\x00-\x1f]/.test(input[key]))) fail('INVALID', `Invalid ${key}.`);
  if (input.confirm !== undefined && typeof input.confirm !== 'boolean') fail('INVALID', 'confirm must be boolean.');
  if (input.operation.startsWith('migrate-')) {
    if (!input.key || input.backupId !== undefined) fail('INVALID', 'Choose one explicit Notebook store.');
    if (input.operation === 'migrate-persona' && input.key !== GLOBAL_KEY) fail('INVALID', 'Legacy persona migration is global only.');
  } else if (input.key !== undefined || input.operation === 'reset-settings' && input.backupId !== undefined || input.operation === 'restore-settings' && !input.backupId) fail('INVALID', 'Invalid settings maintenance target.');
}
function configBackup(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) fail('INVALID', 'Invalid settings backup ID.');
  const file = join(backupDir, `${id}.json`); safeFile(file);
  let payload;
  try {
    if (fs.statSync(file).size > 256000) throw new Error();
    payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { fail('UNAVAILABLE', 'Settings backup is missing or unreadable.'); }
  if (payload.format !== 'maintenance-settings' || payload.version !== 1 || !payload.values || Object.keys(payload.values).length !== configKeys.length || configKeys.some(key => !(key in payload.values)) || stateHash(payload.values) !== payload.checksum) fail('RECOVERY_REQUIRED', 'Settings backup failed integrity validation.');
  return payload;
}
function assertConfigFile() {
  safeFile(configPath);
  if (fs.existsSync(configPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath,'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    } catch { fail('RECOVERY_REQUIRED', 'Configuration is malformed. Inspect it before maintenance; preview cannot replace it with defaults.'); }
  }
}
async function prepare(input) {
  assertConfigFile();
  if (!input.operation.startsWith('migrate-')) {
    const config = getConfig(), before = values(config);
    const source = input.operation === 'restore-settings' ? configBackup(input.backupId) : null;
    const after = source ? source.values : values(DEFAULT_CONFIG);
    validateFields(after);
    const changes = configKeys.filter(key => stateHash(before[key]) !== stateHash(after[key])).map(key => ({ key, label: SETTINGS_FIELDS.find(item => item.key === key).label, before: before[key], after: after[key] }));
    return { after, preview: { operation: input.operation, scope: 'configuration', changes, changed: changes.length,
      canApply: true, previewToken: stateHash([input, fileHash(configPath), source?.checksum, after]),
      notice: 'Search, model and source-access preferences only. Storage mode, cloud credentials, snapshot schedule, migration guards and panel startup are preserved. Runtime models and existing vectors are not changed.', observedAt: new Date().toISOString() } };
  }
  assertLocalMemoryReady();
  safeFile(storeFilePath(input.key));
  const notebook = await readNotebook({ key: input.key });
  if (notebook.readOnly || notebook.target.notebookAvailable === false) fail('UNSUPPORTED', 'Choose a writable Notebook store.');
  const db = await getDatabase();
  if (!hasKnowledgeSchema(db)) fail('MIGRATION_REQUIRED', 'Prepare knowledge links before Notebook maintenance.');
  const content = fs.existsSync(storeFilePath(input.key)) ? fs.readFileSync(storeFilePath(input.key), 'utf8') : '';
  const entries = await readMemory(input.key);
  if (entries.some(line => !parseFactEntry(line))) fail('UNSUPPORTED', 'Repair malformed Notebook records before migration.');
  const ids = entries.map(line => factMeta(line).id).filter(Boolean);
  if (new Set(ids).size !== ids.length) fail('CONFLICT', 'Notebook IDs are ambiguous; repair them before migration.');
  const next = input.operation === 'migrate-titles' ? entries.map(line => withTitle(line)) : markLegacyPersonaDirectives(entries).entries;
  // Include all ID stamping performed by the shared writer in the preview.
  for (let i = 0; i < next.length; i++) if (!factMeta(next[i]).id) {
    let attempt = 0, id;
    do { id = `f_${stateHash([input.key, i, entries[i], attempt++]).slice(0,32)}`; } while (ids.includes(id));
    ids.push(id); next[i] = withMeta(next[i], { ...factMeta(next[i]), id });
  }
  const changes = entries.flatMap((line, index) => next[index] === line ? [] : [{ ref: notebook.records[index].ref, before: line, after: next[index] }]);
  let index = 0;
  const nextContent = content.split('\n').map(line => line.startsWith('- [') ? next[index++] : line).join('\n');
  return { db, nextContent, preview: { operation: input.operation, key: input.key, scope: notebook.target.name, changes, changed: changes.length,
    canApply: true, previewToken: stateHash([input, notebook.version, content, nextContent]), observedAt: new Date().toISOString(),
    notice: 'One Notebook only. Existing dates, protection, TTL, history and sources are preserved. Missing stable IDs are shown above. Managed client files are not synchronized by this operation; review them separately in Client files.' } };
}
// Inputs used for the approval hash never include confirm or the submitted token.
const requestTarget = input => Object.fromEntries(Object.entries(input).filter(([key]) => !['action','confirm','previewToken'].includes(key)));
export async function maintenanceRequest(input, { afterBackup, afterCommit } = {}) {
  validate(input);
  if (input.action === 'status') return withSnapshotLock(MEMORY_DIR, async () => {
    assertConfigFile();
    let targets = [], unavailable = null;
    try { targets = await listNotebookTargets(); } catch (error) { unavailable = error.code || 'UNAVAILABLE'; }
    safeFile(backupDir);
    const backups = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter(name => /^[0-9a-f-]{36}\.json$/.test(name)).map(name => {
      const id = name.slice(0,-5);
      try { return { id, observedAt: configBackup(id).observedAt }; } catch (error) { return { id, unavailable: error.code || 'UNAVAILABLE' }; }
    }).sort((a,b) => (b.observedAt || '').localeCompare(a.observedAt || '')) : [];
    return { targets, unavailable, backups, observedAt: new Date().toISOString(), localOnly: true };
  });
  const target = requestTarget(input);
  const work = async checkpoints => withSnapshotLock(MEMORY_DIR, async () => {
    const prepared = await prepare(target), view = prepared.preview;
    if (input.action === 'preview') return view;
    if (input.confirm !== true) fail('CONFIRMATION', 'Review and explicitly confirm maintenance.');
    if (input.previewToken !== view.previewToken) fail('CONFLICT', 'Notebook, sources, settings or backup changed. Refresh the preview.');
    if (!view.changed) return { status: 'unchanged', changed: 0, operation: input.operation };
    let backup, backupId;
    if (input.operation.startsWith('migrate-')) {
      const payload = captureLocal(prepared.db, MEMORY_DIR, BLOBS_DIR, getConfig());
      const record = await checkpoints.store(payload, checkpoints.state(), { force: true, pinned: true, source: 'maintenance-before-migration' });
      await checkpoints.load(record.id, 'local'); backupId = record.id; backup = checkpoints.archivePath(record.id);
    } else {
      safeFile(backupDir); backupId = randomUUID(); backup = join(backupDir, `${backupId}.json`);
      const previous = values(getConfig()), payload = { format: 'maintenance-settings', version: 1, values: previous, checksum: stateHash(previous), observedAt: new Date().toISOString() };
      atomicWrite(backup, JSON.stringify(payload), { renameRetries: 10 }); configBackup(backupId);
    }
    if (afterBackup) await afterBackup();
    if ((await prepare(target)).preview.previewToken !== view.previewToken) fail('CONFLICT', 'Memory changed during backup. Review a fresh preview.');
    if (input.operation.startsWith('migrate-')) await persistNotebookKnowledge(input.key, prepared.nextContent, { afterCommit });
    else {
      // Same lock as settingsRequest; the atomic replacement has only before/after states.
      updateConfig(prepared.after);
    }
    return { status: 'saved', operation: input.operation, key: input.key || null, changed: view.changed, backup, backupId,
      recovery: input.operation.startsWith('migrate-') ? 'knowledge-journal / full local snapshot restore' : 'restore-settings',
      reindexRequired: !input.operation.startsWith('migrate-') && view.changes.some(item => ['embeddingModel','vectorDimension'].includes(item.key)),
      runtimeApplied: false, clientFilesSynchronized: false };
  });
  // Existing settings transitions acquire settings -> checkpoint -> memory.
  // Migrations use checkpoint -> memory and never take the settings lock.
  if (input.operation.startsWith('migrate-') && input.action === 'apply') {
    const { CloudSnapshots } = await import('../admin/cloud_snapshots.js'); const checkpoints = new CloudSnapshots();
    return checkpoints.lock(() => work(checkpoints));
  }
  if (!input.operation.startsWith('migrate-')) return withSnapshotLock(join(MEMORY_DIR,'storage','settings'), () => work());
  return work();
}

// Compatibility entry points keep their explicit CLI intent and use the same
// preview/CAS/backup path. Browser and TUI require a separate reviewed apply.
export async function executeMaintenance(operation, fields = {}) {
  const preview = await maintenanceRequest({ action: 'preview', operation, ...fields });
  return maintenanceRequest({ action: 'apply', operation, ...fields, previewToken: preview.previewToken, confirm: true });
}
