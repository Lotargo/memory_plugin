import { existsSync } from "node:fs";

export const MIN_NODE_VERSION = Object.freeze({ major: 22, minor: 5, patch: 0 });
export const DEFAULT_CODEX_STARTUP_TIMEOUT_SEC = 60;

function parseVersion(version) {
  const match = String(version || "").trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] || 0),
  };
}

export function isSupportedNodeVersion(version) {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  if (parsed.major !== MIN_NODE_VERSION.major) return parsed.major > MIN_NODE_VERSION.major;
  if (parsed.minor !== MIN_NODE_VERSION.minor) return parsed.minor > MIN_NODE_VERSION.minor;
  return parsed.patch >= MIN_NODE_VERSION.patch;
}

export function validateCodexRuntime({
  nodePath,
  nodeVersion = process.versions.node,
  bootPath,
  pathExists = existsSync,
} = {}) {
  const errors = [];
  if (!nodePath || !pathExists(nodePath)) {
    errors.push(`Node executable not found: ${nodePath || "<empty>"}`);
  }
  if (!isSupportedNodeVersion(nodeVersion)) {
    errors.push(
      `@lotargo/memory_plugin requires Node.js >= ${MIN_NODE_VERSION.major}.${MIN_NODE_VERSION.minor}.0; detected ${nodeVersion || "unknown"}`
    );
  }
  if (!bootPath || !pathExists(bootPath)) {
    errors.push(`MCP boot entry point not found: ${bootPath || "<empty>"}`);
  }
  return { ok: errors.length === 0, errors, nodePath, nodeVersion, bootPath };
}

export function escapeTomlBasicString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\u0008/g, "\\b")
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\f/g, "\\f")
    .replace(/\r/g, "\\r");
}

export function buildCodexMemoryAgentSection({
  nodePath,
  bootPath,
  startupTimeoutSec = DEFAULT_CODEX_STARTUP_TIMEOUT_SEC,
} = {}) {
  if (!nodePath || !bootPath) throw new Error("nodePath and bootPath are required");
  if (!Number.isInteger(startupTimeoutSec) || startupTimeoutSec <= 0) {
    throw new Error("startupTimeoutSec must be a positive integer");
  }
  return [
    "[mcp_servers.memory-agent]",
    `command = "${escapeTomlBasicString(nodePath)}"`,
    `args = ["${escapeTomlBasicString(bootPath)}"]`,
    `startup_timeout_sec = ${startupTimeoutSec}`,
  ].join("\n");
}

function tableHeaderName(line) {
  const match = String(line).match(/^\s*\[\s*([^\[\]]+?)\s*\]\s*(?:#.*)?$/);
  return match ? match[1] : null;
}

function isMemoryAgentHeader(name, { exact = false } = {}) {
  if (!name) return false;
  const suffix = exact ? "$" : "(?:\\s*\\.|$)";
  return new RegExp(
    `^mcp_servers\\s*\\.\\s*(?:memory-agent|"memory-agent"|'memory-agent')${suffix}`,
    "i"
  ).test(name);
}

export function isMemoryPluginOwnedSection(sectionText) {
  return /@lotargo[\\/]memory_plugin|opencode-memory-plugin|(?:^|[\\/])memory_plugin(?:[\\/]|\b)|mcp-server[\\/]+boot\.js/i.test(
    String(sectionText || "")
  );
}

function sectionRanges(lines) {
  const headers = [];
  for (let i = 0; i < lines.length; i++) {
    const name = tableHeaderName(lines[i]);
    if (name) headers.push({ start: i, name });
  }
  return headers.map((header, index) => ({
    ...header,
    end: index + 1 < headers.length ? headers[index + 1].start : lines.length,
  }));
}

export function getCodexMemoryAgentSections(content) {
  const lines = String(content || "").split(/\r?\n/);
  return sectionRanges(lines)
    .filter((range) => isMemoryAgentHeader(range.name))
    .map((range) => ({
      ...range,
      exact: isMemoryAgentHeader(range.name, { exact: true }),
      text: lines.slice(range.start, range.end).join("\n").trimEnd(),
    }));
}

export function updateCodexMemoryAgentConfig(content, options) {
  const source = String(content || "");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const desired = buildCodexMemoryAgentSection(options).split("\n");
  const ranges = sectionRanges(lines);
  const targets = ranges.filter((range) => isMemoryAgentHeader(range.name));
  const exactTargets = targets.filter((range) => isMemoryAgentHeader(range.name, { exact: true }));

  const unowned = exactTargets.filter((range) => {
    const text = lines.slice(range.start, range.end).join("\n");
    return !isMemoryPluginOwnedSection(text);
  });
  if (unowned.length > 0) {
    return {
      content: source,
      changed: false,
      status: "conflict",
      reason: "Existing [mcp_servers.memory-agent] section is not recognized as owned by @lotargo/memory_plugin",
    };
  }

  if (targets.length === 0) {
    const prefix = source.length === 0 ? "" : source.replace(/[\r\n]+$/, "") + eol + eol;
    return { content: prefix + desired.join(eol) + eol, changed: true, status: "added" };
  }

  const targetStarts = new Map(targets.map((target) => [target.start, target]));
  const targetLineIndexes = new Set();
  for (const target of targets) {
    for (let i = target.start; i < target.end; i++) targetLineIndexes.add(i);
  }

  const firstStart = Math.min(...targets.map((target) => target.start));
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === firstStart) {
      while (result.length > 0 && result[result.length - 1] === "") result.pop();
      if (result.length > 0) result.push("");
      result.push(...desired, "");
    }
    if (targetLineIndexes.has(i)) continue;
    if (targetStarts.has(i)) continue;
    result.push(lines[i]);
  }

  while (result.length > 1 && result[result.length - 1] === "" && result[result.length - 2] === "") {
    result.pop();
  }
  const updated = result.join(eol);
  return {
    content: updated,
    changed: updated !== source,
    status: updated === source ? "unchanged" : "migrated",
  };
}
