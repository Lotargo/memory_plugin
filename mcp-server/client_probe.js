// Bounded asynchronous processes for explicitly requested client diagnostics.
import { spawn, execFile } from 'node:child_process';
import { resolveClientExecutable } from './client_cli.js';

export const PROBE_TIMEOUT_MS = 20000;
export const PROBE_OUTPUT_LIMIT = 256 * 1024;
const fault = code => Object.assign(new Error(code), { code });

function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 2000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
    if (process.platform === 'win32') {
      execFile('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, timeout: 1500 }, () => {});
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  });
}

export async function boundedProcess({ command, args, cwd, env, timeoutMs = PROBE_TIMEOUT_MS,
  protocol = false, expectedRuntime, windowsVerbatimArguments = false } = {}) {
  const child = spawn(command, args, { cwd, env, windowsHide: true, shell: false,
    detached: process.platform !== 'win32', windowsVerbatimArguments,
    stdio: [protocol ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  let bytes = 0, stdout = '', buffer = '', nextId = 0, timer;
  const pending = new Map();
  const failures = new Promise((_, reject) => {
    timer = setTimeout(() => reject(fault('TIMEOUT')), timeoutMs);
    child.on('error', () => reject(fault('PROBE_FAILED')));
    child.on('exit', code => {
      if (protocol || code !== 0) reject(fault('PROBE_FAILED'));
    });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > PROBE_OUTPUT_LIMIT) reject(fault('OUTPUT_LIMIT'));
    });
  });
  // Output and exception messages can contain credentials or recalled memory.
  // Never pass them to the service response, logs, or a terminal error.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    if (bytes > PROBE_OUTPUT_LIMIT) return;
    if (!protocol) { stdout += chunk; return; }
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { for (const item of pending.values()) item.reject(fault('PROTOCOL')); continue; }
      const item = pending.get(message.id);
      if (!item) continue;
      pending.delete(message.id);
      message.error ? item.reject(fault('PROTOCOL')) : item.resolve(message.result);
    }
  });
  if (protocol) child.stdin.on('error', () => { for (const item of pending.values()) item.reject(fault('PROBE_FAILED')); });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const run = async () => {
    if (!protocol) return new Promise((resolve, reject) => child.once('close', code => code === 0 ? resolve({ stdout }) : reject(fault('PROBE_FAILED'))));
    const initialized = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'memory-client-doctor', version: '1' } });
    if (!initialized?.serverInfo || !initialized?.protocolVersion) throw fault('PROTOCOL');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    const listed = await request('tools/list');
    const names = new Set((listed?.tools || []).map(tool => tool.name));
    if (!names.has('memory_info') || !names.has('recall')) throw fault('PROTOCOL');
    const info = await request('tools/call', { name: 'memory_info', arguments: {} });
    if (info?.isError) throw fault('PROTOCOL');
    const infoText = (info?.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
    if (expectedRuntime && (!infoText.includes(expectedRuntime.memoryDir) || !infoText.includes(`Version: ${expectedRuntime.version}`))) throw fault('RUNTIME_MISMATCH');
    const recall = await request('tools/call', { name: 'recall', arguments: { scope: 'all' } });
    if (recall?.isError) throw fault('PROTOCOL');
    const partial = /^(?:RAG|Identity): unavailable\b/m.test(infoText);
    return { toolCount: names.size, initialize: 'PASS', memoryInfo: partial ? 'PARTIAL' : 'PASS', recall: 'PASS',
      ...(partial ? { status: 'partial', code: 'ENGINE_UNAVAILABLE' } : {}) };
  };
  try { return await Promise.race([run(), failures]); }
  finally {
    clearTimeout(timer);
    for (const item of pending.values()) item.reject(fault('PROBE_FINISHED'));
    pending.clear(); await stop(child);
  }
}

export async function probeNative(client, args, options) {
  const executable = resolveClientExecutable(client, options);
  if (!executable) throw fault('CLI_UNAVAILABLE');
  const shim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
  if (shim && /["&|<>^%!\r\n]/.test(executable)) throw fault('UNSUPPORTED_LAUNCHER');
  // Only service-owned fixed argument lists reach this function.
  const command = shim ? (options.env.ComSpec || 'cmd.exe') : executable;
  return boundedProcess({ ...options, command, windowsVerbatimArguments: shim,
    args: shim ? ['/d', '/s', '/c', `""${executable}" ${args.join(' ')}"`] : args });
}
