import assert from "node:assert";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

export async function runMemoryUxTests() {
  console.log("--- Running Integration Tests: memory_ux ---");
  const TEST_DIR = join(tmpdir(), `memory_ux_${Date.now()}_${process.pid}`);
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.MEMORY_DIR = TEST_DIR;

  const { ensureDir, readMemory, writeMemory, GLOBAL_KEY } = await import("../../mcp-server/memory.js");
  const { factMeta, factBody } = await import("../../mcp-server/fact_format.js");
  const { getDatabase, closeDatabase } = await import("../../mcp-server/db/database.js");
  const {
    rememberFact,
    recallFacts,
    forgetFacts,
    updateFactText,
    undoMemory,
  } = await import("../../mcp-server/tools/core/memory_core.js");
  const { registerMemoryTools } = await import("../../mcp-server/tools/memory_tools.js");

  try {
    await ensureDir();
    const gitCmd = process.platform === "win32" ? "git.exe" : "git";
    execFileSync(gitCmd, ["init"], { cwd: TEST_DIR, stdio: "ignore" });

    const db = await getDatabase();
    const migration = await db
      .prepare("SELECT version FROM schema_migrations WHERE version = 7")
      .get();
    assert.strictEqual(migration.version, 7, "Migration 7 must be applied");
    const journalTable = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_operations'")
      .get();
    assert.strictEqual(journalTable.name, "memory_operations", "Undo journal table must exist");

    // ----------------------------------------------------
    // 1. MCP and OpenCode surface expose the new UX knobs.
    // ----------------------------------------------------
    const mcpTools = {};
    registerMemoryTools({
      registerTool(name, config, handler) {
        mcpTools[name] = { config, handler };
      },
    });
    assert(mcpTools.undo, "MCP must expose undo");
    assert(mcpTools.recall.config.inputSchema.shape.recent, "MCP recall must expose recent");
    assert(mcpTools.recall.config.inputSchema.shape.groupBy, "MCP recall must expose groupBy");
    assert(mcpTools.forget.config.inputSchema.shape.refs, "MCP forget must expose refs batch");

    const { default: OpenCodeMemoryPlugin } = await import("../../opencode-plugin/entry.js");
    const openCodePlugin = await OpenCodeMemoryPlugin({ directory: TEST_DIR, worktree: TEST_DIR, client: {} });
    assert(openCodePlugin.tool.undo, "OpenCode must expose undo");
    assert(openCodePlugin.tool.recall.args.recent, "OpenCode recall must expose recent");
    assert(openCodePlugin.tool.recall.args.groupBy, "OpenCode recall must expose groupBy");
    assert(openCodePlugin.tool.forget.args.refs, "OpenCode forget must expose refs batch");
    console.log("  [PASS] MCP/OpenCode tool surfaces expose new memory UX");

    // ----------------------------------------------------
    // 2. recent / last / order and tag grouping.
    // ----------------------------------------------------
    await rememberFact({ fact: "First UX fact", title: "First", scope: "global", tags: "arch,core" });
    await rememberFact({ fact: "Second UX fact", title: "Second", scope: "global", tags: "pref" });
    await rememberFact({ fact: "Third UX fact", title: "Third", scope: "global", tags: "arch" });

    const recent = await recallFacts({ scope: "global", recent: 2, mode: "headers" });
    assert(recent.includes("Third"), "recent=2 must contain newest fact");
    assert(recent.includes("Second"), "recent=2 must contain second-newest fact");
    assert(!recent.includes("First UX fact") && !recent.includes("**First**"), "recent=2 must omit oldest fact");
    assert(recent.indexOf("Third") < recent.indexOf("Second"), "recent results must be newest-first");

    const last = await recallFacts({ scope: "global", last: true, mode: "headers" });
    assert(last.includes("Third"), "last must return newest fact");
    assert(!last.includes("Second"), "last must return exactly one fact");

    const oldest = await recallFacts({ scope: "global", order: "oldest", mode: "headers", limit: 2 });
    assert(oldest.indexOf("First") < oldest.indexOf("Second"), "oldest order must preserve ascending chronology");

    const grouped = await recallFacts({ scope: "global", groupBy: "tag", mode: "headers" });
    assert(grouped.includes("### tag:arch"), "groupBy=tag must create arch group");
    assert(grouped.includes("### tag:pref"), "groupBy=tag must create pref group");
    console.log("  [PASS] recent/last/order and tag grouping");

    // ----------------------------------------------------
    // 3. Stable batch delete + keep + undo.
    // ----------------------------------------------------
    await rememberFact({ fact: "Protected UX fact", title: "Protected", scope: "global", keep: true, tags: "safe" });
    let entries = await readMemory(GLOBAL_KEY);
    const firstId = factMeta(entries.find((entry) => factBody(entry) === "First UX fact")).id;
    const thirdId = factMeta(entries.find((entry) => factBody(entry) === "Third UX fact")).id;
    const protectedId = factMeta(entries.find((entry) => factBody(entry) === "Protected UX fact")).id;

    const batchDelete = await forgetFacts({
      refs: [firstId, thirdId, protectedId],
      scope: "global",
      force: false,
    });
    assert(batchDelete.includes("2 fact(s) removed"), "Batch delete must remove two unprotected IDs");
    assert(batchDelete.includes("1 protected fact(s) skipped"), "Batch delete must preserve keep fact");
    entries = await readMemory(GLOBAL_KEY);
    assert(!entries.some((entry) => factMeta(entry).id === firstId), "First ID must be removed");
    assert(!entries.some((entry) => factMeta(entry).id === thirdId), "Third ID must be removed");
    assert(entries.some((entry) => factMeta(entry).id === protectedId), "Protected ID must remain");

    const undoBatch = await undoMemory({ scope: "global" });
    assert(undoBatch.startsWith("Undone forget"), "Undo must revert batch forget");
    entries = await readMemory(GLOBAL_KEY);
    assert(entries.some((entry) => factMeta(entry).id === firstId), "Undo must restore first ID");
    assert(entries.some((entry) => factMeta(entry).id === thirdId), "Undo must restore third ID");
    console.log("  [PASS] Stable batch forget honors keep and is undoable");

    // ----------------------------------------------------
    // 4. Legacy ranges clamp instead of failing wholesale.
    // ----------------------------------------------------
    const rangeDelete = await forgetFacts({ query: "3-999", scope: "global", force: false });
    assert(!rangeDelete.startsWith("Not found"), "Oversized upper range must be clamped, not rejected");
    assert(rangeDelete.includes("fact(s) removed"), "Clamped range must remove existing unprotected facts");
    const undoRange = await undoMemory({ scope: "global" });
    assert(undoRange.startsWith("Undone forget"), "Clamped range deletion must be undoable");
    console.log("  [PASS] Legacy range deletion safely clamps upper bound");

    // ----------------------------------------------------
    // 5. update and remember are reversible too.
    // ----------------------------------------------------
    entries = await readMemory(GLOBAL_KEY);
    const secondEntry = entries.find((entry) => factBody(entry) === "Second UX fact");
    const secondId = factMeta(secondEntry).id;
    await updateFactText({ id: secondId, newText: "Second UX fact updated", scope: "global" });
    entries = await readMemory(GLOBAL_KEY);
    assert(entries.some((entry) => factBody(entry) === "Second UX fact updated"), "update must apply new text");
    assert((await undoMemory({ scope: "global" })).startsWith("Undone update"), "update must be undoable");
    entries = await readMemory(GLOBAL_KEY);
    assert(entries.some((entry) => factBody(entry) === "Second UX fact"), "undo update must restore old text");

    await rememberFact({ fact: "Temporary remembered fact", title: "Temporary", scope: "global" });
    assert((await readMemory(GLOBAL_KEY)).some((entry) => factBody(entry) === "Temporary remembered fact"));
    assert((await undoMemory({ scope: "global" })).startsWith("Undone remember"), "remember must be undoable");
    assert(!(await readMemory(GLOBAL_KEY)).some((entry) => factBody(entry) === "Temporary remembered fact"));
    console.log("  [PASS] update and remember are reversible");

    // ----------------------------------------------------
    // 6. Linked RAG state is restored by forget -> undo.
    // ----------------------------------------------------
    const now = Date.now();
    await db.prepare(`
      INSERT INTO documents (id, path, blob_hash, title, checksum, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("doc_memory_ux", "memory-ux.md", "blob-memory-ux", "Memory UX Doc", "checksum-memory-ux", now, now);
    await db
      .prepare("INSERT INTO document_scopes (doc_id, scope_key, created_at) VALUES (?, ?, ?)")
      .run("doc_memory_ux", GLOBAL_KEY, now);

    await rememberFact({
      fact: "Linked UX fact",
      title: "Linked",
      scope: "global",
      docId: "doc_memory_ux",
      startLine: 10,
      endLine: 20,
      relationType: "REFERENCES",
    });
    entries = await readMemory(GLOBAL_KEY);
    const linkedId = factMeta(entries.find((entry) => factBody(entry) === "Linked UX fact")).id;
    let linkCount = await db
      .prepare("SELECT COUNT(*) AS c FROM knowledge_links WHERE fact_key = ? AND fact_text = ?")
      .get(GLOBAL_KEY, "Linked UX fact");
    assert.strictEqual(linkCount.c, 1, "remember must create knowledge link");

    await forgetFacts({ refs: [linkedId], scope: "global" });
    linkCount = await db
      .prepare("SELECT COUNT(*) AS c FROM knowledge_links WHERE fact_key = ? AND fact_text = ?")
      .get(GLOBAL_KEY, "Linked UX fact");
    assert.strictEqual(linkCount.c, 0, "forget must remove knowledge link");

    assert((await undoMemory({ scope: "global" })).startsWith("Undone forget"), "forget with link must be undoable");
    linkCount = await db
      .prepare("SELECT COUNT(*) AS c FROM knowledge_links WHERE fact_key = ? AND fact_text = ?")
      .get(GLOBAL_KEY, "Linked UX fact");
    assert.strictEqual(linkCount.c, 1, "undo forget must restore knowledge link");
    const edgeCount = await db
      .prepare("SELECT COUNT(*) AS c FROM graph_edges WHERE source_id = ? AND relation_type = ?")
      .get(`fact:${GLOBAL_KEY}:Linked UX fact`, "REFERENCES");
    assert.strictEqual(edgeCount.c, 1, "undo forget must restore fact graph edge");

    assert((await undoMemory({ scope: "global" })).startsWith("Undone remember"), "Second undo must pop the linked remember operation");
    linkCount = await db
      .prepare("SELECT COUNT(*) AS c FROM knowledge_links WHERE fact_key = ? AND fact_text = ?")
      .get(GLOBAL_KEY, "Linked UX fact");
    assert.strictEqual(linkCount.c, 0, "undo remember must remove restored knowledge link");
    assert(!(await readMemory(GLOBAL_KEY)).some((entry) => factMeta(entry).id === linkedId), "undo remember must remove linked fact");
    console.log("  [PASS] Undo restores and removes linked RAG state correctly");

    // ----------------------------------------------------
    // 7. Conflict guard protects manual/newer changes.
    // ----------------------------------------------------
    await rememberFact({ fact: "Conflict candidate", title: "Conflict", scope: "global" });
    const manuallyEdited = await readMemory(GLOBAL_KEY);
    manuallyEdited.push("- [2026-08-18 03:00] **Manual edit** — changed outside the journal <!-- id:manual1 -->");
    await writeMemory(GLOBAL_KEY, manuallyEdited);
    const conflictUndo = await undoMemory({ scope: "global" });
    assert(conflictUndo.startsWith("Undo refused"), "Undo must refuse to overwrite manual/newer state");
    assert((await readMemory(GLOBAL_KEY)).some((entry) => entry.includes("Manual edit")), "Manual edit must remain intact");
    console.log("  [PASS] Undo conflict guard protects manual/newer edits");

    console.log("✅ ALL MEMORY UX TESTS PASSED!");
  } finally {
    try {
      closeDatabase();
    } catch {}
    if (existsSync(TEST_DIR)) {
      try {
        rmSync(TEST_DIR, { recursive: true, force: true });
      } catch {}
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("memory_ux.test.js")) {
  runMemoryUxTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
