#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
const cliArgs = process.argv.slice(2);
if (cliArgs.includes("setup") || cliArgs.includes("install") || cliArgs.includes("--setup") || cliArgs.includes("-s")) {
  const { runSetup } = await import("./setup.js");
  await runSetup();
  process.exit(0);
}

await ensureDir();

const server = new McpServer({
  name: "memory-agent",
  version: "1.0.0",
});

server.registerTool(
  "remember",
  {
    description:
      "Save an important, durable fact to memory. Only use for high-signal information " +
      "(name, goals, constraints, tech preferences, project conventions). " +
      "Translate the fact into English and keep it concise. " +
      "scope: 'project' (default) or 'global'",
    inputSchema: z.object({
      fact: z.string().describe("The fact to remember, written in English"),
      scope: z.string().default("project").describe("'project' (default) or 'global'"),
    }),
  },
  async ({ fact, scope }) => {
    const key = scopeKey(scope, null, null);
    const entries = await readMemory(key);
    const factNormalized = fact.toLowerCase().trim();
    if (entries.some((e) => {
      const idx = e.indexOf("] ");
      return idx !== -1 && e.slice(idx + 2).toLowerCase().trim() === factNormalized;
    })) {
      return { content: [{ type: "text", text: "Already saved" }] };
    }
    entries.push(`- [${today()}] ${fact}`);
    await writeMemory(key, entries);
    return { content: [{ type: "text", text: "Memory updated" }] };
  }
);

server.registerTool(
  "recall",
  {
    description: "Show saved facts. scope: 'project', 'global', or 'all' (default)",
    inputSchema: z.object({
      scope: z.string().default("all").describe("'project', 'global', or 'all'"),
    }),
  },
  async ({ scope }) => {
    const project = projectName(null, null);
    const results = [];
    if (scope !== "project") {
      const global = await readMemoryRaw(GLOBAL_KEY);
      if (global.length) {
        results.push("--- Global ---");
        global.forEach((e, i) => results.push(`${i + 1}. ${e}`));
      }
    }
    if (scope !== "global") {
      const local = await readMemoryRaw(project);
      if (local.length) {
        if (results.length) results.push("");
        results.push(`--- ${project} ---`);
        local.forEach((e, i) => results.push(`${i + 1}. ${e}`));
      }
    }
    const text = results.length ? results.join("\n") : "Memory is empty.";
    return { content: [{ type: "text", text }] };
  }
);

server.registerTool(
  "forget",
  {
    description: "Delete a fact by number (from recall) or text search",
    inputSchema: z.object({
      query: z.string().describe("Number or text to search for"),
      scope: z.string().default("project").describe("'project' (default) or 'global'"),
    }),
  },
  async ({ query, scope }) => {
    const key = scopeKey(scope, null, null);
    const entries = await readMemory(key);
    const num = parseInt(query, 10);
    let removed;
    if (!isNaN(num) && num > 0 && num <= entries.length) {
      removed = entries.splice(num - 1, 1);
    } else {
      const filtered = entries.filter((e) => !e.toLowerCase().includes(query.toLowerCase()));
      removed = entries.filter((e) => e.toLowerCase().includes(query.toLowerCase()));
      entries.length = 0;
      entries.push(...filtered);
    }
    await writeMemory(key, entries);
    const text = removed.length ? "Memory updated" : "Not found.";
    return { content: [{ type: "text", text }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`memory-agent MCP server running, data dir: ${MEMORY_DIR}`);
