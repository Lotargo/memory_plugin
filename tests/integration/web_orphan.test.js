import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = fs.mkdtempSync(join(tmpdir(), 'memory-web-orphan-'));
process.env.MEMORY_DIR = join(root, 'memory');
process.env.OPENCODE_CONFIG_DIR = join(root, 'opencode');
process.env.MEMORY_WEB_STARTUP_DIR = join(root, 'startup');
process.env.MEMORY_DISABLE_WEB_AUTOSTART = '1';
process.env.MEMORY_DISABLE_PERSONA_SYNC = '1';
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = '1';
process.env.MEMORY_WEB_WATCHDOG_MS = '200';
const { ensureWeb, stopWeb } = await import('../../mcp-server/dashboard/runtime.js');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

let panel;
try {
  panel = await ensureWeb();
  assert.ok(alive(panel.pid), 'the panel worker is running');
  // A short-lived gap is not enough to stop it: the connection reappears in time.
  const connection = join(process.env.MEMORY_DIR, 'web', 'connection.json');
  const saved = fs.readFileSync(connection);
  await wait(800);
  assert.ok(alive(panel.pid), 'the watchdog leaves a panel with an existing profile alone');
  // The profile disappears (a deleted test or abandoned memory directory): the worker exits by itself.
  fs.rmSync(connection);
  let stopped = false;
  for (let i = 0; i < 100 && !stopped; i++) { await wait(50); stopped = !alive(panel.pid); }
  assert.ok(stopped, 'the worker stops once its memory directory no longer exists');
  fs.writeFileSync(connection, saved);
  console.log('PASS web orphan: the panel worker stops by itself when its memory directory is removed.');
} finally {
  if (panel && alive(panel.pid)) { try { await stopWeb(); } catch { process.kill(panel.pid); } }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
