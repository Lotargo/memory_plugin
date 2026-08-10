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

if (cliArgs.includes("setup") || cliArgs.includes("install") || cliArgs.includes("--setup") || cliArgs.includes("-s")) {
  const { runSetup } = await import("./setup.js");
  await runSetup();
  process.exit(0);
}

if (
  cliArgs.includes("cli") ||
  cliArgs.includes("config") ||
  cliArgs.includes("--cli") ||
  cliArgs.includes("-c") ||
  cliArgs.includes("login") ||
  cliArgs.includes("logout") ||
  cliArgs.includes("auth-status") ||
  cliArgs.includes("auth_status") ||
  cliArgs.includes("auth")
) {
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
