import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { MEMORY_DIR } from "../memory.js";
import { runMigrations } from "./migrations.js";
import { getConfig, assertStorageMode, assertLocalMemoryReady } from "../config/config_manager.js";

let dbInstance = null;
let dbInitPromise = null;

export const STORAGE_DIR = join(MEMORY_DIR, "storage");
export const BLOBS_DIR = join(STORAGE_DIR, "blobs");
export const MODELS_DIR = join(STORAGE_DIR, "models");
export const DB_PATH = join(STORAGE_DIR, "memory.sqlite");

class DatabaseWrapper {
  constructor(localDb, mode) {
    this.localDb = localDb;
    this.mode = mode;
    this.cloudClient = null;
  }
  async exec(sql) { return this.localDb.exec(sql); }
  prepare(sql) {
    const db = this;
    return {
      async run(...args) { return db.localDb.prepare(sql).run(...args); },
      async get(...args) { return db.localDb.prepare(sql).get(...args); },
      async all(...args) { return db.localDb.prepare(sql).all(...args); },
    };
  }
  close() {
    this.localDb?.close();
    this.localDb = null;
  }
}

async function openDatabase(customPath, mode) {
  const dbPath = customPath || DB_PATH;
  if (/^(?:libsql|https?|wss?):/i.test(dbPath)) throw new Error("Working databases must be local; use cloud-snapshots for cloud storage.");
  mkdirSync(dirname(dbPath), { recursive: true });
  const localDb = new DatabaseSync(dbPath);
  const db = new DatabaseWrapper(localDb, mode);
  db.isDefault = !customPath;
  try {
    localDb.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    await runMigrations(db);
    return db;
  } catch (error) { db.close(); throw error; }
}

// Snapshot preparation/recovery must inspect a former cloud-only cache while
// ordinary operations still report MIGRATION_REQUIRED.
export async function getMigrationDatabase(customPath = DB_PATH) {
  return openDatabase(customPath, "only-local");
}

export async function getDatabase(customPath = null, forceMode = null) {
  const config = getConfig();
  const mode = forceMode || config.mode;
  assertStorageMode(mode);
  if (!customPath) assertLocalMemoryReady(config);
  if (customPath) return openDatabase(customPath, mode);
  if (dbInstance?.mode === mode) return dbInstance;
  if (!dbInitPromise) {
    dbInitPromise = openDatabase(null, mode).then(db => {
      dbInstance?.close();
      dbInstance = db;
      return db;
    }).finally(() => { dbInitPromise = null; });
  }
  return dbInitPromise;
}

export function closeDatabase() {
  dbInitPromise = null;
  dbInstance?.close();
  dbInstance = null;
}
