import { readFile, writeFile, mkdir, unlink, readdir } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join, basename, resolve } from "path";
import { homedir } from "os";
import { resolveProjectIdentity } from "./identity.js";
import { atomicWrite, withSnapshotLock } from "./storage/snapshot_lock.js";
import { createHash } from "node:crypto";

// Read versions follow the returned array, including in-place CLI/MCP edits.
const readVersions = new WeakMap();
export function notebookVersion(entries) {
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}
function observed(entries) {
  readVersions.set(entries, notebookVersion(entries));
  return entries;
}

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

export function getActiveWorkspaceDir() {
  return (
    process.env.WORKSPACE_DIR ||
    process.env.PROJECT_DIR ||
    process.env.OPENCODE_WORKSPACE ||
    process.env.IDE_WORKSPACE ||
    null
  );
}

export function canonicalPath(dir) {
  let p = resolve(dir || getActiveWorkspaceDir() || process.cwd());
  if (process.platform === "win32") {
    p = p.replace(/\\/g, "/").replace(/^([a-zA-Z]):/, (_, d) => `${d.toLowerCase()}:`);
  }
  return p;
}

export async function projectKey(worktree, directory) {
  const dir = worktree || directory || getActiveWorkspaceDir() || process.cwd();
  const identity = await resolveProjectIdentity(dir);
  return identity ? identity.key : null;
}

export async function projectName(worktree, directory) {
  const dir = worktree || directory || getActiveWorkspaceDir() || process.cwd();
  const identity = await resolveProjectIdentity(dir);
  return identity ? identity.name : (dir ? basename(resolve(dir)) : "default");
}

export async function scopeKey(scope, worktree, directory) {
  return scope === "global" ? GLOBAL_KEY : await projectKey(worktree, directory);
}

export function slugify(key) {
  if (!key) return "null";
  return String(key).replace(/[^a-zA-Z0-9_-]/g, "_");
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

export async function readMemory(key) {
  if (!key) return [];
  if (existsSync(join(MEMORY_DIR, '.knowledge-journal.json'))) return withSnapshotLock(MEMORY_DIR, () => readMemory(key));
  const { getConfig, assertLocalMemoryReady } = await import("./config/config_manager.js");
  const config = getConfig();
  assertLocalMemoryReady(config);

  const fp = memoryPath(key);
  // Local working modes read directly from disk without cloud access.
  if (existsSync(fp)) {
    const content = await readFile(fp, "utf-8");
    return observed(content.split("\n").filter((l) => l.startsWith("- [")));
  }
  return observed([]);
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
  const { assertLocalMemoryReady } = await import("./config/config_manager.js");
  assertLocalMemoryReady();
  await withSnapshotLock(MEMORY_DIR, async () => {
    const { persistNotebookKnowledge } = await import('./services/knowledge_links_service.js');
    if (!(await persistNotebookKnowledge(key, content))) atomicWrite(memoryPath(key), content);
  });
}

export async function writeMemory(key, entries, { expectedVersion = readVersions.get(entries), localOnly = false } = {}) {
  if (!key) return;
  const content = buildMemoryContent(key, entries);

  const { getConfig, assertLocalMemoryReady } = await import("./config/config_manager.js");
  const config = getConfig();
  assertLocalMemoryReady(config);
  if (localOnly && !["only-local", "cloud-snapshots"].includes(config.mode)) {
    throw Object.assign(new Error("Storage mode changed. Reload before saving."), { code: "CONFLICT" });
  }

  await withSnapshotLock(MEMORY_DIR, async () => {
    if (expectedVersion !== undefined && notebookVersion(await readMemory(key)) !== expectedVersion) {
      const error = new Error("Notebook changed in another client. Reload before saving.");
      error.code = "CONFLICT";
      throw error;
    }
    const { persistNotebookKnowledge } = await import('./services/knowledge_links_service.js');
    const saved = await persistNotebookKnowledge(key, content);
    if (!saved) atomicWrite(memoryPath(key), content);
    else entries.splice(0, entries.length, ...saved.entries);
    readVersions.set(entries, notebookVersion(entries));
  });

}

export async function listProjectStores() {
  const { getConfig, assertLocalMemoryReady } = await import("./config/config_manager.js");
  const config = getConfig();
  assertLocalMemoryReady(config);

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
      legacy: !meta.key || (!meta.key.startsWith("git:") && !meta.key.startsWith("git_")),
    });
  }
  stores.sort((a, b) => a.basename.localeCompare(b.basename));
  return stores;
}

export async function migrateLegacyStore(legacyKey, targetDir) {
  const { executeProjectOperation } = await import('./services/project_service.js');
  try {
    const result = await executeProjectOperation('migrate', { sourceKey:legacyKey,
      ...(targetDir?.startsWith('git:') ? {targetKey:targetDir,directory:process.cwd()} : {directory:targetDir}) });
    return {ok:true,key:result.targetKey,file:storeFilePath(result.targetKey),facts:result.mergedFacts,backup:result.backup};
  } catch (error) { return {ok:false,reason:error.code || 'migration_failed',message:error.message,key:legacyKey}; }
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
