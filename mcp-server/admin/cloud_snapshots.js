import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { MEMORY_DIR, slugify } from "../memory.js";
import { getDatabase, getMigrationDatabase, BLOBS_DIR } from "../db/database.js";
import { getConfig, updateConfig } from "../config/config_manager.js";
import { resolveCloudSecrets } from "./auth.js";
import { bustIdentityCache } from "../identity.js";
import { withSnapshotLock, atomicWrite } from "../storage/snapshot_lock.js";
import { TABLES, captureLocal, encodeRows, packPayload, unpackPayload, stateHash, sha256, canonical, replaceLocal } from "./full_snapshot.js";
import { gunzipSync } from "node:zlib";

const META = "id,created_at,state_hash,checksum,size,pinned,source";
const SCHEMA = `CREATE TABLE IF NOT EXISTS memory_snapshots (
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, state_hash TEXT NOT NULL,
  checksum TEXT NOT NULL, size INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL, payload_zip BLOB NOT NULL)`;
const QUOTA = /BLOCKED|QUOTA|RATE.?LIMIT|HTTP.?429|HTTP.?402|RESOURCE_EXHAUSTED/i;
export function isSnapshotQuotaError(error) {
  for (let depth = 0, item = error; item && depth < 5; depth++, item = item.cause) {
    if ([item.status, item.statusCode, item.response?.status].some(status => [429, 402].includes(Number(status)))) return true;
    if (QUOTA.test(`${item.code} ${item.message}`) || /\bHTTP\s+(?:status\s+)?(?:429|402)\b/i.test(item.message || "")) return true;
  }
  return false;
}
const emptyState = () => ({ version: 1, records: [], pendingId: null, lastUploadedHash: null,
  lastUploadedId: null, nextDueAt: null, nextAttemptAt: 0, failures: 0, quotaBlocked: false, lastError: null });

