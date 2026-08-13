import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCodexMemoryAgentSection } from "../../mcp-server/codex_config.js";
import { parseCodexMemoryAgentConfig, runCodexDoctor } from "../../mcp-server/codex_diagnostics.js";

export async function runCodexMcpSmokeTests() {
  console.log("--- Running Integration Tests: codex_mcp_smoke ---");
  const temp = mkdtempSync(join(tmpdir(), "memory-codex-smoke-"));
  const codexDir = join(temp, ".codex");
  const bootPath = fileURLToPath(new URL("../../mcp-server/boot.js", import.meta.url));
  mkdirSync(codexDir, { recursive: true });

  try {
    const section = buildCodexMemoryAgentSection({ nodePath: process.execPath, bootPath });
    const config = `model = "test"\n\n${section}\n`;
    writeFileSync(join(codexDir, "config.toml"), config, "utf8");
    const parsed = parseCodexMemoryAgentConfig(config);
    assert.strictEqual(parsed.ok, true, parsed.error);
    assert.strictEqual(parsed.command, process.execPath);
    assert.deepStrictEqual(parsed.args, [bootPath]);

    const messages = [];
    const result = await runCodexDoctor({
      home: temp,
      cwd: temp,
      env: { ...process.env, MEMORY_DIR: join(temp, "memory") },
      output: { log: (message) => messages.push(message) },
    });
    assert.strictEqual(result.ok, true, messages.join("\n"));
    assert.ok(messages.some((message) => message.includes("MCP initialize")), messages.join("\n"));
    assert.ok(messages.some((message) => message.includes("memory_info tool call")), messages.join("\n"));
    assert.ok(messages.some((message) => message.includes("recall(scope=all) tool call")), messages.join("\n"));
    console.log("✅ CODEX DIRECT MCP INITIALIZE/TOOLS/CALL SMOKE TEST PASSED!");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && process.argv[1].endsWith("codex_mcp_smoke.test.js")) {
  runCodexMcpSmokeTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
