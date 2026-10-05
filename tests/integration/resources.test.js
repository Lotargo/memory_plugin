import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const root = fs.mkdtempSync(join(tmpdir(), 'memory-resources-'));
process.env.MEMORY_DIR = join(root, 'memory'); process.env.OPENCODE_CONFIG_DIR = join(root, 'opencode');
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = '1'; process.env.MEMORY_DISABLE_PERSONA_SYNC = '1'; process.env.MEMORY_DISABLE_WEB_AUTOSTART = '1';
const {resourceOverview} = await import('../../mcp-server/services/resource_service.js');
const {writeRuntimeState, CONTROL_DIR} = await import('../../mcp-server/ml/model_control.js');
const {startDashboard} = await import('../../mcp-server/dashboard/server.js');
const {closeDatabase, MODELS_DIR} = await import('../../mcp-server/db/database.js');
let app;
try {
  const now = Date.now();
  const result = await resourceOverview({}, {monitor: {snapshot: async () => ({observedAt: now})}, now: () => now, states: () => [
    {serverPid: 1, serverRssMB: 25, updatedAt: new Date(now).toISOString()},
    {serverPid: 2, serverRssMB: 50, updatedAt: new Date(now - 16000).toISOString()},
    {serverPid: 3, serverRssMB: undefined, updatedAt: 'invalid'},
    {serverPid: process.pid, serverRssMB: 10000, updatedAt: new Date(now).toISOString()}
  ]});
  assert.equal(result.processes.length, 4, 'observer is counted exactly once');
  assert.equal(result.processes[1].rssBytes, 25 * 1024 ** 2);
  assert.equal(result.processes[2].status, 'stale');
  assert.equal(result.processes[3].rssBytes, null);

  writeRuntimeState({controlProtocol: 2, serverPid: process.pid, serverRssMB: 10, lastActivity: '2026-01-01T00:00:00Z', autoUnloadArmed: true, embedding: {loaded: false}});
  const receipt = join(CONTROL_DIR, `runtime_${process.pid}.json`), before = fs.readFileSync(receipt, 'utf8');
  app = await startDashboard();
  const headers = {Authorization: `Bearer ${new URL(app.url).hash.slice(1)}`};
  assert.equal((await fetch(app.origin + '/api/resources')).status, 401);
  assert.equal((await fetch(app.origin + '/api/resources', {headers: {...headers, Origin: 'https://foreign.invalid'}})).status, 403);
  assert.equal((await fetch(app.origin + '/api/resources?pid=123', {headers})).status, 400);
  const native = await (await fetch(app.origin + '/api/resources', {headers})).json();
  assert.equal(native.platform.id, process.platform);
  assert.ok(native.ram.totalBytes > 0);
  assert.ok(native.processes[0].rssBytes > 0);
  assert.equal((await fetch(app.origin + '/resources.js')).status, 200);
  assert.equal(fs.readFileSync(receipt, 'utf8'), before, 'monitoring never touches model activity or unload timers');
  assert.ok(!fs.existsSync(MODELS_DIR) || !fs.readdirSync(MODELS_DIR).length, 'monitoring does not download or load models');
  const code = "import {handleModelCommands} from './mcp-server/cli/model_commands.js'; await handleModelCommands(['models','status','--json']);";
  const cli = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], {env: process.env, timeout: 20000, windowsHide: true});
  const output = JSON.parse(cli.stdout);
  assert.equal(output.resources.platform.id, process.platform);
  assert.ok(Array.isArray(output.resources.gpu.devices));
  assert.ok(output.resources.processes.some(owner => owner.role === 'cli'));
  assert.ok(Object.hasOwn(output, 'gpuMemory'), 'legacy JSON field remains compatible');
  assert.equal(fs.readFileSync(receipt, 'utf8'), before);
  console.log('Resource service/API/CLI: authentication, native measurements, process freshness, unchanged model state passed.');
} finally {
  if (app) await app.close(); await closeDatabase(); fs.rmSync(root, {recursive: true, force: true});
}