export class CloudSnapshots {
  constructor({ memoryDir = MEMORY_DIR, blobDir = BLOBS_DIR, db = null, client = null,
    config = getConfig, saveConfig = updateConfig, now = Date.now, maxUnpackedBytes = 512 * 1024 * 1024 } = {}) {
    this.memoryDir = memoryDir; this.blobDir = blobDir; this.db = db;
    this.directory = path.join(memoryDir, "storage", "snapshots");
    this.stateFile = path.join(this.directory, "state.json");
    this.client = client; this.config = config; this.saveConfig = saveConfig;
    this.now = now; this.maxUnpackedBytes = maxUnpackedBytes; this.schemaReady = false;
  }
  state() {
    if (!fs.existsSync(this.stateFile)) return emptyState();
    const state = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
    if (state.version !== 1 || !Array.isArray(state.records)) throw new Error("Invalid snapshot catalog");
    return { ...emptyState(), ...state };
  }
  save(state) { atomicWrite(this.stateFile, JSON.stringify(state, null, 2)); }
  lock(work) { return withSnapshotLock(this.directory, work); }
  async localDb() {
    const db = this.db || (this.config().legacyCloudRestoreRequired
      ? (this.migrationDb ||= await getMigrationDatabase(path.join(this.memoryDir, "storage", "memory.sqlite")))
      : await getDatabase());
    if (!db.localDb) throw new Error("Switch to local storage before restoring or uploading local snapshots");
    return db;
  }
  async capture() {
    const db = await this.localDb();
    return withSnapshotLock(this.memoryDir, () => captureLocal(db, this.memoryDir, this.blobDir, this.config()));
  }
  archivePath(id) {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid snapshot ID");
    return path.join(this.directory, `${id}.zip`);
  }
  async store(payload, state, { force = false, source = "local", pinned = false } = {}) {
    const hash = stateHash(payload);
    const previous = state.records.find(r => r.id === state.lastCapturedId);
    if (!force && previous?.state_hash === hash && fs.existsSync(this.archivePath(previous.id))) return previous;
    const bytes = await packPayload(payload);
    const record = { id: randomUUID(), created_at: this.now(), state_hash: hash,
      checksum: sha256(bytes), size: bytes.length, pinned: Number(pinned), source };
    atomicWrite(this.archivePath(record.id), bytes);
    state.records.push(record);
    if (source === "local" || source === "pre-restore") state.lastCapturedId = record.id;
    this.save(state);
    return record;
  }
  async cloud({ schema = true } = {}) {
    if (!this.client) {
      const secrets = (await resolveCloudSecrets()) || {};
      const url = secrets.dbUrl || this.config().tursoUrl;
      if (!url) throw new Error("Cloud connection is not configured");
      this.client = createClient({ url, authToken: secrets.token || undefined });
    }
    if (schema && !this.schemaReady) {
      await this.client.execute(SCHEMA);
      await this.client.execute("CREATE INDEX IF NOT EXISTS idx_memory_snapshots_created ON memory_snapshots(created_at,id)");
      this.schemaReady = true;
    }
    return this.client;
  }
  async list({ location = "local", limit = 100, before = null } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("List limit must be 1–1000");
    if (!["local", "cloud"].includes(location)) throw new Error("List location must be local or cloud");
    if (before !== null && !Number.isSafeInteger(before)) throw new Error("Invalid pagination timestamp");
    if (location === "local") return this.state().records.filter(r => before === null || r.created_at < before)
      .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id)).slice(0, limit);
    const client = await this.cloud();
    return (await client.execute({ sql: `SELECT ${META} FROM memory_snapshots ${before === null ? "" : "WHERE created_at < ?"} ORDER BY created_at DESC,id DESC LIMIT ?`,
      args: before === null ? [limit] : [before, limit] })).rows.map(r => ({ ...r }));
  }
  async load(id, location = "local") {
    let record, bytes;
    this.archivePath(id);
    if (location === "local") {
      record = this.state().records.find(r => r.id === id);
      if (!record) throw new Error("Local snapshot not found");
      bytes = fs.readFileSync(this.archivePath(id));
    } else if (location === "cloud") {
      const client = await this.cloud();
      const row = (await client.execute({ sql: `SELECT ${META},payload_zip FROM memory_snapshots WHERE id=?`, args: [id] })).rows[0];
      if (!row) throw new Error("Cloud snapshot not found");
      const { payload_zip, ...meta } = row;
      record = meta; bytes = Buffer.from(payload_zip);
    } else throw new Error("Snapshot location must be local or cloud");
    if (bytes.length !== Number(record.size)) throw new Error("Archive size mismatch");
    return { record, payload: await unpackPayload(bytes, record.checksum, record.state_hash, this.maxUnpackedBytes) };
  }
  async upload({ automatic = false, force = false } = {}) {
    if (this.config().legacyCloudBackupRequired || this.config().legacyCloudRestoreRequired) throw new Error("Run memory-cli snapshots enable and complete the required local restore before uploading; legacy migration is pending.");
    if (!["cloud-snapshots", "only-local"].includes(this.config().mode)) throw new Error("Enable cloud-snapshots before uploading; legacy mirror modes cannot upload local snapshots");
    if (typeof automatic !== "boolean" || typeof force !== "boolean") throw new Error("Upload flags must be boolean");
    return this.lock(async () => {
      const state = this.state();
      const record = await this.store(await this.capture(), state, { force });
      if (record.state_hash === state.lastUploadedHash && !force) {
        state.pendingId = null; this.save(state);
        return { status: "unchanged", snapshot: record };
      }
      // Always replace the pending pointer, including during quota suspension.
      state.pendingId = record.id; this.save(state);
      if (automatic && (state.quotaBlocked || state.nextAttemptAt > this.now())) return { status: "local-only", snapshot: record, reason: state.lastError };
      try {
        const client = await this.cloud();
        const bytes = fs.readFileSync(this.archivePath(record.id));
        // Idempotent retry of the same checkpoint. No per-entity cloud writes.
        const result = await client.execute({ sql: `INSERT INTO memory_snapshots (${META},payload_zip) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
          args: [record.id, record.created_at, record.state_hash, record.checksum, record.size, record.pinned, record.source, bytes] });
        state.lastUploadedId = record.id; state.lastUploadedHash = record.state_hash;
        state.pendingId = null; state.failures = 0; state.nextAttemptAt = 0;
        state.quotaBlocked = false; state.lastError = null; this.save(state);
        return { status: "uploaded", snapshot: record, cloudRowsWritten: Number(result.rowsAffected) };
      } catch (error) {
        state.failures++; state.lastError = String(error.code || error.status || error.message).slice(0, 500);
        state.quotaBlocked = isSnapshotQuotaError(error);
        state.nextAttemptAt = this.now() + Math.min(24, 2 ** Math.min(state.failures, 5)) * 3600_000;
        this.save(state);
        return { status: "local-only", snapshot: record, reason: state.lastError, quotaBlocked: state.quotaBlocked };
      }
    });
  }
  async configure({ syncMode = "manual", intervalHours = 24 } = {}) {
    if (!["manual", "scheduled", "off"].includes(syncMode)) throw new Error("syncMode must be manual, scheduled or off");
    if (!Number.isFinite(intervalHours) || intervalHours <= 0 || intervalHours * 3600_000 > Number.MAX_SAFE_INTEGER) throw new Error("intervalHours must be positive and finite");
    if (this.config().mode !== "cloud-snapshots") throw new Error("Enable cloud-snapshots mode first");
    return this.lock(() => {
      this.saveConfig({ snapshotSyncMode: syncMode, snapshotIntervalHours: intervalHours });
      const state = this.state(); state.nextDueAt = this.now() + intervalHours * 3600_000; this.save(state);
      return { syncMode, intervalHours, nextDueAt: state.nextDueAt };
    });
  }
  async tick() {
    const config = this.config();
    if (config.legacyCloudBackupRequired || config.legacyCloudRestoreRequired || config.mode !== "cloud-snapshots" || config.snapshotSyncMode !== "scheduled") return { status: "disabled" };
    const hours = config.snapshotIntervalHours;
    if (!Number.isFinite(hours) || hours <= 0) throw new Error("Invalid snapshot schedule");
    let due = false;
    await this.lock(() => {
      const state = this.state();
      if (state.nextDueAt === null) { state.nextDueAt = this.now() + hours * 3600_000; this.save(state); }
      else if (state.nextDueAt <= this.now()) {
        // Claim deadline before upload so concurrent processes cannot catch up
        // the same missed intervals. Failures also advance it exactly once.
        state.nextDueAt = this.now() + hours * 3600_000; this.save(state); due = true;
      }
    });
    return due ? this.upload({ automatic: true }) : { status: "not-due" };
  }
  async restore({ id, location = "local", confirmToken = null } = {}) {
    if (!["only-local", "cloud-snapshots"].includes(this.config().mode)) throw new Error("Restore requires local storage; enable snapshot mode first");
    return this.lock(async () => {
      const migration = this.config().legacyCloudRestoreRequired;
      if (migration && (this.config().legacyCloudBackupRequired || location !== "local" || id !== this.state().legacyCloudBackupId)) {
        throw new Error("Run memory-cli snapshots enable, then restore its verified cloudBackupId with --location local to complete migration.");
      }
      const { record, payload } = await this.load(id, location);
      const db = await this.localDb();
      return withSnapshotLock(this.memoryDir, async () => {
        const current = captureLocal(db, this.memoryDir, this.blobDir, this.config());
        const token = sha256(canonical({ id, location, checksum: record.checksum, current: stateHash(current) }));
        const counts = p => ({ notebookStores: p.notebooks.length, documents: p.tables.documents.length,
          factsLinked: p.tables.knowledge_links.length, chunks: p.tables.micro_chunks.length });
        const preview = { status: "preview", id, location, current: counts(current), replacement: counts(payload), confirmToken: token };
        if (!confirmToken) return preview;
        if (confirmToken !== token) throw new Error("Restore preview is stale; preview again");
        const state = this.state();
        const backup = await this.store(current, state, { force: true, source: "pre-restore", pinned: true });
        // Filesystem journal repairs Notebook files if the process dies before
        // SQLite commits. This is also kept on disk if recovery itself fails.
        const marker = randomUUID();
        const settings = { ...payload.settings, ...(migration ? { mode: "cloud-snapshots", snapshotSyncMode: "manual",
          legacyCloudBackupRequired: false, legacyCloudRestoreRequired: false } : {}) };
        state.restoreJournal = { backupId: backup.id, marker, settings }; this.save(state);
        replaceLocal(payload, db, this.memoryDir, this.blobDir, marker, stateHash(current), this.config());
        this.saveConfig(settings);
        bustIdentityCache();
        delete state.restoreJournal; state.lastCapturedId = null; state.pendingId = null;
        // Force the next send to create a fresh checkpoint, even when reverting
        // to contents of an older successfully uploaded snapshot.
        state.lastUploadedHash = null; this.save(state);
        return { ...preview, status: "restored", backupId: backup.id };
      });
    });
  }
  async recover() {
    return this.lock(async () => {
      const state = this.state();
      if (!state.restoreJournal) return;
      const db = await this.localDb();
      await withSnapshotLock(this.memoryDir, async () => {
        const marker = db.localDb.prepare("SELECT value FROM sync_state WHERE key='snapshot_restore_id'").get();
        if (marker?.value === state.restoreJournal.marker) this.saveConfig(state.restoreJournal.settings);
        else {
          const { payload } = await this.load(state.restoreJournal.backupId);
          const keep = new Set(payload.notebooks.map(n => n.file.toLowerCase()));
          for (const store of payload.notebooks) atomicWrite(path.join(this.memoryDir, store.file), store.content);
          for (const file of fs.readdirSync(this.memoryDir).filter(f => f.endsWith(".md"))) if (!keep.has(file.toLowerCase())) fs.unlinkSync(path.join(this.memoryDir, file));
        }
        delete state.restoreJournal; state.lastCapturedId = null; state.lastUploadedHash = null; this.save(state);
        bustIdentityCache();
      });
    });
  }
  async pin({ id, location = "local", pinned = true }) {
    if (typeof pinned !== "boolean") throw new Error("pinned must be boolean");
    this.archivePath(id);
    if (location === "local") return this.lock(() => {
      const state = this.state(), record = state.records.find(r => r.id === id);
      if (!record) throw new Error("Snapshot not found");
      record.pinned = Number(pinned); this.save(state); return record;
    });
    if (location !== "cloud") throw new Error("Pin location must be local or cloud");
    const client = await this.cloud();
    const result = await client.execute({ sql: "UPDATE memory_snapshots SET pinned=? WHERE id=?", args: [Number(pinned), id] });
    if (!result.rowsAffected) throw new Error("Snapshot not found");
    return { id, pinned };
  }
  async prune({ location = "local", from = 0, to, includeProtected = false, confirmToken = null } = {}) {
    if (!["local", "cloud", "both"].includes(location)) throw new Error("Invalid deletion location");
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from) throw new Error("Specify a valid half-open deletion interval [from,to) in epoch milliseconds");
    if (typeof includeProtected !== "boolean") throw new Error("includeProtected must be boolean");
    return this.lock(async () => {
      const state = this.state(); const selections = {}; let protectedCloudId = null;
      if (location !== "cloud") {
        selections.local = state.records.filter(r => r.created_at >= from && r.created_at < to &&
          (includeProtected || (!r.pinned && r.id !== state.lastUploadedId && r.id !== state.pendingId)));
      }
      let client;
      if (location !== "local") {
        client = await this.cloud();
        protectedCloudId = (await client.execute(`SELECT id FROM memory_snapshots ORDER BY created_at DESC,id DESC LIMIT 1`)).rows[0]?.id || "";
        selections.cloud = (await client.execute({ sql: `SELECT ${META} FROM memory_snapshots WHERE created_at>=? AND created_at<? ${includeProtected ? "" : "AND pinned=0 AND id<>?"} ORDER BY created_at,id`,
          args: includeProtected ? [from, to] : [from, to, protectedCloudId] })).rows.map(r => ({ ...r }));
      }
      const token = sha256(canonical({ location, from, to, includeProtected, selections }));
      const summary = Object.fromEntries(Object.entries(selections).map(([key, rows]) => [key, { count: rows.length, bytes: rows.reduce((n, r) => n + Number(r.size), 0) }]));
      if (!confirmToken) return { status: "preview", ...summary, confirmToken: token };
      if (confirmToken !== token) throw new Error("Deletion preview is stale; preview again");
      // One indexed DELETE of the previewed period. json_each avoids a variable
      // per ID / SQLite parameter limits. A concurrent upload can never enter
      // the deletion set; pins/latest are rechecked at execution time.
      if (selections.cloud?.length) {
        const result = await client.execute({ sql: `DELETE FROM memory_snapshots WHERE id IN (SELECT value FROM json_each(?)) ${includeProtected ? "" : "AND pinned=0 AND id<>(SELECT id FROM memory_snapshots ORDER BY created_at DESC,id DESC LIMIT 1)"}`,
          args: [JSON.stringify(selections.cloud.map(r => r.id))] });
        if (Number(result.rowsAffected) !== selections.cloud.length) throw new Error("Cloud snapshot protection changed during deletion; cloud deletion applied to eligible IDs only, local history preserved. Preview again.");
      }
      if (selections.local) {
        const ids = new Set(selections.local.map(r => r.id));
        for (const id of ids) { const file = this.archivePath(id); if (fs.existsSync(file)) fs.unlinkSync(file); }
        state.records = state.records.filter(r => !ids.has(r.id));
        if (ids.has(state.lastCapturedId)) state.lastCapturedId = null;
        if (ids.has(state.pendingId)) state.pendingId = null;
        this.save(state);
      }
      return { status: "deleted", ...summary };
    });
  }
  async enable() {
    return this.lock(async () => {
      let config = this.config();
      const state = this.state();
      const restoreRequired = () => ({ status: "restore-required", localBackupId: state.legacyCloudLocalBackupId,
        cloudBackupId: state.legacyCloudBackupId, restoreCommand: `memory-cli snapshots restore ${state.legacyCloudBackupId} --location local` });
      if (config.legacyCloudRestoreRequired && !config.legacyCloudBackupRequired && state.legacyCloudBackupId) {
        try { await this.load(state.legacyCloudBackupId, "local"); return restoreRequired(); }
        catch { /* An explicitly repeated enable can re-download a lost/corrupt backup. */ }
      }
      if (config.legacyCloudRestoreRequired && !config.legacyCloudBackupRequired) {
        this.saveConfig({ legacyCloudBackupRequired: true }); config = this.config();
      }
      const local = this.db || await getMigrationDatabase(path.join(this.memoryDir, "storage", "memory.sqlite"));
      try {
        const payload = await withSnapshotLock(this.memoryDir, () => captureLocal(local, this.memoryDir, this.blobDir, config));
        const backup = await this.store(payload, state, { force: true, source: "migration-local", pinned: true });
        await this.load(backup.id, "local");
        let cloudBackup = null;
        // Preserve legacy cloud independently; never merge it automatically.
        if (config.legacyCloudBackupRequired) {
          const client = await this.cloud({ schema: false });
          const names = new Set((await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(r => r.name));
          const tables = {};
          // A read transaction gives a consistent view without migrating or
          // backfilling any legacy cloud tables during the switch.
          const tx = await client.transaction("read");
          let remote;
          try {
            for (const [table, columns] of Object.entries(TABLES)) {
              if (!names.has(table)) { tables[table] = []; continue; }
              const available = new Set((await tx.execute(`PRAGMA table_info(${table})`)).rows.map(r => r.name));
              const projection = columns.map(c => available.has(c) ? c : `NULL AS ${c}`).join(",");
              tables[table] = encodeRows((await tx.execute(`SELECT ${projection} FROM ${table}`)).rows);
            }
            const notebooks = names.has("notebooks") ? (await tx.execute("SELECT key,content FROM notebooks ORDER BY key")).rows.map(r => ({
              file: `${slugify(r.key)}.md`, content: r.content,
            })) : [];
            const blobs = {};
            for (const { blob_hash: hash } of tables.documents) {
              if (!(hash in blobs)) {
                const row = names.has("rag_blobs") ? (await tx.execute({ sql: "SELECT gzip_base64 FROM rag_blobs WHERE hash=?", args: [hash] })).rows[0] : null;
                if (!row) throw new Error(`Legacy cloud blob ${hash} is missing; migration stopped, local backup preserved`);
                blobs[hash] = gunzipSync(Buffer.from(row.gzip_base64, "base64"), { maxOutputLength: this.maxUnpackedBytes }).toString("utf8");
              }
            }
            remote = { format: "memory-full", version: 1, tables, notebooks, blobs,
              settings: { embeddingModel: config.embeddingModel, vectorDimension: config.vectorDimension } };
            await tx.commit();
          } catch (error) { await tx.rollback(); throw error; }
          finally { tx.close(); }
          cloudBackup = await this.store(remote, state, { force: true, source: "migration-cloud", pinned: true });
          await this.load(cloudBackup.id, "local");
          // Verify the archive can populate the current local schema before
          // reporting a completed download. This never touches working files.
          const validationDb = await getMigrationDatabase(":memory:");
          try {
            const raw = validationDb.localDb;
            raw.exec("BEGIN IMMEDIATE");
            for (const [table, columns] of Object.entries(TABLES)) {
              const insert = raw.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
              for (const row of remote.tables[table]) insert.run(...columns.map(c => c === "vector" ? Buffer.from(row[c], "base64") : row[c]));
            }
            if (raw.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Legacy cloud archive has broken relational references; migration remains pending");
            raw.exec("ROLLBACK");
          } finally { validationDb.close(); }
        }
        if (config.legacyCloudRestoreRequired) {
          state.legacyCloudLocalBackupId = backup.id; state.legacyCloudBackupId = cloudBackup.id; this.save(state);
          this.saveConfig({ mode: "only-local", snapshotSyncMode: "manual", legacyCloudBackupRequired: false });
          return restoreRequired();
        }
        this.saveConfig({ mode: "cloud-snapshots", snapshotSyncMode: "manual", legacyCloudBackupRequired: false, legacyCloudRestoreRequired: false });
        state.initialized = true; state.lastCapturedId = null; state.nextDueAt = null; this.save(state);
        return { status: "enabled", localBackupId: backup.id, cloudBackupId: cloudBackup?.id || null, syncMode: "manual" };
      } finally { if (!this.db) local.localDb?.close(); }
    });
  }
  close() { this.client?.close(); this.client = null; this.schemaReady = false; this.migrationDb?.close(); this.migrationDb = null; }
}

let service;
export const getCloudSnapshots = () => service ||= new CloudSnapshots();
let timer;
let schedulerRunning = false;
export function startSnapshotScheduler() {
  if (schedulerRunning || process.env.MEMORY_DISABLE_BACKGROUND_SYNC === "1") return;
  schedulerRunning = true;
  const run = async () => {
    try { await getCloudSnapshots().recover(); await getCloudSnapshots().tick(); }
    catch (error) { console.error(`[snapshots] ${error.message}`); }
    // Local clock/config only. Never poll the cloud. The persisted deadline
    // handles arbitrarily large hour intervals without setTimeout overflow.
    if (schedulerRunning) { timer = setTimeout(run, 30_000); timer.unref(); }
  };
  timer = setTimeout(run, 0); timer.unref();
}
export function stopSnapshotScheduler() { schedulerRunning = false; clearTimeout(timer); timer = null; service?.close(); }

export async function manageSnapshots(args) {
  const api = getCloudSnapshots();
  await api.recover();
  switch (args.action) {
    case "status": return { mode: getConfig().mode, syncMode: getConfig().snapshotSyncMode,
      intervalHours: getConfig().snapshotIntervalHours, legacyCloudBackupRequired: getConfig().legacyCloudBackupRequired,
      legacyCloudRestoreRequired: getConfig().legacyCloudRestoreRequired, ...api.state() };
    case "enable": return api.enable();
    case "configure": return api.configure(args);
    case "create": return api.lock(async () => {
      if (args.force !== undefined && typeof args.force !== "boolean") throw new Error("force must be boolean");
      return { status: "saved-local", snapshot: await api.store(await api.capture(), api.state(), { force: args.force || false }) };
    });
    case "upload": return api.upload(args);
    case "list": return api.list(args);
    case "restore": {
      const result = await api.restore(args);
      if (result.status === "restored" && process.env.MEMORY_DISABLE_PERSONA_SYNC !== "1") {
        const { syncPersonaPrompts } = await import("../prompt_manager.js");
        result.personaSync = await syncPersonaPrompts();
      }
      return result;
    }
    case "delete": return api.prune(args);
    case "pin": return api.pin(args);
    default: throw new Error("Unknown snapshot action");
  }
}
