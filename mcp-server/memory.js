import { readFile, writeFile, mkdir, unlink, readdir } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join, basename, resolve } from "path";
import { homedir } from "os";
import { resolveProjectIdentity } from "./identity.js";

function resolveMemoryDir() {
  if (process.env.MEMORY_DIR) return process.env.MEMORY_DIR;
  if (process.env.OPENCODE_CONFIG_DIR) return join(process.env.OPENCODE_CONFIG_DIR, "memory");

  const legacyDir = join(homedir(), ".config", "opencode", "memory");
  if (existsSync(legacyDir)) {
    return legacyDir;
  }

  if (process.platform === "win32") {
    const appData = process.env.LOCALAPPDATA || process.env.APPDATA || join(homedir(), "AppData", "Local");
    return join(appData, "opencode", "memory");
  }

  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "opencode", "memory");
}

export const MEMORY_DIR = resolveMemoryDir();
export const GLOBAL_KEY = "global";

export async function ensureDir() {
  if (!existsSync(MEMORY_DIR)) await mkdir(MEMORY_DIR, { recursive: true });
  const storageDir = join(MEMORY_DIR, "storage");
  const blobsDir = join(storageDir, "blobs");
  const modelsDir = join(storageDir, "models");
  const exportsDir = join(MEMORY_DIR, "exports");
  if (!existsSync(blobsDir)) await mkdir(blobsDir, { recursive: true });
  if (!existsSync(modelsDir)) await mkdir(modelsDir, { recursive: true });
  if (!existsSync(exportsDir)) await mkdir(exportsDir, { recursive: true });
}

export function ensureDirSync() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  const storageDir = join(MEMORY_DIR, "storage");
  const blobsDir = join(storageDir, "blobs");
  const modelsDir = join(storageDir, "models");
  const exportsDir = join(MEMORY_DIR, "exports");
  if (!existsSync(blobsDir)) mkdirSync(blobsDir, { recursive: true });
  if (!existsSync(modelsDir)) mkdirSync(modelsDir, { recursive: true });
  if (!existsSync(exportsDir)) mkdirSync(exportsDir, { recursive: true });
}

export function canonicalPath(dir) {
  let p = resolve(dir || process.cwd());
  if (process.platform === "win32") {
    p = p.replace(/\\/g, "/").replace(/^([a-zA-Z]):/, (_, d) => `${d.toLowerCase()}:`);
  }
  return p;
}

export async function projectKey(worktree, directory) {
  const dir = worktree || directory || process.cwd();
  const identity = await resolveProjectIdentity(dir);
  return identity ? identity.key : null;
}

export async function projectName(worktree, directory) {
  const dir = worktree || directory || process.cwd();
  const identity = await resolveProjectIdentity(dir);
  return identity ? identity.name : (dir ? basename(resolve(dir)) : "default");
}

export async function scopeKey(scope, worktree, directory) {
  return scope === "global" ? GLOBAL_KEY : await projectKey(worktree, directory);
}

