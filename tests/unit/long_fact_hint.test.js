import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "long-fact-"));
process.env.MEMORY_DIR = join(root, "memory");
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = "1";
process.env.MEMORY_DISABLE_PERSONA_SYNC = "1";
const memory = await import("../../mcp-server/memory.js");
const core = await import("../../mcp-server/tools/core/memory_core.js");
const { closeDatabase } = await import("../../mcp-server/db/database.js");

try {
  const project = join(root, "project");
  execFileSync("git", ["init", project], { stdio: "ignore" });
  execFileSync("git", ["-C", project, "remote", "add", "origin", "https://example.com/team/long.git"]);
  const key = await memory.projectKey(null, project);
  const ctx = { worktree: project, directory: project };
  const long = "x".repeat(core.LONG_FACT_CHARS + 1);

  // A short fact gets no warning.
  assert.equal(await core.rememberFact({ fact: "Short fact", title: "Short" }, ctx), "Memory updated");

  // A long fact is still saved, but the agent is told to move it to a Memory Note.
  const saved = await core.rememberFact({ fact: long, title: "Long" }, ctx);
  assert.match(saved, /^Memory updated \(warning: this fact is 801 characters; .*remember_note/);
  assert.ok((await memory.readMemory(key)).some((entry) => entry.includes(long)), "the long fact is saved");

  // The title does not count toward the limit.
  const exact = "y".repeat(core.LONG_FACT_CHARS);
  assert.equal(await core.rememberFact({ fact: exact, title: "T".repeat(100) }, ctx), "Memory updated");

  // update_fact warns on a long replacement and stays quiet on a short one.
  assert.match(await core.updateFactText({ id: "1", newText: long + "z" }, ctx), /warning: this fact is 802 characters/);
  assert.doesNotMatch(await core.updateFactText({ id: "1", newText: "Short again" }, ctx), /warning/);

  console.log("PASS long fact hint: remember and update_fact warn above the limit, save the fact, and ignore the title");
} finally {
  closeDatabase();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
