import assert from "node:assert";
import { formatFactEntry, parseFactEntry } from "./fact_format.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync, existsSync, writeFileSync } from "node:fs";

// Create a mock of what opencode-plugin buildMemoryContext does
import { MemoryPlugin } from "../opencode-plugin/index.js";

console.log("--- Running Part A2 & A3 Integration Tests ---");

const TMP_CONFIG_DIR = join(tmpdir(), `test_opencode_config_${Date.now()}`);
process.env.OPENCODE_CONFIG_DIR = TMP_CONFIG_DIR;
process.env.MEMORY_DIR = join(TMP_CONFIG_DIR, "memory");

// Let's create some dummy memories
const globalFile = join(process.env.MEMORY_DIR, "global.md");
const projectFile = join(process.env.MEMORY_DIR, "default.md");

import { ensureDirSync, GLOBAL_KEY, writeMemory, readMemory } from "./memory.js";
ensureDirSync();

// Save 12 dummy facts to global memory to exceed the 10 limit
const facts = [];
for (let i = 1; i <= 12; i++) {
  // Let's create some with inject:1
  const meta = { id: `id${i}` };
  if (i === 5 || i === 11) {
    meta.inject = "1";
  }
  // format with title
  const date = "2026-08-03";
  const time = `10:${String(i).padStart(2, "0")}`;
  const line = formatFactEntry({
    date,
    time,
    text: `**Title Fact ${i}** — This is body of fact ${i}`,
    meta
  });
  facts.push(line);
}

await writeMemory(GLOBAL_KEY, facts);

// Let's run MemoryPlugin to see how it formats global memory context
const plugin = await MemoryPlugin({ directory: process.cwd() });
const transformResult = { messages: [{ info: { role: "user" }, parts: [{ type: "text", text: "task" }] }] };

await plugin["experimental.chat.messages.transform"](null, transformResult);
const injectedText = transformResult.messages[0].parts[0].text;

console.log("Injected Context:");
console.log(injectedText);

// Assertions on the injected context
assert(injectedText.includes("<MEMORY>"), "Should contain memory block");
assert(injectedText.includes("## Global"), "Should contain Global section");
assert(injectedText.includes("Title Fact 12"), "Should contain Title Fact 12");
assert(injectedText.includes("body of fact 11"), "Fact 11 (inject:1) should have body injected");
assert(injectedText.includes("body of fact 5"), "Fact 5 (inject:1) should have body injected");
assert(!injectedText.includes("body of fact 12"), "Fact 12 should only have header (no body)");
assert(injectedText.includes("and 2 more of 12 memories"), "Should have X of Y counter");

console.log("✅ Part A2 & A3 Integration Tests Passed!");

// Cleanup
rmSync(TMP_CONFIG_DIR, { recursive: true, force: true });

// Now let's test the get_fact tool
console.log("Testing get_fact...");
const toolResult = await plugin.tool.get_fact.execute({ id: "id11" }, { worktree: process.cwd(), directory: process.cwd() });
console.log(toolResult);
assert(toolResult.includes("Title Fact 11"), "get_fact should return Title Fact 11");
assert(toolResult.includes("This is body of fact 11"), "get_fact should return body of fact 11");

console.log("✅ get_fact tests passed!");
