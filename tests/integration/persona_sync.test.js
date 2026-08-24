import assert from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function runPersonaSyncTests() {
  console.log("--- Running Integration Tests: persona_sync ---");
  const root = await mkdtemp(join(tmpdir(), "memory-persona-sync-"));
  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    MEMORY_DIR: process.env.MEMORY_DIR,
    MEMORY_DISABLE_PERSONA_SYNC: process.env.MEMORY_DISABLE_PERSONA_SYNC,
  };
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  process.env.MEMORY_DIR = join(root, "memory");
  delete process.env.MEMORY_DISABLE_PERSONA_SYNC;

  try {
    const { rememberFact, updateFactText, forgetFacts } = await import("../../mcp-server/tools/core/memory_core.js");
    const codexAgents = join(root, ".codex", "AGENTS.md");

    await rememberFact({
      scope: "global",
      title: "Test Persona",
      fact: "Use a deliberately concise test voice",
      kind: "directive",
    });
    let prompt = await readFile(codexAgents, "utf-8");
    assert.ok(prompt.includes("START MEMORY PERSONA OVERLAY"), prompt);
    assert.ok(prompt.includes("Use a deliberately concise test voice"), prompt);

    await updateFactText({
      scope: "global",
      id: "Use a deliberately concise test voice",
      newText: "This was only historical context",
      kind: "fact",
    });
    prompt = await readFile(codexAgents, "utf-8");
    assert.ok(!prompt.includes("START MEMORY PERSONA OVERLAY"), prompt);
    assert.ok(!prompt.includes("historical context"), prompt);

    await updateFactText({
      scope: "global",
      id: "This was only historical context",
      newText: "Use the concise test voice again",
      kind: "directive",
    });
    prompt = await readFile(codexAgents, "utf-8");
    assert.ok(prompt.includes("Use the concise test voice again"), prompt);

    await forgetFacts({ scope: "global", query: "concise test voice again", force: true });
    prompt = await readFile(codexAgents, "utf-8");
    assert.ok(!prompt.includes("START MEMORY PERSONA OVERLAY"), prompt);
    console.log("✅ PERSONA AUTO-SYNCHRONIZATION TESTS PASSED!");
  } finally {
    try {
      const { closeDatabase } = await import("../../mcp-server/db/database.js");
      await closeDatabase();
    } catch {}
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (process.argv[1] && process.argv[1].endsWith("persona_sync.test.js")) {
  runPersonaSyncTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}

