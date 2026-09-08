import { DatabaseSync } from "node:sqlite";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { MEMORY_DIR } from "../memory.js";
import { runMigrations, LATEST_SCHEMA_VERSION } from "./migrations.js";
import { getConfig } from "../config/config_manager.js";
import { resolveCloudSecrets } from "../admin/auth.js";
import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";

let dbInstance = null;
let dbInitPromise = null;
let dbLastFailAt = 0;
const DB_FAIL_COOLDOWN_MS = 5_000;
let hybridSyncScheduled = false;

export const STORAGE_DIR = join(MEMORY_DIR, "storage");
export const BLOBS_DIR = join(STORAGE_DIR, "blobs");
export const MODELS_DIR = join(STORAGE_DIR, "models");
export const DB_PATH = join(STORAGE_DIR, "memory.sqlite");

class DatabaseWrapper {
  constructor(localDb, cloudClient, mode, failoverClient = null) {
    this.localDb = localDb;
    this.cloudClient = cloudClient;
    this.mode = mode;
    this.failoverClient = failoverClient;
    this.usingFailover = false;
    this.consecutiveFailures = 0;
    this.cloudInitPromise = null;
  }

  async runWithRetry(fn) {
    let attempts = 0;
    const maxAttempts = 3;
    const timeoutMs = 10000;

    while (attempts < maxAttempts) {
      attempts++;
      let timeoutId = null;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Database operation timed out after ${timeoutMs / 1000} seconds`)),
          timeoutMs
        );
      });

      try {
        const client = (this.usingFailover && this.failoverClient) ? this.failoverClient : this.cloudClient;
        const result = await Promise.race([fn(client), timeoutPromise]);
        clearTimeout(timeoutId);
        this.consecutiveFailures = 0;
        return result;
      } catch (err) {
        clearTimeout(timeoutId);
        if (attempts >= maxAttempts) {
          this.consecutiveFailures++;
          if (this.consecutiveFailures >= 3 && this.failoverClient && !this.usingFailover) {
            console.warn("[WARN] Turso is temporarily unreachable. Switching to LiteFS failover replica...");
            this.usingFailover = true;
            return this.runWithRetry(fn);
          }
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  async exec(sql) {
    if (this.mode === "only-cloud" && (this.cloudClient || this.failoverClient)) {
      const trimmed = sql.trim().replace(/;$/, "").toUpperCase();
      if (trimmed === "BEGIN" || trimmed === "BEGIN IMMEDIATE" || trimmed === "COMMIT" || trimmed === "ROLLBACK") {
        return;
      }
      return await this.runWithRetry(async (client) => {
        return await client.executeMultiple(sql);
      });
    } else {
      return this.localDb.exec(sql);
    }
  }

  prepare(sql) {
    const self = this;
    return {
      async run(...args) {
        if (self.mode === "only-cloud" && (self.cloudClient || self.failoverClient)) {
          const res = await self.runWithRetry(async (client) => {
            return await client.execute({ sql, args });
          });
          return {
            changes: res.rowsAffected || 0,
            lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : undefined,
          };
        } else {
          return self.localDb.prepare(sql).run(...args);
        }
      },
      async get(...args) {
        if (self.mode === "only-cloud" && (self.cloudClient || self.failoverClient)) {
          const res = await self.runWithRetry(async (client) => {
            return await client.execute({ sql, args });
          });
          return res.rows[0];
        } else {
          return self.localDb.prepare(sql).get(...args);
        }
      },
      async all(...args) {
        if (self.mode === "only-cloud" && (self.cloudClient || self.failoverClient)) {
          const res = await self.runWithRetry(async (client) => {
            return await client.execute({ sql, args });
          });
          return res.rows;
        } else {
          return self.localDb.prepare(sql).all(...args);
        }
      },
    };
  }

  close() {
    if (this.localDb) {
      try {
        this.localDb.close();
      } catch (e) {}
      this.localDb = null;
    }
    if (this.cloudClient) {
      try {
        this.cloudClient.close();
      } catch (e) {}
      this.cloudClient = null;
    }
    if (this.failoverClient) {
      try {
        this.failoverClient.close();
      } catch (e) {}
      this.failoverClient = null;
    }
    this.cloudInitPromise = null;
  }
}

function cloudFingerprint(url) {
  return createHash("sha256").update(String(url || "")).digest("hex").slice(0, 16);
}

async function readLocalSyncState(db, key) {
  if (!db?.localDb) return null;
  try {
    const row = await db.prepare("SELECT value FROM sync_state WHERE key = ?;").get(key);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function writeLocalSyncState(db, key, value) {
  if (!db?.localDb) return;
  await db.prepare(`
    INSERT INTO sync_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
  `).run(key, String(value), Date.now());
}

export async function ensureCloudConnection(db = null, { runBackfill = true } = {}) {
  const target = db || await getDatabase();
  if (target.mode === "only-local") return target;
  if (target.cloudClient || target.failoverClient) return target;
  if (target.cloudInitPromise) return await target.cloudInitPromise;

  target.cloudInitPromise = (async () => {
    const config = getConfig();
    const secrets = await resolveCloudSecrets();
    const tursoUrl = secrets?.dbUrl || config.tursoUrl;
    const failoverUrl = config.failoverUrl || "";
    const token = secrets?.token;

    if (!tursoUrl) {
      throw new Error("Turso URL is required for cloud synchronization. Please login first.");
    }

    target.cloudClient = createClient({
      url: tursoUrl,
      authToken: token || undefined,
    });
    if (failoverUrl) {
      target.failoverClient = createClient({
        url: failoverUrl,
        authToken: token || undefined,
      });
    }

    const fingerprint = cloudFingerprint(tursoUrl);
    const schemaStateKey = `cloud_schema_version:${fingerprint}`;
    const checkedVersion = await readLocalSyncState(target, schemaStateKey);
    if (checkedVersion !== String(LATEST_SCHEMA_VERSION)) {
      const migrationClient = createClient({
        url: tursoUrl,
        authToken: token || undefined,
      });
      const cloudDbWrapper = new DatabaseWrapper(null, migrationClient, "only-cloud", null);
      try {
        await runMigrations(cloudDbWrapper);
      } finally {
        cloudDbWrapper.close();
      }
      await writeLocalSyncState(target, schemaStateKey, LATEST_SCHEMA_VERSION);
    }

    if (runBackfill) {
      const backfillStateKey = `rag_blob_backfill_v1:${fingerprint}`;
      const backfilled = await readLocalSyncState(target, backfillStateKey);
      if (backfilled !== "done") {
        const { backfillCloudBlobsFromLocal } = await import("./rag_blob_transport.js");
        const summary = await backfillCloudBlobsFromLocal(target);
        if (!summary?.errors) await writeLocalSyncState(target, backfillStateKey, "done");
      }
    }

    return target;
  })();

  try {
    return await target.cloudInitPromise;
  } catch (err) {
    if (target.cloudClient) {
      try { target.cloudClient.close(); } catch {}
      target.cloudClient = null;
    }
    if (target.failoverClient) {
      try { target.failoverClient.close(); } catch {}
      target.failoverClient = null;
    }
    throw err;
  } finally {
    target.cloudInitPromise = null;
  }
}

function scheduleHybridBackgroundSync() {
  if (hybridSyncScheduled || process.env.MEMORY_DISABLE_BACKGROUND_SYNC === "1") return;
  hybridSyncScheduled = true;
  const timer = setTimeout(() => {
    import("./sync_queue.js")
      .then(({ triggerBackgroundSync }) => triggerBackgroundSync())
      .catch((err) => console.warn("[WARN] Background memory sync skipped:", err.message));
  }, 0);
  if (typeof timer.unref === "function") timer.unref();
}

async function openDatabase(customPath, mode) {
  const config = getConfig();
  let localDb = null;
  if (mode !== "only-cloud") {
    const dbPath = customPath || DB_PATH;
    const parentDir = join(dbPath, "..");
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    localDb = new DatabaseSync(dbPath);
    localDb.exec("PRAGMA foreign_keys = ON;");
    localDb.exec("PRAGMA journal_mode = WAL;");
    localDb.exec("PRAGMA busy_timeout = 5000;");
  }

  let cloudClient = null;
  let failoverClient = null;
  if (mode === "only-cloud") {
    const secrets = await resolveCloudSecrets();
    const tursoUrl = customPath && customPath.startsWith("libsql:") ? customPath : (secrets?.dbUrl || config.tursoUrl);
    const failoverUrl = config.failoverUrl || "";
    const token = secrets?.token;

    if (!tursoUrl) {
      throw new Error("Turso URL is required for only-cloud mode. Please login first.");
    }
    cloudClient = createClient({
      url: tursoUrl,
      authToken: token || undefined,
    });
    if (failoverUrl) {
      failoverClient = createClient({
        url: failoverUrl,
        authToken: token || undefined,
      });
    }
  }

  // Hybrid mode deliberately opens only the local replica here. Cloud clients,
  // remote migrations, and legacy blob backfill are initialized lazily by the
  // background sync path so local reads never wait on Turso.
  const wrappedDb = new DatabaseWrapper(localDb, cloudClient, mode, failoverClient);
  await runMigrations(wrappedDb);

  if (mode === "only-cloud" && cloudClient) {
    try {
      const { backfillCloudBlobsFromLocal } = await import("./rag_blob_transport.js");
      await backfillCloudBlobsFromLocal(wrappedDb);
    } catch (err) {
      console.warn("[WARN] RAG cloud blob backfill skipped:", err.message);
    }
  }

  if (!customPath) {
    if (dbInstance && dbInstance !== wrappedDb) {
      try {
        dbInstance.close();
      } catch {}
    }
    dbInstance = wrappedDb;
    if (mode === "hybrid-sync") scheduleHybridBackgroundSync();
  }

  return wrappedDb;
}

export async function getDatabase(customPath = null, forceMode = null) {
  const config = getConfig();
  const mode = forceMode || config.mode || "only-local";

  if (!customPath) {
    if (dbInstance && dbInstance.mode === mode) {
      return dbInstance;
    }
    const isCloudMode = mode === "only-cloud";
    if (isCloudMode && !dbInitPromise && dbLastFailAt && (Date.now() - dbLastFailAt) < DB_FAIL_COOLDOWN_MS) {
      throw new Error("Database initialization failed recently. Retrying in a few seconds...");
    }
    if (!dbInitPromise) {
      dbInitPromise = openDatabase(null, mode).then((result) => {
        dbLastFailAt = 0;
        return result;
      }).catch((err) => {
        dbLastFailAt = Date.now();
        throw err;
      }).finally(() => {
        dbInitPromise = null;
      });
    }
    return await dbInitPromise;
  }

  return openDatabase(customPath, mode);
}

export function closeDatabase() {
  dbInitPromise = null;
  dbLastFailAt = 0;
  hybridSyncScheduled = false;
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
