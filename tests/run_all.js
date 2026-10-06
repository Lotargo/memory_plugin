import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const testSuites = [
  // --- 1. UNIT TESTS ---
  { category: "Unit", name: "fact_format", file: "tests/unit/fact_format.test.js" },
  { category: "Unit", name: "identity", file: "tests/unit/identity.test.js" },
  { category: "Unit", name: "background_launch", file: "tests/unit/background_launch.test.js" },
  { category: "Unit", name: "codex_compat", file: "tests/unit/codex_compat.test.js" },
  { category: "Unit", name: "prompt_manager", file: "tests/unit/prompt_manager.test.js" },
  { category: "Unit", name: "client_cli", file: "tests/unit/client_cli.test.js" },
  { category: "Unit", name: "uninstall", file: "tests/unit/uninstall.test.js" },
  { category: "Unit", name: "persona_migration", file: "tests/unit/persona_migration.test.js" },
  { category: "Unit", name: "dev_link", file: "tests/unit/dev_link.test.js" },
  { category: "Unit", name: "opencode_memory_context", file: "tests/unit/opencode_memory_context.test.js" },
  { category: "Unit", name: "rag_integrity", file: "tests/unit/rag_integrity.test.js" },
  { category: "Unit", name: "rag_memory_notes", file: "tests/unit/rag_memory_notes.test.js" },
  { category: "Unit", name: "project_identity", file: "tests/unit/project_identity.test.js" },
  { category: "Unit", name: "notebook_targeting", file: "tests/unit/notebook_targeting.test.js" },
  { category: "Unit", name: "unit_audit_fixes", file: "tests/unit/unit_audit_fixes.test.js" },
  { category: "Unit", name: "benchmark_report", file: "tests/unit/benchmark_report.test.js" },
  { category: "Unit", name: "chunker", file: "tests/unit/chunker.test.js" },
  { category: "Unit", name: "policy_retrieval", file: "tests/unit/policy_retrieval.test.js" },
  { category: "Unit", name: "spreadsheet_parser", file: "tests/unit/spreadsheet_parser.test.js" },
  { category: "Unit", name: "model_control", file: "tests/unit/model_control.test.js" },
  { category: "Unit", name: "resources", file: "tests/unit/resources.test.js" },
  { category: "Unit", name: "resources_ui", file: "tests/unit/resources_ui.test.js" },
  { category: "Unit", name: "notebook_filters", file: "tests/unit/notebook_filters.test.js" },

  // --- 2. INTEGRATION TESTS ---
  { category: "Integration", name: "marketplace", file: "tests/integration/marketplace.test.js" },
  { category: "Integration", name: "dashboard", file: "tests/integration/dashboard.test.js" },
  { category: "Integration", name: "notebook_collection", file: "tests/integration/notebook_collection.test.js" },
  { category: "Integration", name: "notebook_tui", file: "tests/integration/notebook_tui.test.js" },
  { category: "Integration", name: "directive_transfer", file: "tests/integration/directive_transfer.test.js" },
  { category: "Integration", name: "persona_preview", file: "tests/integration/persona_preview.test.js" },
  { category: "Integration", name: "persona_delivery", file: "tests/integration/persona_delivery.test.js" },
  { category: "Integration", name: "prompt_service", file: "tests/integration/prompt_service.test.js" },
  { category: "Integration", name: "maintenance", file: "tests/integration/maintenance.test.js" },
  { category: "Integration", name: "rag_maintenance", file: "tests/integration/rag_maintenance.test.js" },
  { category: "Integration", name: "diagnostics", file: "tests/integration/diagnostics.test.js" },
  { category: "Integration", name: "uninstall_service", file: "tests/integration/uninstall_service.test.js" },
  { category: "Integration", name: "client_service", file: "tests/integration/client_service.test.js" },
  { category: "Integration", name: "settings", file: "tests/integration/settings.test.js" },
  { category: "Integration", name: "models", file: "tests/integration/models.test.js" },
  { category: "Integration", name: "resources", file: "tests/integration/resources.test.js" },
  { category: "Integration", name: "project_service", file: "tests/integration/project_service.test.js" },
  { category: "Integration", name: "knowledge_service", file: "tests/integration/knowledge_service.test.js" },
  { category: "Integration", name: "knowledge_links", file: "tests/integration/knowledge_links.test.js" },
  { category: "Integration", name: "knowledge_content", file: "tests/integration/knowledge_content.test.js" },
  { category: "Integration", name: "knowledge_removal", file: "tests/integration/knowledge_removal.test.js" },
  { category: "Integration", name: "knowledge_graph", file: "tests/integration/knowledge_graph.test.js" },
  { category: "Integration", name: "knowledge_search", file: "tests/integration/knowledge_search.test.js" },
  { category: "Integration", name: "web_commands", file: "tests/integration/web_commands.test.js" },
  { category: "Integration", name: "web_runtime", file: "tests/integration/web_runtime.test.js" },
  { category: "Integration", name: "cloud_snapshots", file: "tests/integration/cloud_snapshots.test.js" },
  { category: "Integration", name: "expanded_features", file: "tests/integration/expanded_features.test.js" },
  { category: "Integration", name: "memory_verification", file: "tests/integration/memory_verification.test.js" },
  { category: "Integration", name: "mcp_tools", file: "tests/integration/mcp_tools.test.js" },
  { category: "Integration", name: "persona_sync", file: "tests/integration/persona_sync.test.js" },
  { category: "Integration", name: "codex_mcp_smoke", file: "tests/integration/codex_mcp_smoke.test.js" },
  { category: "Integration", name: "storage_mode_migration", file: "tests/integration/storage_mode_migration.test.js" },
  { category: "Integration", name: "rag_mcp_tools", file: "tests/integration/rag_mcp_tools.test.js" },
  { category: "Integration", name: "rag_memory_notes", file: "tests/integration/rag_memory_notes.test.js" },
  { category: "Integration", name: "rag_memory_notes_mcp", file: "tests/integration/rag_memory_notes_mcp.test.js" },
  { category: "Integration", name: "only_cloud_migration", file: "tests/integration/only_cloud_migration.test.js" },
  { category: "Integration", name: "rag_deletion", file: "tests/integration/rag_deletion.test.js" },

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
    const sandbox = mkdtempSync(join(tmpdir(), "memory-suite-"));
    try {
      execFileSync(process.execPath, [filePath], {
        stdio: "inherit",
        env: {
          ...process.env,
          MEMORY_DIR: join(sandbox, "memory"),
          OPENCODE_CONFIG_DIR: join(sandbox, "opencode"),
          MEMORY_DISABLE_PERSONA_SYNC: "1",
          MEMORY_DISABLE_BACKGROUND_SYNC: "1",
          MEMORY_DISABLE_WEB_AUTOSTART: "1",
        },
      });
    } catch (err) {
      console.error(`\n❌ TEST SUITE FAILED: ${suite.name} (${suite.file})`);
      process.exitCode = 1;
      return;
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5 });
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log("\n=================================================");
  console.log(`🎉 ALL TEST SUITES PASSED IN ${duration}s!`);
  console.log("=================================================\n");
}

main();
