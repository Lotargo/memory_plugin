import { DatabaseSync } from "node:sqlite";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { MEMORY_DIR } from "../memory.js";
import { runMigrations } from "./migrations.js";
import { getConfig } from "../config/config_manager.js";
import { resolveCloudSecrets } from "../admin/auth.js";
import { createClient } from "@libsql/client";

let dbInstance = null;
let dbInitPromise = null;
let dbLastFailAt = 0;
const DB_FAIL_COOLDOWN_MS = 5_000;

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
  }
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
  if (mode === "only-cloud" || mode === "hybrid-sync") {
    const secrets = await resolveCloudSecrets();
    const tursoUrl = customPath && customPath.startsWith("libsql:") ? customPath : (secrets?.dbUrl || config.tursoUrl);
    const failoverUrl = config.failoverUrl || "";
    const token = secrets?.token;

    if (tursoUrl) {
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
      if (mode === "hybrid-sync") {
        const remoteClient = createClient({
          url: tursoUrl,
          authToken: token || undefined,
        });
        const cloudDbWrapper = new DatabaseWrapper(null, remoteClient, "only-cloud", null);
        await runMigrations(cloudDbWrapper);
        cloudDbWrapper.close();
      }
    } else if (mode === "only-cloud") {
      throw new Error("Turso URL is required for only-cloud mode. Please login first.");
    }
  }

  const wrappedDb = new DatabaseWrapper(localDb, cloudClient, mode, failoverClient);
  await runMigrations(wrappedDb);

  // Upgrade path for RAG content ingested before portable cloud blobs existed.
  // The backfill is content-addressed and uploads only hashes absent in Turso.
  // Missing local files are simply reported/skipped; database availability must
  // never depend on a legacy raw blob still being present on this machine.
  if ((mode === "only-cloud" || mode === "hybrid-sync") && cloudClient) {
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
    const isCloudMode = mode === "only-cloud" || mode === "hybrid-sync";
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
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
