import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(os.tmpdir(), 'memory hidden & probes-'));
process.env.MEMORY_DIR = join(root, 'memory');
process.env.MEMORY_DISABLE_PERSONA_SYNC = '1';
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = '1';
process.env.MEMORY_DISABLE_WEB_AUTOSTART = '1';
const originals = { execFile: childProcess.execFile, execFileSync: childProcess.execFileSync, spawn: childProcess.spawn };
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
const calls = [];
const guid = '12345678-1234-5678-9abc-123456789abc';
let nvidiaAvailable = true;

function fakeExecFile(file, args, options, callback) {
  calls.push({ file, args, options });
  let stdout;
  if (file === 'git') stdout = args[0] === 'rev-parse' ? root + '\n' : 'remote.origin.url https://example.com/team/project.git\n';
  else if (file === 'nvidia-smi' && nvidiaAvailable) stdout = args[0].includes('utilization') ? '47\n' : '2048, 8192\n';
  else if (file === 'powershell') stdout = args.at(-1).includes('WorkingSet64') ? '33554432\n' : '23\n';
  else if (file === 'ps') stdout = '32768\n';
  const error = stdout === undefined ? Object.assign(new Error('unavailable probe'), { code: 'ENOENT' }) : null;
  queueMicrotask(() => callback(error, stdout || '', ''));
}
fakeExecFile[promisify.custom] = (file, args, options) => new Promise((resolve, reject) => {
  fakeExecFile(file, args, options, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
});
childProcess.execFile = fakeExecFile;
childProcess.execFileSync = (file, args, options) => {
  calls.push({ file, args, options });
  if (file === 'reg.exe') return `MachineGuid    REG_SZ    ${guid}\n`;
  if (file === 'ioreg') return `"IOPlatformUUID" = "${guid}"\n`;
  throw new Error('unexpected machine probe');
};
childProcess.spawn = (file, args, options) => {
  calls.push({ file, args, options });
  return originals.spawn(file, args, options);
};
syncBuiltinESMExports();

function checkEncryptionCompatibility(store) {
  // The launch change must preserve the machine fingerprint and existing key.
  const fingerprint = `${guid}|${os.platform()}|${os.arch()}`;
  const salt = crypto.createHash('sha256').update(fingerprint).digest();
  const key = crypto.pbkdf2Sync(fingerprint, salt, 600000, 32, 'sha256');
  const plain = 'isolated compatibility fixture';
  const [iv, tag, cipher] = store.encryptData(plain).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  assert.equal(decipher.update(Buffer.from(cipher, 'hex'), undefined, 'utf8') + decipher.final('utf8'), plain);
  assert.equal(store.decryptData([iv, tag, cipher].join(':')), plain);
}

try {
  const identity = await import('../../mcp-server/identity.js');
  assert.equal(await identity.detectGitToplevel(root), root);
  assert.deepEqual(await identity.getRemoteUrls(root), ['https://example.com/team/project.git']);
  assert.equal((await identity.resolveProjectIdentity(root)).key, 'git:example.com/team/project');

  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' });
  const gpu = await import('../../mcp-server/ml/gpu_monitor.js');
  assert.equal(await gpu.getGpuUtilizationAsync(), 47);
  assert.deepEqual(await gpu.getGpuMemoryInfoAsync(), { usedMB: 2048, totalMB: 8192 });
  nvidiaAvailable = false;
  assert.equal(await gpu.getGpuUtilizationAsync(), 23, 'Windows fallback still returns a measurement');
  assert.equal(await gpu.getGpuMemoryInfoAsync(), null, 'Missing hardware remains unavailable');
  assert.equal(await gpu.getProcessMemoryMB(process.pid + 1), 32);
  const store = await import('../../mcp-server/config/auth_store.js');
  checkEncryptionCompatibility(store);
  const registry = calls.find(call => call.file === 'reg.exe');
  assert.deepEqual(registry.args, ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']);

  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'darwin' });
  checkEncryptionCompatibility(await import('../../mcp-server/config/auth_store.js?mac-launch'));
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'linux' });
  assert.equal(await gpu.getProcessMemoryMB(process.pid + 1), 32);
  Object.defineProperty(process, 'platform', platformDescriptor);

  const { runDirectMcpSmoke } = await import('../../mcp-server/codex_diagnostics.js');
  const result = await runDirectMcpSmoke({ command: process.execPath,
    args: [fileURLToPath(new URL('../../mcp-server/boot.js', import.meta.url))], cwd: root });
  assert.equal(result.ok, true);
  assert.ok(result.toolNames.includes('recall'));
  assert.ok(calls.some(call => call.file === process.execPath), 'Actual MCP diagnostics use the hidden launch');
  for (const call of calls) assert.equal(call.options.windowsHide, true, `${call.file} must not create a console window`);
  console.log('PASS background launches: Git, Windows/macOS machine keys, GPU/RSS fallbacks and real MCP diagnostics; hidden flags preserve results.');
} finally {
  Object.defineProperty(process, 'platform', platformDescriptor);
  Object.assign(childProcess, originals);
  syncBuiltinESMExports();
  assert.equal(dirname(resolve(root)), resolve(os.tmpdir()));
  assert.ok(basename(root).startsWith('memory hidden & probes-'));
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
