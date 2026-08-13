import assert from "node:assert";
import { PROMPT_BLOCK, stripPromptBlock, upsertPromptBlock } from "../../mcp-server/prompt_manager.js";

export async function runPromptManagerTests() {
  console.log("--- Running Unit Tests: prompt_manager ---");
  const userText = "# User instructions\n\nKeep this content.";
  const duplicated = `${userText}\n\n${PROMPT_BLOCK}\n\n${PROMPT_BLOCK}\n`;
  const updated = upsertPromptBlock(duplicated);
  assert.strictEqual((updated.match(/<!-- START MEMORY AGENT PROMPT -->/g) || []).length, 1);
  assert.strictEqual((updated.match(/<!-- END MEMORY AGENT PROMPT -->/g) || []).length, 1);
  assert.ok(updated.includes(userText), updated);
  assert.strictEqual(upsertPromptBlock(updated), updated, "enable-prompt must be idempotent");
  assert.strictEqual(stripPromptBlock(updated), userText, "disable must remove only the plugin-owned block");
  console.log("✅ ALL PROMPT MANAGER IDEMPOTENCY TESTS PASSED!");
}

if (process.argv[1] && process.argv[1].endsWith("prompt_manager.test.js")) {
  runPromptManagerTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
