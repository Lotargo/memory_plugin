import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "recall-window-"));
process.env.MEMORY_DIR = join(root, "memory");
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = "1";
process.env.MEMORY_DISABLE_PERSONA_SYNC = "1";
const memory = await import("../../mcp-server/memory.js");
const core = await import("../../mcp-server/tools/core/memory_core.js");
const { closeDatabase } = await import("../../mcp-server/db/database.js");

const numbered = (text) => [...text.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
const line = (n, extra = "") => {
  const day = String(n).padStart(2, "0");
  return `- [2026-09-${day} 10:00] **Decision ${n}** — decision body ${n} <!-- id:d${n}${extra} -->`;
};

try {
  const project = join(root, "project");
  execFileSync("git", ["init", project], { stdio: "ignore" });
  execFileSync("git", ["-C", project, "remote", "add", "origin", "https://example.com/team/window.git"]);
  const key = await memory.projectKey(null, project);
  const ctx = { worktree: project, directory: project };

  // 25 project facts in storage order (oldest first), plus one active project directive.
  const facts = Array.from({ length: 25 }, (_, i) => line(i + 1));
  facts.splice(3, 0, "- [2026-08-01 10:00] **Style** — project style directive <!-- id:dir1, kind:directive -->");
  await memory.writeMemory(key, facts);
  // Global memory: a directive and 14 facts, all of which must always be returned.
  const globals = Array.from({ length: 14 }, (_, i) => `- [2026-07-${String(i + 1).padStart(2, "0")} 10:00] **Global ${i + 1}** — global body ${i + 1} <!-- id:g${i + 1} -->`);
  globals.push("- [2026-07-30 10:00] **Persona** — global persona directive <!-- id:gdir, kind:directive -->");
  await memory.writeMemory(memory.GLOBAL_KEY, globals);

  // Default: project facts are the 10 newest, newest first; the directive is always listed.
  const first = await core.recallFacts({ scope: "all", directory: project }, ctx);
  const projectPart = first.slice(first.indexOf("--- Project"));
  const globalPart = first.slice(first.indexOf("--- Global"), first.indexOf("--- Project"));
  assert.equal((globalPart.match(/global body|global persona/g) || []).length, 15, "global memory must stay complete");
  assert.ok(!globalPart.includes("Showing"), "unlimited global memory has no truncation note");
  const projectNumbers = numbered(projectPart);
  assert.equal(projectNumbers.length, 11, "directive plus the 10 newest");
  assert.ok(projectPart.includes("project style directive"), "active directives are never windowed out");
  const newest = projectNumbers.filter((n) => n !== 4);
  assert.deepEqual(newest, [26, 25, 24, 23, 22, 21, 20, 19, 18, 17], "storage numbers, newest first");
  assert.match(projectPart, /Showing 10 of 25 non-directive entries, newest first; 15 older not shown\./);
  assert.match(projectPart, /offset=10/);
  assert.ok(!projectPart.includes("decision body 5\n") && !projectPart.includes("decision body 5 "), "older facts stay out of the window");

  // Next page: skips the newest 10; the directive is not repeated.
  const second = await core.recallFacts({ scope: "project", directory: project, offset: 10 }, ctx);
  assert.deepEqual(numbered(second), [16, 15, 14, 13, 12, 11, 10, 9, 8, 7]);
  assert.ok(!second.includes("project style directive"));
  assert.match(second, /skipped the newest 10\); 5 older not shown\./);
  const third = await core.recallFacts({ scope: "project", directory: project, offset: 20 }, ctx);
  // The directive sits at storage number 4, so decisions 5..1 are storage numbers 6, 5, 3, 2, 1.
  assert.deepEqual(numbered(third), [6, 5, 3, 2, 1]);
  assert.match(third, /0 older not shown\./);
  assert.ok(!/Repeat this call/.test(third), "no paging hint on the last page");

  // limit=0 returns the whole store in storage order with no note.
  const everything = await core.recallFacts({ scope: "project", directory: project, limit: 0 }, ctx);
  assert.deepEqual(numbered(everything), Array.from({ length: 26 }, (_, i) => i + 1));
  assert.ok(!everything.includes("Showing"));

  // An explicit limit applies to both stores and counts from the newest entry.
  const limited = await core.recallFacts({ scope: "all", directory: project, limit: 2 }, ctx);
  assert.match(limited, /Showing 2 of 14 non-directive entries, newest first; 12 older not shown\./);
  assert.match(limited, /Showing 2 of 25 non-directive entries, newest first; 23 older not shown\./);
  assert.ok(limited.includes("global persona directive") && limited.includes("project style directive"));

  // Filters narrow first, then the window applies to the matches.
  const filtered = await core.recallFacts({ scope: "project", directory: project, query: "decision", limit: 3 }, ctx);
  assert.deepEqual(numbered(filtered), [26, 25, 24]);
  assert.match(filtered, /Showing 3 of 25 entries, newest first; 22 older not shown\./, "no directive matched the filter");

  // A small project is returned whole, with no truncation note.
  await memory.writeMemory(key, facts.slice(0, 5));
  const small = await core.recallFacts({ scope: "project", directory: project }, ctx);
  assert.equal(numbered(small).length, 5);
  assert.ok(!small.includes("Showing"));

  // Invalid paging arguments fail clearly.
  await assert.rejects(core.recallFacts({ scope: "project", directory: project, limit: -1 }, ctx), /limit must be/);
  await assert.rejects(core.recallFacts({ scope: "project", directory: project, offset: 1.5 }, ctx), /offset must be/);
  console.log("PASS recall window: project facts newest-first, complete global and directives, paging, limit=0, filters and validation");
} finally {
  closeDatabase();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
