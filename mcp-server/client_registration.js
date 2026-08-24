import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isMemoryPluginSpec } from "./dev_link.js";

export const MEMORY_MCP_ENTRY = Object.freeze({
  command: "npx",
  args: Object.freeze(["-y", "@lotargo/memory_plugin"]),
});

export function isMemoryPluginEntry(entry) {
  const spec = Array.isArray(entry)
    ? entry[0]
    : entry && typeof entry === "object"
      ? entry.package
      : entry;
  return isMemoryPluginSpec(spec);
}

export function isMemoryMcpServerEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const command = String(entry.command || "").replace(/\\/g, "/").toLowerCase();
  const args = Array.isArray(entry.args)
    ? entry.args.map((value) => String(value).replace(/\\/g, "/").toLowerCase())
    : [];
  return args.some((arg) => /^@lotargo\/memory_plugin(?:@[^/]+)?$/i.test(arg) || /^opencode-memory-plugin(?:@[^/]+)?$/i.test(arg))
    || args.some((arg) => arg.endsWith("/mcp-server/boot.js") && arg.includes("memory"))
    || /(?:^|\/)(?:memory_plugin|memory-agent)(?:\.(?:cmd|exe|ps1|bat))?$/i.test(command);
}

export async function readJsonConfig(filePath) {
  if (!existsSync(filePath)) return {};
  const raw = (await readFile(filePath, "utf-8")).replace(/^\uFEFF/, "");
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected a JSON object in ${filePath}`);
  }
  return value;
}
