// Real prepared-runtime acceptance; all adapters and memory remain disposable.
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'memory-marketplace-security-'));
assert.ok(process.env.npm_execpath, 'Run with npm run smoke:marketplace.');
Object.assign(process.env, { MEMORY_DIR: join(root, 'memory'), OPENCODE_CONFIG_DIR: join(root, 'opencode'),
  MEMORY_WEB_STARTUP_DIR: join(root, 'startup'), MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1',
  MEMORY_DISABLE_WEB_AUTOSTART: '1', MEMORY_WEB_AUTOSTART: '0', CI: '1' });
try {
  const { buildMarketplace } = await import('../../mcp-server/marketplace.js');
  const output = join(root, 'catalog');
  const receipt = await buildMarketplace({ output, memoryDir: process.env.MEMORY_DIR });
  assert.equal(receipt.prepared, true);
  const shrink = JSON.parse(await readFile(join(receipt.runtime, 'npm-shrinkwrap.json'), 'utf8'));
  assert.equal(shrink.packages['node_modules/@huggingface/transformers'].version, '4.3.1');
  assert.ok(!Object.keys(shrink.packages).some(name => /(?:^|\/)node_modules\/(?:sprintf-js|argparse|mammoth)$/.test(name)));
  const audit = await run(process.execPath, [process.env.npm_execpath, 'audit', '--prefix', receipt.runtime, '--omit=dev', '--json'], { windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(JSON.parse(audit.stdout).metadata.vulnerabilities.total, 0);
  const smoke = await run(process.execPath, [fileURLToPath(new URL('./marketplace_prepared.test.js', import.meta.url)), output], { env: process.env, windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  assert.match(smoke.stdout, /PASSED/);
  console.log('PASS real prepared marketplace: npm ci with shipped shrinkwrap, zero production advisories, native ONNX import, both adapter hooks and MCP storage isolation.');
} finally {
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
}
