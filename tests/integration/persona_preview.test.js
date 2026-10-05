import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'memory-persona-preview-'));
for (const [key, value] of Object.entries({ MEMORY_DIR: join(root, 'memory'), OPENCODE_CONFIG_DIR: join(root, 'opencode'),
  CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude'), XDG_CONFIG_HOME: join(root, 'config'),
  MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_DISABLE_WEB_AUTOSTART: '1' })) process.env[key] = value;
const memory = await import('../../mcp-server/memory.js');
const { getDatabase, closeDatabase } = await import('../../mcp-server/db/database.js');
const { updateConfig } = await import('../../mcp-server/config/config_manager.js');
const { previewPersonaContext } = await import('../../mcp-server/services/persona_service.js');
const notebook = await import('../../mcp-server/services/notebook_service.js');
const { buildMemoryContext, buildSystemMemoryOverlay } = await import('../../opencode-plugin/index.js');
const v2 = await import('../../opencode-plugin/main.js');
const { buildPersonaOverlayBlock } = await import('../../mcp-server/prompt_manager.js');
const { seedPersonaFixture } = await import('../fixtures/persona.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error('Preview must remain offline'); };
let app;
try {
  const { a, b } = await seedPersonaFixture();
  const before = new Map();
  for (const key of ['global', a, b]) before.set(key, await memory.readMemory(key));
  const versions = await Promise.all(['global', a, b].map(key => notebook.readNotebook({ key })));
  let preview = await previewPersonaContext({ key: a });
  const row = (key, ref) => preview.directives.find(item => item.key === key && item.ref === ref);
  assert.equal(preview.coverage, 'native-builders'); assert.equal(preview.partial, false);
  assert.equal(preview.injection.limit, null); assert.equal(preview.agentUsage, 'not-observed');
  assert.equal(row(a, 'id:same').included, true); assert.equal(row('global', 'id:same').included, true);
  assert.deepEqual(row(b, 'id:same').reasons, ['other_scope']);
  assert.deepEqual(row(a, 'id:disabled').reasons, ['disabled']);
  assert.deepEqual(row(a, 'id:old').reasons, ['superseded']);
  assert.deepEqual(row(a, 'id:expired').reasons, ['expired']);
  assert.equal(row(a, 'id:expired').contextRole, 'fact', 'keep does not reactivate expired directives; native context retains an expired fact');
  assert.equal(row('global', 'id:legacy').legacy, true);
  assert.equal(row(a, 'legacy:4').included, true);
  assert.equal(row(a, 'legacy:4').fingerprint, versions[1].records.find(item => item.ref === 'legacy:4').fingerprint);
  assert.equal(preview.directives.some(item => item.ref === 'id:fact'), false);
  const now = Date.parse(preview.observedAt);
  assert.equal(preview.blocks[0].text, buildSystemMemoryOverlay(before.get('global'), before.get(a), a, now));
  assert.equal(preview.blocks[1].text, buildMemoryContext(before.get('global'), before.get(a), a, null, now));
  assert.equal(preview.blocks[1].text, v2.buildMemoryContext(before.get('global'), before.get(a), a, null, now));
  assert.equal(preview.blocks[2].text, v2.buildOpenCodeV2MemoryContext(before.get('global'), before.get(a), a, now));
  assert.match(preview.blocks[2].text, /MEMORY ROUTING DIRECTIVE:/);
  assert.doesNotMatch(preview.blocks[0].text, /Историческое правило|Прежнее правило|Временно отключённое|Данные другого/);
  assert.match(preview.blocks[1].text, /Историческое правило/);
  assert.doesNotMatch(preview.blocks[1].text, /sync to the cloud immediately|next background sync/);
  for (const client of ['codex', 'claude', 'gemini', 'antigravity']) {
    preview = await previewPersonaContext({ key: a, client });
    assert.equal(preview.partial, true); assert.equal(preview.coverage, 'partial-managed-template');
    assert.deepEqual(preview.injection.scopeKeys, ['global']);
    assert.deepEqual(row(a, 'id:same').reasons, ['client_scope']);
    assert.equal(row('global', 'id:same').included, true);
    assert.equal(preview.blocks[0].text, buildPersonaOverlayBlock(before.get('global'), Date.parse(preview.observedAt)));
    assert.doesNotMatch(preview.blocks[0].text, /Проверять данные проекта A/);
  }
  preview = await previewPersonaContext({ key: 'global' });
  assert.equal(row(a, 'id:same').included, false); assert.deepEqual(row(a, 'id:same').reasons, ['other_scope']);
  assert.equal(preview.project, ''); assert.deepEqual(preview.injection.scopeKeys, ['global']);
  for (const input of [{}, { key: '__all__' }, { key: 'git:missing' }, { key: a, client: '../codex' }]) {
    await assert.rejects(previewPersonaContext(input));
  }
  for (const key of ['global', a, b]) assert.deepEqual(await memory.readMemory(key), before.get(key));
  assert.deepEqual((await Promise.all(['global', a, b].map(key => notebook.readNotebook({ key })))).map(item => item.version), versions.map(item => item.version));
  assert.equal(existsSync(join(root, 'config', 'memory-agent', 'prompt.md')), false, 'preview never writes prompt files');
  assert.equal(existsSync(join(root, 'memory', 'models')), false, 'preview never loads models');
  // A competing client changes the current state. Refresh must show it; no stale cache.
  let doc = await notebook.readNotebook({ key: a });
  await notebook.mutateNotebook({ key: a, expectedVersion: doc.version, ref: 'id:same', action: 'update', fields: { disabled: true } });
  preview = await previewPersonaContext({ key: a });
  assert.equal(row(a, 'id:same').included, false); assert.notEqual(preview.versions.selected, doc.version);
  const legacyFingerprint = row(a, 'legacy:4').fingerprint;
  const reordered = await memory.readMemory(a);
  reordered.unshift('- [2099-01-01 10:00] **Inserted** — A different instruction <!-- kind:directive, id:inserted -->');
  await memory.writeMemory(a, reordered);
  const moved = await notebook.readNotebook({ key: a });
  assert.notEqual(moved.records.find(item => item.ref === 'id:old').fingerprint, legacyFingerprint);
  assert.equal(moved.records.find(item => item.ref === 'legacy:5').fingerprint, legacyFingerprint, 'legacy positional navigation can reject a stale ref instead of opening another instruction');
  // Colliding legacy filenames are explicitly omitted.
  const { upsertIdentity } = await import('../../mcp-server/identity.js');
  for (const key of ['same/path', 'same_path']) await upsertIdentity(await getDatabase(), { key, name: key, primaryRemote: key });
  preview = await previewPersonaContext({ key: a }); assert.equal(preview.unavailable.length, 2); assert.equal(preview.partial, true);
  await assert.rejects(previewPersonaContext({ key: 'same/path' }), { code: 'UNSUPPORTED' });
  assert.equal(networkCalls, 0); assert.equal((await getDatabase()).cloudClient, null);
  globalThis.fetch = originalFetch;
  app = await startDashboard();
  const headers = { Authorization: `Bearer ${new URL(app.url).hash.slice(1)}` };
  const path = `/api/persona?key=${encodeURIComponent(a)}&client=opencode`;
  assert.equal((await fetch(app.origin + path)).status, 401);
  assert.equal((await fetch(app.origin + path, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  for (const query of ['key=global&client=unknown', 'key=global&client=codex&client=opencode', 'key=global&key=global', 'key=global&extra=x', 'client=opencode']) {
    assert.equal((await fetch(`${app.origin}/api/persona?${query}`, { headers })).status, 400);
  }
  const response = await fetch(app.origin + path, { headers }); assert.equal(response.status, 200);
  assert.equal((await response.json()).unavailable.length, 2);
  assert.equal((await fetch(app.origin + '/persona.js')).status, 200);
  updateConfig({ legacyCloudRestoreRequired: true });
  await assert.rejects(previewPersonaContext({ key: a }), { code: 'MIGRATION_REQUIRED' });
  console.log('PASS persona preview: real V1/V2 builders, exact scopes/IDs, exclusions, legacy/keep/TTL, client limits, refresh, omissions, readonly/auth and migration guard.');
} finally {
  globalThis.fetch = originalFetch;
  if (app) await app.close(); closeDatabase();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
