#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ensureDir, MEMORY_DIR } from "./memory.js";
import { registerAllTools } from "./tools/index.js";

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

const server = new McpServer({
  name: "memory-agent",
  version: "1.5.1",
});

registerAllTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`memory-agent MCP server running, data dir: ${MEMORY_DIR}`);
