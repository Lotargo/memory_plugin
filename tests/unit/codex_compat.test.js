import assert from "node:assert";
import {
  buildCodexMemoryAgentSection,
  escapeTomlBasicString,
  getCodexMemoryAgentSections,
  isSupportedNodeVersion,
  updateCodexMemoryAgentConfig,
  validateCodexRuntime,
} from "../../mcp-server/codex_config.js";

export async function runCodexCompatTests() {
  console.log("--- Running Unit Tests: codex_compat ---");

  assert.strictEqual(isSupportedNodeVersion("22.4.9"), false);
  assert.strictEqual(isSupportedNodeVersion("v22.5.0"), true);
  assert.strictEqual(isSupportedNodeVersion("26.1.0"), true);
  assert.strictEqual(isSupportedNodeVersion("garbage"), false);

  const nodePath = "C:\\Program Files\\nodejs\\node.exe";
  const bootPath = "C:\\Users\\Jane Doe\\AppData\\Roaming\\npm\\node_modules\\@lotargo\\memory_plugin\\mcp-server\\boot.js";
  const block = buildCodexMemoryAgentSection({ nodePath, bootPath });
  assert.ok(block.includes('command = "C:\\\\Program Files\\\\nodejs\\\\node.exe"'), block);
  assert.ok(block.includes('@lotargo\\\\memory_plugin\\\\mcp-server\\\\boot.js'), block);
  assert.ok(block.includes("startup_timeout_sec = 60"), block);
  assert.ok(!block.includes("npx"), block);
  assert.strictEqual(escapeTomlBasicString('C:\\A "quoted" path'), 'C:\\\\A \\"quoted\\" path');

  const added = updateCodexMemoryAgentConfig('model = "gpt-5"\n', { nodePath, bootPath });
  assert.strictEqual(added.status, "added");
  assert.ok(added.content.startsWith('model = "gpt-5"\n\n'));
  assert.strictEqual(getCodexMemoryAgentSections(added.content).filter((s) => s.exact).length, 1);

  const legacy = [
    'model = "gpt-5"',
    "",
    "[mcp_servers.memory-agent]",
    'command = "npx"',
    'args = ["-y", "opencode-memory-plugin"]',
    "",
    "[mcp_servers.other]",
    'command = "other.exe"',
    "",
  ].join("\r\n");
  const migrated = updateCodexMemoryAgentConfig(legacy, { nodePath, bootPath });
  assert.strictEqual(migrated.status, "migrated");
  assert.ok(!migrated.content.includes("opencode-memory-plugin"), migrated.content);
  assert.ok(!migrated.content.includes('command = "npx"'), migrated.content);
  assert.ok(migrated.content.includes("[mcp_servers.other]\r\n"), migrated.content);
  assert.ok(migrated.content.includes('command = "other.exe"'), migrated.content);
  assert.strictEqual(getCodexMemoryAgentSections(migrated.content).filter((s) => s.exact).length, 1);

  const idempotent = updateCodexMemoryAgentConfig(migrated.content, { nodePath, bootPath });
  assert.strictEqual(idempotent.status, "unchanged");
  assert.strictEqual(idempotent.content, migrated.content);

  const duplicated = migrated.content + [
    "",
    '[mcp_servers."memory-agent"]',
    'command = "npx"',
    'args = ["-y", "@lotargo/memory_plugin"]',
    "",
    "[mcp_servers.memory-agent.env]",
    'MEMORY_TEST = "1"',
    "",
  ].join("\r\n");
  const deduplicated = updateCodexMemoryAgentConfig(duplicated, { nodePath, bootPath });
  assert.strictEqual(getCodexMemoryAgentSections(deduplicated.content).filter((s) => s.exact).length, 1);
  assert.ok(!deduplicated.content.includes("MEMORY_TEST"), deduplicated.content);

  const foreign = [
    "[mcp_servers.memory-agent]",
    'command = "C:\\\\Tools\\\\unrelated-memory.exe"',
    "",
  ].join("\n");
  const conflict = updateCodexMemoryAgentConfig(foreign, { nodePath, bootPath });
  assert.strictEqual(conflict.status, "conflict");
  assert.strictEqual(conflict.content, foreign);

  const invalid = validateCodexRuntime({
    nodePath,
    nodeVersion: "20.18.0",
    bootPath,
    pathExists: () => true,
  });
  assert.strictEqual(invalid.ok, false);
  assert.ok(invalid.errors.some((error) => error.includes("Node.js >= 22.5.0")));

  console.log("✅ ALL CODEX CONFIG COMPATIBILITY TESTS PASSED!");
}

if (process.argv[1] && process.argv[1].endsWith("codex_compat.test.js")) {
  runCodexCompatTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
