import { DatabaseSync } from "node:sqlite";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { MEMORY_DIR, ensureDir } from "../memory.js";
import { runMigrations } from "./migrations.js";

let dbInstance = null;

export const STORAGE_DIR = join(MEMORY_DIR, "storage");
export const BLOBS_DIR = join(STORAGE_DIR, "blobs");
export const MODELS_DIR = join(STORAGE_DIR, "models");
export const DB_PATH = join(STORAGE_DIR, "memory.sqlite");

export function getDatabase(customPath = null) {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const dbPath = customPath || DB_PATH;
  const parentDir = join(dbPath, "..");
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");

  runMigrations(db);

  if (!customPath) {
    dbInstance = db;
  }

  return db;
}

export function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
