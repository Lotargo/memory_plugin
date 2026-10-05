#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ensureDir, MEMORY_DIR } from "./memory.js";
import { registerAllTools } from "./tools/index.js";
import { closeDatabase } from "./db/database.js";
import { readFileSync } from "node:fs";
import { startSnapshotScheduler, stopSnapshotScheduler } from "./admin/cloud_snapshots.js";

function readPackageVersion() {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    return JSON.parse(readFileSync(pkgUrl, "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const cliArgs = process.argv.slice(2);
if (cliArgs[0] === "knowledge") {
  const { handleKnowledgeCommand } = await import("./cli/knowledge_commands.js");
  await handleKnowledgeCommand(cliArgs.slice(1));
  process.exit(process.exitCode || 0);
}

// Snapshot arguments belong exclusively to that command, even if a value
// happens to match a global command such as setup or uninstall.
if (["web", "dashboard"].includes(cliArgs[0])) {
  const { handleWebCommand } = await import("./cli/web_commands.js");
  await handleWebCommand(cliArgs.slice(1));
  process.exit(process.exitCode || 0);
}
if (cliArgs[0] === "snapshots") {
  const { handleSnapshotCommands } = await import("./cli/snapshot_commands.js");
  await handleSnapshotCommands(cliArgs);
  process.exit(process.exitCode || 0);
}

// Every command handled by cli.js/direct_commands.js must be routed here too,
// otherwise `memory_plugin link` etc. would fall through and start an MCP
// server that silently blocks on stdin.
const CLI_COMMANDS = new Set([
  "maintenance",
  "rag-maintenance",
  "notebook",
  "prompts",
  "web",
  "dashboard",
  "cli",
  "config",
  "--cli",
  "-c",
  "login",
  "logout",
  "auth-status",
  "auth_status",
  "auth",
  "link",
  "unlink",
  "relink",
  "identity",
  "migrate_titles",
  "enable-prompt",
  "disable-prompt",
  "doctor",
  "models",
  "model",
  "snapshots",
  "marketplace",
]);

function printUsage() {
  console.log(`memory_plugin v${readPackageVersion()} — hybrid RAG memory for AI coding agents

Usage:
  memory_plugin                      Start the MCP server on stdio (default)
  memory_plugin setup [--opencode|--claude|--codex|--gemini|--antigravity] [--api-key <TOKEN>] [--mode <MODE>]
  memory_plugin setup --uninstall [--purge] [--purge-cache] [--dry-run] [--yes]
  memory_plugin uninstall [--purge] [--purge-cache] [--dry-run] [--yes] [--opencode|--claude|--codex|--gemini|--antigravity]
  memory_plugin cli                  Interactive terminal UI
  memory-plugin web                  Start/reuse the background browser panel
  memory-plugin web status|stop|restart
  memory-plugin web autostart on|off|status
  memory-plugin web --foreground [--port N] Temporary panel until Ctrl+C
  memory-plugin web port [N]         Show or save its default port
  memory_plugin dashboard [--port N] Local browser panel (Notebook first increment)
  memory_plugin login [--from-env|--api-token|--api-key|--db-url <URL>]
  memory_plugin logout [--api-key]
  memory_plugin auth-status
  memory_plugin link|unlink|relink|identity [--dir <path>] [--remote <url>]
  memory_plugin migrate_titles [--key <key>]
  memory_plugin enable-prompt | disable-prompt
  memory_plugin models status [--json] | unload | load [--device cpu|gpu] | device cpu|gpu | timer off|<minutes>
  memory_plugin doctor --codex
  memory-plugin marketplace help     Local plugin build, install, channel switch and status
  memory_plugin snapshots help       ZIP checkpoints, schedules in hours, restore and period deletion

Options:
  -h, --help                         Show this help text
  -v, --version                      Print the package version

Secrets: prefer TURSO_API_TOKEN / TURSO_DB_URL / TURSO_DB_TOKEN environment
variables over command-line flags — argv is visible to other local processes.
Data directory: ${MEMORY_DIR}`);
}

const isUninstallCommand = cliArgs.includes("uninstall") || cliArgs.includes("--uninstall");

if (!isUninstallCommand && (cliArgs.includes("--help") || cliArgs.includes("-h") || cliArgs[0] === "help")) {
  printUsage();
  process.exit(0);
}

if (cliArgs.includes("--version") || cliArgs.includes("-v")) {
  console.log(readPackageVersion());
  process.exit(0);
}

if (isUninstallCommand) {
  const { runUninstall } = await import("./uninstall.js");
  await runUninstall();
  process.exit(process.exitCode || 0);
}

if (cliArgs.includes("setup") || cliArgs.includes("install") || cliArgs.includes("--setup") || cliArgs.includes("-s")) {
  const { runSetup } = await import("./setup.js");
  await runSetup();
  process.exit(0);
}

if (cliArgs.some((a) => CLI_COMMANDS.has(a))) {
  const { runCli } = await import("./cli.js");
  await runCli();
  process.exit(process.exitCode || 0);
}

await ensureDir();

process.on("exit", () => {
  try {
    stopSnapshotScheduler();
    closeDatabase();
  } catch {}
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try {
      stopSnapshotScheduler();
      closeDatabase();
    } catch {}
    process.exit(0);
  });
}

const server = new McpServer({
  name: "memory-agent",
  version: readPackageVersion(),
});

// Arm the file-based model control channel so `memory-cli models ...`
// commands can unload/reload ONNX sessions owned by this process.
const { startModelControlLoop } = await import("./ml/model_manager.js");
startModelControlLoop();

registerAllTools(server);
startSnapshotScheduler();

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`memory-agent MCP server running, data dir: ${MEMORY_DIR}`);
const { autoStartWeb } = await import('./dashboard/runtime.js');
void autoStartWeb().catch(error => console.error(`Memory panel: ${error.message}`));
