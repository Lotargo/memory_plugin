import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const output = resolve(process.argv[2] || '');
const receipt = JSON.parse(await readFile(join(output, 'local-marketplace.json'), 'utf8'));
assert.equal(receipt.prepared, true);
const temp = await mkdtemp(join(tmpdir(), 'memory-prepared-runtime-'));
const data = join(temp, 'data');
const workspace = join(temp, 'workspace');
await Promise.all([data, workspace].map(p => mkdir(p, { recursive: true })));
Object.assign(process.env, { HOME: temp, USERPROFILE: temp, CODEX_HOME: join(temp, '.codex'), CLAUDE_CONFIG_DIR: join(temp, '.claude'), MEMORY_DIR: data, OPENCODE_CONFIG_DIR: join(temp, 'opencode'), CI: '1', MEMORY_WEB_AUTOSTART: '0' });
try {
  // Verify that ignored npm lifecycle scripts did not leave a broken native
  // ONNX dependency. This loads the provider without downloading any model.
  const requireRuntime = createRequire(join(receipt.runtime, 'package.json'));
  const ort = createRequire(requireRuntime.resolve('@huggingface/transformers'))('onnxruntime-node');
  assert.ok(ort.InferenceSession);
  await writeFile(join(data, 'global.md'), '- [2026-10-05 00:00] prepared_runtime_fixture <!-- id:prepared -->\n');
  const { runDirectMcpSmoke } = await import('../../mcp-server/codex_diagnostics.js');
  for (const client of ['codex', 'claude']) {
    // Copy the small installed adapter to an isolated profile. Change only
    // this test copy's data pointer, leaving the delivered build untouched.
    const plugin = join(temp, client);
    await cp(join(output, client, 'plugins', 'memory'), plugin, { recursive: true });
    const config = JSON.parse(await readFile(join(plugin, 'runtime.json'), 'utf8'));
    config.memoryDir = data;
    await writeFile(join(plugin, 'runtime.json'), JSON.stringify(config));
    const entry = join(plugin, 'scripts', 'entry.cjs');
    const hook = spawnSync(process.execPath, [entry, 'hook'], { cwd: workspace, env: process.env, input: JSON.stringify({ cwd: workspace }), encoding: 'utf8', timeout: 15000 });
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(JSON.parse(hook.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
    const smoke = await runDirectMcpSmoke({ command: process.execPath, args: [entry, 'mcp'], cwd: workspace, env: process.env });
    assert.ok(smoke.memoryInfo.includes(`Version: ${receipt.version}`), smoke.memoryInfo);
    assert.ok(smoke.memoryInfo.includes(data), smoke.memoryInfo);
    assert.ok(smoke.recall.includes('prepared_runtime_fixture'), smoke.recall);
  }
  console.log('PREPARED RUNTIME: native ONNX import, both hooks, MCP initialize/tools/recall and isolated storage PASSED');
} finally {
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
