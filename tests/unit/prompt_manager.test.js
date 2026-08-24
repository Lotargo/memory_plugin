import assert from "node:assert";
import {
  PROMPT_BLOCK,
  buildPersonaOverlayBlock,
  stripPersonaOverlayBlock,
  stripPromptBlock,
  upsertPersonaOverlayBlock,
  upsertPromptBlock,
} from "../../mcp-server/prompt_manager.js";

export async function runPromptManagerTests() {
  console.log("--- Running Unit Tests: prompt_manager ---");
  const userText = "# User instructions\n\nKeep this content.";
  const duplicated = `${userText}\n\n${PROMPT_BLOCK}\n\n${PROMPT_BLOCK}\n`;
  const updated = upsertPromptBlock(duplicated);
  assert.strictEqual((updated.match(/<!-- START MEMORY AGENT PROMPT -->/g) || []).length, 1);
  assert.strictEqual((updated.match(/<!-- END MEMORY AGENT PROMPT -->/g) || []).length, 1);
  assert.ok(updated.includes(userText), updated);
  assert.ok(updated.includes("SELECTIVE RAG CURATION"), updated);
  assert.ok(updated.includes("link it to the project-scoped Notebook fact"), updated);
  assert.ok(updated.includes("auto-injected `<MEMORY>` block"), updated);
  assert.ok(updated.includes("DO NOT call `recall` again"), updated);
  assert.ok(updated.includes("active user-approved personalization"), updated);
  assert.strictEqual(upsertPromptBlock(updated), updated, "enable-prompt must be idempotent");
  assert.strictEqual(stripPromptBlock(updated), userText, "disable must remove only the plugin-owned block");

  const directive = "- [2026-08-22 10:00] **Tone** — Use concise Russian <!-- kind:directive -->";
  const normal = "- [2026-08-22 10:01] **Name** — User is Oleg <!-- kind:fact -->";
  const legacy = "- [2026-08-22 10:02] **Style** — Use playful tone <!-- tags:persona,style -->";
  const explicitFact = "- [2026-08-22 10:03] **Preference Fact** — Historical preference <!-- kind:fact, tags:pref -->";
  const persona = buildPersonaOverlayBlock([directive, normal, legacy, explicitFact]);
  assert.ok(persona.includes("Use concise Russian"), persona);
  assert.ok(persona.includes("Use playful tone"), persona);
  assert.ok(!persona.includes("User is Oleg"), persona);
  assert.ok(!persona.includes("Historical preference"), persona);
  const withPersona = upsertPersonaOverlayBlock(updated, persona);
  assert.strictEqual(upsertPersonaOverlayBlock(withPersona, persona), withPersona, "persona sync must be idempotent");
  assert.strictEqual(stripPersonaOverlayBlock(withPersona), updated.trim(), "persona removal must preserve agent prompt");
  console.log("✅ ALL PROMPT MANAGER IDEMPOTENCY TESTS PASSED!");
}

if (process.argv[1] && process.argv[1].endsWith("prompt_manager.test.js")) {
  runPromptManagerTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
