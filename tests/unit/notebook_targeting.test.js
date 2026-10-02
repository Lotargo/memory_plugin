import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "notebook-targeting-"));
process.env.MEMORY_DIR = join(root, "memory");
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = "1";
process.env.MEMORY_DISABLE_PERSONA_SYNC = "1";
const memory = await import("../../mcp-server/memory.js");
const core = await import("../../mcp-server/tools/core/memory_core.js");
const { closeDatabase } = await import("../../mcp-server/db/database.js");
const { registerMemoryTools } = await import("../../mcp-server/tools/memory_tools.js");

try {
  const current = join(root, "current");
  const selected = join(root, "selected");
  for (const [dir, name] of [[current, "current"], [selected, "selected"]]) {
    execFileSync("git", ["init", dir], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "remote", "add", "origin", `https://example.com/team/${name}.git`]);
  }
  const outside = join(root, "outside");
  mkdirSync(outside);
  const currentKey = await memory.projectKey(null, current);
  const selectedKey = await memory.projectKey(null, selected);
  const legacyKey = "git_example_com_team_legacy";
  const fact = (text) => `- [2026-10-03 01:00] **Rule** — ${text} <!-- id:same-id -->`;
  const untouched = [fact("current project must survive")];
  await memory.writeMemory(currentKey, untouched);
  const ctx = { worktree: current, directory: current };

  for (const [key, target] of [[selectedKey, { directory: selected }], [selectedKey, { project: selectedKey }], [selectedKey, { project: memory.slugify(selectedKey) }], [legacyKey, { project: legacyKey }]]) {
    await memory.writeMemory(key, [fact("selected project fact")]);
    assert.match(await core.recallFacts({ scope: "project", ...target }, ctx), /selected project fact/);
    const deleted = await core.forgetFacts({ scope: "project", query: "1", ...target }, ctx);
    assert.ok(deleted.includes(key), "deletion response must identify the actual store");
    assert.deepEqual(await memory.readMemory(key), [], "forget must target the same store as recall");
    assert.deepEqual(await memory.readMemory(currentKey), untouched, "explicit target must never affect current worktree");

    await core.rememberFact({ scope: "project", title: "New rule", fact: "selected new fact", ...target }, ctx);
    const id = /id:([^, >]+)/.exec((await memory.readMemory(key))[0])[1];
    assert.match(await core.getFactById({ scope: "project", id, ...target }, ctx), /selected new fact/);
    await core.updateFactText({ scope: "project", id, newText: "selected updated fact", ...target }, ctx);
    assert.match((await memory.readMemory(key))[0], /selected updated fact/);
    assert.equal(memory.parseMeta(readFileSync(memory.storeFilePath(key), "utf8")).key, key, "an alias must preserve the stored identity");
    assert.deepEqual(await memory.readMemory(currentKey), untouched);
  }

  assert.match(await core.memoryInfo({ directory: selected }, ctx), /key: git:example.com\/team\/selected/);
  const keyedInfo = await core.memoryInfo({ project: selectedKey }, ctx);
  assert.ok(keyedInfo.includes(`key: ${selectedKey}`));
  assert.ok(!keyedInfo.includes("[object Promise]"));
  assert.ok(!keyedInfo.includes(`key: ${currentKey}`));
  assert.match(await core.memoryInfo({ project: legacyKey }, ctx), /Identity: legacy-store/);
  await assert.rejects(core.forgetFacts({ query: "1", scope: "project", directory: outside }, ctx), /No project memory/);
  await assert.rejects(core.forgetFacts({ query: "1", scope: "project", project: "git_missing_store" }, ctx), /Unknown.*target/i);
  await assert.rejects(core.forgetFacts({ query: "1", scope: "all" }, ctx), /scope/i);
  await assert.rejects(core.forgetFacts({ query: "1", scope: false }, ctx), /scope/i);
  await assert.rejects(core.forgetFacts({ query: " ", scope: "project" }, ctx), /query/i);
  await assert.rejects(core.forgetFacts({ query: "1", scope: "project", force: "false" }, ctx), /force/i);
  assert.deepEqual(await memory.readMemory(currentKey), untouched);
  const definitions = new Map();
  registerMemoryTools({ registerTool: (name, definition) => definitions.set(name, definition) });
  const forgetSchema = definitions.get("forget").inputSchema;
  assert.equal(forgetSchema.safeParse({ query: "1", scope: "all" }).success, false);
  assert.equal(forgetSchema.safeParse({ query: "1", force: "false" }).success, false);
  assert.equal(forgetSchema.parse({ query: "1", scope: null }).scope, "project");
  console.log("PASS: Notebook reads and mutations share explicit target resolution; invalid destructive arguments fail closed.");
} finally {
  closeDatabase();
  rmSync(root, { recursive: true, force: true });
}
