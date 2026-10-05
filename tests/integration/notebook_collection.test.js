import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'memory-notebook-collection-'));
process.env.MEMORY_DIR = join(root, 'memory');
process.env.OPENCODE_CONFIG_DIR = join(root, 'opencode');
process.env.MEMORY_DISABLE_PERSONA_SYNC = '1';
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = '1';
process.env.MEMORY_DISABLE_WEB_AUTOSTART = '1';
const memory = await import('../../mcp-server/memory.js');
const service = await import('../../mcp-server/services/notebook_service.js');
const core = await import('../../mcp-server/tools/core/memory_core.js');
const { getDatabase, closeDatabase } = await import('../../mcp-server/db/database.js');
const { buildPersonaOverlayBlock } = await import('../../mcp-server/prompt_manager.js');
const { partitionMemoryEntries } = await import('../../opencode-plugin/index.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
const { ingestDocument } = await import('../../mcp-server/ingest/pipeline.js');
const { migrateKnowledge, manageKnowledgeLinks } = await import('../../mcp-server/services/knowledge_links_service.js');
let app;
try {
  const a = 'git:example.test/notebook/a', b = 'git:example.test/notebook/b';
  const line = '- [2026-10-01 10:00] **Old rule** — Preserve sources <!-- id:same, tags:style, keep:1 -->';
  for (const key of ['global', a, b]) await memory.writeMemory(key, [line]);
  const doc = await ingestDocument({ path: 'evidence.md', content: '# Evidence\n\nSaved original evidence.', title: 'Evidence', projectScope: a, generateEmbeddings: false });
  await migrateKnowledge();
  const linkInput = { operation: 'create', scopeKey: a, fields: { factRef: 'id:same', docId: doc.docId, relationType: 'SUPPORTS' } };
  const preview = await manageKnowledgeLinks({ ...linkInput, action: 'preview' });
  await manageKnowledgeLinks({ ...linkInput, action: 'apply', previewToken: preview.previewToken });
  const collection = await service.readNotebookCollection();
  assert.equal(collection.readOnly, true);
  assert.equal(collection.records.length, 3);
  assert.equal(new Set(collection.records.map(record => record.ref)).size, 3, 'same ID remains distinct across stores');
  assert.deepEqual(collection.unavailable, []);
  assert.equal(collection.records.find(record => record.sourceKey === a).sourceRef, 'id:same');
  assert.equal(collection.records.find(record => record.sourceKey === a).links.length, 1);
  await assert.rejects(service.mutateNotebook({ key: '__all__', action: 'delete', ref: 'id:same' }), { code: 'NOT_FOUND' });
  const old = await service.readNotebook({ key: a });
  const fields = { title: 'New rule', body: 'Preserve sources and versions', kind: 'directive', tags: 'style', keep: true, ttl: '90d' };
  const request = { key: a, expectedVersion: old.version, ref: 'id:same', action: 'supersede', fields };
  await assert.rejects(service.mutateNotebook({ ...request, fields: { ...fields, body: 'Preserve sources' } }), { code: 'INVALID' });
  assert.equal((await service.readNotebook({ key: a })).version, old.version, 'invalid replacement writes nothing');
  const saved = await service.mutateNotebook(request);
  const previous = saved.notebook.records.find(record => record.id === 'same');
  const current = saved.notebook.records.find(record => record.ref === saved.ref);
  assert.ok(current.id && current.id !== 'same');
  assert.equal(previous.meta.supersededBy, current.id);
  assert.equal(current.meta.supersedes, 'same');
  assert.equal(previous.body, 'Preserve sources');
  assert.equal(previous.meta.keep, '1');
  assert.equal(previous.links.length, 1, 'source links stay on the preserved original');
  assert.equal(previous.links[0].status, 'valid');
  assert.equal(current.links.length, 0, 'new assertion does not inherit evidence');
  assert.equal(current.meta.ttl, '90d');
  assert.equal(current.date, memory.today().split(' ')[0], 'replacement starts a fresh TTL');
  for (const action of ['create', 'supersede']) await assert.rejects(service.mutateNotebook({
    key: a, expectedVersion: saved.notebook.version, ref: current.ref, action,
    fields: { ...fields, body: 'Preserve sources' },
  }), { code: 'INVALID' }, 'history participates in deduplication just as in MCP remember');
  for (const key of ['global', b]) assert.deepEqual(await memory.readMemory(key), [line], 'other stores untouched');
  const entries = await memory.readMemory(a);
  const overlay = buildPersonaOverlayBlock(entries);
  assert.match(overlay, /Preserve sources and versions/);
  assert.doesNotMatch(overlay, /Old rule/);
  assert.equal(partitionMemoryEntries(entries).directives.length, 1);
  assert.match(await core.getFactById({ scope: 'project', project: a, id: current.id }), /Preserve sources and versions/);
  assert.match(await core.recallFacts({ scope: 'project', project: a }), /Preserve sources and versions/);
  await assert.rejects(service.mutateNotebook(request), { code: 'CONFLICT' });
  await assert.rejects(service.mutateNotebook({ ...request, expectedVersion: saved.notebook.version }), { code: 'CONFLICT' });
  assert.equal((await service.readNotebook({ key: a })).records.length, 2, 'cannot replace an already replaced target');

  // Legacy target gets a stable ID in the same write as its replacement.
  const legacy = 'legacy-notebook';
  // Simulate an unmigrated file arriving from an older client, after K2.
  writeFileSync(memory.storeFilePath(legacy), memory.buildMemoryContent(legacy, ['- [2026-10-01 10:00] **Legacy** — Old legacy body']));
  const legacyDoc = await service.readNotebook({ key: legacy });
  const replaced = await service.mutateNotebook({ key: legacy, expectedVersion: legacyDoc.version, ref: 'legacy:0', action: 'supersede', fields: { title: 'New legacy', body: 'New legacy body', kind: 'fact' } });
  assert.equal(replaced.notebook.records[1].meta.supersedes, replaced.notebook.records[0].id);
  assert.equal(replaced.notebook.records[0].meta.supersededBy, replaced.notebook.records[1].id);

  // Ambiguous filenames are reported as omissions, never silently combined.
  await memory.writeMemory('ambiguous:key', ['- [2026-10-01 10:00] **Conflict** — Ambiguous storage']);
  await (await getDatabase()).prepare('INSERT INTO document_scopes (doc_id, scope_key, created_at) VALUES (?, ?, ?)').run(doc.docId, 'ambiguous/key', new Date().toISOString());
  const partial = await service.readNotebookCollection();
  assert.equal(partial.unavailable.length, 2);
  assert.ok(!partial.records.some(record => record.sourceKey.startsWith('ambiguous')));

  app = await startDashboard();
  const headers = { Authorization: `Bearer ${new URL(app.url).hash.slice(1)}` };
  assert.equal((await fetch(app.origin + '/api/notebooks')).status, 401);
  assert.equal((await fetch(app.origin + '/api/notebooks', { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(app.origin + '/api/notebooks?key=global', { headers })).status, 400);
  const response = await fetch(app.origin + '/api/notebooks', { headers });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).unavailable.length, 2);
  assert.equal((await fetch(app.origin + '/notebook_filters.js')).status, 200);
  const currentDoc = await service.readNotebook({ key: b });
  const posted = await fetch(app.origin + '/api/notebook', { method: 'POST', headers: { ...headers, Origin: app.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: b, ref: 'id:same', expectedVersion: currentDoc.version, action: 'supersede', fields: { title: 'HTTP replacement', body: 'HTTP fresh rule', kind: 'directive' } }) });
  assert.equal(posted.status, 200);
  assert.equal((await posted.json()).notebook.records.length, 2);
  assert.equal((await getDatabase()).cloudClient, null, 'collection and replacement remain local');
  console.log('PASS Notebook collection/replacement: exact ownership, legacy IDs, conflicts, links, active context, MCP/HTTP, omissions and local-only reads.');
} finally {
  if (app) await app.close();
  closeDatabase();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
