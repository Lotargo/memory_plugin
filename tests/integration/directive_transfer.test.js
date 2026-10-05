import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const root = fs.mkdtempSync(join(tmpdir(), 'memory-directive-transfer-'));
Object.assign(process.env, { HOME: root, USERPROFILE: root, MEMORY_DIR: join(root, 'memory'),
  XDG_CONFIG_HOME: join(root, 'config'), OPENCODE_CONFIG_DIR: join(root, 'opencode'),
  CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude'),
  MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_DISABLE_WEB_AUTOSTART: '1' });
const memory = await import('../../mcp-server/memory.js');
const { directiveTransferRequest: transfer } = await import('../../mcp-server/services/directive_transfer_service.js');
const { readNotebook } = await import('../../mcp-server/services/notebook_service.js');
const { getDatabase, closeDatabase } = await import('../../mcp-server/db/database.js');
const { migrateKnowledge, manageKnowledgeLinks } = await import('../../mcp-server/services/knowledge_links_service.js');
const { ingestDocument } = await import('../../mcp-server/ingest/pipeline.js');
const { factMeta } = await import('../../mcp-server/fact_format.js');
const { factNode } = await import('../../mcp-server/storage/knowledge_schema.js');
const { recallFacts } = await import('../../mcp-server/tools/core/memory_core.js');
const { CloudSnapshots } = await import('../../mcp-server/admin/cloud_snapshots.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
const line = (title, body, id, meta = 'kind:directive') => `- [2026-10-01 10:00] **${title}** — ${body} <!-- id:${id}, ${meta} -->`;
let app;
const nativeFetch = globalThis.fetch; let network = 0;
async function input(sourceKey, targetKey, ref, extra = {}) {
  return { sourceKey, targetKey, ref, expectedSourceVersion: (await readNotebook({ key: sourceKey })).version,
    expectedTargetVersion: (await readNotebook({ key: targetKey })).version, ...extra };
}
async function apply(request, options) {
  const preview = await transfer({ ...request, action: 'preview' });
  assert.equal(preview.canApply, true, JSON.stringify(preview.conflicts));
  return transfer({ ...request, action: 'apply', previewToken: preview.previewToken, confirm: true, confirmShare: true }, options);
}
try {
  globalThis.fetch = async () => { network++; throw new Error('Network forbidden'); };
  const a = 'git:example.test/transfer/a', b = 'git:example.test/transfer/b', c = 'git:example.test/transfer/c';
  const rule = line('Directive', 'Preserve scoped evidence', 'same', 'ttl:90d, keep:1, tags:style, inject:always, kind:directive, disabled:1');
  await memory.writeMemory(a, [rule, line('Unrelated', 'Leave source neighbour', 'neighbour', 'kind:fact')]);
  await memory.writeMemory(b, [line('Target', 'Existing target fact', 'same', 'kind:fact')]);
  await memory.writeMemory(c, [line('Other', 'Unrelated other project', 'same')]);
  await memory.writeMemory('global', [line('Global', 'Global instruction unchanged', 'global')]);
  const db = await getDatabase(), sql = db.localDb;
  let request = await input(a, b, 'id:same');
  await assert.rejects(transfer({ ...request, action: 'preview' }), { code: 'MIGRATION_REQUIRED' });
  const doc = await ingestDocument({ content: '# Evidence\n\nSaved lines for this rule.', path: 'transfer-evidence', title: 'Shared evidence', projectScope: a, generateEmbeddings: false });
  sql.prepare('INSERT INTO document_scopes (doc_id,scope_key,created_at) VALUES (?,?,?)').run(doc.docId, c, Date.now());
  await migrateKnowledge();
  const linkRequest = { scopeKey: a, operation: 'create', fields: { factRef: 'id:same', docId: doc.docId, startLine: 3, endLine: 3, relationType: 'SUPPORTS' } };
  const linkPreview = await manageKnowledgeLinks({ ...linkRequest, action: 'preview' });
  const link = await manageKnowledgeLinks({ ...linkRequest, action: 'apply', previewToken: linkPreview.previewToken });
  const legacyNode = `fact:${a}:${'**Directive** — Preserve scoped evidence'.slice(0, 30)}`;
  sql.prepare('INSERT INTO graph_edges (source_id,target_id,relation_type,metadata_json,created_at) VALUES (?,?,?,?,?)')
    .run(legacyNode, `${doc.docId}:L3-3`, 'SUPPORTS', JSON.stringify({ linkId: link.linkId }), Date.now());
  const beforeA = fs.readFileSync(memory.storeFilePath(a), 'utf8'), beforeB = fs.readFileSync(memory.storeFilePath(b), 'utf8');
  const beforeC = fs.readFileSync(memory.storeFilePath(c), 'utf8');
  request = await input(a, b, 'id:same');
  let preview = await transfer({ ...request, action: 'preview' });
  assert.equal(preview.canApply, false);
  assert.ok(preview.conflicts.some(item => item.reason === 'source-not-visible-in-target'));
  assert.equal(preview.idChange.changed, true);
  assert.equal(fs.readFileSync(memory.storeFilePath(a), 'utf8'), beforeA, 'preview writes no Notebook');
  assert.equal((await new CloudSnapshots().list({ location: 'local' })).filter(item => item.source === 'directive-before-transfer').length, 0);
  request.shareSources = true; preview = await transfer({ ...request, action: 'preview' });
  assert.equal(preview.canApply, true); assert.equal(preview.sources[0].addScope, b);
  assert.notEqual(preview.idChange.to, 'same');
  assert.equal((await transfer({ ...request, action: 'preview' })).previewToken, preview.previewToken, 'deterministic reviewed ID');
  await assert.rejects(transfer({ ...request, action: 'apply', previewToken: preview.previewToken }), { code: 'CONFIRMATION' });
  await assert.rejects(transfer({ ...request, action: 'apply', previewToken: preview.previewToken, confirm: true }), { code: 'CONFIRMATION' });
  await assert.rejects(transfer({ ...request, shareSources: false, action: 'apply', previewToken: preview.previewToken, confirm: true }), { code: 'CONFLICT' });
  // A source revision change without altered Notebook bytes invalidates approval.
  sql.prepare('UPDATE documents SET title=? WHERE id=?').run('Changed evidence title', doc.docId);
  await assert.rejects(transfer({ ...request, action: 'apply', previewToken: preview.previewToken, confirm: true, confirmShare: true }), { code: 'CONFLICT' });
  assert.equal(fs.readFileSync(memory.storeFilePath(a), 'utf8'), beforeA);
  request = await input(a, b, 'id:same', { shareSources: true });
  preview = await transfer({ ...request, action: 'preview' });
  const result = await transfer({ ...request, action: 'apply', previewToken: preview.previewToken, confirm: true, confirmShare: true });
  assert.equal(result.status, 'saved'); assert.ok(fs.existsSync(result.backup));
  const loaded = await new CloudSnapshots().load(result.backupId, 'local');
  assert.ok(loaded.payload.notebooks.some(item => item.file === memory.memoryFileName(a) && item.content === beforeA));
  assert.ok(loaded.payload.notebooks.some(item => item.file === memory.memoryFileName(b) && item.content === beforeB));
  assert.equal((await readNotebook({ key: a })).records.length, 1);
  const moved = (await readNotebook({ key: b })).records.find(item => item.ref === result.ref);
  assert.equal(moved.date, '2026-10-01'); assert.equal(moved.time, '10:00');
  assert.deepEqual(moved.meta, { ...factMeta(rule), id: preview.idChange.to });
  assert.equal(moved.links[0].status, 'valid'); assert.equal(moved.links[0].startLine, 3);
  assert.equal(sql.prepare('SELECT fact_key FROM knowledge_links WHERE id=?').get(link.linkId).fact_key, b);
  assert.deepEqual(sql.prepare('SELECT scope_key FROM document_scopes WHERE doc_id=? ORDER BY scope_key').all(doc.docId).map(item => item.scope_key), [a, b, c]);
  assert.ok(sql.prepare('SELECT source_id FROM graph_edges WHERE source_id=?').get(factNode(b, moved.id)));
  assert.equal(sql.prepare('SELECT source_id FROM graph_edges WHERE source_id=?').get(factNode(a, 'same')), undefined);
  assert.equal(sql.prepare('SELECT source_id FROM graph_edges WHERE source_id=?').get(legacyNode), undefined, 'owned legacy title/body projection removed');
  assert.equal(fs.readFileSync(memory.storeFilePath(c), 'utf8'), beforeC);
  assert.match(await recallFacts({ scope: 'project', project: b }), /Preserve scoped evidence/);
  await assert.rejects(transfer({ ...request, action: 'apply', previewToken: preview.previewToken, confirm: true, confirmShare: true }), { code: 'CONFLICT' }, 'no automatic replay onto another row');
  await assert.rejects(transfer({ ...await input(a, b, 'id:neighbour'), action: 'preview' }), { code: 'UNSUPPORTED' }, 'ordinary facts excluded');

  const d = 'git:example.test/transfer/conflicts';
  await memory.writeMemory(d, [line('Duplicate', 'preserve scoped evidence', 'dupe'), line('History', 'History rule', 'history', 'kind:directive, supersededBy:next')]);
  preview = await transfer({ ...await input(b, d, result.ref), action: 'preview' });
  assert.ok(preview.conflicts.some(item => item.reason === 'duplicate-body'));
  preview = await transfer({ ...await input(d, a, 'id:history'), action: 'preview' });
  assert.ok(preview.conflicts.some(item => item.reason === 'replacement-history'));
  // Incoming source history references also block a split.
  await memory.writeMemory(d, [...await memory.readMemory(d), line('Referenced', 'Referenced rule', 'next')]);
  preview = await transfer({ ...await input(d, a, 'id:next'), action: 'preview' });
  assert.ok(preview.conflicts.some(item => item.reason === 'replacement-history'));
  sql.prepare('INSERT INTO graph_edges (source_id,target_id,relation_type,metadata_json,created_at) VALUES (?,?,?,?,?)').run(factNode(d, 'dupe'), 'manual-node', 'CUSTOM', '{}', Date.now());
  preview = await transfer({ ...await input(d, a, 'id:dupe'), action: 'preview' });
  assert.ok(preview.conflicts.some(item => item.reason === 'independent-graph-edges'));

  // Target/source/link changes: no file or SQL mutation from a stale apply.
  const fresh = 'git:example.test/transfer/fresh';
  await memory.writeMemory(fresh, [line('Fresh', 'Standalone fresh directive', 'fresh')]);
  request = await input(fresh, a, 'id:fresh'); preview = await transfer({ ...request, action: 'preview' });
  await memory.writeMemory(a, [...await memory.readMemory(a), line('Concurrent', 'Concurrent target insertion', 'insert')]);
  await assert.rejects(transfer({ ...request, action: 'apply', previewToken: preview.previewToken, confirm: true }), { code: 'CONFLICT' });
  request = await input(b, a, result.ref); preview = await transfer({ ...request, action: 'preview' });
  sql.prepare('UPDATE knowledge_links SET relation_type=? WHERE id=?').run('REFERS_TO', link.linkId);
  await assert.rejects(transfer({ ...request, action: 'apply', previewToken: preview.previewToken, confirm: true }), { code: 'CONFLICT' });

  // Late legacy rows retain metadata and are addressed by their scoped position.
  const legacy = 'legacy-directive-transfer';
  const legacyLine = '- [2026-10-01 10:00] **Legacy rule** — Legacy body <!-- tags:persona, keep:1 -->';
  fs.writeFileSync(memory.storeFilePath(legacy), memory.buildMemoryContent(legacy, [legacyLine]));
  request = await input(legacy, a, 'legacy:0'); preview = await transfer({ ...request, action: 'preview' });
  fs.writeFileSync(memory.storeFilePath(legacy), memory.buildMemoryContent(legacy, [line('New', 'Inserted legacy neighbour', 'new'), legacyLine]));
  await assert.rejects(transfer({ ...request, action: 'apply', previewToken: preview.previewToken, confirm: true }), { code: 'CONFLICT' });
  const legacyMoved = await apply(await input(legacy, a, 'legacy:1'));
  assert.equal((await readNotebook({ key: a })).records.find(item => item.ref === legacyMoved.ref).meta.tags, 'persona');

  // Global transfer previews explicit visibility broadening, never drops prior scopes.
  request = await input(b, 'global', result.ref, { shareSources: true });
  preview = await transfer({ ...request, action: 'preview' });
  assert.equal(preview.sharingGlobal, true);
  assert.equal(preview.sources[0].addScope, 'global');
  assert.equal(preview.canApply, true);
  const globalMoved = await apply(request);
  assert.equal(globalMoved.persona[0].status, 'disabled_by_environment');
  assert.ok((await readNotebook({ key: 'global' })).records.some(item => item.ref === globalMoved.ref));

  // SQL failure before commit rolls back links/scopes and both Notebook files.
  request = await input('global', b, globalMoved.ref); preview = await transfer({ ...request, action: 'preview' });
  const priorGlobal = fs.readFileSync(memory.storeFilePath('global'), 'utf8');
  const priorTarget = fs.readFileSync(memory.storeFilePath(b), 'utf8');
  sql.exec(`CREATE TRIGGER transfer_fail BEFORE UPDATE OF fact_key ON knowledge_links BEGIN SELECT RAISE(ABORT, 'transfer SQL failure'); END;`);
  await assert.rejects(transfer({ ...request, action: 'apply', previewToken: preview.previewToken, confirm: true }), /transfer SQL failure/);
  assert.equal(fs.readFileSync(memory.storeFilePath('global'), 'utf8'), priorGlobal);
  assert.equal(fs.readFileSync(memory.storeFilePath(b), 'utf8'), priorTarget);
  assert.equal(sql.prepare('SELECT fact_key FROM knowledge_links WHERE id=?').get(link.linkId).fact_key, 'global');
  assert.equal(fs.existsSync(join(memory.MEMORY_DIR, '.knowledge-journal.json')), false);
  sql.exec('DROP TRIGGER transfer_fail');

  // A real process exit after SQL commit/one file publication recovers both files.
  for (const publishFirst of [false, true]) {
    const recoveryKey = `recovery-transfer-${publishFirst}`;
    await memory.writeMemory(recoveryKey, [line('Recovery', `Recovery directive ${publishFirst}`, 'recover')]);
    request = await input(recoveryKey, a, 'id:recover'); preview = await transfer({ ...request, action: 'preview' });
    const serviceUrl = new URL('../../mcp-server/services/directive_transfer_service.js', import.meta.url).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs'; import path from 'node:path';
      const { directiveTransferRequest } = await import(${JSON.stringify(serviceUrl)});
      await directiveTransferRequest(${JSON.stringify({ ...request, action: 'apply', previewToken: preview.previewToken, confirm: true })}, {afterCommit(){
        if (${publishFirst}) { const journal = JSON.parse(fs.readFileSync(path.join(process.env.MEMORY_DIR,'.knowledge-journal.json'))); fs.writeFileSync(path.join(process.env.MEMORY_DIR,journal.files[0].file),journal.files[0].content); }
        process.exit(73);
      }});`], { encoding: 'utf8', env: process.env });
    assert.equal(child.status, 73, child.stderr);
    assert.ok(fs.existsSync(join(memory.MEMORY_DIR, '.knowledge-journal.json')));
    assert.equal((await readNotebook({ key: recoveryKey })).records.length, 0);
    assert.ok((await readNotebook({ key: a })).records.some(item => item.body === `Recovery directive ${publishFirst}`));
    assert.equal(fs.existsSync(join(memory.MEMORY_DIR, '.knowledge-journal.json')), false);
  }

  // Actual persona client-file failure is a partial result after the move.
  await memory.writeMemory(fresh, [line('Partial', 'Partial transfer instruction', 'partial')]);
  fs.mkdirSync(join(root, 'codex', 'AGENTS.md'), { recursive: true });
  delete process.env.MEMORY_DISABLE_PERSONA_SYNC;
  const partial = await apply(await input(fresh, 'global', 'id:partial'));
  assert.equal(partial.status, 'partial'); assert.ok(partial.persona.some(item => item.status === 'failed'));
  assert.equal((await readNotebook({ key: fresh })).records.length, 0);
  process.env.MEMORY_DISABLE_PERSONA_SYNC = '1';

  for (const bad of [{ action: 'targets', extra: 1 }, { action: 'preview' }, { ...request, action: 'preview', confirm: 'yes' },
    { ...request, action: 'preview', sourceKey: '__all__' }, { ...request, action: 'preview', targetKey: request.sourceKey }]) {
    await assert.rejects(transfer(bad), error => ['INVALID', 'NOT_FOUND'].includes(error.code));
  }
  assert.equal(network, 0); assert.equal(db.cloudClient, null);
  globalThis.fetch = nativeFetch;
  app = await startDashboard();
  const headers = { Authorization: `Bearer ${new URL(app.url).hash.slice(1)}`, Origin: app.origin, 'Content-Type': 'application/json' };
  const post = (body, customHeaders = headers) => nativeFetch(app.origin + '/api/directive-transfer', { method: 'POST', headers: customHeaders, body: JSON.stringify(body) });
  assert.equal((await post({ action: 'targets' }, {})).status, 401);
  assert.equal((await post({ action: 'targets' }, { ...headers, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ action: 'targets', surprise: true })).status, 400);
  assert.equal((await post({ action: 'targets' })).status, 200);
  assert.equal((await nativeFetch(app.origin + '/directive_transfer.js')).status, 200);
  await memory.writeMemory(fresh, [line('HTTP rule', 'HTTP standalone directive', 'http')]);
  request = await input(fresh, a, 'id:http');
  const httpPreview = await (await post({ ...request, action: 'preview' })).json();
  assert.equal(httpPreview.canApply, true);
  const httpApplied = await post({ ...request, action: 'apply', previewToken: httpPreview.previewToken, confirm: true });
  assert.equal(httpApplied.status, 200);
  assert.equal((await readNotebook({ key: fresh })).records.length, 0);
  // Both installed CLI launchers call the same reviewed service.
  const cliRead = JSON.parse(execFileSync(process.execPath, ['mcp-server/cli_boot.js', 'notebook', 'read', '--key', a], { env: process.env, encoding: 'utf8' }));
  assert.equal(cliRead.version, (await readNotebook({ key: a })).version);
  await memory.writeMemory(fresh, [line('CLI directive', 'CLI reviewed transfer body', 'cli')]);
  request = await input(fresh, b, 'id:cli');
  const cliFlags = ['--source-key', fresh, '--target-key', b, '--ref', request.ref,
    '--source-version', request.expectedSourceVersion, '--target-version', request.expectedTargetVersion];
  const cliPreview = JSON.parse(execFileSync(process.execPath, ['mcp-server/boot.js', 'notebook', 'transfer', 'preview', ...cliFlags], { env: process.env, encoding: 'utf8' }));
  assert.equal(cliPreview.canApply, true);
  const cliApplied = JSON.parse(execFileSync(process.execPath, ['mcp-server/cli_boot.js', 'notebook', 'transfer', 'apply', ...cliFlags, '--preview-token', cliPreview.previewToken, '--confirm'], { env: process.env, encoding: 'utf8' }));
  assert.equal(cliApplied.status, 'saved');
  assert.equal((await readNotebook({ key: fresh })).records.length, 0);
  assert.ok((await readNotebook({ key: b })).records.some(item => item.body === 'CLI reviewed transfer body'));
  // An external edit after SQL commit must survive a recovery conflict.
  const conflictingRecovery = 'recovery-external-transfer';
  await memory.writeMemory(conflictingRecovery, [line('External recovery', 'External recovery source', 'external')]);
  request = await input(conflictingRecovery, a, 'id:external');
  preview = await transfer({ ...request, action: 'preview' });
  const externalOriginal = fs.readFileSync(memory.storeFilePath(conflictingRecovery), 'utf8');
  await assert.rejects(transfer({ ...request, action: 'apply', previewToken: preview.previewToken, confirm: true }, { afterCommit() {
    fs.writeFileSync(memory.storeFilePath(conflictingRecovery), 'External manual bytes must survive');
    throw new Error('Publication interrupted by test');
  } }), /Publication interrupted/);
  await assert.rejects(readNotebook({ key: a }), { code: 'RECOVERY_REQUIRED' });
  assert.equal(fs.readFileSync(memory.storeFilePath(conflictingRecovery), 'utf8'), 'External manual bytes must survive');
  // Explicit fixture repair, never an automatic product overwrite.
  fs.writeFileSync(memory.storeFilePath(conflictingRecovery), externalOriginal);
  assert.equal((await readNotebook({ key: conflictingRecovery })).records.length, 0);
  const { parseNotebookCommand } = await import('../../mcp-server/cli/notebook_commands.js');
  assert.throws(() => parseNotebookCommand(['transfer', 'preview', '--source-key', a, '--source-key', b]), /Repeated/);
  assert.throws(() => parseNotebookCommand(['transfer', 'apply', '--extra']), /Unknown/);
  assert.throws(() => parseNotebookCommand(['read', '--key']), /requires/);
  console.log('PASS directive transfer: two versions, metadata/legacy IDs, conflicts, scoped links/graph, explicit sharing, verified backups, SQL rollback, process-exit recovery, partial persona sync, HTTP guards and zero network.');
} finally {
  globalThis.fetch = nativeFetch;
  if (app) await app.close(); closeDatabase();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
