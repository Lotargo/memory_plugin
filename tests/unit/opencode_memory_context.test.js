import assert from "node:assert";

export async function runOpenCodeMemoryContextTests() {
  console.log("--- Running Unit Tests: opencode_memory_context ---");
  const { formatInjectedFacts, buildMemoryContext } = await import("../../opencode-plugin/index.js");
  const now = new Date("2026-08-13T12:00:00Z").getTime();
  const normal = "- [2026-08-13 10:00] **Normal Rule** — full normal fact body <!-- id:n1, tags:arch -->";
  const priority = "- [2026-08-12 09:00] **Injected Rule** — full injected fact body <!-- id:i1, inject:1 -->";
  const superseded = "- [2026-08-11 08:00] **Old Rule** — obsolete body <!-- id:o1, supersededBy:n1 -->";

  const formatted = formatInjectedFacts([normal, priority, superseded], 100, now);
  assert.ok(formatted.includes("full normal fact body"), formatted);
  assert.ok(formatted.includes("full injected fact body"), formatted);
  assert.ok(!formatted.includes("obsolete body"), formatted);
  assert.ok(formatted.indexOf("full injected fact body") < formatted.indexOf("full normal fact body"), formatted);

  const manyFacts = Array.from(
    { length: 12 },
    (_, i) => `- [2026-08-13 10:${String(i).padStart(2, "0")}] **Rule ${i + 1}** — complete body ${i + 1} <!-- id:m${i + 1} -->`
  );
  const unlimited = formatInjectedFacts(manyFacts, null, now);
  assert.ok(unlimited.includes("complete body 1"), unlimited);
  assert.ok(unlimited.includes("complete body 12"), unlimited);
  assert.ok(!unlimited.includes("more of"), unlimited);

  const context = buildMemoryContext([normal], [priority], "git:example/project", 100, now);
  assert.ok(context.includes("## Global\n"), context);
  assert.ok(context.includes("Registry: unlinked"), context);
  assert.ok(context.includes("link_project_memory"), context);
  assert.ok(context.includes("SELECTIVE RAG DIRECTIVE"), context);
  assert.ok(context.includes("do not dump everything"), context);
  assert.ok(context.includes("full normal fact body"), context);
  assert.ok(context.includes("## Project: git:example/project\n"), context);
  assert.ok(context.includes("full injected fact body"), context);
  console.log("✅ OPENCODE FULL-BODY MEMORY CONTEXT TESTS PASSED!");
}

if (process.argv[1] && process.argv[1].endsWith("opencode_memory_context.test.js")) {
  runOpenCodeMemoryContextTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
