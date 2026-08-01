import { readFile, writeFile, mkdir, unlink, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, basename, resolve } from "path";
import { homedir } from "os";

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

// Canonical absolute path key: forward slashes, lowercase drive letter on win32.
export function canonicalPath(dir) {
  let p = resolve(dir || process.cwd());
  if (process.platform === "win32") {
    p = p.replace(/\\/g, "/").replace(/^([a-zA-Z]):/, (_, d) => `${d.toLowerCase()}:`);
  }
  return p;
}

// Project store key = full directory path. This removes basename collisions and
// binds each store to the real project location.
export function projectKey(worktree, directory) {
  return canonicalPath(worktree || directory);
}

// Display label for a project (basename of the resolved directory).
export function projectName(worktree, directory) {
  const dir = worktree || directory || process.cwd();
  return dir ? basename(resolve(dir)) : "default";
}

export function scopeKey(scope, worktree, directory) {
  return scope === "global" ? GLOBAL_KEY : projectKey(worktree, directory);
}

function slugify(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function memoryPath(key) {
  return join(MEMORY_DIR, `${slugify(key)}.md`);
}

export function memoryFileName(key) {
  return basename(memoryPath(key));
}

function parseMeta(content) {
  const m = content.match(/<!-- path: (.+?) -->/);
  return { path: m ? m[1].trim() : null };
}

function isSimpleKey(key) {
  return /^[a-zA-Z0-9_-]+$/.test(key);
}

// Lazy migration: when reading a project path store that doesn't exist yet but a
// legacy <basename>.md store (without path binding) does, claim it under the path.
async function maybeMigrateLegacy(key) {
  if (key === GLOBAL_KEY || isSimpleKey(key)) return null;
  const legacyBasename = basename(key);
  if (!legacyBasename) return null;
  const legacyFp = join(MEMORY_DIR, `${legacyBasename}.md`);
  if (slugify(key) === legacyBasename || !existsSync(legacyFp)) return null;
  const content = await readFile(legacyFp, "utf-8");
  if (parseMeta(content).path) return null; // already bound to another project
  // Collision guard: a different path with the same basename is already bound,
  // so this legacy store is ambiguous and must not be silently claimed.
  const files = await readdir(MEMORY_DIR).catch(() => []);
  for (const f of files) {
    if (!f.endsWith(".md") || f === `${legacyBasename}.md` || f === `${GLOBAL_KEY}.md`) continue;
    try {
      const other = parseMeta(await readFile(join(MEMORY_DIR, f), "utf-8")).path;
      if (other && basename(other) === legacyBasename) return null;
    } catch (e) {}
  }
  const facts = content.split("\n").filter((l) => l.startsWith("- ["));
  await writeMemory(key, facts);
  try {
    await unlink(legacyFp);
  } catch (e) {}
  return facts;
}

export async function readMemory(key) {
  const fp = memoryPath(key);
  if (existsSync(fp)) {
    const content = await readFile(fp, "utf-8");
    return content.split("\n").filter((l) => l.startsWith("- ["));
  }
  const migrated = await maybeMigrateLegacy(key);
  return migrated || [];
}

export async function readMemoryRaw(key) {
  return (await readMemory(key)).map((e) => e.slice(2));
}

export async function writeMemory(key, entries) {
  const lines = [];
  if (key === GLOBAL_KEY) {
    lines.push("# Global Memory", "");
  } else {
    lines.push(`# Memory: ${basename(key) || key}`, "");
    if (!isSimpleKey(key)) {
      lines.push(`<!-- path: ${key} -->`, "");
    }
  }
  const content = lines.join("\n") + "\n" + (entries.length ? entries.join("\n") + "\n" : "");
  await writeFile(memoryPath(key), content);
}

export async function listProjectStores() {
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
    const key = meta.path || f.slice(0, -3);
    stores.push({
      key,
      path: meta.path,
      basename: basename(meta.path || key) || key,
      file: f,
      count: facts.length,
      legacy: !meta.path,
    });
  }
  stores.sort((a, b) => a.basename.localeCompare(b.basename));
  return stores;
}

// Bind an unbound legacy store (e.g. "comfy-meta-viewer") to a directory path.
export async function migrateLegacyStore(legacyKey, targetDir) {
  const legacyFp = join(MEMORY_DIR, `${legacyKey.replace(/[^a-zA-Z0-9_-]/g, "_")}.md`);
  if (!existsSync(legacyFp)) return { ok: false, reason: "not_found", key: legacyKey };
  const content = await readFile(legacyFp, "utf-8");
  if (parseMeta(content).path) return { ok: false, reason: "already_bound", key: legacyKey };
  const targetKey = projectKey(targetDir, null);
  const facts = content.split("\n").filter((l) => l.startsWith("- ["));
  await writeMemory(targetKey, facts);
  try {
    await unlink(legacyFp);
  } catch (e) {}
  return { ok: true, key: targetKey, file: memoryPath(targetKey), facts: facts.length };
}

export function today() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${date} ${time}`;
}
