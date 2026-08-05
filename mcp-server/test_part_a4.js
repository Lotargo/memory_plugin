import assert from "node:assert";
import { formatFactEntry, withTitle, factTitle, factBody } from "./fact_format.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

console.log("--- Running Part A4 Migrate Titles Tests ---");

const TMP_CONFIG_DIR = join(tmpdir(), `test_a4_${Date.now()}`);
process.env.OPENCODE_CONFIG_DIR = TMP_CONFIG_DIR;
process.env.MEMORY_DIR = join(TMP_CONFIG_DIR, "memory");

const { ensureDirSync, GLOBAL_KEY, writeMemory, readMemory, migrateStoreTitles } = await import("./memory.js");
ensureDirSync();

// withTitle: unit-level
const legacy = formatFactEntry({
  date: "2026-08-03",
  time: "10:00",
  text: "user prefers TypeScript over JavaScript for backend work",
  meta: { id: "abc123", keep: "1" },
});
const titled = withTitle(legacy);
assert.notStrictEqual(titled, legacy, "legacy fact should be rewritten");
assert(factTitle(titled) === "user prefers TypeScript over JavaScript for backend work", "title should be first phrase");
assert(factBody(titled).includes("over JavaScript"), "body should be preserved");

const already = formatFactEntry({
  date: "2026-08-03",
  time: "10:01",
  text: "**Known Title** — some body text",
});
assert.strictEqual(withTitle(already), already, "already-titled fact must not change");

assert.strictEqual(withTitle("plain non-fact line"), "plain non-fact line", "non-fact lines unchanged");

// migrateStoreTitles: write a mix, migrate, verify
const mixed = [
  legacy,
  already,
  formatFactEntry({ date: "2026-08-03", time: "10:02", text: "second legacy without title", meta: { id: "xyz789" } }),
];
await writeMemory(GLOBAL_KEY, mixed);
const res = await migrateStoreTitles(GLOBAL_KEY);
assert.strictEqual(res.ok, true, "migrate should succeed");
assert.strictEqual(res.changed, 2, "exactly 2 legacy facts should gain titles");

const after = await readMemory(GLOBAL_KEY);
const titles = after.filter((l) => factTitle(l));
assert.strictEqual(titles.length, 3, "all 3 facts should now have titles");

// idempotent second run
const res2 = await migrateStoreTitles(GLOBAL_KEY);
assert.strictEqual(res2.changed, 0, "second run must be a no-op");

// non-existent key
const res3 = await migrateStoreTitles("git:definitely/not/a/key");
assert.strictEqual(res3.ok, true, "missing store treated as no-op ok");
assert.strictEqual(res3.changed, 0, "missing store changes 0");

console.log("All Part A4 assertions passed!");

rmSync(TMP_CONFIG_DIR, { recursive: true, force: true });
