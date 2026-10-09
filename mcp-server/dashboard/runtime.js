import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { MEMORY_DIR, resolveDefaultMemoryDir } from '../memory.js';
import { getConfig, updateConfig } from '../config/config_manager.js';
import { atomicWrite, withSnapshotLock } from '../storage/snapshot_lock.js';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const webDir = join(MEMORY_DIR, 'web');
const connectionFile = join(webDir, 'connection.json');
export const storageId = createHash('sha256').update(resolve(MEMORY_DIR).toLowerCase()).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let buildPromise;

export function readConnection() {
  try {
    const value = JSON.parse(fs.readFileSync(connectionFile, 'utf8'));
    if (!/^[a-f0-9]{64}$/.test(value.token) || !Number.isInteger(value.port) || value.port < 0 || value.port > 65535) throw new Error('Invalid connection file');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Cannot read ${connectionFile}; keep this file and repair its format before starting the panel.`);
  }
}

export async function writeConnection(value) {
  fs.mkdirSync(webDir, { recursive: true });
  const temp = `${connectionFile}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    for (let attempt = 0; ; attempt++) {
      try { await fs.promises.rename(temp, connectionFile); break; }
      catch (error) {
        // Windows can briefly deny replacement while another launcher reads it.
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 39) throw error;
        await pause(50);
      }
    }
  } finally { fs.rmSync(temp, { force: true }); }
}

export function webBuildId() {
  return buildPromise ||= (async () => {
    const hash = createHash('sha256');
    function walk(dir, prefix = '') {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (['node_modules', 'benchmarks', 'corpus'].includes(entry.name)) continue;
        const name = prefix + entry.name, file = join(dir, entry.name);
        if (entry.isDirectory()) walk(file, name + '/');
        else if (/\.(js|css|html|svg|png|ico)$/.test(entry.name)) hash.update(name + '\0').update(fs.readFileSync(file));
      }
    }
    hash.update(fs.readFileSync(join(packageRoot, 'package.json')));
    walk(join(packageRoot, 'mcp-server'));
    return hash.digest('hex');
  })();
}

const withLaunchLock = run => withSnapshotLock(webDir, run);

async function inspect(connection) {
  if (!connection?.port) return null;
  const origin = `http://127.0.0.1:${connection.port}`;
  try {
    const response = await fetch(origin + '/api/runtime', {
      headers: { Authorization: `Bearer ${connection.token}`, Connection: 'close' }, signal: AbortSignal.timeout(1000)
    });
    if (!response.ok) throw new Error('Port is occupied by a different server');
    const runtime = await response.json();
    if (runtime.kind !== 'memory-dashboard' || runtime.storageId !== storageId || !/^[a-f0-9]{64}$/.test(runtime.buildId)) throw new Error('Port is occupied by a different server');
    return { ...runtime, origin, url: `${origin}/#${connection.token}` };
  } catch (error) {
    if (['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET'].includes(error.cause?.code)) return null;
    throw error;
  }
}

async function stopConnection(connection) {
  const runtime = await inspect(connection);
  if (!runtime) return { running: false };
  const response = await fetch(runtime.origin + '/api/runtime/stop', {
    method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, Origin: runtime.origin, Connection: 'close' }, signal: AbortSignal.timeout(2000)
  });
  if (response.status !== 202) throw new Error('The panel did not accept a stop request');
  await response.json();
  for (let i = 0; i < 100; i++) {
    if (!await inspect(connection)) return { running: false };
    await pause(50);
  }
  throw new Error('The panel is still shutting down; retry before changing its port or installation.');
}

export async function webStatus() {
  const connection = readConnection();
  const runtime = await inspect(connection);
  return runtime ? { running: true, ...runtime } : { running: false, port: connection?.port || null };
}

export async function stopWeb() {
  return withLaunchLock(() => stopConnection(readConnection()));
}

