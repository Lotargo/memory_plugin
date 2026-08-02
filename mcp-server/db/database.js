import { DatabaseSync } from "node:sqlite";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { MEMORY_DIR } from "../memory.js";
import { runMigrations } from "./migrations.js";
import { getConfig } from "../config/config_manager.js";
import { loadSecrets } from "../config/auth_store.js";
import { createClient } from "@libsql/client";

let dbInstance = null;

export const STORAGE_DIR = join(MEMORY_DIR, "storage");
export const BLOBS_DIR = join(STORAGE_DIR, "blobs");
export const MODELS_DIR = join(STORAGE_DIR, "models");
export const DB_PATH = join(STORAGE_DIR, "memory.sqlite");

class DatabaseWrapper {
  constructor(localDb, cloudClient, mode) {
    this.localDb = localDb;
    this.cloudClient = cloudClient;
    this.mode = mode;
  }

  async exec(sql) {
    if (this.mode === "only-cloud" && this.cloudClient) {
      const trimmed = sql.trim().replace(/;$/, "").toUpperCase();
      if (trimmed === "BEGIN" || trimmed === "BEGIN IMMEDIATE" || trimmed === "COMMIT" || trimmed === "ROLLBACK") {
        return;
      }
      return await this.cloudClient.executeMultiple(sql);
    } else {
      return this.localDb.exec(sql);
    }
  }

  prepare(sql) {
    const self = this;
    return {
      async run(...args) {
        if (self.mode === "only-cloud" && self.cloudClient) {
          const res = await self.cloudClient.execute({ sql, args });
          return {
            changes: res.rowsAffected || 0,
            lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : undefined,
          };
        } else {
          return self.localDb.prepare(sql).run(...args);
        }
      },
      async get(...args) {
        if (self.mode === "only-cloud" && self.cloudClient) {
          const res = await self.cloudClient.execute({ sql, args });
          return res.rows[0];
        } else {
          return self.localDb.prepare(sql).get(...args);
        }
      },
      async all(...args) {
        if (self.mode === "only-cloud" && self.cloudClient) {
          const res = await self.cloudClient.execute({ sql, args });
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
  }
}

export async function getDatabase(customPath = null, forceMode = null) {
  const config = getConfig();
  const mode = forceMode || config.mode || "only-local";

  if (dbInstance && !customPath && dbInstance.mode === mode) {
    return dbInstance;
  }

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
  if (mode === "only-cloud" || mode === "hybrid-sync") {
    const secrets = loadSecrets();
    const tursoUrl = customPath && customPath.startsWith("libsql:") ? customPath : (secrets?.dbUrl || config.tursoUrl);
    const token = secrets?.token;

    if (tursoUrl) {
      cloudClient = createClient({
        url: tursoUrl,
        authToken: token || undefined,
      });
      // In hybrid-sync mode, ensure remote schema is also fully migrated and up to date
      if (mode === "hybrid-sync") {
        const cloudDbWrapper = new DatabaseWrapper(null, cloudClient, "only-cloud");
        await runMigrations(cloudDbWrapper);
      }
    } else if (mode === "only-cloud") {
      throw new Error("Turso URL is required for only-cloud mode. Please login first.");
    }
  }

  const wrappedDb = new DatabaseWrapper(localDb, cloudClient, mode);

  // Initialize/run migrations
  await runMigrations(wrappedDb);

  if (!customPath) {
    dbInstance = wrappedDb;
  }

  return wrappedDb;
}

export function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
