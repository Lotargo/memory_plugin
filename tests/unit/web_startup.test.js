import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = fs.mkdtempSync(join(tmpdir(), 'memory-startup-'));
const runtimeUrl = new URL('../../mcp-server/dashboard/runtime.js', import.meta.url).href;
const memoryUrl = new URL('../../mcp-server/memory.js', import.meta.url).href;
const env = {
  ...process.env, HOME: join(root, 'home'), USERPROFILE: join(root, 'home'),
  APPDATA: join(root, 'roaming'), LOCALAPPDATA: join(root, 'local'), XDG_CONFIG_HOME: join(root, 'config'),
  MEMORY_DIR: '', OPENCODE_CONFIG_DIR: '', MEMORY_WEB_STARTUP_DIR: '', CI: '',
  MEMORY_CLIENT_PROBE: '', MEMORY_WEB_AUTOSTART: '', MEMORY_DISABLE_WEB_AUTOSTART: '',
  MEMORY_DISABLE_BACKGROUND_SYNC: '', MEMORY_WEB_AUTOSTART_CHILD: '', MEMORY_DISABLE_PERSONA_SYNC: '1',
};
const run = (code, overrides = {}) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
  import fs from 'node:fs';
  const runtime = await import(${JSON.stringify(runtimeUrl)});
  const memory = await import(${JSON.stringify(memoryUrl)});
  ${code}
`], { env: { ...env, ...overrides }, encoding: 'utf8', timeout: 15000, windowsHide: true }));
const register = options => `console.log(JSON.stringify(runtime.registerWebStartup(${JSON.stringify(options)})));`;
const files = directory => fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];

try {
  // All suppression flags act before loading config or creating a profile.
  for (const [key, value] of Object.entries({ CI: '1', MEMORY_CLIENT_PROBE: '1', MEMORY_WEB_AUTOSTART: '0',
    MEMORY_DISABLE_WEB_AUTOSTART: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_WEB_AUTOSTART_CHILD: '1' })) {
    const profile = join(root, key);
    assert.deepEqual(run('console.log(JSON.stringify(await runtime.autoStartWeb()));', { MEMORY_DIR: profile, [key]: value }), { skipped: true });
    assert.equal(fs.existsSync(profile), false, `${key} must not create config, runtime or login entries`);
  }

  const sandbox = join(root, 'startup');
  const custom = { MEMORY_DIR: join(root, 'custom-profile'), MEMORY_WEB_STARTUP_DIR: sandbox };
  const first = run(register({ automatic: true }), custom);
  assert.equal(first.enabled, true, 'a sandbox can exercise login registration for an isolated profile');
  const bytes = fs.readFileSync(first.path);
  const stamp = new Date('2000-01-01T00:00:00Z');
  fs.utimesSync(first.path, stamp, stamp);
  const modified = fs.statSync(first.path).mtimeMs;
  assert.deepEqual(run(register({ automatic: true }), custom), first);
  assert.deepEqual(fs.readFileSync(first.path), bytes);
  assert.equal(fs.statSync(first.path).mtimeMs, modified, 'repeated launches must leave identical entries untouched');
  assert.deepEqual(files(sandbox), [first.path.split(/[\\/]/).at(-1)]);

  // An old build command is refreshed in place, without claiming other files.
  const unrelated = join(sandbox, 'memory-plugin-web-unrelated.vbs');
  fs.writeFileSync(unrelated, 'another application');
  fs.writeFileSync(first.path, Buffer.from(bytes.toString('utf16le').replace(/shell\.Run .*/, 'shell.Run "old build", 0, False'), 'utf16le'));
  assert.equal(run(register({ automatic: true }), custom).path, first.path);
  assert.deepEqual(fs.readFileSync(first.path), bytes);
  assert.equal(files(sandbox).length, 2);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'another application');
  run(register({ remove: true }), custom);
  assert.deepEqual(files(sandbox), ['memory-plugin-web-unrelated.vbs']);
  fs.writeFileSync(first.path, 'not plugin-owned');
  assert.equal(run(`try { runtime.registerWebStartup(); } catch (error) { console.log(JSON.stringify(error.message)); }`, custom).includes('not owned'), true);
  assert.equal(fs.readFileSync(first.path, 'utf8'), 'not plugin-owned');

  if (process.platform === 'win32') {
    // Fake APPDATA exercises the real Windows-path policy without touching the
    // user's Startup directory, even when no disabling flag was supplied.
    const normal = run(register({ automatic: true }));
    assert.equal(normal.enabled, true, 'the default persistent profile retains automatic login registration');
    const normalBytes = fs.readFileSync(normal.path);
    for (const redirected of [{ MEMORY_DIR: join(root, 'diagnostic') }, { OPENCODE_CONFIG_DIR: join(root, 'opencode') }]) {
      const blocked = run(register({ automatic: true }), redirected);
      assert.equal(blocked.reason, 'custom-memory-directory');
      assert.equal(blocked.enabled, false);
      assert.equal(fs.existsSync(blocked.path), false);
      assert.deepEqual(fs.readFileSync(normal.path), normalBytes, 'another profile cannot alter the normal entry');
      const optedIn = run(register({}), redirected);
      assert.equal(optedIn.enabled, true, 'explicit CLI/UI opt-in can register a persistent custom profile');
      assert.equal(run(register({ automatic: true }), redirected).path, optedIn.path, 'future launches reuse the explicit entry');
      run(register({ remove: true }), redirected);
    }
    const defaultDir = run('console.log(JSON.stringify(memory.resolveDefaultMemoryDir()));');
    assert.equal(run(register({ automatic: true }), { MEMORY_DIR: defaultDir }).path, normal.path, 'an explicit alias of the default profile still uses one entry');
    run(register({ remove: true }));
  }
  console.log('PASS web startup: suppression before side effects, redirected-profile opt-in, stable registration, build refresh, sandbox isolation and foreign-file preservation.');
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
