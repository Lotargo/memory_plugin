import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'memory-notebook-tui-'));
// All client targets, including clients resolved from the home directory, are fixtures.
Object.assign(process.env, { HOME: root, USERPROFILE: root, MEMORY_DIR: join(root, 'memory'),
  XDG_CONFIG_HOME: join(root, 'config'), OPENCODE_CONFIG_DIR: join(root, 'opencode'),
  CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude'),
  MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_DISABLE_WEB_AUTOSTART: '1' });
const { browseNotebookFacts } = await import('../../mcp-server/cli/notebook.js');
const memory = await import('../../mcp-server/memory.js');
const { readNotebook } = await import('../../mcp-server/services/notebook_service.js');
const { getDatabase, closeDatabase } = await import('../../mcp-server/db/database.js');
const { ingestDocument } = await import('../../mcp-server/ingest/pipeline.js');
const { migrateKnowledge, manageKnowledgeLinks } = await import('../../mcp-server/services/knowledge_links_service.js');
const core = await import('../../mcp-server/tools/core/memory_core.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');

// Drive the real adapter's menus/prompts; service and SQL operations are real.
async function run(key, selections, answers = [], beforePrompt, beforeMenu) {
  const logs = [], prompts = [], menus = [];
  await browseNotebookFacts(key, 'Test scope', {
    clear() {}, log(message) { logs.push(message); }, async waitForEnter() {},
    async selectSimpleMenu(menu) {
      menus.push(menu);
      if (beforeMenu) await beforeMenu(menu, menus.length);
      assert.ok(selections.length, 'unexpected menu; adapter must finish or return');
      const value = selections.shift();
      assert.ok(menu.items.some(item => item.value === value), `choice ${value} must be visible`);
      return { action: 'select', value };
    },
    async promptText(question) {
      prompts.push(question);
      if (beforePrompt) await beforePrompt(question, prompts.length);
      assert.ok(answers.length, 'unexpected prompt');
      return answers.shift();
    },
  });
  assert.equal(selections.length, 0);
  assert.equal(answers.length, 0);
  return { text: logs.join('\n'), prompts, menus };
}
let app;
try {
  const a = 'git:example.test/tui/a', b = 'git:example.test/tui/b';
  const line = '- [2026-10-01 10:00] **Original** — Scoped original body <!-- id:same, ttl:90d, keep:1, tags:test, inject:always, kind:fact -->';
  for (const key of ['global', a, b]) await memory.writeMemory(key, [line]);
  const doc = await ingestDocument({ path: 'evidence.md', content: '# Evidence\n\nSupporting saved source.',
    title: 'TUI evidence', projectScope: a, generateEmbeddings: false });
  const db = await getDatabase(), sql = db.localDb;
  sql.prepare('INSERT INTO knowledge_links (id,fact_key,fact_text,doc_id,relation_type,created_at) VALUES (?,?,?,?,?,?)')
    .run('legacy-link', a, 'Scoped original body', doc.docId, 'SUPPORTS', Date.now());

  // Unmigrated links must not be edited/deleted outside the shared guard.
  let output = await run(a, ['id:same', 'update', 'back'], ['', 'Legacy unsafe edit']);
  assert.match(output.text, /\[UNSUPPORTED\].*source links/s);
  assert.doesNotMatch(output.text, /\[OK\]/);
  assert.deepEqual(await memory.readMemory(a), [line]);
  output = await run(a, ['id:same', 'delete', 'back'], ['yes', 'yes']);
  assert.match(output.text, /\[UNSUPPORTED\]/);
  assert.equal(sql.prepare('SELECT fact_text FROM knowledge_links').get().fact_text, 'Scoped original body');
  await run(a, ['id:same', 'unprotect', 'back']);
  assert.equal((await readNotebook({ key: a })).records[0].meta.keep, undefined);
  await run(a, ['id:same', 'protect', 'back']);
  assert.deepEqual(await memory.readMemory(a), [line]);

  await migrateKnowledge();
  const fields = { factRef: 'id:same', docId: doc.docId, relationType: 'SUPPORTS' };
  async function changeLink(relationType) {
    const request = { operation: 'update', scopeKey: a, linkId: 'legacy-link', fields: { ...fields, relationType } };
    const preview = await manageKnowledgeLinks({ ...request, action: 'preview' });
    return manageKnowledgeLinks({ ...request, action: 'apply', previewToken: preview.previewToken });
  }
  await changeLink('SUPPORTS');
  // An audit trigger catches duplicated link writes, even if the final text matches.
  sql.exec(`CREATE TABLE tui_link_audit (id TEXT);
    CREATE TRIGGER tui_link_audit_trigger AFTER UPDATE OF fact_text ON knowledge_links
    BEGIN INSERT INTO tui_link_audit VALUES (NEW.id); END;`);
  output = await run(a, ['id:same', 'update', 'back'], ['Edited title', 'Edited scoped body']);
  assert.match(output.text, /\[OK\]/);
  const edited = (await readNotebook({ key: a })).records[0];
  assert.equal(edited.title, 'Edited title'); assert.equal(edited.body, 'Edited scoped body');
  assert.equal(edited.date, '2026-10-01'); assert.equal(edited.time, '10:00');
  assert.equal(edited.meta.keep, '1'); assert.equal(edited.meta.ttl, '90d');
  assert.equal(edited.meta.tags, 'test'); assert.equal(edited.meta.inject, 'always');
  assert.equal(edited.links[0].status, 'valid');
  assert.equal(sql.prepare('SELECT fact_text FROM knowledge_links WHERE id=?').get('legacy-link').fact_text, edited.body);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM tui_link_audit').get().n, 1, 'one shared link write');
  for (const key of ['global', b]) assert.deepEqual(await memory.readMemory(key), [line], 'same IDs in other stores untouched');
  assert.match(await core.getFactById({ scope: 'project', project: a, id: 'same' }), /Edited scoped body/);
  app = await startDashboard();
  const response = await fetch(`${app.origin}/api/notebook?key=${encodeURIComponent(a)}`, {
    headers: { Authorization: `Bearer ${new URL(app.url).hash.slice(1)}` },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).records[0].body, edited.body, 'dashboard reads the TUI change');

  await run(a, ['id:same', 'unprotect', 'back']);
  await run(a, ['id:same', 'protect', 'back']);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM tui_link_audit').get().n, 1, 'metadata edits do not rewrite source links');
  output = await run(a, ['id:same', 'delete', 'back'], ['']);
  assert.equal(output.prompts.length, 1); assert.doesNotMatch(output.text, /\[OK\]/);
  output = await run(a, ['id:same', 'delete', 'back'], ['yes', 'no']);
  assert.equal(output.prompts.length, 2); assert.doesNotMatch(output.text, /\[OK\]/);
  assert.equal((await readNotebook({ key: a })).records.length, 1);

  // MCP can change the record while a TUI editor is open; no stale auto-retry.
  output = await run(a, ['id:same', 'update', 'back'], ['', 'Stale TUI edit'], async (_, count) => {
    if (count === 1) await core.updateFactText({ scope: 'project', project: a, id: 'same', newText: 'MCP concurrent edit' });
  });
  assert.match(output.text, /\[CONFLICT\]/); assert.doesNotMatch(output.text, /\[OK\]/);
  assert.equal((await readNotebook({ key: a })).records[0].body, 'MCP concurrent edit');

  // Version includes links, even when Notebook bytes have not changed.
  const beforeLinkChange = await memory.readMemory(a);
  output = await run(a, ['id:same', 'update', 'back'], ['', 'Stale after link edit'], async (_, count) => {
    if (count === 1) await changeLink('REFERS_TO');
  });
  assert.match(output.text, /\[CONFLICT\]/);
  assert.deepEqual(await memory.readMemory(a), beforeLinkChange);

  // A metadata action must use the displayed snapshot too, not a fresh version.
  output = await run(a, ['id:same', 'unprotect', 'back'], [], null, async (_, count) => {
    if (count === 2) await changeLink('REFERS_TO');
  });
  assert.match(output.text, /\[CONFLICT\]/);
  assert.equal((await readNotebook({ key: a })).records[0].meta.keep, '1');
  assert.deepEqual(await memory.readMemory(a), beforeLinkChange);
  output = await run(a, ['id:same', 'delete', 'back'], ['yes', 'yes'], async (_, count) => {
    if (count === 2) await changeLink('SUPPORTS');
  });
  assert.match(output.text, /\[CONFLICT\]/);
  assert.deepEqual(await memory.readMemory(a), beforeLinkChange);

  // A SQL failure must roll back the linked write and cannot become OK.
  sql.exec(`CREATE TRIGGER tui_fail_link BEFORE UPDATE OF fact_text ON knowledge_links
    BEGIN SELECT RAISE(ABORT, 'TUI injected link failure'); END;`);
  const beforeFailure = await readNotebook({ key: a });
  output = await run(a, ['id:same', 'update', 'back'], ['', 'Fail this linked write']);
  assert.match(output.text, /TUI injected link failure/); assert.doesNotMatch(output.text, /\[OK\]/);
  assert.equal((await readNotebook({ key: a })).version, beforeFailure.version);
  assert.equal(existsSync(join(memory.MEMORY_DIR, '.knowledge-journal.json')), false);
  sql.exec('DROP TRIGGER tui_fail_link');

  // ID-less legacy rows must not shift the editor onto a neighbour.
  const legacy = 'legacy-tui';
  const legacyLine = '- [2026-10-01 10:00] **Legacy** — Untitled ID-less original';
  writeFileSync(memory.storeFilePath(legacy), memory.buildMemoryContent(legacy, [legacyLine]));
  output = await run(legacy, ['legacy:0', 'update', 'back'], ['', 'Wrong shifted row'], async (_, count) => {
    if (count === 1) writeFileSync(memory.storeFilePath(legacy), memory.buildMemoryContent(legacy,
      ['- [2026-10-01 10:00] **Inserted** — Concurrent row', legacyLine]));
  });
  assert.match(output.text, /\[CONFLICT\]/);
  assert.equal((await memory.readMemory(legacy))[1], legacyLine);
  output = await run(legacy, ['legacy:1', 'update', 'back'], ['', 'Legacy safely edited']);
  assert.match(output.text, /\[OK\]/);
  assert.ok((await readNotebook({ key: legacy })).records[1].id);
  assert.equal((await readNotebook({ key: legacy })).records[1].body, 'Legacy safely edited');

  // Read guards and invalid input remain visible and do not create a store.
  output = await run(null, []); assert.match(output.text, /no Git project/);
  output = await run('unknown-tui-store', []); assert.match(output.text, /\[NOT_FOUND\]/);
  output = await run(b, ['id:same', 'update', 'back'], ['', 'Invalid <!-- id:evil -->']);
  assert.match(output.text, /\[INVALID\]/);
  assert.deepEqual(await memory.readMemory(b), [line]);

  // Actual client-file failure produces partial success, while Notebook is saved.
  delete process.env.MEMORY_DISABLE_PERSONA_SYNC;
  mkdirSync(join(root, 'codex', 'AGENTS.md'), { recursive: true });
  await memory.writeMemory('global', ['- [2026-10-01 10:00] **Directive** — Original instruction <!-- id:same, kind:directive -->']);
  output = await run('global', ['id:same', 'update', 'back'], ['', 'Updated instruction']);
  assert.match(output.text, /\[PARTIAL\]/); assert.match(output.text, /Codex/);
  assert.doesNotMatch(output.text, /\[OK\]/);
  assert.match(output.text, /Existing agent sessions may retain old context/);
  assert.equal((await readNotebook({ key: 'global' })).records[0].body, 'Updated instruction');
  process.env.MEMORY_DISABLE_PERSONA_SYNC = '1';

  output = await run(a, ['id:same', 'delete'], ['yes', 'yes']);
  assert.match(output.text, /\[OK\]/);
  assert.equal((await readNotebook({ key: a })).records.length, 0);
  assert.equal(sql.prepare('SELECT id FROM knowledge_links WHERE id=?').get('legacy-link'), undefined);
  assert.ok(sql.prepare('SELECT id FROM documents WHERE id=?').get(doc.docId), 'deletion retains the source document');
  assert.deepEqual(await memory.readMemory(b), [line]);
  assert.equal(db.cloudClient, null);
  console.log('PASS TUI Notebook: shared CRUD/metadata, scoped IDs, source links, confirmations, MCP/HTTP readback, stale record/link/legacy conflicts, SQL rollback and actual persona partial failure.');
} finally {
  if (app) await app.close();
  closeDatabase();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
