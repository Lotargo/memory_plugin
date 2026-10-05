// Local diagnostics and reviewed CAS maintenance. No arbitrary paths or shell.
import fs from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { MEMORY_DIR } from '../memory.js';
import { getDatabase, BLOBS_DIR } from '../db/database.js';
import { assertLocalMemoryReady } from '../config/config_manager.js';
import { withSnapshotLock, atomicWrite } from '../storage/snapshot_lock.js';
import { safeGunzip, getBlobPath, hashContent } from '../storage/blob_store.js';
import { stateHash, sha256 } from '../admin/full_snapshot.js';
import { serviceError } from './notebook_service.js';

const folder = join(MEMORY_DIR, 'maintenance-blobs');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const BYTE_LIMIT = 64 * 1024 * 1024, RAW_LIMIT = 128 * 1024 * 1024, FILE_LIMIT = 2000;
const fail = (code, message) => { throw serviceError(code, message); };
const notice = 'Only unreferenced CAS files in this local store. Notebook, SQL, models, client files and snapshot history are preserved. A verified recovery ZIP retains these bytes; active CAS reduction is not net disk space freed.';
function safe(file) {
  for (let current = resolve(file); ; current = dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) fail('UNSUPPORTED', 'Linked maintenance files or directories cannot be managed.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(current) === current) break;
  }
}
function paths(id) {
  if (!UUID.test(id || '')) fail('INVALID', 'Choose an exact operation ID.');
  const zip = join(folder, `${id}.zip`), receipt = join(folder, `${id}.json`); safe(zip); safe(receipt);
  return { zip, receipt };
}
function validate(input) {
  const allowed = { status: ['action'], run: ['action','operation'], preview: ['action','operation','backupId'],
    apply: ['action','operation','backupId','previewToken','confirm'], receipt: ['action','operationId'] };
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(allowed, input.action) || Object.keys(input).some(key => !allowed[input.action].includes(key))) fail('INVALID', 'Unknown diagnostic field or action.');
  for (const key of ['backupId','operationId']) if (input[key] !== undefined && !UUID.test(input[key])) fail('INVALID', `Invalid ${key}.`);
  if (input.action === 'receipt' && !input.operationId) fail('INVALID', 'Choose an operation ID.');
  if (input.action === 'run' && input.operation !== 'graph-check') fail('INVALID', 'Only the isolated graph check is supported.');
  if (['preview','apply'].includes(input.action)) {
    if (!['cleanup-blobs','restore-blobs','resume-cleanup'].includes(input.operation)) fail('INVALID', 'Unknown CAS operation.');
    if (input.operation === 'cleanup-blobs' ? input.backupId !== undefined : !input.backupId) fail('INVALID', 'Choose the exact recovery backup for restore/resume.');
  }
  if (input.confirm !== undefined && typeof input.confirm !== 'boolean' || input.previewToken !== undefined && (typeof input.previewToken !== 'string' || !HASH.test(input.previewToken))) fail('INVALID', 'Invalid confirmation or preview token.');
}
async function runDiagnostic() {
  const root = fs.mkdtempSync(join(tmpdir(), 'memory-diagnostic-'));
  const parent = fs.realpathSync(tmpdir()), actual = fs.realpathSync(root);
  if (dirname(actual) !== parent || !relative(parent, actual).startsWith('memory-diagnostic-')) fail('UNSUPPORTED', 'Cannot verify the isolated diagnostic directory.');
  // Only OS/runtime variables are inherited; user/client/cloud configuration is isolated.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp|lang|lc_all)$/i.test(key)));
  Object.assign(env, { HOME: actual, USERPROFILE: actual, MEMORY_DIR: join(actual,'memory'), CODEX_HOME: join(actual,'codex'),
    OPENCODE_CONFIG_DIR: join(actual,'opencode'), CLAUDE_CONFIG_DIR: join(actual,'claude'), XDG_CONFIG_HOME: join(actual,'config'),
    MEMORY_DIAGNOSTIC_ISOLATED: '1', MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1',
    MEMORY_DISABLE_WEB_AUTOSTART: '1', MEMORY_LOG_LEVEL: 'silent', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' });
  let result;
  try {
    result = await new Promise(resolveDone => execFile(process.execPath, [fileURLToPath(new URL('../admin/diagnostic_worker.js', import.meta.url))],
      { cwd: actual, env, timeout: 45000, maxBuffer: 64000, windowsHide: true }, (error, stdout) => {
        let report; try { report = JSON.parse(stdout); } catch {}
        if (error && report?.status === 'passed') report = { ...report, status: 'failed', error: { code: error.killed ? 'TIMEOUT' : 'UNAVAILABLE', message: 'The diagnostic process did not finish normally.' } };
        resolveDone(report && ['passed','failed'].includes(report.status) && Array.isArray(report.checks) ? report
          : { status: 'failed', checks: [], error: { code: error?.killed ? 'TIMEOUT' : 'UNAVAILABLE', message: 'The isolated diagnostic process did not return a complete report.' } });
      }));
  } finally {
    // Recheck the resolved target before a recursive removal on Windows.
    try {
      if (fs.existsSync(root)) {
        if (fs.realpathSync(root) !== actual || dirname(actual) !== parent) throw new Error('Temporary target changed');
        fs.rmSync(actual, { recursive: true, force: true, maxRetries: 5 });
      }
    } catch { if (result) result.temporaryCleanup = 'unavailable'; }
  }
  return { ...result, operation: 'graph-check', scope: 'isolated-temporary-store', observedAt: new Date().toISOString(),
    workingMemoryTouched: false, sessionObserved: false, temporaryCleanup: result.temporaryCleanup || 'completed' };
}
function receipt(id) {
  const { receipt: file } = paths(id);
  if (!fs.existsSync(file)) fail('NOT_FOUND', 'CAS receipt was not found.');
  if (!fs.lstatSync(file).isFile() || fs.statSync(file).size > 2 * 1024 * 1024) fail('RECOVERY_REQUIRED', 'Invalid CAS receipt.');
  let value; try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail('RECOVERY_REQUIRED', 'Invalid CAS receipt.'); }
  if (value.format !== 'memory-cas-receipt' || value.operationId !== id || !['cleanup-blobs','restore-blobs','resume-cleanup'].includes(value.operation)
    || !['pending','saved','partial','restored'].includes(value.status) || !['running','interrupted','completed'].includes(value.phase)
    || !UUID.test(value.backupId) || !HASH.test(value.backupChecksum) || !Array.isArray(value.files) || value.files.length > FILE_LIMIT
    || value.files.some(item => !HASH.test(item.hash) || !HASH.test(item.checksum))) fail('RECOVERY_REQUIRED', 'Invalid CAS receipt.');
  return value;
}
function saveReceipt(value) { atomicWrite(paths(value.operationId).receipt, JSON.stringify(value), { renameRetries: 10 }); }
function listReceipts() {
  safe(folder); if (!fs.existsSync(folder)) return [];
  const names = fs.readdirSync(folder).filter(name => UUID.test(name.slice(0,-5)) && name.endsWith('.json'));
  if (names.length > 1000) fail('UNSUPPORTED', 'CAS receipt history exceeds the local inspection limit.');
  return names.map(name => { const id = name.slice(0,-5); try { return receipt(id); } catch (error) { return { operationId: id, unavailable: error.code || 'UNAVAILABLE' }; } })
    .sort((a,b) => (b.observedAt || '').localeCompare(a.observedAt || ''));
}
async function archive(id) {
  const record = receipt(id), { zip: file } = paths(record.backupId);
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile() || fs.statSync(file).size > BYTE_LIMIT + 2 * 1024 * 1024) fail('RECOVERY_REQUIRED', 'CAS recovery archive is missing or exceeds the limit.');
  const bytes = fs.readFileSync(file); if (sha256(bytes) !== record.backupChecksum) fail('RECOVERY_REQUIRED', 'CAS backup checksum changed.');
  let zip, manifest; try {
    // Bound individual entries before decompression; hashes validate their contents.
    zip = await JSZip.loadAsync(bytes);
    const meta = zip.file('manifest.json'); if (!meta || meta._data.uncompressedSize > 2 * 1024 * 1024) throw new Error();
    manifest = JSON.parse(await meta.async('string'));
  } catch { fail('RECOVERY_REQUIRED', 'CAS recovery archive is corrupt.'); }
  if (manifest.format !== 'memory-unused-blobs' || manifest.version !== 1 || manifest.id !== record.backupId
    || !Array.isArray(manifest.files) || stateHash(manifest.files) !== stateHash(record.files)
    || Object.keys(zip.files).length !== manifest.files.length + 1) fail('RECOVERY_REQUIRED', 'CAS backup manifest changed.');
  const data = new Map(); let compressed = 0, unpacked = 0;
  for (const item of manifest.files) {
    const entry = zip.file(`${item.hash}.raw.gz`);
    if (!entry || entry._data.uncompressedSize !== item.bytes || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || (compressed += item.bytes) > BYTE_LIMIT) fail('RECOVERY_REQUIRED', 'CAS archive file exceeds the limit.');
    const gzip = await entry.async('nodebuffer'); let raw;
    try { raw = safeGunzip(gzip, RAW_LIMIT - unpacked); } catch { fail('RECOVERY_REQUIRED', 'CAS archive contains corrupt gzip data.'); }
    unpacked += raw.length;
    if (sha256(gzip) !== item.checksum || hashContent(raw) !== item.hash) fail('RECOVERY_REQUIRED', 'CAS archive content failed verification.');
    data.set(item.hash, gzip);
  }
  return { record, data };
}
function referenced(sql) {
  const rows = sql.prepare('SELECT id,blob_hash FROM documents ORDER BY id').all();
  if (rows.some(row => !HASH.test(row.blob_hash))) fail('RECOVERY_REQUIRED', 'A document has an invalid blob hash; repair it before cleanup.');
  return { rows, hashes: new Set(rows.map(row => row.blob_hash)) };
}
function inventory(refs) {
  safe(BLOBS_DIR); const files = [], skipped = []; let bytes = 0, rawBytes = 0, inspectedBytes = 0, scanned = 0;
  if (!fs.existsSync(BLOBS_DIR)) return { files, skipped };
  for (const prefix of fs.readdirSync(BLOBS_DIR).sort()) {
    if (++scanned > 10000) fail('UNSUPPORTED', 'CAS directory inspection exceeds 10000 entries.');
    const dir = join(BLOBS_DIR, prefix), stat = fs.lstatSync(dir);
    if (!/^[a-f0-9]{2}$/.test(prefix) || stat.isSymbolicLink() || !stat.isDirectory()) { skipped.push({ name: prefix, reason: 'foreign-or-linked-entry' }); continue; }
    for (const name of fs.readdirSync(dir).sort()) {
      if (++scanned > 10000) fail('UNSUPPORTED', 'CAS directory inspection exceeds 10000 entries.');
      const hash = name.replace(/\.raw\.gz$/, ''), file = join(dir, name), item = fs.lstatSync(file);
      if (!HASH.test(hash) || name !== `${hash}.raw.gz` || !hash.startsWith(prefix) || item.isSymbolicLink() || !item.isFile()) { skipped.push({ name: `${prefix}/${name}`, reason: 'foreign-or-linked-entry' }); continue; }
      if (refs.hashes.has(hash)) continue;
      inspectedBytes += item.size;
      if (files.length >= FILE_LIMIT || inspectedBytes > BYTE_LIMIT) fail('UNSUPPORTED', 'Unused CAS exceeds 2000 files / 64 MiB. No cleanup was performed.');
      const gzip = fs.readFileSync(file); let raw;
      try { raw = safeGunzip(gzip, RAW_LIMIT - rawBytes); rawBytes += raw.length; if (hashContent(raw) !== hash) throw new Error(); }
      catch { skipped.push({ hash, reason: 'corrupt-or-oversize-content', checksum: sha256(gzip) }); continue; }
      bytes += gzip.length;
      files.push({ hash, bytes: gzip.length, checksum: sha256(gzip) });
    }
  }
  return { files, skipped };
}
async function prepare(input, sql) {
  const refs = referenced(sql), history = listReceipts(); let files = [], skipped = [], saved;
  if (input.operation === 'cleanup-blobs') {
    if (history.some(item => item.unavailable || item.phase !== 'completed')) fail('RECOVERY_REQUIRED', 'Resolve the interrupted CAS operation with reviewed resume or restore before new cleanup.');
    ({ files, skipped } = inventory(refs));
  } else {
    saved = await archive(input.backupId);
    if (input.operation === 'resume-cleanup' && saved.record.operation === 'restore-blobs') fail('INVALID', 'Resume selects a cleanup receipt; repeat restore to recover an interrupted restore.');
    for (const item of saved.record.files) {
      const file = getBlobPath(item.hash); safe(file);
      const exists = fs.existsSync(file); if (exists && !fs.lstatSync(file).isFile()) fail('UNSUPPORTED', 'A CAS target is not a regular file.');
      if (exists && fs.statSync(file).size > BYTE_LIMIT) fail('UNSUPPORTED', 'An existing CAS target exceeds the inspection limit.');
      const checksum = exists ? sha256(fs.readFileSync(file)) : null;
      if (input.operation === 'restore-blobs') {
        if (exists && checksum !== item.checksum) fail('CONFLICT', 'An existing CAS file differs from the recovery backup. It will not be overwritten.');
        if (!exists) files.push(item);
      } else if (exists) {
        if (refs.hashes.has(item.hash)) skipped.push({ hash: item.hash, reason: 'now-referenced', checksum });
        else if (checksum !== item.checksum) skipped.push({ hash: item.hash, reason: 'content-changed', checksum });
        else files.push(item);
      }
    }
  }
  const view = { operation: input.operation, backupId: input.backupId || null, scope: 'all-local-cas', files, skipped,
    changed: files.length, bytes: files.reduce((n,item) => n + item.bytes, 0), canApply: true,
    observedAt: new Date().toISOString(), notice };
  view.previewToken = stateHash([input.operation, input.backupId || null, saved?.record.backupChecksum || null, refs.rows, files, skipped,
    history.map(item => [item.operationId,item.status,item.phase])]);
  return { view, saved };
}
export async function diagnosticsRequest(input, { afterBackup, afterFile, beforeRestore } = {}) {
  validate(input);
  if (input.action === 'run') return runDiagnostic();
  assertLocalMemoryReady();
  return withSnapshotLock(MEMORY_DIR, async () => {
    const db = await getDatabase(), sql = db.localDb;
    if (input.action === 'receipt') return receipt(input.operationId);
    if (input.action === 'status') {
      const { files, skipped } = inventory(referenced(sql)), history = listReceipts();
      return { scope: 'all-local-cas', unusedFiles: files.length, unusedBytes: files.reduce((n,item) => n + item.bytes,0), skipped,
        receipts: history, recoveryRequired: history.some(item => item.unavailable || item.phase !== 'completed'),
        limits: { files: FILE_LIMIT, compressedBytes: BYTE_LIMIT, unpackedBytes: RAW_LIMIT }, notice, observedAt: new Date().toISOString(), localOnly: true };
    }
    const target = { operation: input.operation, ...(input.backupId ? { backupId: input.backupId } : {}) };
    const prepared = await prepare(target, sql), view = prepared.view;
    if (input.action === 'preview') return view;
    if (input.confirm !== true) fail('CONFIRMATION', 'Review and explicitly confirm the exact CAS operation.');
    if (input.previewToken !== view.previewToken) fail('CONFLICT', 'CAS files, references or recovery state changed. Review again.');
    if (!view.changed && input.operation === 'cleanup-blobs') return { status: 'unchanged', changed: 0, operation: input.operation };
    if (listReceipts().length >= 1000) fail('UNSUPPORTED', 'CAS receipt history is full; no new operation was started.');
    let backupId = prepared.saved?.record.backupId, backupChecksum = prepared.saved?.record.backupChecksum;
    const operationId = randomUUID();
    if (input.operation === 'cleanup-blobs') {
      backupId = operationId; const zip = new JSZip();
      zip.file('manifest.json', JSON.stringify({ format: 'memory-unused-blobs', version: 1, id: backupId, files: view.files }));
      for (const item of view.files) { const file = getBlobPath(item.hash); safe(file); zip.file(`${item.hash}.raw.gz`, fs.readFileSync(file)); }
      const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }); backupChecksum = sha256(bytes);
      atomicWrite(paths(backupId).zip, bytes, { renameRetries: 10 });
    }
    // Revalidate after asynchronous backup, before recording any deletion intent.
    if (afterBackup) await afterBackup();
    if ((await prepare(target, sql)).view.previewToken !== view.previewToken) fail('CONFLICT', 'CAS changed during backup. No cleanup was performed.');
    const record = { format: 'memory-cas-receipt', operationId, operation: input.operation, backupId, backupChecksum,
      files: prepared.saved?.record.files || view.files, status: 'pending', phase: 'running', completed: 0,
      changed: view.changed, skipped: view.skipped, backup: paths(backupId).zip, observedAt: new Date().toISOString() };
    saveReceipt(record);
    // The archive includes unused bytes, which ordinary full snapshots do not capture.
    await archive(operationId);
    try {
      for (const item of view.files) {
        const file = getBlobPath(item.hash); safe(file);
        if (input.operation === 'restore-blobs') {
          if (fs.existsSync(file)) fail('CONFLICT', 'A CAS file appeared during restore. Review again.');
          // Hard-link publication is atomic and fails if a concurrent writer
          // created the target. Atomic replacement would overwrite that writer.
          const staged = `${file}.restore-${randomUUID()}.tmp`;
          try {
            atomicWrite(staged, prepared.saved.data.get(item.hash), { renameRetries: 10 });
            if (beforeRestore) await beforeRestore(file);
            safe(file); fs.linkSync(staged, file);
          } finally { if (fs.existsSync(staged)) fs.unlinkSync(staged); }
        } else {
          if (referenced(sql).hashes.has(item.hash) || !fs.existsSync(file) || sha256(fs.readFileSync(file)) !== item.checksum) fail('CONFLICT', 'A cleanup target changed. Resume from a fresh review.');
          fs.unlinkSync(file);
        }
        record.completed++; saveReceipt(record); if (afterFile) await afterFile(record.completed);
      }
      record.status = view.skipped.length ? 'partial' : 'saved'; record.phase = 'completed'; saveReceipt(record);
      if (prepared.saved) {
        // A recovery may itself have been interrupted. Resolve every intent for
        // this same immutable backup after all remaining files are processed.
        for (const prior of listReceipts().filter(item => !item.unavailable && item.backupId === backupId && item.phase !== 'completed')) {
          prior.phase = 'completed'; prior.status = input.operation === 'restore-blobs' ? 'restored' : record.status; saveReceipt(prior);
        }
      }
    } catch (error) {
      record.status = 'partial'; record.phase = 'interrupted'; record.error = { code: error.code || 'UNAVAILABLE', message: 'CAS operation interrupted. Review resume/restore from this receipt before retrying.' }; saveReceipt(record);
    }
    return record;
  });
}
