import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { resolveClientPaths } from './client_paths.js';
import { isMemoryMcpServerEntry, readJsonConfig } from './client_registration.js';
import { getCodexMemoryAgentSections, isMemoryPluginOwnedSection } from './codex_config.js';

export const MARKETPLACE_NAME = 'lotargo-memory-local';
export const PLUGIN_NAME = 'memory';
export const PLUGIN_SELECTOR = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

async function textAt(path) {
  return existsSync(path) ? readFile(path, 'utf8') : '';
}

function codexPluginSetting(text) {
  // Only our exact catalog identity is ours to inspect. Do not match other
  // plugins named memory, nor nested per-tool policy tables.
  const escaped = PLUGIN_SELECTOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\s*\\[plugins\\.(?:"${escaped}"|'${escaped}')\\]\\s*(?:#.*)?$`, 'm');
  const match = pattern.exec(text);
  if (!match) return undefined;
  const body = text.slice(match.index + match[0].length).split(/^\s*\[/m)[0];
  const enabled = body.match(/^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/m);
  if (!enabled) throw new Error(`Cannot determine enabled state of ${PLUGIN_SELECTOR}`);
  return enabled[1] === 'true';
}

export function projectConfigDirectories(cwd) {
  const current = resolve(cwd);
  const directories = [];
  for (let dir = current; ; dir = dirname(dir)) {
    directories.push(dir);
    if (existsSync(join(dir, '.git'))) return directories.reverse();
    if (dirname(dir) === dir) return [current];
  }
}

export async function integrationStatus(client, { paths = resolveClientPaths(), cwd = paths.cwd,
  textReader = textAt, jsonReader = readJsonConfig } = {}) {
  if (!['codex', 'claude'].includes(client)) throw new Error('Client must be codex or claude');
  let pluginEnabled = false;
  let direct = false;
  let foreignDirect = false;
  let projectDirect = false;
  let memoryDirOverride;
  const configPath = client === 'codex' ? paths.codexConfigPath : paths.claudeConfigPath;
  const projectDirectories = projectConfigDirectories(cwd);
  if (client === 'codex') {
    const config = await textReader(configPath);
    const sections = getCodexMemoryAgentSections(config).filter(s => s.exact);
    direct = sections.some(s => isMemoryPluginOwnedSection(s.text));
    foreignDirect = sections.some(s => !isMemoryPluginOwnedSection(s.text));
    const envSection = getCodexMemoryAgentSections(config).find(s => /\.\s*env\s*$/.test(s.name));
    const envPath = key => {
      const match = envSection?.text.match(new RegExp(`^\\s*(?:${key}|"${key}")\\s*=\\s*("(?:\\\\.|[^"\\\\])*"|'[^']*')`, 'm'));
      if (!match) return undefined;
      return match[1][0] === '"' ? JSON.parse(match[1]) : match[1].slice(1, -1);
    };
    memoryDirOverride = envPath('MEMORY_DIR') || (envPath('OPENCODE_CONFIG_DIR') ? join(envPath('OPENCODE_CONFIG_DIR'), 'memory') : undefined);
    pluginEnabled = codexPluginSetting(config) ?? false;
    for (const dir of projectDirectories) {
      const file = join(dir, '.codex', 'config.toml');
      if (resolve(file) === resolve(configPath)) continue;
      const project = await textReader(file);
      pluginEnabled = codexPluginSetting(project) ?? pluginEnabled;
      projectDirect ||= getCodexMemoryAgentSections(project).length > 0;
    }
  } else {
    const config = await jsonReader(configPath);
    const entry = config.mcpServers?.['memory-agent'];
    direct = !!entry && isMemoryMcpServerEntry(entry);
    foreignDirect = !!entry && !direct;
    memoryDirOverride = entry?.env?.MEMORY_DIR || (entry?.env?.OPENCODE_CONFIG_DIR ? join(entry.env.OPENCODE_CONFIG_DIR, 'memory') : undefined);
    for (const file of [join(paths.claudeDir, 'settings.json'), ...projectDirectories.flatMap(dir => [join(dir, '.claude', 'settings.json'), join(dir, '.claude', 'settings.local.json')])]) {
      const settings = await jsonReader(file);
      const flag = settings.enabledPlugins?.[PLUGIN_SELECTOR];
      if (flag !== undefined && typeof flag !== 'boolean') throw new Error(`Invalid plugin state in ${file}`);
      pluginEnabled = flag ?? pluginEnabled;
    }
    for (const dir of projectDirectories) {
      const project = await jsonReader(join(dir, '.mcp.json'));
      projectDirect ||= !!project.mcpServers?.['memory-agent'];
    }
  }
  return { client, selector: PLUGIN_SELECTOR, pluginEnabled, direct, foreignDirect, projectDirect,
    conflict: pluginEnabled && (direct || foreignDirect || projectDirect), configPath, memoryDirOverride,
    mode: pluginEnabled ? (direct || foreignDirect || projectDirect ? 'conflict' : 'marketplace') : direct ? 'direct' : 'none' };
}

export async function assertDirectSetupAllowed(clients) {
  for (const client of clients) {
    const status = await integrationStatus(client);
    if (status.pluginEnabled) throw new Error(`${client}: ${PLUGIN_SELECTOR} is enabled. Use memory-plugin marketplace direct --client ${client} to switch; setup would duplicate the plugin.`);
  }
}

export async function isPluginManagedTarget(name) {
  const client = { Codex: 'codex', 'Claude Code': 'claude' }[name];
  return client ? (await integrationStatus(client)).pluginEnabled : false;
}

export async function assertPluginLaunchAllowed(client) {
  const status = await integrationStatus(client);
  if (status.direct || status.foreignDirect || status.projectDirect) {
    throw new Error(`${client}: direct memory-agent registration is still present. Use memory-plugin marketplace install --client ${client} --path <built-marketplace> to migrate it. No second server was started.`);
  }
  return status;
}
