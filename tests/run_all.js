import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const testSuites = [
  // --- 1. UNIT TESTS ---
  { category: "Unit", name: "fact_format", file: "tests/unit/fact_format.test.js" },
  { category: "Unit", name: "identity", file: "tests/unit/identity.test.js" },
  { category: "Unit", name: "codex_compat", file: "tests/unit/codex_compat.test.js" },
  { category: "Unit", name: "prompt_manager", file: "tests/unit/prompt_manager.test.js" },
  { category: "Unit", name: "opencode_memory_context", file: "tests/unit/opencode_memory_context.test.js" },
  { category: "Unit", name: "rag_integrity", file: "tests/unit/rag_integrity.test.js" },
  { category: "Unit", name: "rag_memory_notes", file: "tests/unit/rag_memory_notes.test.js" },
  { category: "Unit", name: "project_identity", file: "tests/unit/project_identity.test.js" },
  { category: "Unit", name: "unit_audit_fixes", file: "tests/unit/unit_audit_fixes.test.js" },
  { category: "Unit", name: "benchmark_report", file: "tests/unit/benchmark_report.test.js" },
  { category: "Unit", name: "chunker", file: "tests/unit/chunker.test.js" },
  { category: "Unit", name: "policy_retrieval", file: "tests/unit/policy_retrieval.test.js" },

  // --- 2. INTEGRATION TESTS ---
  { category: "Integration", name: "expanded_features", file: "tests/integration/expanded_features.test.js" },
  { category: "Integration", name: "memory_verification", file: "tests/integration/memory_verification.test.js" },
  { category: "Integration", name: "mcp_tools", file: "tests/integration/mcp_tools.test.js" },
  { category: "Integration", name: "codex_mcp_smoke", file: "tests/integration/codex_mcp_smoke.test.js" },
  { category: "Integration", name: "reverse_sync", file: "tests/integration/reverse_sync.test.js" },
  { category: "Integration", name: "rag_mcp_tools", file: "tests/integration/rag_mcp_tools.test.js" },
  { category: "Integration", name: "rag_memory_notes", file: "tests/integration/rag_memory_notes.test.js" },
  { category: "Integration", name: "rag_memory_notes_mcp", file: "tests/integration/rag_memory_notes_mcp.test.js" },
  { category: "Integration", name: "rag_cloud_portability", file: "tests/integration/rag_cloud_portability.test.js" },

  // --- 3. CLOUD TESTS ---
  { category: "Cloud", name: "phase1_cloud", file: "tests/cloud/phase1_cloud.test.js" },
];

async function main() {
  console.log("=================================================");
  console.log("   MEMORY PLUGIN UNIFIED TEST SUITE RUNNER       ");
  console.log("=================================================\n");

  const startTime = Date.now();
  let currentCategory = "";

  for (const suite of testSuites) {
    if (suite.category !== currentCategory) {
      currentCategory = suite.category;
      console.log(`\n▶ Running ${currentCategory} Test Suite...`);
    }

    const filePath = join(ROOT, suite.file);
    try {
      execFileSync(process.execPath, [filePath], { stdio: "inherit" });
    } catch (err) {
      console.error(`\n❌ TEST SUITE FAILED: ${suite.name} (${suite.file})`);
      process.exit(1);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log("\n=================================================");
  console.log(`🎉 ALL TEST SUITES PASSED IN ${duration}s!`);
  console.log("=================================================\n");
}

main();
