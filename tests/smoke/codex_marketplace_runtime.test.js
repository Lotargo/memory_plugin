// Explicit native acceptance: real Codex, temporary profile/store, no login or
// real model calls. Hooks run on the first turn against a loopback HTTP stub.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { codexAppServer } from '../fixtures/codex_app_server.js';
import { resolveClientExecutable } from '../../mcp-server/client_cli.js';

if (process.env.MEMORY_MARKETPLACE_LIVE !== '1') throw new Error('Set MEMORY_MARKETPLACE_LIVE=1 for isolated native Codex acceptance');
const binary = process.env.MEMORY_NATIVE_CODEX_BINARY || resolveClientExecutable('codex');
if (!binary || !fs.existsSync(binary)) throw new Error('A native Codex executable is required');
const root = fileURLToPath(new URL('../..', import.meta.url));
const temp = fs.mkdtempSync(join(tmpdir(), process.platform === 'win32' ? 'memory codex $literal ' : 'memory codex runtime '));
const home = join(temp, 'home'), workspace = join(temp, 'workspace'), data = join(temp, 'memory');
for (const p of [home, workspace, data]) fs.mkdirSync(p, { recursive: true });
Object.assign(process.env, { HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
  XDG_CONFIG_HOME: join(home, '.config'), OPENCODE_CONFIG_DIR: join(home, 'opencode'), MEMORY_DIR: data,
  MEMORY_PLUGIN_DISABLE_NATIVE_CLI: '0', MEMORY_CLIENT_PROBE: '1', MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_WEB_AUTOSTART: '0' });
