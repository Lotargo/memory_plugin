import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getCodexMemoryAgentSections, isSupportedNodeVersion } from "./codex_config.js";

function decodeTomlString(raw) {
  const value = String(raw || "").trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return null;
}

export function parseCodexMemoryAgentConfig(content) {
  const exact = getCodexMemoryAgentSections(content).filter((section) => section.exact);
  if (exact.length !== 1) {
    return {
      ok: false,
      error: exact.length === 0
        ? "[mcp_servers.memory-agent] section not found"
        : `Found ${exact.length} memory-agent sections`,
      sectionCount: exact.length,
    };
  }

  const text = exact[0].text;
  const commandMatch = text.match(/^\s*command\s*=\s*(.+?)\s*$/m);
  const argsMatch = text.match(/^\s*args\s*=\s*\[([\s\S]*?)\]\s*$/m);
  const timeoutMatch = text.match(/^\s*startup_timeout_sec\s*=\s*(\d+)\s*$/m);
  const command = decodeTomlString(commandMatch?.[1]);
  const args = [];
  if (argsMatch) {
    const stringPattern = /"(?:\\.|[^"\\])*"|'(?:''|[^'])*'/g;
    for (const match of argsMatch[1].matchAll(stringPattern)) {
      const decoded = decodeTomlString(match[0]);
      if (decoded === null) return { ok: false, error: "Unable to parse memory-agent args", sectionCount: 1 };
      args.push(decoded);
    }
  }

  if (!command) return { ok: false, error: "Unable to parse memory-agent command", sectionCount: 1 };
  if (!argsMatch) return { ok: false, error: "Unable to parse memory-agent args", sectionCount: 1 };
  return {
    ok: true,
    command,
    args,
    startupTimeoutSec: timeoutMatch ? Number(timeoutMatch[1]) : null,
    sectionCount: 1,
    text,
  };
}

function toolText(result) {
  return (result?.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

export async function runDirectMcpSmoke({
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = 30_000,
} = {}) {
  if (!command) throw new Error("MCP command is required");
  const child = spawn(command, args, { cwd, env: { ...env }, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let nextId = 0;
  let stdoutBuffer = "";
  let stderr = "";
  let settled = false;
  const pending = new Map();

  const rejectAll = (error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    let newline;
    while ((newline = stdoutBuffer.indexOf("\n")) >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        rejectAll(new Error(`Invalid JSON-RPC output: ${error.message}; line=${line.slice(0, 200)}`));
        continue;
      }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    }
  });
  child.on("error", (error) => rejectAll(error));
  child.on("exit", (code, signal) => {
    if (!settled && pending.size > 0) {
      rejectAll(new Error(`MCP server exited before completing diagnostics (code=${code}, signal=${signal}): ${stderr.trim()}`));
    }
  });

  const request = (method, params = {}) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  };
  const withTimeout = (promise, label) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });

  try {
    await withTimeout(request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "memory-plugin-codex-doctor", version: "1.0.0" },
    }), "initialize");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

    const toolsResult = await withTimeout(request("tools/list"), "tools/list");
    const toolNames = (toolsResult?.tools || []).map((tool) => tool.name);
    for (const required of ["memory_info", "recall"]) {
      if (!toolNames.includes(required)) throw new Error(`Required MCP tool is missing: ${required}`);
    }
    const infoResult = await withTimeout(
      request("tools/call", { name: "memory_info", arguments: {} }),
      "memory_info"
    );
    const recallResult = await withTimeout(
      request("tools/call", { name: "recall", arguments: { scope: "all" } }),
      "recall(scope=all)"
    );
    settled = true;
    return {
      ok: true,
      toolNames,
      memoryInfo: toolText(infoResult),
      recall: toolText(recallResult),
      stderr: stderr.trim(),
    };
  } finally {
    settled = true;
    rejectAll(new Error("MCP diagnostics finished"));
    if (child.exitCode === null) child.kill();
  }
}

function countOccurrences(text, needle) {
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(needle, offset)) !== -1) {
    count++;
    offset += needle.length;
  }
  return count;
}

export async function runCodexDoctor({
  home = homedir(),
  cwd = process.cwd(),
  env = process.env,
  output = console,
} = {}) {
  const checks = [];
  const record = (level, label, detail = "") => {
    checks.push({ level, label, detail });
    output.log(`[${level}] ${label}${detail ? `: ${detail}` : ""}`);
  };

  const configPath = join(home, ".codex", "config.toml");
  if (!existsSync(configPath)) {
    record("FAIL", "Codex config found", configPath);
    return { ok: false, checks, configPath };
  }
  record("OK", "Codex config found", configPath);
  const config = readFileSync(configPath, "utf8");
  const parsed = parseCodexMemoryAgentConfig(config);
  if (!parsed.ok) {
    record("FAIL", "memory-agent configuration", parsed.error);
    return { ok: false, checks, configPath };
  }
  record("OK", "Single memory-agent section found");
  record(parsed.command.toLowerCase().includes("npx") ? "FAIL" : "OK", "Direct executable launcher", parsed.command);
  record(existsSync(parsed.command) ? "OK" : "FAIL", "Command executable exists", parsed.command);

  const bootPath = parsed.args[0];
  record(bootPath && existsSync(bootPath) ? "OK" : "FAIL", "boot.js exists", bootPath || "missing first arg");
  record(parsed.args.length === 1 ? "OK" : "FAIL", "boot.js is the only launcher argument", JSON.stringify(parsed.args));

  let detectedVersion = null;
  try {
    detectedVersion = await new Promise((resolve, reject) => {
      const child = spawn(parsed.command, ["--version"], { cwd, env: { ...env }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `exit ${code}`)));
    });
    record(isSupportedNodeVersion(detectedVersion) ? "OK" : "FAIL", "Node.js version >= 22.5.0", detectedVersion);
  } catch (error) {
    record("FAIL", "Node.js version check", error.message);
  }

  try {
    const smoke = await runDirectMcpSmoke({ command: parsed.command, args: parsed.args, cwd, env });
    record("OK", "MCP initialize");
    record("OK", "MCP tools/list", `${smoke.toolNames.length} tools`);
    record("OK", "memory_info tool call");
    record("OK", "recall(scope=all) tool call");
  } catch (error) {
    record("FAIL", "Direct MCP protocol smoke test", error.message);
  }

  try {
    const { resolveProjectIdentity } = await import("./identity.js");
    const identity = await resolveProjectIdentity(cwd);
    record("INFO", "Current project identity", identity?.key || "none (global memory only)");
  } catch (error) {
    record("WARN", "Current project identity", error.message);
  }

  const agentsPath = join(home, ".codex", "AGENTS.md");
  if (existsSync(agentsPath)) {
    const agents = readFileSync(agentsPath, "utf8");
    const starts = countOccurrences(agents, "<!-- START MEMORY AGENT PROMPT -->");
    const ends = countOccurrences(agents, "<!-- END MEMORY AGENT PROMPT -->");
    record(starts === 1 && ends === 1 ? "OK" : "WARN", "Codex memory prompt block count", `start=${starts}, end=${ends}`);
  } else {
    record("WARN", "Codex memory prompt", `${agentsPath} not found`);
  }

  record(
    "INFO",
    "Codex Desktop exposure",
    "Cannot be proven by the MCP server; start a new task after setup and verify that memory-agent tools are listed"
  );
  const ok = !checks.some((check) => check.level === "FAIL");
  return { ok, checks, configPath, parsed, detectedVersion };
}
