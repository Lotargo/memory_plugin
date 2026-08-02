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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const client = (this.usingFailover && this.failoverClient) ? this.failoverClient : this.cloudClient;
        const result = await Promise.race([
          fn(client),
          new Promise((_, reject) => {
            controller.signal.addEventListener("abort", () => {
              reject(new Error("Database operation timed out after 10 seconds"));
            });
          })
        ]);
        clearTimeout(timeoutId);
        // Successful operation, reset consecutive failures
        this.consecutiveFailures = 0;
        return result;
      } catch (err) {
        clearTimeout(timeoutId);
        if (attempts >= maxAttempts) {
          this.consecutiveFailures++;
          if (this.consecutiveFailures >= 3 && this.failoverClient && !this.usingFailover) {
            console.warn("[WARN] Turso is temporarily unreachable. Switching to LiteFS failover replica...");
            this.usingFailover = true;
            // Retry the operation on the failover client
            return this.runWithRetry(fn);
          }
          throw err;
        }
        // Small delay before retrying (exponential backoff / fixed delay)
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
  }

  let cloudClient = null;
  let failoverClient = null;
  if (mode === "only-cloud" || mode === "hybrid-sync") {
    // Resolve working cloud credentials. An env TURSO_API_TOKEN (which can only
    // call the Platform API) is lazily minted into a per-database JWT here.
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
      // In hybrid-sync mode, ensure remote schema is also fully migrated and up to date
      if (mode === "hybrid-sync") {
        const cloudDbWrapper = new DatabaseWrapper(null, cloudClient, "only-cloud", failoverClient);
        await runMigrations(cloudDbWrapper);
      }
    } else if (mode === "only-cloud") {
      throw new Error("Turso URL is required for only-cloud mode. Please login first.");
    }
  }

  const wrappedDb = new DatabaseWrapper(localDb, cloudClient, mode, failoverClient);

  // Initialize/run migrations
  await runMigrations(wrappedDb);

  if (!customPath) {
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
    // Deduplicate concurrent default-DB initialization so migrations never run
    // on multiple connections at once (avoids "database is locked" crashes).
    if (!dbInitPromise) {
      dbInitPromise = openDatabase(null, mode).finally(() => {
        dbInitPromise = null;
      });
    }
    return await dbInitPromise;
  }

  return openDatabase(customPath, mode);
}

export function closeDatabase() {
  dbInitPromise = null;
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
