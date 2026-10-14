import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(join(tmpdir(), 'memory-project-registration-'));
process.env.MEMORY_DIR = join(root, 'memory');
process.env.OPENCODE_CONFIG_DIR = join(root, 'opencode');
process.env.MEMORY_WEB_STARTUP_DIR = join(root, 'startup');
process.env.MEMORY_DISABLE_PERSONA_SYNC = '1';
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = '1';
process.env.MEMORY_DISABLE_WEB_AUTOSTART = '1';
const memory = await import('../../mcp-server/memory.js');
const { projectRequest, executeProjectOperation } = await import('../../mcp-server/services/project_service.js');
const { getDatabase, closeDatabase, BLOBS_DIR } = await import('../../mcp-server/db/database.js');
const { hasKnowledgeSchema, createKnowledgeSchema, rebuildLinkProjections } = await import('../../mcp-server/storage/knowledge_schema.js');
const { getBlobPath, saveBlob, readBlob } = await import('../../mcp-server/storage/blob_store.js');
const { captureLocal } = await import('../../mcp-server/admin/full_snapshot.js');
const { CloudSnapshots } = await import('../../mcp-server/admin/cloud_snapshots.js');
const { getConfig } = await import('../../mcp-server/config/config_manager.js');
const { factBody } = await import('../../mcp-server/fact_format.js');
const nativeFetch = globalThis.fetch;
const ragTables = ['documents', 'document_scopes', 'sections', 'medium_chunks', 'micro_chunks', 'knowledge_links', 'graph_edges', 'rag_document_tombstones'];
let repo = join(root, 'actual-git');
const key = 'git:example.test/team/registration';
const missingHash = '0'.repeat(64);
const fact = '- [2026-10-15 10:00] **Preserve** — Keep this record <!-- id:preserve, kind:fact -->';
const checkpoints = new CloudSnapshots();
async function apply(input) {
  const preview = await projectRequest({ ...input, action: 'preview' });
  assert.equal(preview.canApply, true, JSON.stringify(preview.conflicts));
  return projectRequest({ ...input, action: 'apply', previewToken: preview.previewToken, confirm: true });
}
try {
  fs.mkdirSync(repo);
  execFileSync('git', ['init', repo], { stdio: 'pipe' });
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://example.test/team/registration.git']);
  let db = await getDatabase(), sql = db.localDb;
  globalThis.fetch = async () => { throw new Error('Network forbidden'); };
  sql.prepare('INSERT INTO documents (id,path,blob_hash,title,checksum,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run('unrelated-doc', 'archived/unrelated', missingHash, 'Unrelated missing source', missingHash, 1, 1);
  sql.prepare('INSERT INTO document_scopes (doc_id,scope_key,created_at) VALUES (?,?,?)')
    .run('unrelated-doc', 'git:example.test/team/other', 1);
  const sourceText = 'Project source survives moving its checkout.';
  const sourcePath = join(repo, 'source.md');
  fs.writeFileSync(sourcePath, sourceText);
  const sourceBlob = await saveBlob(sourceText);
  sql.prepare('INSERT INTO documents (id,path,blob_hash,title,checksum,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run('project-doc', sourcePath, sourceBlob.hash, 'Project source', sourceBlob.hash, 1, 1);
  sql.prepare('INSERT INTO document_scopes (doc_id,scope_key,created_at) VALUES (?,?,?)')
    .run('project-doc', key, 1);
  await memory.writeMemory(key, [fact]);
  sql.prepare('INSERT INTO knowledge_links (id,fact_key,fact_text,doc_id,created_at) VALUES (?,?,?,?,?)')
    .run('project-link', key, factBody(fact), 'project-doc', 1);
  const notebook = fs.readFileSync(memory.storeFilePath(key), 'utf8');
  const ragState = () => JSON.stringify(ragTables.map(table => sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
  const before = ragState();
  assert.equal(hasKnowledgeSchema(sql), false);
  await assert.rejects(checkpoints.capture(), { code: 'ENOENT' });

  // Registration must work even when an unrelated archived source is missing.
  const linked = await executeProjectOperation('link', { directory: repo });
  assert.equal(linked.key, key);
  assert.equal(linked.migrated, false);
  assert.equal(linked.backup, null);
  assert.equal(linked.backupId, null);
  assert.equal(linked.restoreCommand, null);
  assert.equal((await projectRequest({ action: 'inspect', directory: repo })).registered, true);
  assert.equal(hasKnowledgeSchema(sql), false, 'registry changes must not activate the knowledge schema');
  assert.equal(ragState(), before);
  assert.equal(fs.readFileSync(memory.storeFilePath(key), 'utf8'), notebook);
  assert.equal(checkpoints.state().records.length, 0);
  const preview = await projectRequest({ action: 'preview', operation: 'link', directory: repo });
  assert.equal(preview.backupRequired, false);
  await assert.rejects(projectRequest({ action: 'apply', operation: 'link', directory: repo, previewToken: preview.previewToken }), { code: 'CONFIRMATION' });
  // A SQL failure must roll back identity and alias publication together.
  await executeProjectOperation('unlink', { directory: repo, purge: true });
  sql.exec("CREATE TRIGGER reject_registration_alias BEFORE INSERT ON project_aliases BEGIN SELECT RAISE(ABORT, 'registration rejected'); END");
  await assert.rejects(executeProjectOperation('link', { directory: repo }), /registration rejected/);
  assert.equal((await projectRequest({ action: 'inspect', directory: repo })).registered, false);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM project_aliases WHERE identity_key=?').get(key).n, 0);
  sql.exec('DROP TRIGGER reject_registration_alias');

  // Registry-only publication is complete at the SQLite commit even if the
  // process exits before returning; it needs no Notebook recovery journal.
  const serviceUrl = new URL('../../mcp-server/services/project_service.js', import.meta.url).href;
  const p = await projectRequest({ action: 'preview', operation: 'link', directory: repo });
  closeDatabase();
  const exited = spawnSync(process.execPath, ['--input-type=module', '-e', `const {projectRequest}=await import(${JSON.stringify(serviceUrl)});await projectRequest(${JSON.stringify({ action: 'apply', operation: 'link', directory: repo, previewToken: p.previewToken, confirm: true })},{afterCommit(){process.exit(73)}});`], { env: process.env, encoding: 'utf8' });
  assert.equal(exited.status, 73, exited.stderr);
  assert.equal((await projectRequest({ action: 'inspect', directory: repo })).registered, true);
  db = await getDatabase(); sql = db.localDb;
  assert.equal(fs.existsSync(join(memory.MEMORY_DIR, '.knowledge-journal.json')), false);
  assert.equal(hasKnowledgeSchema(sql), false);

  // Compatibility adapters exercise the same service; retries remain safe.
  const calls = new Map();
  const { registerIdentityTools } = await import('../../mcp-server/tools/identity_tools.js');
  registerIdentityTools({ registerTool(name, options, handler) { calls.set(name, handler); } });
  const mcp = await calls.get('link_project_memory')({ directory: repo });
  assert.equal(JSON.parse(mcp.content[0].text).key, key);
  const cli = execFileSync(process.execPath, ['mcp-server/cli_boot.js', 'link', '--dir', repo], { env: process.env, encoding: 'utf8' });
  assert.match(cli, /registration/);
  const { MemoryPlugin } = await import('../../opencode-plugin/index.js');
  const plugin = await MemoryPlugin({ client: {} });
  assert.equal(JSON.parse(await plugin.tool.link_project_memory.execute({ directory: repo })).key, key);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM project_aliases WHERE identity_key=?').get(key).n, 3);
  await apply({ operation: 'unlink', directory: repo });
  assert.equal((await projectRequest({ action: 'inspect', directory: repo })).registered, true);
  await executeProjectOperation('unlink', { directory: repo, purge: true });
  assert.equal(ragState(), before);
  assert.equal(fs.readFileSync(memory.storeFilePath(key), 'utf8'), notebook);
  assert.equal(hasKnowledgeSchema(sql), false);

  // Modern schema and a corrupt blob must have the same registry-only behavior.
  createKnowledgeSchema(sql);
  sql.prepare("UPDATE knowledge_links SET fact_id=?,status='valid',source_revision=1 WHERE id=?")
    .run('preserve', 'project-link');
  rebuildLinkProjections(sql);
  const modernBefore = ragState();
  const blobPath = getBlobPath(missingHash, BLOBS_DIR);
  fs.mkdirSync(join(blobPath, '..'), { recursive: true });
  fs.writeFileSync(blobPath, 'corrupt gzip');
  await executeProjectOperation('link', { directory: repo });
  await executeProjectOperation('unlink', { directory: repo });
  assert.equal(ragState(), modernBefore);
  fs.unlinkSync(blobPath);
  assert.equal(checkpoints.state().records.length, 0);

  // A physical checkout move is a path-alias update, including a directory
  // rename when the Git remote remains the same. Archived content is read by
  // hash from shared storage, independently of the former source-file path.
  function moveCheckout(from, to) {
    for (const directory of [from, to]) {
      const within = relative(resolve(root), resolve(directory));
      assert.ok(within && !within.startsWith('..') && !isAbsolute(within));
    }
    fs.mkdirSync(join(to, '..'), { recursive: true });
    fs.renameSync(from, to);
  }
  await executeProjectOperation('link', { directory: repo });
  const oldRepo = repo;
  repo = join(root, 'relocated', 'renamed-project');
  moveCheckout(oldRepo, repo);
  const afterMove = await executeProjectOperation('link', { directory: repo });
  assert.equal(afterMove.key, key);
  assert.equal(afterMove.migrated, false);
  assert.equal(afterMove.backupId, null);
  assert.equal(await memory.projectKey(null, repo), key);
  const nested = join(repo, 'nested'); fs.mkdirSync(nested);
  await executeProjectOperation('link', { directory: nested });
  assert.equal(await memory.projectKey(null, nested), key);
  assert.equal(fs.readFileSync(memory.storeFilePath(key), 'utf8'), notebook);
  assert.equal(ragState(), modernBefore);
  assert.equal(await readBlob(sourceBlob.hash), sourceText);
  assert.equal(fs.existsSync(sourcePath), false);
  assert.equal(sql.prepare('SELECT identity_key FROM project_aliases WHERE alias=?').get('path:' + memory.canonicalPath(repo)).identity_key, key);
  assert.equal(sql.prepare('SELECT identity_key FROM project_aliases WHERE alias=?').get('path:' + memory.canonicalPath(oldRepo)).identity_key, key, 'retain other paths as history; they may also be valid clones');

  // A repository without remotes keeps its local identity on a directory move
  // that preserves the repository basename, under the existing local-key rule.
  const localBefore = join(root, 'local-before', 'local-repo');
  const localAfter = join(root, 'local-after', 'local-repo');
  fs.mkdirSync(localBefore, { recursive: true });
  execFileSync('git', ['init', localBefore], { stdio: 'pipe' });
  const localKey = (await executeProjectOperation('link', { directory: localBefore })).key;
  await memory.writeMemory(localKey, [fact]);
  moveCheckout(localBefore, localAfter);
  const localLinked = await executeProjectOperation('link', { directory: localAfter });
  assert.equal(localLinked.key, localKey);
  assert.equal(localLinked.backupId, null);
  assert.deepEqual(await memory.readMemory(localKey), [fact]);
  assert.equal(checkpoints.state().records.length, 0);

  // An automatically discovered legacy store is a memory move. Keep its
  // verified full backup mandatory; missing blobs must stop before publication.
  const legacyKey = memory.canonicalPath(repo);
  await memory.writeMemory(legacyKey, [fact.replace('Keep this record', 'Legacy evidence')]);
  const legacyPath = memory.storeFilePath(legacyKey);
  const legacyBytes = fs.readFileSync(legacyPath, 'utf8');
  const move = await projectRequest({ action: 'preview', operation: 'link', directory: repo });
  assert.equal(move.backupRequired, true);
  await assert.rejects(executeProjectOperation('link', { directory: repo }), { code: 'ENOENT' });
  await assert.rejects(apply({ operation: 'migrate', sourceKey: legacyKey, targetKey: key }), { code: 'ENOENT' });
  await assert.rejects(apply({ operation: 'relink', sourceKey: key, targetKey: 'git:example.test/team/target', remote: 'https://example.test/team/target.git' }), { code: 'ENOENT' });
  assert.equal(fs.readFileSync(legacyPath, 'utf8'), legacyBytes);
  assert.equal(fs.readFileSync(memory.storeFilePath(key), 'utf8'), notebook);
  assert.equal(ragState(), modernBefore);
  assert.equal(checkpoints.state().records.length, 0);
  assert.equal(fs.existsSync(join(memory.MEMORY_DIR, '.knowledge-journal.json')), false);
  // Repair the test fixture with exact source bytes; a move now saves a
  // restoreable full checkpoint and preserves the original legacy Notebook.
  const saved = await saveBlob('Unrelated source bytes');
  sql.prepare('UPDATE documents SET blob_hash=?,checksum=? WHERE id=?').run(saved.hash, saved.hash, 'unrelated-doc');
  const migrated = await executeProjectOperation('link', { directory: repo });
  assert.equal(migrated.migrated, true);
  assert.ok(fs.existsSync(migrated.backup));
  const backup = await checkpoints.load(migrated.backupId, 'local');
  assert.equal(backup.payload.notebooks.find(n => n.file === memory.memoryFileName(legacyKey)).content, legacyBytes);
  assert.ok(migrated.restoreCommand.includes(migrated.backupId));
  assert.equal(fs.existsSync(legacyPath), false);
  assert.equal(captureLocal(db, memory.MEMORY_DIR, BLOBS_DIR, getConfig()).blobs[saved.hash], 'Unrelated source bytes');
  console.log('PASS project registration: physical checkout moves, remote/local identities, subdirectories, archived source readback, missing/corrupt unrelated blob, atomic rollback/process exit, CLI/MCP/OpenCode, mandatory verified backup for memory moves.');
} finally {
  globalThis.fetch = nativeFetch;
  closeDatabase();
  const absoluteRoot = fs.realpathSync(root);
  assert.ok(absoluteRoot.startsWith(fs.realpathSync(tmpdir())));
  fs.rmSync(absoluteRoot, { recursive: true, force: true, maxRetries: 5 });
}
