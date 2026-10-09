import { spawn, execFile } from 'node:child_process';

// Native-host tests use isolated CODEX_HOME and a local HTTP stub. This helper
// never trusts hooks or starts a turn on its own.
export async function codexAppServer({ binary, env, cwd }) {
  const child = spawn(binary, ['app-server', '--stdio'], {
    cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map(), notifications = [], waiters = new Set();
  let nextId = 0, buffer = '', stderr = '', failure;
  function rejectAll(error) {
    failure = error;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
    for (const item of waiters) { clearTimeout(item.timer); item.reject(error); }
    waiters.clear();
  }
  child.on('error', rejectAll);
  child.on('exit', code => rejectAll(new Error(`Codex app-server exited: ${code}`)));
  child.stdin.on('error', rejectAll);
  child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-16384); });
  child.stdout.on('data', bytes => {
    buffer += bytes.toString();
    if (buffer.length > 2 * 1024 * 1024) { rejectAll(new Error('Codex app-server output limit')); child.kill(); return; }
    let at;
    while ((at = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { rejectAll(new Error('Invalid app-server JSON')); return; }
      const item = pending.get(message.id);
      if (item) {
        pending.delete(message.id); clearTimeout(item.timer);
        message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
      } else if (message.method) {
        notifications.push(message);
        for (const waiter of waiters) if (waiter.predicate(message)) {
          waiters.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(message);
        }
      }
    }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  const waitFor = (predicate, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const found = notifications.find(predicate);
    if (found) { resolve(found); return; }
    if (failure) { reject(failure); return; }
    const waiter = { predicate, resolve, reject };
    waiter.timer = setTimeout(() => { waiters.delete(waiter); reject(new Error('Timed out waiting for native notification')); }, timeoutMs);
    waiters.add(waiter);
  });
  const close = async () => {
    rejectAll(new Error('Native test client closed'));
    child.stdin.end();
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => { const timer = setTimeout(resolve, 1500); child.once('close', () => { clearTimeout(timer); resolve(); }); });
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') await new Promise(resolve => execFile('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, timeout: 2000 }, resolve));
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  };
  try {
    await request('initialize', { clientInfo: { name: 'memory-native-runtime-test', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    return { request, waitFor, close, stderr: () => stderr };
  } catch (error) { await close(); throw error; }
}
