import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { getCodexMemoryAgentSections } from "./codex_config.js";

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
    if (argsMatch[1].replace(stringPattern, '').replace(/[\s,]/g, '')) return { ok: false, error: 'Unsupported memory-agent args', sectionCount: 1 };
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
    if (infoResult?.isError || recallResult?.isError) throw new Error(`MCP tool returned an error: ${toolText(infoResult?.isError ? infoResult : recallResult)}`);
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
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 5000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill();
      });
    }
  }
}

export async function runCodexDoctor({ home = homedir(), cwd = process.cwd(), env = process.env, output = console } = {}) {
  const { clientRequest } = await import('./services/client_service.js');
  const options = { home, cwd, env };
  const status = await clientRequest({ action: 'status', client: 'codex' }, options);
  const item = status.items[0];
  if (!item.version) return { ok: false, checks: [{ level: 'FAIL', label: 'Client configuration unavailable' }], runtimeVerified: false };
  const result = await clientRequest({ action: 'probe', client: 'codex', operation: 'doctor', expectedVersion: item.version }, options);
  for (const check of result.checks) output.log('[' + check.level + '] ' + check.label);
  if (result.status !== 'passed') output.log('[FAIL] Client doctor: ' + (result.code || result.status));
  output.log('[INFO] Active session and automatic initialization: UNVERIFIED');
  return { ...result, ok: result.status === 'passed', runtimeVerified: result.status === 'passed', configPath: item.files[0]?.path };
}
