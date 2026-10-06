import { spawn } from 'node:child_process';
import { browserLaunchSpec } from '../admin/auth.js';

// Only the verified local panel URL is sent to the system browser. A successful
// launcher handoff is a request, not proof that a browser page has loaded.
export async function requestPanelBrowser(url, { platform = process.platform, spawnProcess = spawn, timeoutMs = 1500 } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1'
    || target.pathname !== '/' || target.search || target.username || target.password
    || !/^#[a-f0-9]{64}$/.test(target.hash)) throw new Error('Expected the saved local panel URL.');
  const { command, args } = browserLaunchSpec(url, platform);
  return new Promise((resolve, reject) => {
    let timer, settled = false, child;
    const finish = error => {
      if (settled) return; settled = true; clearTimeout(timer);
      child?.unref();
      if (error) reject(new Error(`Cannot launch the system browser (${error.code || error.message}). Use the printed panel URL.`));
      else resolve({ status: 'requested' });
    };
    try {
      child = spawnProcess(command, args, { shell: false, stdio: 'ignore', detached: true, windowsHide: true });
      child.once('error', finish);
      child.once('exit', (code, signal) => finish(code === 0 ? null : new Error(`exit ${code ?? signal}`)));
      child.once('spawn', () => { timer = setTimeout(() => finish(), timeoutMs); });
    } catch (error) { finish(error); }
  });
}
