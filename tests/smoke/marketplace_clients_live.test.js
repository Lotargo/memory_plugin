// Explicit, isolated native-client acceptance. Never touches the user's client
// profiles, login, project registry or memory; no model calls are made.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (process.env.MEMORY_MARKETPLACE_LIVE !== '1') throw new Error('Set MEMORY_MARKETPLACE_LIVE=1 to run isolated native-client acceptance');
const root = fileURLToPath(new URL('../..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'memory-native-marketplace-'));
const workspace = join(temp, 'workspace');
const home = join(temp, 'home');
const data = join(temp, 'data');
await Promise.all([workspace, home, data].map(p => mkdir(p, { recursive: true })));
Object.assign(process.env, { HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'), XDG_CONFIG_HOME: join(home, '.config'), OPENCODE_CONFIG_DIR: join(home, 'opencode'), MEMORY_DIR: data, MEMORY_PLUGIN_DISABLE_NATIVE_CLI: '0', CI: '1', MEMORY_WEB_AUTOSTART: '0' });
process.chdir(workspace);
const { buildMarketplace, installMarketplace, switchToDirect, marketplaceDoctor } = await import('../../mcp-server/marketplace.js');
const { integrationStatus } = await import('../../mcp-server/plugin_integration.js');
const { runSetup } = await import('../../mcp-server/setup.js');
const { runClientCli } = await import('../../mcp-server/client_cli.js');
const { runDirectMcpSmoke } = await import('../../mcp-server/codex_diagnostics.js');
try {
  const output = join(temp, 'bundle');
  await buildMarketplace({ output, memoryDir: data, installDependencies: (_, runtime) => symlink(join(root, 'node_modules'), join(runtime, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir') });
  await writeFile(join(data, 'global.md'), '- [2026-10-05 00:00] native_marketplace_fixture <!-- id:native -->\n');
  for (const client of ['codex', 'claude']) {
    if (client === 'claude') {
      const valid = runClientCli(client, ['plugin', 'validate', join(output, client)]);
      assert.ok(valid.ok, valid.stderr || valid.stdout);
      console.log(`Claude native validation: ${valid.stdout.trim()}`);
      const pluginValid = runClientCli(client, ['plugin', 'validate', join(output, client, 'plugins', 'memory')]);
      assert.ok(pluginValid.ok, pluginValid.stderr || pluginValid.stdout);
      console.log(`Claude plugin validation: ${pluginValid.stdout.trim()}`);
    }
    await runSetup(['setup', `--${client}`]);
    assert.equal((await integrationStatus(client)).mode, 'direct');
    assert.equal((await installMarketplace(client, output)).mode, 'marketplace');
    const listing = runClientCli(client, ['plugin', 'list', '--json']);
    assert.ok(listing.ok, listing.stderr || listing.stdout);
    console.log(`${client} native listing: ${listing.stdout.slice(0, 2500)}`);
    const listed = JSON.parse(listing.stdout);
    const installedPath = client === 'claude' ? listed.find(p => p.id === 'memory@lotargo-memory-local').installPath : listed.installed.find(p => p.pluginId === 'memory@lotargo-memory-local').source.path;
    const entry = join(installedPath, 'scripts', 'entry.cjs');
    assert.ok(existsSync(entry), `Installed adapter missing: ${entry}`);
    const smoke = await runDirectMcpSmoke({ command: process.execPath, args: [entry, 'mcp'], cwd: workspace, env: process.env });
    assert.ok(smoke.recall.includes('native_marketplace_fixture'), smoke.recall);
    assert.equal((await marketplaceDoctor(client)).ok, true);
    assert.equal((await installMarketplace(client, output)).mode, 'marketplace');
    assert.equal((await switchToDirect(client)).mode, 'direct');
    assert.ok((await readFile(join(data, 'global.md'), 'utf8')).includes('native_marketplace_fixture'));
    console.log(`${client}: NATIVE INSTALL / REINSTALL / MCP / RETURN TO DIRECT PASSED`);
  }
} finally {
  process.chdir(root);
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(e => console.error(`Temporary profile cleanup: ${e.message}`));
}