export async function ensureWeb({ restart = false } = {}) {
  return withLaunchLock(async () => {
    let connection = readConnection();
    if (!connection) { connection = { token: randomBytes(32).toString('hex'), port: 0 }; await writeConnection(connection); }
    const buildId = await webBuildId();
    const current = await inspect(connection);
    const configuredPort = getConfig().webPort;
    if (current && !restart && current.buildId === buildId && (!configuredPort || configuredPort === connection.port)) return { running: true, reused: true, ...current };
    if (current) await stopConnection(connection);
    if (configuredPort && configuredPort !== connection.port) { connection = { ...connection, port: configuredPort }; await writeConnection(connection); }
    const logPath = join(webDir, 'server.log');
    // Keep launch failures bounded on disk; this log never prints connection tokens.
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) fs.renameSync(logPath, logPath + '.previous');
    const log = fs.openSync(logPath, 'a', 0o600);
    let child;
    try {
      child = spawn(process.execPath, [join(packageRoot, 'mcp-server', 'dashboard', 'worker.js')], {
        cwd: packageRoot, detached: true, windowsHide: true, stdio: ['ignore', log, log],
        env: { ...process.env, MEMORY_DIR: resolve(MEMORY_DIR), MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_WEB_AUTOSTART_CHILD: '1' }
      });
    } finally { fs.closeSync(log); }
    let failure;
    child.on('error', error => { failure = error; });
    child.unref();
    try {
      for (let i = 0; i < 150; i++) {
        if (failure) throw failure;
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Panel failed to start. See ${logPath}`);
        const latest = readConnection();
        const runtime = await inspect(latest);
        if (runtime && runtime.pid === child.pid) {
          if (runtime.buildId !== buildId) throw new Error('Panel files changed during startup; retry.');
          return { running: true, reused: false, ...runtime };
        }
        await pause(75);
      }
      throw new Error(`Panel startup timed out. See ${logPath}`);
    } catch (error) {
      // Only the child created by this launch is owned; never kill a stored PID.
      if (child.exitCode === null && child.signalCode === null) child.kill();
      throw error;
    }
  });
}

const startupMarker = "' Memory Plugin managed web startup";
export function startupPath() {
  const root = process.env.MEMORY_WEB_STARTUP_DIR || (process.platform === 'win32' && process.env.APPDATA
    ? join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') : null);
  return root ? join(root, `memory-plugin-web-${storageId.slice(0, 12)}.vbs`) : null;
}

export function registerWebStartup({ remove = false, dryRun = false, automatic = false } = {}) {
  const file = startupPath();
  if (!file) return { supported: false, enabled: false };
  let previous;
  if (fs.existsSync(file)) {
    previous = fs.readFileSync(file);
    const old = previous.toString('utf16le').replace(/^\uFEFF/, '');
    if (!old.startsWith(startupMarker + '\r\n')) throw new Error(`Startup entry is not owned by this plugin: ${file}`);
  }
  // A redirected profile may be a test or a diagnostic process. Only explicit
  // opt-in (CLI/UI), or an existing owned entry, permits its OS login startup.
  // Tests exercising login startup must point at their own Startup directory.
  const normalPath = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
  if (automatic && !previous && !process.env.MEMORY_WEB_STARTUP_DIR
    && normalPath(MEMORY_DIR) !== normalPath(resolveDefaultMemoryDir())) {
    return { supported: true, enabled: false, skipped: true, reason: 'custom-memory-directory', path: file };
  }
  if (dryRun) return { supported: true, enabled: fs.existsSync(file), path: file };
  if (remove) { fs.rmSync(file, { force: true }); return { supported: true, enabled: false, path: file }; }
  const literal = value => '"' + value.replaceAll('"', '""') + '"';
  const command = [process.execPath, join(packageRoot, 'mcp-server', 'cli_boot.js')].map(value => '"' + value + '"').join(' ') + ' web start';
  const body = `${startupMarker}\r\nSet shell = CreateObject("WScript.Shell")\r\nshell.Environment("PROCESS")("MEMORY_DIR") = ${literal(resolve(MEMORY_DIR))}\r\nshell.Run ${literal(command)}, 0, False\r\n`;
  const bytes = Buffer.from('\uFEFF' + body, 'utf16le');
  // Do not rewrite the login entry on every client launch. A new build updates
  // the command in the same profile-owned file, rather than adding an entry.
  if (!previous?.equals(bytes)) atomicWrite(file, bytes, { renameRetries: 20 });
  return { supported: true, enabled: true, path: file };
}

export async function setWebAutostart(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Autostart requires on or off');
  const startup = registerWebStartup({ remove: !enabled });
  updateConfig({ webAutoStart: enabled });
  return { enabled, startup, ...(enabled ? await ensureWeb() : {}) };
}

export async function autoStartWeb() {
  if (process.env.CI || process.env.MEMORY_CLIENT_PROBE === '1' || process.env.MEMORY_WEB_AUTOSTART === '0'
    || process.env.MEMORY_DISABLE_WEB_AUTOSTART === '1' || process.env.MEMORY_DISABLE_BACKGROUND_SYNC === '1'
    || process.env.MEMORY_WEB_AUTOSTART_CHILD === '1') return { skipped: true };
  if (!getConfig().webAutoStart) return { skipped: true };
  registerWebStartup({ automatic: true });
  return ensureWeb();
}

export async function removeWebRuntime({ dryRun = false } = {}) {
  if (!readConnection() && !fs.existsSync(startupPath() || '')) return { skipped: true };
  const startup = registerWebStartup({ remove: true, dryRun });
  if (dryRun) return { startup, ...(await webStatus()) };
  const stopped = await stopWeb();
  updateConfig({ webAutoStart: false });
  return { startup, ...stopped };
}
