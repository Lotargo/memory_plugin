import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fs.mkdtempSync(join(tmpdir(), 'memory-web-runtime-'));
const cwd = fileURLToPath(new URL('../../', import.meta.url));
process.env.MEMORY_DIR = join(root, 'memory');
process.env.OPENCODE_CONFIG_DIR = join(root, 'opencode');
process.env.MEMORY_WEB_STARTUP_DIR = join(root, 'startup');
process.env.MEMORY_DISABLE_WEB_AUTOSTART = '1';
process.env.MEMORY_DISABLE_PERSONA_SYNC = '1';
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = '1';
const { ensureWeb, webStatus, stopWeb, readConnection, registerWebStartup, removeWebRuntime, startupPath, autoStartWeb, setWebAutostart, nodeExecutable } = await import('../../mcp-server/dashboard/runtime.js');
const { updateConfig } = await import('../../mcp-server/config/config_manager.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
const { handleWebCommand } = await import('../../mcp-server/cli/web_commands.js');
const run = async args => (await promisify(execFile)(process.execPath, ['mcp-server/cli_boot.js', 'web', ...args], { cwd, env: process.env, timeout: 30000 })).stdout;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let foreign, older;
try {
  assert.deepEqual(await autoStartWeb(), { skipped: true });
  assert.equal(fs.existsSync(process.env.MEMORY_DIR), false, 'disabled autostart does not create data or login entries');
  // Different launchers race the same profile. They must converge on one listener.
  const launching = await Promise.allSettled([run([]), run(['start']), run(['start'])]);
  for (const result of launching) if (result.status === 'rejected') throw result.reason;
  const starts = launching.map(result => result.value);
  const urls = starts.map(text => text.match(/http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]{64})/)[0]);
  assert.equal(new Set(urls).size, 1);
  const first = await webStatus();
  assert.equal(first.running, true);
  const connection = readConnection();
  assert.equal(first.url, urls[0]);
  assert.equal((await ensureWeb()).pid, first.pid, 'reuse a verified daemon after its launching commands exit');
  const launched = [], output = [], errors = [];
  const originalLog = console.log, originalError = console.error;
  console.log = text => output.push(text); console.error = text => errors.push(text);
  try {
    await handleWebCommand(['open'], { launchBrowser: async url => launched.push(url) });
    assert.deepEqual(launched, [first.url]);
    assert.equal((await webStatus()).pid, first.pid, 'Opening a browser reuses the verified panel');
    let browserFailure;
    await handleWebCommand(['open'], { launchBrowser: async () => { throw new Error('launcher failed'); }, onError: error => { browserFailure = error; } });
    assert.equal(browserFailure.message, 'launcher failed');
    assert.ok(output.some(text => text.includes(first.url)), 'The manual URL remains available when launching fails');
    assert.ok(errors.some(text => text.includes('launcher failed')));
    assert.equal((await webStatus()).pid, first.pid, 'Browser failure leaves the panel running');
  } finally { console.log = originalLog; console.error = originalError; }
  const headers = { Authorization: `Bearer ${connection.token}` };
  assert.equal((await fetch(first.origin + '/api/runtime')).status, 401);
  const response = await fetch(first.origin + '/api/overview', { headers });
  assert.equal(response.status, 200);
  const session = response.headers.get('set-cookie');
  assert.match(session, /HttpOnly; SameSite=Strict; Max-Age=/);
  const cookie = session.split(';')[0];
  assert.equal((await fetch(first.origin + '/api/overview', { headers: { Cookie: cookie } })).status, 200, 'browser reload can reconnect without a readable token');
  assert.equal((await fetch(first.origin + '/api/overview', { headers: { Cookie: cookie, Authorization: 'Bearer invalid' } })).status, 401);
  assert.equal((await fetch(first.origin + '/api/overview', { headers: { Cookie: cookie, Origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await fetch(first.origin + '/api/runtime/stop', { method: 'POST', headers: { Cookie: cookie } })).status, 403, 'cookie-authenticated stop still requires a local Origin');
  const readyFiles = fs.readdirSync(join(process.env.MEMORY_DIR, 'web'));
  assert.ok(!readyFiles.some(name => name.endsWith('.tmp') || name.endsWith('.lock')));
  assert.ok(!fs.existsSync(join(process.env.MEMORY_DIR, 'storage', 'snapshots', 'state.json')), 'daemon does not create snapshot state without an explicitly configured schedule');
  for (const name of ['favicon.svg', 'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png']) {
    const icon = await fetch(first.origin + '/' + name);
    assert.equal(icon.status, 200);
    assert.deepEqual(Buffer.from(await icon.arrayBuffer()), fs.readFileSync(join(cwd, 'website', 'public', name)));
  }
  await stopWeb();
  assert.equal((await webStatus()).running, false);
  assert.deepEqual(readConnection(), connection, 'stop preserves the saved address and secret');
  let openedAfterStop;
  console.log = () => {};
  try { await handleWebCommand(['open'], { launchBrowser: async url => { openedAfterStop = url; } }); }
  finally { console.log = originalLog; }
  const second = await webStatus();
  assert.equal(openedAfterStop, first.url, 'Opening starts a stopped panel at its saved address');
  assert.equal(second.url, first.url);
  assert.notEqual(second.pid, first.pid);
  assert.equal((await fetch(second.origin + '/api/overview', { headers: { Cookie: cookie } })).status, 200, 'session survives daemon restart');
  const restarted = await ensureWeb({ restart: true });
  assert.equal(restarted.url, first.url);
  assert.notEqual(restarted.pid, second.pid);
  const startup = registerWebStartup();
  assert.equal(startup.enabled, true);
  const script = fs.readFileSync(startup.path).toString('utf16le');
  assert.match(script, /shell\.Run .*web start", 0, False/);
  assert.ok(script.includes(process.env.MEMORY_DIR));
  assert.ok(!script.includes(connection.token));
  const startupBytes = fs.readFileSync(startup.path);
  // Automatic client launches (any executable/package root) leave a working entry alone...
  const otherLauncher = script.replace(join(cwd, 'mcp-server', 'cli_boot.js'), join(cwd, 'package.json'));
  assert.notEqual(otherLauncher, script);
  fs.writeFileSync(startup.path, Buffer.from(otherLauncher, 'utf16le'));
  assert.equal(registerWebStartup({ automatic: true }).kept, true);
  assert.deepEqual(fs.readFileSync(startup.path), Buffer.from(otherLauncher, 'utf16le'), 'automatic launch rewrote a working login entry');
  // ...but repair one whose launcher no longer exists, and explicit enable still rewrites.
  fs.writeFileSync(startup.path, Buffer.from(script.replace(join(cwd, 'mcp-server', 'cli_boot.js'), join(root, 'removed-build', 'cli_boot.js')), 'utf16le'));
  assert.equal(registerWebStartup({ automatic: true }).kept, undefined);
  assert.deepEqual(fs.readFileSync(startup.path), startupBytes, 'broken login entry was not repaired');
  // A host binary (e.g. opencode-cli.exe) cannot run our scripts: never keep or write it.
  const hostDir = join(root, 'host-bin'); fs.mkdirSync(hostDir);
  const hostExe = join(hostDir, 'opencode-cli.exe'), nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
  fs.writeFileSync(hostExe, ''); fs.writeFileSync(join(hostDir, nodeName), '');
  fs.writeFileSync(startup.path, Buffer.from(script.replace(process.execPath, hostExe), 'utf16le'));
  assert.equal(registerWebStartup({ automatic: true }).kept, undefined, 'a non-Node login launcher must be repaired');
  assert.deepEqual(fs.readFileSync(startup.path), startupBytes);
  assert.equal(nodeExecutable({ execPath: process.execPath }), process.execPath);
  assert.equal(nodeExecutable({ execPath: hostExe, env: { PATH: hostDir, PATHEXT: '.EXE' } }), join(hostDir, nodeName), 'a host binary must resolve to a real Node');
  assert.equal(nodeExecutable({ execPath: hostExe, env: { PATH: join(root, 'empty'), PATHEXT: '.EXE' } }), hostExe, 'without Node on PATH keep the current executable');
  fs.writeFileSync(startup.path, Buffer.from(otherLauncher, 'utf16le'));
  registerWebStartup();
  assert.deepEqual(fs.readFileSync(startup.path), startupBytes, 'explicit enable did not rewrite the entry');
  await removeWebRuntime({ dryRun: true });
  assert.deepEqual(fs.readFileSync(startup.path), startupBytes);
  assert.equal((await webStatus()).pid, restarted.pid, 'dry-run does not stop the panel');
  await stopWeb();
  if (process.platform === 'win32') {
    // Execute the real hidden login launcher, without logging out or changing user Startup.
    execFileSync(join(process.env.SystemRoot, 'System32', 'wscript.exe'), [startup.path], { windowsHide: true, timeout: 10000 });
    let loggedIn;
    for (let i = 0; i < 150; i++) { loggedIn = await webStatus(); if (loggedIn.running) break; await wait(75); }
    assert.equal(loggedIn.running, true);
    assert.equal(loggedIn.url, first.url);
    await stopWeb();
  }
  fs.writeFileSync(startup.path, 'not owned');
  assert.throws(() => registerWebStartup(), /not owned/);
  fs.writeFileSync(startup.path, startupBytes);
  // A different program takes the saved port: never stop it or silently move the bookmark.
  foreign = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ kind: 'another-program' })); });
  await new Promise(resolve => foreign.listen(connection.port, '127.0.0.1', resolve));
  await assert.rejects(ensureWeb(), /different server/);
  assert.deepEqual(readConnection(), connection);
  assert.equal((await fetch(first.origin)).status, 200);
  await new Promise(resolve => foreign.close(resolve)); foreign = null;
  // An authenticated older build is replaced, while its saved connection survives.
  older = await startDashboard({ port: connection.port, token: connection.token,
    runtime: { ...first, buildId: '0'.repeat(64) },
    onStop: () => { older.server.closeIdleConnections(); void older.close().then(() => { older = null; }); }
  });
  // Automatic launches from other clients/builds adopt a running panel instead of replacing it.
  const adopted = await ensureWeb({ adopt: true });
  assert.equal(adopted.reused, true); assert.equal(adopted.otherBuild, true);
  assert.equal(adopted.buildId, '0'.repeat(64), 'automatic launch replaced a running panel from another build');
  assert.ok(older, 'the older panel must still be running after an automatic launch');
  // Status and the panel page both say that a restart switches to the current files.
  const behind = await webStatus();
  assert.equal(behind.otherBuild, true); assert.match(behind.hint, /web restart/);
  const panelUpdate = async origin => (await fetch(origin + '/api/runtime/update', { headers: { Authorization: `Bearer ${connection.token}` } })).json();
  assert.deepEqual(await panelUpdate(behind.origin), { filesChanged: true });
  const upgraded = await ensureWeb();
  assert.equal(upgraded.url, first.url);
  assert.equal(upgraded.buildId, first.buildId);
  assert.equal((await webStatus()).otherBuild, undefined, 'a current panel is not reported as another build');
  assert.deepEqual(await panelUpdate(upgraded.origin), { filesChanged: false });
  const off = await setWebAutostart(false);
  assert.equal(off.enabled, false);
  assert.equal(fs.existsSync(startupPath()), false);
  delete process.env.MEMORY_DISABLE_WEB_AUTOSTART;
  delete process.env.MEMORY_DISABLE_BACKGROUND_SYNC;
  assert.deepEqual(await autoStartWeb(), { skipped: true }, 'explicit off survives new client startups');
  updateConfig({ webAutoStart: true });
  const enabled = await autoStartWeb();
  assert.equal(enabled.url, first.url);
  assert.equal(fs.existsSync(startupPath()), true);
  await stopWeb();
  const client = new Client({ name: 'managed-web-lifecycle', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(cwd, 'mcp-server', 'boot.js')], env: process.env, stderr: 'pipe' }));
    let attached;
    for (let i = 0; i < 150; i++) { attached = await webStatus(); if (attached.running) break; await wait(75); }
    assert.equal(attached.running, true, 'MCP startup ensures the panel without changing stdio');
    assert.equal(attached.url, first.url);
  } finally { await client.close(); }
  assert.equal((await webStatus()).running, true, 'closing the MCP host leaves its detached panel available');
  await removeWebRuntime();
  assert.equal((await webStatus()).running, false);
  assert.equal(fs.existsSync(startupPath()), false);
  console.log('PASS managed web: concurrent launchers, detached lifetime, stable address/token, cookie reload/restart, auth/origin guards, hidden Windows login launcher, foreign-port refusal, opt-out/uninstall and no cloud scheduling.');
} catch (error) {
  const log = join(process.env.MEMORY_DIR, 'web', 'server.log');
  if (fs.existsSync(log)) console.error(fs.readFileSync(log, 'utf8'));
  throw error;
} finally {
  if (foreign) await new Promise(resolve => foreign.close(resolve));
  if (older) await older.close();
  await stopWeb();
  registerWebStartup({ remove: true });
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
