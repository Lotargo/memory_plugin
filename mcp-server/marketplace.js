import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { nodeExecutable, resolveClientExecutable, runClientCli, cliFailureMessage } from './client_cli.js';
import { resolveClientPaths } from './client_paths.js';
import { integrationStatus, MARKETPLACE_NAME, PLUGIN_NAME, PLUGIN_SELECTOR } from './plugin_integration.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const jsonWrite = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
};

async function npmCommand(args, cwd) {
  const executable = resolveClientExecutable('npm', { env: { ...process.env, MEMORY_PLUGIN_DISABLE_NATIVE_CLI: '0' } });
  const resolved = executable ? await realpath(executable) : null;
  const npmCli = process.env.npm_execpath || (resolved?.endsWith('.js') ? resolved : executable && join(dirname(executable), 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  if (!npmCli || !existsSync(npmCli)) throw new Error('npm-cli.js is required to prepare a local marketplace runtime');
  const result = spawnSync(nodeExecutable(), [npmCli, ...args], {
    cwd, encoding: 'utf8', timeout: 300000, windowsHide: true,
    env: { ...process.env, CI: '1', MEMORY_WEB_AUTOSTART: '0' }, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`npm ${args[0]} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout;
}

export async function buildMarketplace({ output, memoryDir, prepare = true, installDependencies = npmCommand } = {}) {
  if (!output || !isAbsolute(output)) throw new Error('--output must be an absolute path to a new directory');
  output = resolve(output);
  if (existsSync(output)) throw new Error('Output already exists. Use a new directory; installed runtimes are never overwritten.');
  const { MEMORY_DIR } = await import('./memory.js');
  memoryDir = resolve(memoryDir || MEMORY_DIR);
  const dataRelative = relative(output, memoryDir);
  if (!dataRelative || (!dataRelative.startsWith('..') && !isAbsolute(dataRelative))) throw new Error('User memory must live outside the build directory');
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const packed = JSON.parse(await npmCommand(['pack', '--dry-run', '--json', '--ignore-scripts'], ROOT))[0];
  const runtime = join(output, 'runtime');
  await mkdir(runtime, { recursive: true });
  await jsonWrite(join(output, 'local-marketplace.json'), { schema: 1, prepared: false });
  const digest = createHash('sha256');
  const files = packed.files.map(f => f.path).sort();
  for (const name of files) {
    const source = resolve(ROOT, name);
    const rel = relative(ROOT, source);
    if (rel.startsWith('..') || isAbsolute(rel) || !/^(mcp-server\/|opencode-plugin\/|skills\/|package\.json$|npm-shrinkwrap\.json$|README\.md$|MARKETPLACE\.md$|CHANGELOG\.md$|LICENSE$)/.test(name)) {
      throw new Error(`Unexpected source bundle file: ${name}`);
    }
    if ((await lstat(source)).isSymbolicLink()) throw new Error(`Symlinks are not permitted in source bundles: ${name}`);
    const content = await readFile(source);
    digest.update(name).update('\0').update(content).update('\0');
    await mkdir(dirname(join(runtime, name)), { recursive: true });
    await writeFile(join(runtime, name), content);
  }
  // Dependencies are prepared explicitly. Do not run this package's npm
  // lifecycle hooks, change client registrations, or autostart the dashboard.
  await jsonWrite(join(runtime, 'package.json'), { ...pkg, scripts: {} });
  if (prepare) await installDependencies(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], runtime);
  const sourceDigest = digest.digest('hex');
  for (const client of ['codex', 'claude']) {
    const base = join(output, client);
    const plugin = join(base, 'plugins', PLUGIN_NAME);
    await mkdir(join(plugin, 'scripts'), { recursive: true });
    await cp(join(ROOT, 'mcp-server', 'marketplace_entry.cjs'), join(plugin, 'scripts', 'entry.cjs'));
    await cp(join(ROOT, 'skills'), join(plugin, 'skills'), { recursive: true });
    await jsonWrite(join(plugin, 'runtime.json'), { schema: 1, client, runtime, memoryDir, version: pkg.version, sourceDigest });
    const macro = client === 'codex' ? '${PLUGIN_ROOT}' : '${CLAUDE_PLUGIN_ROOT}';
    // Codex's legacy MCP loader does not expand PLUGIN_ROOT. These catalogs
    // already belong to this machine and retain their immutable build, so pin
    // its adapter path just as runtime.json pins the prepared engine path.
    const entry = client === 'codex' ? join(plugin, 'scripts', 'entry.cjs') : `${macro}/scripts/entry.cjs`;
    const nodePath = nodeExecutable();
    const mcp = { mcpServers: { 'memory-agent': { command: nodePath, args: [entry, 'mcp'] } } };
    const handler = { type: 'command', command: `"${nodePath.replace(/\\/g, '/')}" "${macro}/scripts/entry.cjs" hook`, timeout: 10 };
    if (client === 'codex' && process.platform === 'win32') {
      // A quoted executable is a string expression in PowerShell. Read the
      // plugin path as an environment value so spaces and '$' stay literal.
      const node = nodePath.replace(/\\/g, '/').replace(/'/g, "''");
      handler.commandWindows = `& '${node}' (Join-Path $env:PLUGIN_ROOT 'scripts/entry.cjs') hook`;
    }
    const hooks = { hooks: { SessionStart: [{ hooks: [handler] }] } };
    await jsonWrite(join(plugin, 'hooks', 'hooks.json'), hooks);
    const identity = { name: PLUGIN_NAME, version: pkg.version, description: 'Local persistent memory, RAG and agent instructions', author: { name: 'Lotargo' }, license: 'MIT' };
    if (client === 'codex') {
      await jsonWrite(join(plugin, '.codex-plugin', 'plugin.json'), { ...identity, skills: './skills/', mcpServers: './.mcp.json', hooks: './hooks/hooks.json',
        interface: { displayName: 'Memory', shortDescription: 'Local memory and RAG', developerName: 'Lotargo', category: 'Productivity', capabilities: ['Read', 'Write'] } });
      await jsonWrite(join(base, '.agents', 'plugins', 'marketplace.json'), { name: MARKETPLACE_NAME, interface: { displayName: 'Lotargo Memory — Local' }, plugins: [{ name: PLUGIN_NAME, source: { source: 'local', path: './plugins/memory' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] });
    } else {
      await jsonWrite(join(plugin, '.claude-plugin', 'plugin.json'), { ...identity, mcpServers: './.mcp.json' });
      await jsonWrite(join(base, '.claude-plugin', 'marketplace.json'), { name: MARKETPLACE_NAME, metadata: { description: 'Local Lotargo memory plugin with a shared prepared runtime' }, owner: { name: 'Lotargo' }, plugins: [{ name: PLUGIN_NAME, source: './plugins/memory', description: identity.description }] });
    }
    await jsonWrite(join(plugin, '.mcp.json'), mcp);
  }
  const receipt = { schema: 1, prepared: prepare, version: pkg.version, sourceDigest, runtime, memoryDir, nodePath: nodeExecutable(), clients: ['codex', 'claude'] };
  await jsonWrite(join(output, 'local-marketplace.json'), receipt);
  await writeFile(join(output, 'README.md'), `# Local memory marketplace\n\nVersion: ${pkg.version}\nSource: ${sourceDigest}\nPrepared: ${prepare}\n\nThis build belongs to this computer. Keep this directory: installed adapters use its prepared runtime. User memory remains in ${memoryDir}. Rebuilding requires a new output directory.\n\nInstall and migrate the direct integration:\n\n\`\`\`powershell\nnode "${join(runtime, 'mcp-server', 'boot.js')}" marketplace install --client codex --path "${output}"\nnode "${join(runtime, 'mcp-server', 'boot.js')}" marketplace install --client claude --path "${output}"\n\`\`\`\n\nReview and trust the Codex SessionStart hook in the client before expecting automatic initialization. Start a new session after installation, disable, removal or channel changes.\n`);
  return { output, ...receipt };
}

function native(client, args, options = {}) {
  const result = runClientCli(client, args, { timeout: 120000, ...options });
  if (!result.ok) throw new Error(`${client}: ${cliFailureMessage(result)}`);
  return result;
}

async function migrationPreflight(client) {
  const status = await integrationStatus(client);
  if (status.foreignDirect || status.projectDirect) throw new Error('A foreign or project-scoped memory-agent registration exists. Resolve it before switching the user-scoped integration.');
  const paths = resolveClientPaths();
  const skills = client === 'codex'
    ? [join(paths.codexDir, 'skills', 'using-memory'), join(paths.home, '.agents', 'skills', 'using-memory')]
    : [join(paths.claudeDir, 'skills', 'using-memory')];
  const { isOwnedSkillDir } = await import('./uninstall.js');
  for (const skill of skills) if (existsSync(skill) && !await isOwnedSkillDir(skill)) {
    throw new Error(`Skill contains local modifications or belongs to another version: ${skill}. Preserve or reconcile it before switching.`);
  }
  return status;
}

export async function installMarketplace(client, output, { runNative = native } = {}) {
  const receipt = JSON.parse(await readFile(join(output, 'local-marketplace.json'), 'utf8'));
  if (receipt.schema !== 1 || !receipt.prepared || !existsSync(join(receipt.runtime, 'node_modules'))) throw new Error('Marketplace runtime is not prepared. Build without --source-only first.');
  const before = await migrationPreflight(client);
  const { preparePromptMigrationCleanup } = await import('./services/prompt_service.js');
  const cleanupOldPrompt = await preparePromptMigrationCleanup(client);
  if (before.direct) {
    const { MEMORY_DIR } = await import('./memory.js');
    const normalizeData = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
    if (normalizeData(before.memoryDirOverride || MEMORY_DIR) !== normalizeData(receipt.memoryDir)) {
      throw new Error(`The build uses another memory directory. Rebuild with --memory-dir "${before.memoryDirOverride || MEMORY_DIR}" before migrating; the direct integration was preserved.`);
    }
  }
  const source = join(resolve(output), client);
  let alreadyRegistered = false;
  if (client === 'claude') {
    const listing = await runNative(client, ['plugin', 'marketplace', 'list', '--json']);
    const existing = JSON.parse(listing.stdout || '[]').find(item => item.name === MARKETPLACE_NAME);
    if (existing) {
      const normalize = path => resolve(path).replace(/^\\\\\?\\/, '').replace(/\\/g, '/').toLowerCase();
      if (existing.source !== 'directory' || normalize(existing.installLocation) !== normalize(source)) {
        throw new Error(`Existing ${MARKETPLACE_NAME} marketplace points to another source. Remove that catalog explicitly with claude plugin marketplace remove ${MARKETPLACE_NAME}, then install the new build. Shared runtime and memory are retained.`);
      }
      alreadyRegistered = true;
      if (before.mode === 'marketplace') return before;
    }
  }
  // Older Claude CLIs parse a Windows drive prefix as a URI scheme. Resolve
  // the local source from an explicit cwd instead of passing that drive path.
  if (!alreadyRegistered) await runNative(client, ['plugin', 'marketplace', 'add', client === 'claude' ? './' : source], { cwd: source });
  await runNative(client, ['plugin', client === 'codex' ? 'add' : 'install', PLUGIN_SELECTOR]);
  if (client === 'claude' && !(await integrationStatus(client)).pluginEnabled) await runNative(client, ['plugin', 'enable', PLUGIN_SELECTOR]);
  const enabled = await integrationStatus(client);
  if (!enabled.pluginEnabled) throw new Error('Native install did not enable the expected plugin. Direct integration was preserved.');
  try {
    await cleanupOldPrompt();
    const { runUninstall } = await import('./uninstall.js');
    const result = await runUninstall(['uninstall', `--${client}`]);
    if (!result.ok) throw new Error('Direct integration cleanup failed');
    const status = await integrationStatus(client);
    if (status.conflict || !status.pluginEnabled) throw new Error('Integration changed during migration; run marketplace status');
    return status;
  } catch (error) {
    // Keep the shared runtime/data. Disable/remove only the new adapter if
    // legacy cleanup failed; never leave two active registrations.
    try { await runNative(client, ['plugin', client === 'codex' ? 'remove' : 'uninstall', PLUGIN_SELECTOR]); }
    catch (rollback) { throw new Error(`${error.message}; plugin rollback also failed: ${rollback.message}`); }
    throw error;
  }
}

export async function switchToDirect(client, { runNative = native } = {}) {
  await migrationPreflight(client);
  const before = await integrationStatus(client);
  if (before.pluginEnabled) await runNative(client, ['plugin', client === 'codex' ? 'remove' : 'uninstall', PLUGIN_SELECTOR]);
  if ((await integrationStatus(client)).pluginEnabled) throw new Error('Plugin is still enabled. Direct setup was not run.');
  const { runSetup } = await import('./setup.js');
  await runSetup(['setup', `--${client}`]);
  const status = await integrationStatus(client);
  if (status.mode !== 'direct') throw new Error('Direct setup failed. Shared memory was retained; run setup again.');
  return status;
}

export async function marketplaceDoctor(client) {
  const { clientRequest } = await import('./services/client_service.js');
  const status = await clientRequest({ action: 'status', client });
  const item = status.items[0];
  if (!item?.version || item.channel?.mode !== 'marketplace') throw new Error('Expected one available marketplace integration. Refresh client status.');
  const result = await clientRequest({ action: 'probe', client, operation: 'doctor', expectedVersion: item.version });
  if (result.status !== 'passed') throw new Error('Marketplace doctor: ' + (result.code || result.status));
  return { ...result, ok: true };
}

export async function handleMarketplaceCommand(args) {
  try {
    const [action = 'help', ...rest] = args;
    const flags = {};
    for (let i = 0; i < rest.length; i++) {
      const key = rest[i];
      if (!['--client', '--path', '--output', '--memory-dir', '--source-only'].includes(key) || flags[key] !== undefined) throw new Error(`Unknown or duplicate option: ${key}`);
      if (key === '--source-only') flags[key] = true;
      else { if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`Missing value: ${key}`); flags[key] = rest[++i]; }
    }
    const allowed = { build: ['--output', '--memory-dir', '--source-only'], install: ['--client', '--path'], direct: ['--client'], uninstall: ['--client'], doctor: ['--client'], status: ['--client'], help: [] }[action];
    if (!allowed || Object.keys(flags).some(k => !allowed.includes(k))) throw new Error(`Invalid marketplace command/options: ${action}`);
    if (['install', 'direct', 'uninstall', 'doctor'].includes(action) && !['codex', 'claude'].includes(flags['--client'])) throw new Error('--client codex|claude is required');
    if (action === 'help') {
      console.log('memory-plugin marketplace build --output <new absolute directory> [--memory-dir <path>] [--source-only]\nmemory-plugin marketplace install --client codex|claude --path <built directory>\nmemory-plugin marketplace direct --client codex|claude\nmemory-plugin marketplace uninstall --client codex|claude\nmemory-plugin marketplace doctor --client codex|claude\nmemory-plugin marketplace status [--client codex|claude]');
      return;
    }
    let result;
    if (action === 'build') result = await buildMarketplace({ output: flags['--output'], memoryDir: flags['--memory-dir'], prepare: !flags['--source-only'] });
    else if (action === 'install') { if (!flags['--path']) throw new Error('--path is required'); result = await installMarketplace(flags['--client'], flags['--path']); }
    else if (action === 'direct') result = await switchToDirect(flags['--client']);
    else if (action === 'doctor') result = await marketplaceDoctor(flags['--client']);
    else if (action === 'uninstall') {
      native(flags['--client'], ['plugin', flags['--client'] === 'codex' ? 'remove' : 'uninstall', PLUGIN_SELECTOR]);
      result = await integrationStatus(flags['--client']);
      if (result.pluginEnabled) throw new Error('Plugin remains enabled in another configuration scope');
    } else {
      if (flags['--client'] && !['codex','claude'].includes(flags['--client'])) throw new Error('--client codex|claude is required');
      const { clientRequest } = await import('./services/client_service.js');
      const snapshot = await clientRequest({ action: 'status', ...(flags['--client'] ? { client: flags['--client'] } : {}) });
      result = snapshot.items.filter(item => ['codex','claude'].includes(item.client)).map(item => ({ ...item, selector: PLUGIN_SELECTOR,
        pluginEnabled: item.channel?.marketplace ?? null, direct: item.channel?.direct ?? null, foreignDirect: item.channel?.foreign ?? null,
        projectDirect: item.channel?.project ?? null, conflict: item.channel?.conflict ?? null, mode: item.channel?.mode || 'unknown', configPath: item.files[0]?.path }));
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(`Marketplace: ${error.message}`); process.exitCode = 1; }
}
