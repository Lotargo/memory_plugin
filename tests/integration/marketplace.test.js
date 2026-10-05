import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'memory marketplace '));
const home = join(temp, 'home');
const workspace = join(temp, 'workspace');
const store = join(temp, 'data');
await Promise.all([home, workspace, store].map(p => mkdir(p, { recursive: true })));
Object.assign(process.env, { HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'), XDG_CONFIG_HOME: join(home, '.config'), OPENCODE_CONFIG_DIR: join(home, 'opencode'), MEMORY_DIR: store, MEMORY_PLUGIN_DISABLE_NATIVE_CLI: '1', CI: '1', MEMORY_WEB_AUTOSTART: '0' });
process.chdir(workspace);
const { buildMarketplace, installMarketplace, switchToDirect, handleMarketplaceCommand } = await import('../../mcp-server/marketplace.js');
const { integrationStatus, PLUGIN_SELECTOR } = await import('../../mcp-server/plugin_integration.js');
const { runSetup } = await import('../../mcp-server/setup.js');
const { enableGlobalPrompt, syncPersonaPrompts } = await import('../../mcp-server/prompt_manager.js');
const { runDirectMcpSmoke } = await import('../../mcp-server/codex_diagnostics.js');

try {
  const output = join(temp, 'build with spaces');
  const built = await buildMarketplace({ output, memoryDir: store, installDependencies: (_, runtime) => {
    // Existing dependencies only; no network or npm lifecycle scripts in tests.
    return symlink(join(root, 'node_modules'), join(runtime, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  } });
  // The dependency adapter can be asynchronous, so it must have completed.
  assert.ok(existsSync(join(built.runtime, 'node_modules')));
  assert.ok(!existsSync(join(built.runtime, 'local_test.db')));
  assert.ok(!existsSync(join(built.runtime, 'dev_docs')));
  assert.ok(!existsSync(join(built.runtime, '.git')));
  assert.deepEqual(JSON.parse(await readFile(join(built.runtime, 'package.json'), 'utf8')).scripts, {});
  await assert.rejects(buildMarketplace({ output }), /already exists/);
  await assert.rejects(buildMarketplace({ output: 'relative' }), /absolute/);
  await assert.rejects(buildMarketplace({ output: join(temp, 'bad-data'), memoryDir: join(temp, 'bad-data', 'data') }), /outside/);
  const memory = '# Global memory\n\n- [2026-10-05 00:00] **Retained** — marketplace_retention_fixture <!-- id:retain -->\n';
  await writeFile(join(store, 'global.md'), memory);

  for (const client of ['codex', 'claude']) {
    const config = client === 'codex' ? join(home, '.codex', 'config.toml') : join(home, '.claude', '.claude.json');
    const settings = join(home, '.claude', 'settings.json');
    const setPlugin = async enabled => {
      if (client === 'codex') {
        let text = existsSync(config) ? await readFile(config, 'utf8') : '';
        text = text.replace(/\n?\[plugins\."memory@lotargo-memory-local"\]\nenabled = (?:true|false)\n?/g, '');
        await writeFile(config, `${text}\n[plugins."${PLUGIN_SELECTOR}"]\nenabled = ${enabled}\n`);
      } else await writeFile(settings, JSON.stringify({ enabledPlugins: { [PLUGIN_SELECTOR]: enabled }, unrelated: 'keep' }));
    };
    const calls = [];
    const runNative = async (_client, args) => {
      calls.push(args);
      if (['add', 'install'].includes(args[1])) await setPlugin(true);
      if (['remove', 'uninstall'].includes(args[1])) await setPlugin(false);
      return { ok: true };
    };
    await runSetup(['setup', `--${client}`]);
    assert.equal((await integrationStatus(client)).mode, 'direct');
    const before = await readFile(config, 'utf8');
    const otherStore = join(temp, 'other-data');
    if (client === 'codex') await writeFile(config, before + `\n[mcp_servers.memory-agent.env]\nMEMORY_DIR = ${JSON.stringify(otherStore)}\n`);
    else {
      const configured = JSON.parse(before);
      configured.mcpServers['memory-agent'].env = { MEMORY_DIR: otherStore };
      await writeFile(config, JSON.stringify(configured));
    }
    await assert.rejects(installMarketplace(client, output, { runNative }), /another memory directory/);
    assert.equal(calls.length, 0, 'data directory mismatch must precede native mutations');
    await writeFile(config, before);
    await assert.rejects(installMarketplace(client, output, { runNative: () => { throw new Error('native install unavailable'); } }), /unavailable/);
    assert.equal(await readFile(config, 'utf8'), before, 'failed native install must preserve direct registration');
    const skill = join(home, client === 'codex' ? '.codex' : '.claude', 'skills', 'using-memory', 'SKILL.md');
    const skillText = await readFile(skill, 'utf8');
    await writeFile(skill, skillText + '\nLocal customization\n');
    await assert.rejects(installMarketplace(client, output, { runNative }), /modifications/);
    assert.equal(calls.length, 0, 'modified skill refusal precedes native mutations');
    await writeFile(skill, skillText);

    const promptBeforeMigration = join(home, client === 'codex' ? '.codex' : '.claude', client === 'codex' ? 'AGENTS.md' : 'CLAUDE.md');
    const originalPrompt = await readFile(promptBeforeMigration, 'utf8');
    await assert.rejects(installMarketplace(client, output, { runNative: async (...args) => {
      const result = await runNative(...args);
      if (['add', 'install'].includes(args[1][1])) await writeFile(promptBeforeMigration, originalPrompt + '\nConcurrent migration edit\n');
      return result;
    } }), /changed during marketplace migration/);
    assert.equal((await integrationStatus(client)).mode, 'direct', 'failed prompt preflight preserves the old direct registration');
    assert.ok((await readFile(promptBeforeMigration, 'utf8')).includes('Concurrent migration edit'));
    await writeFile(promptBeforeMigration, originalPrompt);

    assert.equal((await installMarketplace(client, output, { runNative })).mode, 'marketplace');
    assert.equal(await readFile(join(store, 'global.md'), 'utf8'), memory);
    assert.equal(existsSync(skill), false);
    await assert.rejects(runSetup(['setup', `--${client}`]), /duplicate/);
    const target = client === 'codex' ? 'Codex' : 'Claude Code';
    assert.equal((await enableGlobalPrompt([target]))[0].status, 'plugin_managed');
    assert.equal((await syncPersonaPrompts([target], []))[0].status, 'plugin_managed');
    const prompt = join(home, client === 'codex' ? '.codex' : '.claude', client === 'codex' ? 'AGENTS.md' : 'CLAUDE.md');
    if (existsSync(prompt)) assert.ok(!(await readFile(prompt, 'utf8')).includes('START MEMORY'));
    const entry = join(output, client, 'plugins', 'memory', 'scripts', 'entry.cjs');
    const hook = spawnSync(process.execPath, [entry, 'hook'], { cwd: workspace, env: process.env, input: JSON.stringify({ cwd: workspace }), encoding: 'utf8', timeout: 15000 });
    assert.equal(hook.status, 0, hook.stderr);
    const context = JSON.parse(hook.stdout).hookSpecificOutput.additionalContext;
    assert.ok(context.includes(JSON.stringify(workspace)));
    assert.ok(context.includes('MCP server supplied by the memory plugin'));
    const smoke = await runDirectMcpSmoke({ command: process.execPath, args: [entry, 'mcp'], cwd: workspace, env: process.env });
    assert.ok(smoke.recall.includes('marketplace_retention_fixture'), smoke.recall);
    assert.ok(smoke.memoryInfo.includes(store));
    assert.equal((await installMarketplace(client, output, { runNative })).mode, 'marketplace', 'repeat install is idempotent');
    assert.equal((await switchToDirect(client, { runNative })).mode, 'direct');
    const blocked = spawnSync(process.execPath, [entry, 'mcp'], { cwd: workspace, env: process.env, encoding: 'utf8', timeout: 15000 });
    assert.equal(blocked.status, 1, blocked.stderr);
    assert.match(blocked.stderr, /No second server/);
    assert.equal(blocked.stdout, '');
    assert.equal(await readFile(join(store, 'global.md'), 'utf8'), memory);
    const projectConfig = client === 'codex' ? join(workspace, '.codex', 'config.toml') : join(workspace, '.mcp.json');
    await mkdir(join(workspace, '.codex'), { recursive: true });
    await writeFile(projectConfig, client === 'codex' ? '[mcp_servers.memory-agent]\ncommand="foreign"\n' : JSON.stringify({ mcpServers: { 'memory-agent': { command: 'foreign' } } }));
    await assert.rejects(installMarketplace(client, output, { runNative }), /project-scoped/);
    await mkdir(join(workspace, '.git'), { recursive: true });
    const nested = join(workspace, 'nested');
    await mkdir(nested, { recursive: true });
    assert.equal((await integrationStatus(client, { cwd: nested })).projectDirect, true, 'subdirectory launches must detect parent repo registrations');
    await rm(projectConfig);
  }
  await handleMarketplaceCommand(['build', '--output', output, '--client', 'codex']);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
  console.log('MARKETPLACE PACKAGING, TRANSITIONS, HOOKS AND REAL MCP TESTS PASSED');
} finally {
  const { closeDatabase } = await import('../../mcp-server/db/database.js');
  await closeDatabase();
  process.chdir(root);
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(error => console.error(`Temporary cleanup: ${error.message}`));
}