process.chdir(workspace);
const { buildMarketplace, installMarketplace } = await import('../../mcp-server/marketplace.js');
const profile = process.env.CODEX_HOME, config = join(profile, 'config.toml');
const write = (file, value) => { fs.mkdirSync(dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
const json = (file, value) => write(file, JSON.stringify(value, null, 2));
const native = (_client, args, options = {}) => {
  const result = spawnSync(binary, ['--disable', 'remote_plugin', ...args], { cwd: options.cwd || workspace, env: process.env,
    windowsHide: true, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
  return { ...result, ok: true };
};
const sentinel = '- [2026-10-05 00:00] native_runtime_retention <!-- id:native-runtime -->\n';
write(join(data, 'global.md'), sentinel);
let requests = 0, blockedExternalRequests = 0, contextDelivered = false, workspaceDelivered = false, active;
const stub = createServer((req, res) => {
  if (/^https?:\/\//.test(req.url)) {
    blockedExternalRequests++; req.resume(); res.writeHead(403); res.end(); return;
  }
  let body = '';
  req.on('data', bytes => body += bytes);
  req.on('end', () => {
    requests++;
    contextDelivered ||= body.includes('Use the memory plugin tools by their names');
    workspaceDelivered ||= body.includes(JSON.stringify(workspace).slice(1, -1).replace(/\\/g, '\\\\'));
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Intentional local test stop; no model called', type: 'invalid_request_error' } }));
  });
});
stub.on('connect', (_req, socket) => {
  blockedExternalRequests++; socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
});
async function inspect() {
  active = await codexAppServer({ binary, env: process.env, cwd: workspace });
  try { return (await active.request('mcpServerStatus/list')).data.find(s => s.pluginId === 'memory@lotargo-memory-local'); }
  finally { await active.close(); active = null; }
}
try {
  await new Promise(done => stub.listen(0, '127.0.0.1', done));
  // Reject Codex's unrelated featured-catalog probes at a loopback proxy.
  const loopback = `http://127.0.0.1:${stub.address().port}`;
  Object.assign(process.env, { HTTP_PROXY: loopback, HTTPS_PROXY: loopback, ALL_PROXY: loopback, NO_PROXY: '127.0.0.1,localhost,::1' });
  // The local provider prevents the first-turn hook test from using a model.
  write(config, `model = "memory-native-hook-stub"\nmodel_provider = "memory-local-stub"\n[features]\nhooks = true\nplugins = true\n[model_providers.memory-local-stub]\nname = "Local hook test"\nbase_url = "${loopback}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
  const output = join(temp, 'fixed build');
  const built = await buildMarketplace({ output, memoryDir: data, installDependencies: (_, runtime) => fs.symlinkSync(join(root, 'node_modules'), join(runtime, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir') });
  const legacy = join(temp, 'legacy catalog');
  fs.cpSync(join(output, 'codex'), legacy, { recursive: true });
  const oldPlugin = join(legacy, 'plugins', 'memory');
  const identity = JSON.parse(fs.readFileSync(join(oldPlugin, '.codex-plugin', 'plugin.json'), 'utf8'));
  json(join(oldPlugin, '.codex-plugin', 'plugin.json'), { name: 'memory', version: identity.version, skills: './skills/', mcpServers: './.mcp.json', hooks: './hooks/hooks.json' });
  json(join(oldPlugin, '.mcp.json'), { mcpServers: { 'memory-agent': { command: process.execPath, args: ['${PLUGIN_ROOT}/scripts/entry.cjs', 'mcp'] } } });
  const oldHooks = JSON.parse(fs.readFileSync(join(oldPlugin, 'hooks', 'hooks.json'), 'utf8'));
  delete oldHooks.hooks.SessionStart[0].hooks[0].commandWindows;
  json(join(oldPlugin, 'hooks', 'hooks.json'), oldHooks);
  native('codex', ['plugin', 'marketplace', 'add', legacy]); native('codex', ['plugin', 'add', 'memory@lotargo-memory-local']);
  active = await codexAppServer({ binary, env: process.env, cwd: workspace });
  const legacyHooks = await active.request('hooks/list', { cwds: [workspace] });
  assert.ok(legacyHooks.data.flatMap(d => d.hooks).some(h => h.pluginId === 'memory@lotargo-memory-local'), JSON.stringify({ legacyHooks, stderr: active.stderr() }));
  await active.close(); active = null;
  const broken = await inspect();
  assert.equal(Object.keys(broken.tools).length, 0); assert.ok(broken.toolsError, 'Native legacy macro failure must be observable');

  // Upgrade the existing installed plugin, retaining the exact same version.
  // Codex requires explicit removal before replacing an immutable catalog's
  // source. The installed adapter and its version are not removed here.
  native('codex', ['plugin', 'marketplace', 'remove', 'lotargo-memory-local']);
  assert.equal((await installMarketplace('codex', output, { runNative: native })).mode, 'marketplace');
  const ready = await inspect();
  assert.equal(ready.toolsError, null, JSON.stringify(ready));
  assert.ok(Object.values(ready.tools).some(t => t.name === 'recall'));
  const toolCount = Object.keys(ready.tools).length; assert.ok(toolCount >= 22);
  const installed = join(profile, 'plugins', 'cache', 'lotargo-memory-local', 'memory', built.version);
  assert.equal(JSON.parse(fs.readFileSync(join(installed, '.mcp.json'), 'utf8')).mcpServers['memory-agent'].args[0],
    join(output, 'codex', 'plugins', 'memory', 'scripts', 'entry.cjs'), 'Upgrade must replace the literal macro in the cached launcher');

  active = await codexAppServer({ binary, env: process.env, cwd: workspace });
  const listing = await active.request('hooks/list', { cwds: [workspace] });
  const hook = listing.data.flatMap(d => d.hooks).find(h => h.pluginId === 'memory@lotargo-memory-local');
  assert.ok(hook, JSON.stringify({ listing, config: fs.readFileSync(config, 'utf8'), stderr: active.stderr() }));
  assert.ok(hook.enabled); assert.notEqual(hook.trustStatus, 'trusted');
  await active.close(); active = null;
  // Trust only the temporary fixture, never the user's profile.
  fs.appendFileSync(config, `\n[hooks.state."${hook.key}"]\ntrusted_hash = "${hook.currentHash}"\n`);
  active = await codexAppServer({ binary, env: process.env, cwd: workspace });
  const thread = await active.request('thread/start', { cwd: workspace, ephemeral: true, sessionStartSource: 'startup' });
  await active.request('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text: 'Native memory hook fixture.' }] });
  const completed = await active.waitFor(e => e.method === 'hook/completed' && e.params.threadId === thread.thread.id);
  assert.equal(completed.params.run.status, 'completed', JSON.stringify(completed.params.run));
  const context = completed.params.run.entries.find(e => e.kind === 'context')?.text;
  assert.ok(context?.includes('Use the memory plugin tools by their names'));
  assert.ok(context.includes(JSON.stringify(workspace)), 'Hook must retain the actual session workspace');
  const deadline = Date.now() + 5000;
  while (!requests && Date.now() < deadline) await new Promise(done => setTimeout(done, 50));
  assert.ok(contextDelivered, 'Native model input must contain the hook context');
  assert.ok(workspaceDelivered, 'Native model input must contain the workspace');
  await active.waitFor(e => e.method === 'turn/completed' && e.params.threadId === thread.thread.id);
  await active.close(); active = null;
  assert.equal(fs.readFileSync(join(data, 'global.md'), 'utf8'), sentinel);
  assert.equal((await installMarketplace('codex', output, { runNative: native })).mode, 'marketplace');
  assert.equal(Object.keys((await inspect()).tools).length, toolCount);
  console.log(JSON.stringify({ status: 'PASS', sameVersionUpgrade: true, repeatedInstall: true, nativeMcpTools: toolCount,
    nativeHookStatus: 'completed', nativeContextDelivered: true, realModelRequests: 0, localStubRequests: requests, blockedExternalRequests, retainedMemory: true }));
} finally {
  if (active) await active.close();
  await new Promise(done => stub.close(done));
  const { closeDatabase } = await import('../../mcp-server/db/database.js'); closeDatabase();
  process.chdir(root);
  if (dirname(resolve(temp)) !== resolve(tmpdir()) || !temp.startsWith(join(tmpdir(), 'memory codex '))) throw new Error('Unsafe fixture cleanup target');
  try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  catch (error) { console.error(`Temporary fixture cleanup: ${error.code}; retained ${temp}`); }
}
