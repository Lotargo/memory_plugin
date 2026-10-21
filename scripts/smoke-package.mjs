// Install a real tarball into a fresh directory; no client setup or user data access.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const run = promisify(execFile);
const tarball = process.argv[2];
const verifying = tarball === '--verify';
if (!verifying) assert.ok(tarball?.endsWith('.tgz'), 'Usage: npm run smoke:package -- /absolute/path/package.tgz');
assert.ok(process.env.npm_execpath, 'Run through npm run smoke:package.');
const root = verifying ? resolve(process.argv[3]) : await mkdtemp(join(tmpdir(), 'memory-release-smoke-'));
const env = { ...process.env, CI: '1', MEMORY_DIR: join(root, 'memory'), OPENCODE_CONFIG_DIR: join(root, 'opencode'),
  HOME: root, USERPROFILE: root, APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'local'),
  CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude'), MEMORY_WEB_STARTUP_DIR: join(root, 'startup'),
  MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_DISABLE_WEB_AUTOSTART: '1',
  MEMORY_WEB_AUTOSTART: '0', MEMORY_CLIENT_PROBE: '1', MEMORY_PLUGIN_DISABLE_NATIVE_CLI: '1' };
let client, app, closeDatabase;
try {
  if (!verifying) {
  await run(process.execPath, [process.env.npm_execpath, 'install', '--prefix', root, '--ignore-scripts', '--no-audit', '--no-fund', resolve(tarball)],
    { env, windowsHide: true, timeout: 300000, maxBuffer: 4 * 1024 * 1024 });
  const audit = await run(process.execPath, [process.env.npm_execpath, 'audit', '--prefix', root, '--omit=dev', '--json'],
    { env, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(JSON.parse(audit.stdout).metadata.vulnerabilities.total, 0, 'the consumer install must also have a clean audit');
  console.log('PASS consumer production dependency audit: zero vulnerabilities.');
  // Native SQLite libraries stay locked until their process exits on Windows.
  // Only this child imports the installed runtime; the parent can then remove it.
  const result = await run(process.execPath, [fileURLToPath(import.meta.url), '--verify', root],
    { env, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(result.stdout);
  } else {
  const pkgRoot = join(root, 'node_modules', '@lotargo', 'memory_plugin');
  const { createDocxFixture } = await import('../tests/fixtures/docx_fixture.js');
  const { normalizeContent } = await import(pathToFileURL(join(pkgRoot, 'mcp-server/ingest/normalizer.js')).href);
  const docx = await normalizeContent({ content: await createDocxFixture(), type: 'file', path: 'synthetic.docx' });
  for (const text of ['# Release decision', 'Пример DOCX: SKU-123', 'Metric', 'Samples', '42']) assert.ok(docx.markdown.includes(text), `installed DOCX: ${text}`);
  console.log('PASS installed DOCX runtime: real OOXML heading, Unicode, identifiers and table text.');
  const imported = path => import(pathToFileURL(join(root, 'node_modules', path)).href);
  const { Client } = await imported('@modelcontextprotocol/sdk/dist/esm/client/index.js');
  const { StdioClientTransport } = await imported('@modelcontextprotocol/sdk/dist/esm/client/stdio.js');
  client = new Client({ name: 'release-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(pkgRoot, 'mcp-server/boot.js')], cwd: root, env, stderr: 'pipe' });
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.ok(tools.some(tool => tool.name === 'remember'));
  const recalled = await client.callTool({ name: 'recall', arguments: { scope: 'all' } });
  assert.match(JSON.stringify(recalled), /empty/i);
  const saved = await client.callTool({ name: 'remember', arguments: { title: 'Release smoke', fact: 'Synthetic package validation record.', kind: 'fact', scope: 'global' } });
  assert.ok(!saved.isError, JSON.stringify(saved));
  const readback = await client.callTool({ name: 'recall', arguments: { scope: 'all' } });
  assert.match(JSON.stringify(readback), /Synthetic package validation record/);
  const info = await client.callTool({ name: 'memory_info', arguments: {} });
  const pkg = JSON.parse(await readFile(join(pkgRoot, 'package.json'), 'utf8'));
  assert.ok(JSON.stringify(info).includes(pkg.version));
  await client.close(); client = null;
  Object.assign(process.env, env);
  const database = await import(pathToFileURL(join(pkgRoot, 'mcp-server/db/database.js')).href);
  ({ closeDatabase } = database);
  const db = await database.getDatabase();
  await db.exec("CREATE TABLE release_blob_probe (value BLOB NOT NULL); INSERT INTO release_blob_probe VALUES (X'')");
  const emptyBlob = (await db.prepare('SELECT value FROM release_blob_probe').get()).value;
  await db.prepare('UPDATE release_blob_probe SET value = ?').run(emptyBlob);
  assert.equal((await db.prepare('SELECT typeof(value) AS kind FROM release_blob_probe').get()).kind, 'blob');
  const { startDashboard } = await import(pathToFileURL(join(pkgRoot, 'mcp-server/dashboard/server.js')).href);
  app = await startDashboard();
  const url = new URL(app.url), headers = { Authorization: `Bearer ${url.hash.slice(1)}` };
  for (const path of ['/', '/app.js', '/style.css', '/favicon.svg', '/vendor/marked/marked.esm.js', '/vendor/katex/katex.min.css', '/api/overview']) {
    const response = await fetch(new URL(path, url), { headers });
    assert.equal(response.status, 200, path);
  }
  console.log(`PASS installed tarball ${pkg.version}: ${tools.length} MCP tools, initially empty isolated memory, Notebook write/read, dashboard and packaged browser assets.`);
  console.log('Install lifecycle scripts and native client setup were intentionally disabled; no models were downloaded or loaded.');
  }
} finally {
  await client?.close(); await app?.close(); closeDatabase?.();
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  if (!verifying) {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
    console.log('PASS temporary install/profile cleanup after the runtime child exited.');
  }
}
