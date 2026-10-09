// Fixed local configuration inventory; no process is started by status.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveClientPaths } from '../client_paths.js';
import { nodeExecutable, resolveClientExecutable } from '../client_cli.js';
import { integrationStatus, PLUGIN_SELECTOR, projectConfigDirectories } from '../plugin_integration.js';
import { isMemoryMcpServerEntry, isMemoryPluginEntry } from '../client_registration.js';
import { getCodexMemoryAgentSections } from '../codex_config.js';
import { parseCodexMemoryAgentConfig } from '../codex_diagnostics.js';
import { START_MARKER, PERSONA_START_MARKER } from '../prompt_manager.js';
import { boundedProcess, probeNative, PROBE_TIMEOUT_MS } from '../client_probe.js';

export const CLIENTS = Object.freeze({ opencode: 'OpenCode', codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini CLI', antigravity: 'Antigravity' });
const LIMIT = 512 * 1024, latest = new Map();
let running = false;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const codes = new Set(['INVALID','CONFLICT','BUSY','TIMEOUT','OUTPUT_LIMIT','PROTOCOL','PROBE_FAILED','CLI_UNAVAILABLE','UNSUPPORTED_LAUNCHER','RUNTIME_MISMATCH','ENGINE_UNAVAILABLE','UNSUPPORTED','UNAVAILABLE']);
const safeCode = error => codes.has(error.code) ? error.code : 'UNAVAILABLE';
const messages = {
  INVALID: 'Choose a fixed client, operation and current configuration version.',
  CONFLICT: 'Client configuration changed. Refresh status before running a probe.',
  BUSY: 'A client probe is already running. Wait for its result.',
};

function reader() {
  const files = new Map();
  function read(file) {
    file = path.resolve(file);
    if (files.has(file)) return files.get(file);
    for (let parent = file; ; parent = path.dirname(parent)) {
      try { if (fs.lstatSync(parent).isSymbolicLink()) fail('UNSUPPORTED'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (path.dirname(parent) === parent) break;
    }
    let state;
    try {
      const stat = fs.statSync(file); if (!stat.isFile() || stat.size > LIMIT) fail('UNSUPPORTED');
      const bytes = fs.readFileSync(file); if (bytes.length > LIMIT) fail('UNSUPPORTED');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      state = { path: file, exists: true, hash: sha(bytes), text };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { path: file, exists: false, hash: null, text: '' };
    }
    files.set(file, state); return state;
  }
  function json(file) {
    const state = read(file); if (!state.exists) return {};
    let value; try { value = JSON.parse(state.text); } catch { fail('UNSUPPORTED'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('UNSUPPORTED');
    return value;
  }
  return { read, json, files };
}

function definition(client, p) {
  return {
    config: { opencode: p.opencodeConfigPath, codex: p.codexConfigPath, claude: p.claudeConfigPath, gemini: p.geminiSettingsPath, antigravity: p.antigravityMcpConfigPath }[client],
    dir: { opencode: p.opencodeDir, codex: p.codexDir, claude: p.claudeDir, gemini: p.geminiDir, antigravity: p.antigravityConfigDir }[client],
    prompt: { codex: path.join(p.codexDir,'AGENTS.md'), claude: path.join(p.claudeDir,'CLAUDE.md'), gemini: p.geminiPromptPath, antigravity: path.join(p.antigravityConfigDir,'AGENTS.md') }[client],
  };
}

async function capture(client, options) {
  const p = options.paths || resolveClientPaths(options), r = reader(), target = definition(client, p);
  const executable = client === 'antigravity' ? null : resolveClientExecutable(client, options);
  const base = { client, name: CLIENTS[client], scope: 'global-and-panel-workspace', workspace: p.cwd,
    observedAt: new Date().toISOString(), activeSession: 'not-observed', agentUsage: 'not-observed', installed: 'not-probed',
    executable: { available: !!executable, path: executable, supported: client !== 'antigravity' } };
  try {
    const config = r.read(target.config);
    let channel, entry = null, count = 0;
    if (['codex','claude'].includes(client)) {
      const status = await integrationStatus(client, { paths: p, cwd: p.cwd, textReader: file => r.read(file).text, jsonReader: r.json });
      // Deliberately select fields: env, raw config and memoryDirOverride may contain secrets.
      channel = { mode: status.mode, marketplace: status.pluginEnabled, direct: status.direct,
        foreign: status.foreignDirect, project: status.projectDirect, conflict: status.conflict };
      if (client === 'codex') {
        count = getCodexMemoryAgentSections(config.text).filter(item => item.exact).length;
        const parsed = parseCodexMemoryAgentConfig(config.text); entry = parsed.ok ? parsed : null;
        if (count === 1 && channel.direct && !parsed.ok) fail('UNSUPPORTED');
      } else { entry = r.json(target.config).mcpServers?.['memory-agent']; count = entry ? 1 : 0; }
    } else {
      const value = r.json(target.config); entry = value.mcpServers?.['memory-agent']; count = entry ? 1 : 0;
      const pluginCount = client === 'opencode' ? ['plugin','plugins'].flatMap(key => Array.isArray(value[key]) ? value[key] : []).filter(isMemoryPluginEntry).length : 0;
      const direct = !!entry && isMemoryMcpServerEntry(entry), foreign = !!entry && !direct;
      let projectBinding = false;
      for (const dir of projectConfigDirectories(p.cwd)) {
        const projectFile = client === 'gemini' ? path.join(dir,'.gemini','settings.json') : client === 'antigravity' ? path.join(dir,'.agents','mcp_config.json') : path.join(dir,'opencode.json');
        const project = r.json(projectFile);
        projectBinding ||= !!(project.mcpServers?.['memory-agent'] || project.mcp?.['memory-agent'] || client === 'opencode' && Array.isArray(project.plugin) && project.plugin.some(isMemoryPluginEntry));
      }
      // Modern OpenCode standalone MCP entries use mcp/command-array rather than mcpServers.
      const local = value.mcp?.['memory-agent'];
      const modern = local && Array.isArray(local.command) ? { command: local.command[0], args: local.command.slice(1), disabled: local.enabled === false } : null;
      if (modern) { entry = modern; count++; }
      const owned = direct || !!modern && isMemoryMcpServerEntry(modern);
      channel = { mode: pluginCount ? 'native-plugin' : owned ? 'direct' : projectBinding ? 'project-only' : 'none', marketplace: false,
        nativePlugin: pluginCount > 0, direct: owned, foreign: foreign || !!modern && !isMemoryMcpServerEntry(modern), project: projectBinding,
        conflict: pluginCount > 1 || count > 1 || !!pluginCount && !!entry };
    }
    channel.conflict ||= count > 1;
    if (channel.mode === 'none' && channel.foreign) channel.mode = 'foreign';
    else if (channel.mode === 'none' && channel.project) channel.mode = 'project-only';
    const disabled = entry?.disabled === true || client === 'codex' && /^\s*enabled\s*=\s*false\s*(?:#.*)?$/m.test(entry?.text || '');
    channel.directEnabled = channel.direct && !disabled;
    if (channel.direct && disabled && !channel.marketplace && !channel.nativePlugin) channel.mode = 'disabled';
    const skill = r.read(path.join(target.dir,'skills','using-memory','SKILL.md'));
    const prompt = target.prompt ? r.read(target.prompt) : null;
    // Claude Code receives the personality through a selected output style, not a CLAUDE.md block.
    let persona = !!prompt && prompt.text.includes(PERSONA_START_MARKER);
    if (client === 'claude' && !persona) {
      try {
        persona = r.read(path.join(target.dir, 'output-styles', 'memory-persona.md')).exists
          && r.json(path.join(target.dir, 'settings.json')).outputStyle === 'memory-persona';
      } catch { persona = false; }
    }
    const item = { ...base, status: channel.conflict ? 'conflict' : channel.foreign ? 'foreign' : 'available', channel,
      components: { skill: { path: skill.path, exists: skill.exists, ownership: 'not-verified' },
        prompt: prompt ? { path: prompt.path, exists: prompt.exists, prompt: prompt.text.includes(START_MARKER), persona } : { channel: 'native-context' } } };
    const files = [...r.files.values()].map(({ path, exists, hash }) => ({ path, exists, hash }));
    item.files = files;
    item.version = sha(JSON.stringify({ client, files, channel, executable }));
    return { item, entry, paths: p, r };
  } catch (error) {
    return { item: { ...base, status: 'unavailable', code: safeCode(error), version: null, files: [...r.files.values()].map(({ path, exists, hash }) => ({ path, exists, hash })) } };
  }
}

function safeEnvironment(env) {
  return { ...env, MEMORY_CLIENT_PROBE: '1', MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_DISABLE_WEB_AUTOSTART: '1', MEMORY_WEB_AUTOSTART: '0' };
}

async function doctor(captured, options) {
  const { item, entry, paths: p, r } = captured;
  if (item.status !== 'available' || item.channel.project || !item.channel.directEnabled && !item.channel.marketplace) fail('UNSUPPORTED_LAUNCHER');
  const env = safeEnvironment(options.env), processOptions = { cwd: p.cwd, env, timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS };
  const deadline = Date.now() + processOptions.timeoutMs;
  let command = nodeExecutable(), args, expectedRuntime, metadata = {};
  if (item.channel.marketplace) {
    const listing = await probeNative(item.client, ['plugin','list','--json'], processOptions);
    let listed; try { listed = JSON.parse(listing.stdout); } catch { fail('PROTOCOL'); }
    const installed = item.client === 'codex' ? listed.installed?.find?.(x => x.pluginId === PLUGIN_SELECTOR) : listed.find?.(x => x.id === PLUGIN_SELECTOR);
    if (!installed?.enabled) fail('PROBE_FAILED');
    const dir = item.client === 'codex' ? installed.source?.path : installed.installPath;
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) fail('UNSUPPORTED_LAUNCHER');
    const receipt = r.json(path.join(dir,'runtime.json'));
    if (receipt.schema !== 1 || receipt.client !== item.client || typeof receipt.runtime !== 'string' || !path.isAbsolute(receipt.runtime) || typeof receipt.memoryDir !== 'string' || !path.isAbsolute(receipt.memoryDir)) fail('RUNTIME_MISMATCH');
    const pkg = r.json(path.join(receipt.runtime,'package.json'));
    if (pkg.name !== '@lotargo/memory_plugin' || pkg.version !== receipt.version || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(receipt.version)) fail('RUNTIME_MISMATCH');
    if (!r.read(path.join(receipt.runtime,'mcp-server','index.js')).text.includes('MEMORY_CLIENT_PROBE')) fail('UNSUPPORTED_LAUNCHER');
    const adapter = path.join(dir,'scripts','entry.cjs');
    if (r.read(adapter).hash !== sha(fs.readFileSync(fileURLToPath(new URL('../marketplace_entry.cjs',import.meta.url))))) fail('UNSUPPORTED_LAUNCHER');
    args = [adapter,'mcp']; expectedRuntime = { memoryDir: receipt.memoryDir, version: receipt.version };
    metadata = { installed: 'native-list-confirmed', version: receipt.version, installedPath: dir, memoryDir: receipt.memoryDir };
  } else {
    if (!entry || !Array.isArray(entry.args) || entry.args.length !== 1 || !path.isAbsolute(entry.args[0]) || path.basename(entry.args[0]) !== 'boot.js') fail('UNSUPPORTED_LAUNCHER');
    let node = entry.command === 'node' ? resolveClientExecutable('node', options) : entry.command;
    if (!node || !path.isAbsolute(node) || fs.realpathSync(node) !== fs.realpathSync(command)) fail('UNSUPPORTED_LAUNCHER');
    const pkg = r.json(path.join(path.dirname(path.dirname(entry.args[0])),'package.json'));
    if (pkg.name !== '@lotargo/memory_plugin' || path.basename(path.dirname(entry.args[0])) !== 'mcp-server' || !r.read(entry.args[0]).exists) fail('UNSUPPORTED_LAUNCHER');
    if (!r.read(path.join(path.dirname(entry.args[0]),'index.js')).text.includes('MEMORY_CLIENT_PROBE')) fail('UNSUPPORTED_LAUNCHER');
    // Only supported storage overrides are forwarded, never arbitrary launcher env or args.
    if (typeof entry.env?.MEMORY_DIR === 'string') env.MEMORY_DIR = entry.env.MEMORY_DIR;
    if (typeof entry.env?.OPENCODE_CONFIG_DIR === 'string') env.OPENCODE_CONFIG_DIR = entry.env.OPENCODE_CONFIG_DIR;
    if (item.client === 'codex') {
      const envSection = getCodexMemoryAgentSections(r.read(item.files[0].path).text).find(s => /\.\s*env\s*$/.test(s.name));
      for (const key of ['MEMORY_DIR','OPENCODE_CONFIG_DIR']) {
        const match = envSection?.text.match(new RegExp(`^\\s*${key}\\s*=\\s*("(?:\\\\.|[^"\\\\])*"|'[^']*')`, 'm'));
        if (match) env[key] = match[1][0] === '"' ? JSON.parse(match[1]) : match[1].slice(1,-1);
      }
    }
    args = entry.args;
  }
  const remaining = deadline - Date.now(); if (remaining <= 0) fail('TIMEOUT');
  const result = await boundedProcess({ ...processOptions, timeoutMs: remaining, command, args, protocol: true, expectedRuntime });
  const fresh = reader();
  for (const state of r.files.values()) if (fresh.read(state.path).hash !== state.hash) fail('CONFLICT');
  return { ...metadata, ...result, checks: ['MCP initialize','MCP tools/list','memory_info tool call','recall(scope=all) tool call'].map(label => ({ label,
    level: label === 'memory_info tool call' && result.memoryInfo === 'PARTIAL' ? 'WARN' : 'OK' })) };
}

export async function clientRequest(input, options = {}) {
  const allowed = { status: ['action','client'], probe: ['action','client','operation','expectedVersion'] };
  if (!input || !Object.hasOwn(allowed,input.action) || Object.keys(input).some(key => !allowed[input.action].includes(key)) || input.client !== undefined && !Object.hasOwn(CLIENTS,input.client))
    throw Object.assign(new Error(messages.INVALID), { code: 'INVALID' });
  options = { ...options, env: options.env || process.env };
  if (input.action === 'status') {
    const items = [];
    for (const client of input.client ? [input.client] : Object.keys(CLIENTS)) {
      const { item } = await capture(client, options), cached = latest.get(client);
      if (cached) item.lastProbe = { ...cached, stale: cached.configurationVersion !== item.version };
      items.push(item);
    }
    return { observedAt: new Date().toISOString(), items, running, source: 'local-client-files-and-PATH', activeSession: 'not-observed', agentUsage: 'not-observed' };
  }
  if (!input.client || !['version','doctor'].includes(input.operation) || !/^[a-f0-9]{64}$/.test(input.expectedVersion || '')) throw Object.assign(new Error(messages.INVALID), { code: 'INVALID' });
  if (running) throw Object.assign(new Error(messages.BUSY), { code: 'BUSY' });
  running = true;
  const startedAt = new Date().toISOString(), started = Date.now();
  try {
    const captured = await capture(input.client, options);
    if (captured.item.version !== input.expectedVersion) throw Object.assign(new Error(messages.CONFLICT), { code: 'CONFLICT' });
    let result;
    try {
      if (input.operation === 'version') {
        if (input.client === 'antigravity') fail('UNSUPPORTED_LAUNCHER');
        const value = await probeNative(input.client, ['--version'], { cwd: captured.paths.cwd, env: safeEnvironment(options.env), timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS });
        const match = value.stdout.match(/\b\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?\b/);
        if (!match) fail('PROTOCOL');
        result = { status: 'passed', cliVersion: match[0], checks: [{ level: 'OK', label: 'Client CLI version' }] };
      } else result = { status: 'passed', ...await doctor(captured, { ...options, timeoutMs: Math.max(1,(options.timeoutMs ?? PROBE_TIMEOUT_MS) - (Date.now()-started)) }) };
    } catch (error) { result = { status: error.code === 'CONFLICT' ? 'stale' : error.code === 'TIMEOUT' ? 'timed-out' : ['UNSUPPORTED_LAUNCHER','CLI_UNAVAILABLE'].includes(error.code) ? 'unavailable' : 'failed', code: safeCode(error), checks: [] }; }
    const after = await capture(input.client, options);
    const response = { ...result, client: input.client, operation: input.operation, configurationVersion: input.expectedVersion,
      startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now()-started, timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS,
      stale: result.status === 'stale' || after.item.version !== input.expectedVersion, activeSession: 'not-observed', agentUsage: 'not-observed', automaticInitialization: 'UNVERIFIED' };
    if (response.stale) { response.status = 'stale'; response.code = 'CONFLICT'; }
    latest.set(input.client, response); return response;
  } finally { running = false; }
}