export function slugify(key) {
  if (!key) return "null";
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function memoryPath(key) {
  return join(MEMORY_DIR, `${slugify(key)}.md`);
}

export function memoryFileName(key) {
  return basename(memoryPath(key));
}

export function storeFilePath(key) {
  return memoryPath(key);
}

export function parseMeta(content) {
  const m = content.match(/<!-- key: (.+?) -->/) || content.match(/<!-- path: (.+?) -->/);
  return { key: m ? m[1].trim() : null };
}

function isSimpleKey(key) {
  return /^[a-zA-Z0-9_-]+$/.test(key);
}

export async function readMemory(key) {
  if (!key) return [];
  const { getConfig } = await import("./config/config_manager.js");
  const config = getConfig();
  if (config.mode === "only-cloud") {
    try {
      const { getDatabase } = await import("./db/database.js");
      const db = await getDatabase();
      const row = await db.prepare("SELECT content FROM notebooks WHERE key = ?;").get(key);
      if (row && row.content) {
        return row.content.split("\n").filter((l) => l.startsWith("- ["));
      }
    } catch (err) {
      console.error("Failed to read memory from cloud database:", err.message);
    }
    return [];
  }

  const fp = memoryPath(key);
  if (config.mode === "hybrid-sync") {
    try {
      const { ensureReverseSync } = await import("./db/sync_queue.js");
      await ensureReverseSync();
    } catch (err) {
      console.error("Failed to reverse-sync before read:", err.message);
    }
  }
  if (existsSync(fp)) {
    const content = await readFile(fp, "utf-8");
    return content.split("\n").filter((l) => l.startsWith("- ["));
  }
  return [];
}

export async function readMemoryRaw(key) {
  return (await readMemory(key)).map((e) => e.slice(2));
}

export function buildMemoryContent(key, entries) {
  const lines = [];
  if (key === GLOBAL_KEY) {
    lines.push("# Global Memory", "");
  } else {
    lines.push(`# Memory: ${basename(key) || key}`, "");
    lines.push(`<!-- key: ${key} -->`, "");
  }
  return lines.join("\n") + "\n" + (entries.length ? entries.join("\n") + "\n" : "");
}

export function extractFacts(content) {
  return (content || "").split("\n").filter((l) => l.startsWith("- ["));
}

export async function writeMemoryFile(key, content) {
  if (!key) return;
  await writeFile(memoryPath(key), content);
}

export async function writeMemory(key, entries) {
  if (!key) return;
  const content = buildMemoryContent(key, entries);

  const { getConfig } = await import("./config/config_manager.js");
  const config = getConfig();
  if (config.mode === "only-cloud") {
    try {
      const { getDatabase } = await import("./db/database.js");
      const db = await getDatabase();
      await db.prepare(`
        INSERT INTO notebooks (key, content, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at;
      `).run(key, content, Date.now());
    } catch (err) {
      console.error("Failed to write memory to cloud database:", err.message);
    }
    return;
  }

  await writeFile(memoryPath(key), content);

  if (config.mode === "hybrid-sync") {
    try {
      const { enqueueSyncTask } = await import("./db/sync_queue.js");
      await enqueueSyncTask("write_memory", key, content);
    } catch (err) {
      console.error("Failed to queue memory sync task:", err.message);
    }
  }
}

export async function listProjectStores() {
  const { getConfig } = await import("./config/config_manager.js");
  const config = getConfig();
  if (config.mode === "only-cloud") {
    try {
      const { getDatabase } = await import("./db/database.js");
      const db = await getDatabase();
      const rows = await db.prepare("SELECT key, content FROM notebooks WHERE key != ?;").all(GLOBAL_KEY);
      const stores = [];
      for (const row of rows) {
        const key = row.key;
        const content = row.content;
        const facts = content.split("\n").filter((l) => l.startsWith("- ["));
        const meta = parseMeta(content);
        stores.push({
          key,
          path: meta.key || key,
          basename: basename(meta.key || key) || key,
          file: `${slugify(key)}.md`,
          count: facts.length,
          legacy: !meta.key || meta.key.startsWith("/"),
        });
      }
      stores.sort((a, b) => a.basename.localeCompare(b.basename));
      return stores;
    } catch (err) {
      console.error("Failed to list memory stores from cloud database:", err.message);
    }
    return [];
  }

  const stores = [];
  const files = await readdir(MEMORY_DIR).catch(() => []);
  for (const f of files) {
    if (!f.endsWith(".md") || f === `${GLOBAL_KEY}.md`) continue;
    const fp = join(MEMORY_DIR, f);
    let content = "";
    try {
      content = await readFile(fp, "utf-8");
    } catch (e) {
      continue;
    }
    const facts = content.split("\n").filter((l) => l.startsWith("- ["));
    const meta = parseMeta(content);
    const key = meta.key || f.slice(0, -3);
    stores.push({
      key,
      path: meta.key,
      basename: basename(meta.key || key) || key,
      file: f,
      count: facts.length,
      legacy: !meta.key || meta.key.startsWith("/"),
    });
  }
  stores.sort((a, b) => a.basename.localeCompare(b.basename));
  return stores;
}

export async function migrateLegacyStore(legacyKey, targetDir) {
  const legacyFp = join(MEMORY_DIR, `${legacyKey.replace(/[^a-zA-Z0-9_-]/g, "_")}.md`);
  if (!existsSync(legacyFp)) return { ok: false, reason: "not_found", key: legacyKey };
  const content = await readFile(legacyFp, "utf-8");
  if (parseMeta(content).key) return { ok: false, reason: "already_bound", key: legacyKey };

  const targetKey = await projectKey(targetDir, null);
  if (!targetKey) return { ok: false, reason: "not_a_git_repo", key: legacyKey };

  const facts = content.split("\n").filter((l) => l.startsWith("- ["));
  await writeMemory(targetKey, facts);
  try {
    await unlink(legacyFp);
  } catch (e) {}
  return { ok: true, key: targetKey, file: memoryPath(targetKey), facts: facts.length };
}

// Mass-stamp titles onto legacy facts in a store. Returns how many lines were
// changed. Skips stores that already have titles on every fact (fast no-op).
export async function migrateStoreTitles(key) {
  if (!key) return { ok: false, reason: "no_key", changed: 0 };
  const { withTitle } = await import("./fact_format.js");
  const facts = await readMemory(key);
  let changed = 0;
  const migrated = facts.map((line) => {
    const next = withTitle(line);
    if (next !== line) changed++;
    return next;
  });
  if (!changed) return { ok: true, changed: 0 };
  await writeMemory(key, migrated);
  return { ok: true, changed };
}

export function today() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${date} ${time}`;
}
