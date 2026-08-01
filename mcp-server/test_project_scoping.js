// Path-scoping tests for the Notebook memory store.
// Run: node test_project_scoping.js
import { mkdtemp, writeFile, readFile, rm, readdir, mkdir } from "fs/promises";
import { join, basename } from "path";
import { tmpdir } from "os";
import assert from "assert";

const ROOT = await mkdtemp(join(tmpdir(), "memscope-"));

process.env.MEMORY_DIR = join(ROOT, "store");
delete process.env.OPENCODE_CONFIG_DIR;

const mem = await import("./memory.js");
await mem.ensureDir();

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
  console.log(`  [OK] ${msg}`);
}

const dirA = join(ROOT, "projects", "app");
const dirB = join(ROOT, "other", "app"); // same basename as A

console.log("\n[1] Distinct path keys for same basename");
{
  const keyA = mem.projectKey(null, dirA);
  const keyB = mem.projectKey(null, dirB);
  ok(keyA !== keyB, `keys differ (${keyA} vs ${keyB})`);
  ok(mem.canonicalPath(dirA) === keyA, "canonicalPath stable on win32");

  await writeMemoryA(dirA, "fact A");
  await writeMemoryA(dirB, "fact B");
  ok(mem.memoryFileName(keyA) !== mem.memoryFileName(keyB), "filenames differ");

  const ra = await mem.readMemoryRaw(keyA);
  const rb = await mem.readMemoryRaw(keyB);
  ok(ra.length === 1 && ra[0].includes("fact A"), "A contains only its own fact");
  ok(rb.length === 1 && rb[0].includes("fact B"), "B contains only its own fact");

  const contentA = await readFile(join(process.env.MEMORY_DIR, mem.memoryFileName(keyA)), "utf-8");
  ok(contentA.includes(`<!-- path: ${keyA} -->`), "path metadata header present in A");
  ok(contentA.startsWith(`# Memory: ${basename(keyA)}`), "basename display header present");
}

async function writeMemoryA(dir, factText) {
  const key = mem.projectKey(null, dir);
  const entries = await mem.readMemory(key);
  entries.push(`- [2026-08-01] ${factText}`);
  await mem.writeMemory(key, entries);
}

console.log("\n[2] listProjectStores listing & binding");
{
  const stores = await mem.listProjectStores();
  ok(stores.length === 2, "returns the 2 path-bound stores");
  ok(stores.every((s) => s.path), "all stores bound to paths");
  ok(stores.every((s) => !s.legacy), "no legacy stores");
  ok(stores.some((s) => s.path === mem.canonicalPath(dirA)), "store A shows its bound path");
}

console.log("\n[3] Lazy legacy migration on path read");
{
  const legacyDir = join(ROOT, "proj", "comfy-meta-viewer");
  await mkdir(legacyDir, { recursive: true });
  await writeFile(
    join(process.env.MEMORY_DIR, "comfy-meta-viewer.md"),
    "# Memory: comfy-meta-viewer\n\n- [2026-07-30] legacy fact\n"
  );

  const legacyKey = mem.projectKey(null, legacyDir);
  const migrated = await mem.readMemoryRaw(legacyKey);
  ok(migrated.length === 1 && migrated[0].includes("legacy fact"), "legacy fact readable through path key");

  const files = await readdir(process.env.MEMORY_DIR);
  ok(!files.includes("comfy-meta-viewer.md"), "legacy file removed after lazy migration");
  ok(files.includes(mem.memoryFileName(legacyKey)), "path-bound file created");

  const migContent = await readFile(join(process.env.MEMORY_DIR, mem.memoryFileName(legacyKey)), "utf-8");
  ok(migContent.includes(`<!-- path: ${legacyKey} -->`), "migrated store bound to path");
}

console.log("\n[4] Explicit migrateLegacyStore");
{
  const legacy2Dir = join(ROOT, "lib", "unicorn-service");
  await mkdir(legacy2Dir, { recursive: true });
  await writeFile(
    join(process.env.MEMORY_DIR, "unicorn_service.md"),
    "# Memory: unicorn_service\n\n- [2026-07-29] go backend\n"
  );

  const mig = await mem.migrateLegacyStore("unicorn_service", legacy2Dir);
  ok(mig.ok, "explicit migration reports ok");

  const files = await readdir(process.env.MEMORY_DIR);
  ok(!files.includes("unicorn_service.md"), "explicit migration removed legacy file");

  const r2 = await mem.readMemoryRaw(mem.projectKey(null, legacy2Dir));
  ok(r2.length === 1 && r2[0].includes("go backend"), "explicitly migrated store readable by path");
}

console.log("\n[5] No cross-project pollution");
{
  const unrelated = await mem.readMemoryRaw(mem.projectKey(null, join(ROOT, "unrelated")));
  ok(unrelated.length === 0, "unrelated path yields no facts");
}

console.log("\n[6] Global store untouched");
{
  const gk = mem.scopeKey("global", null, dirA);
  ok(gk === mem.GLOBAL_KEY, "global key unchanged");
  const entries = await mem.readMemory(gk);
  entries.push("- [2026-08-01] global fact");
  await mem.writeMemory(gk, entries);
  const gf = await mem.readMemoryRaw(gk);
  ok(gf.length === 1, "global store works");
  const gc = await readFile(join(process.env.MEMORY_DIR, "global.md"), "utf-8");
  ok(gc.startsWith("# Global Memory"), "global header preserved");
  const stores = await mem.listProjectStores();
  ok(!stores.some((s) => s.file === "global.md"), "global excluded from project stores");
}

await rm(ROOT, { recursive: true, force: true });
console.log(`\nAll ${passed} assertions passed.`);
