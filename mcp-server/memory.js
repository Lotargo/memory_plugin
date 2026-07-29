import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

const CONFIG_DIR = process.env.MEMORY_DIR || process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode");
export const MEMORY_DIR = join(CONFIG_DIR, "memory");
export const GLOBAL_KEY = "global";

export async function ensureDir() {
  if (!existsSync(MEMORY_DIR)) await mkdir(MEMORY_DIR, { recursive: true });
}

export function projectName(worktree, directory) {
  const dir = worktree || directory || process.cwd();
  return dir ? basename(dir) : "default";
}

export function scopeKey(scope, worktree, directory) {
  return scope === "global" ? GLOBAL_KEY : projectName(worktree, directory);
}

function memoryPath(key) {
  return join(MEMORY_DIR, `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.md`);
}

export async function readMemory(key) {
  const fp = memoryPath(key);
  if (!existsSync(fp)) return [];
  const content = await readFile(fp, "utf-8");
  return content.split("\n").filter((l) => l.startsWith("- ["));
}

export async function readMemoryRaw(key) {
  return (await readMemory(key)).map((e) => e.slice(2));
}

export async function writeMemory(key, entries) {
  const header = `# ${key === GLOBAL_KEY ? "Global Memory" : `Memory: ${key}`}\n\n`;
  await writeFile(memoryPath(key), header + entries.join("\n") + "\n");
}

export function today() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${date} ${time}`;
}
