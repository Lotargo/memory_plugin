#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ensureDir, MEMORY_DIR } from "./memory.js";
import { registerAllTools } from "./tools/index.js";
import { closeDatabase } from "./db/database.js";
import { readFileSync } from "node:fs";

function readPackageVersion() {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    return JSON.parse(readFileSync(pkgUrl, "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const cliArgs = process.argv.slice(2);

// Every command handled by cli.js/direct_commands.js must be routed here too,
// otherwise `memory_plugin link` etc. would fall through and start an MCP
// server that silently blocks on stdin.
const CLI_COMMANDS = new Set([
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
]);

function printUsage() {
  console.log(`memory_plugin v${readPackageVersion()} — hybrid RAG memory for AI coding agents

Usage:
  memory_plugin                      Start the MCP server on stdio (default)
  memory_plugin setup [--opencode|--claude|--codex|--antigravity] [--mode <MODE>]
  memory_plugin cli                  Interactive terminal UI
  memory_plugin login [--from-env|--api-token|--db-url <URL>]
  memory_plugin logout [--api-key]
  memory_plugin auth-status
  memory_plugin link|unlink|relink|identity [--dir <path>] [--remote <url>]
  memory_plugin migrate_titles [--key <key>]
  memory_plugin enable-prompt | disable-prompt
  memory_plugin doctor --codex

Options:
  -h, --help                         Show this help text
  -v, --version                      Print the package version

Secrets: prefer TURSO_API_TOKEN / TURSO_DB_URL / TURSO_DB_TOKEN environment
variables over command-line flags — argv is visible to other local processes.
Data directory: ${MEMORY_DIR}`);
}

if (cliArgs.includes("--help") || cliArgs.includes("-h") || cliArgs[0] === "help") {
  printUsage();
  process.exit(0);
}

if (cliArgs.includes("--version") || cliArgs.includes("-v")) {
  console.log(readPackageVersion());
  process.exit(0);
}

if (cliArgs.includes("setup") || cliArgs.includes("install") || cliArgs.includes("--setup") || cliArgs.includes("-s")) {
  const { runSetup } = await import("./setup.js");
  await runSetup();
  process.exit(0);
}

if (cliArgs.some((a) => CLI_COMMANDS.has(a))) {
  const { runCli } = await import("./cli.js");
  await runCli();
  process.exit(0);
}

await ensureDir();

process.on("exit", () => {
  try {
    closeDatabase();
  } catch {}
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try {
      closeDatabase();
    } catch {}
    process.exit(0);
  });
}

const server = new McpServer({
  name: "memory-agent",
  version: readPackageVersion(),
});

registerAllTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`memory-agent MCP server running, data dir: ${MEMORY_DIR}`);
