import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "rag-pending-deletion-"));
process.env.MEMORY_DIR = join(root, "memory");
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = "1";
const { getDatabase, ensureCloudConnection, closeDatabase } = await import("../../mcp-server/db/database.js");
const { updateConfig } = await import("../../mcp-server/config/config_manager.js");
const { ingestDocument, deleteDocument, reindexEmbeddings } = await import("../../mcp-server/ingest/pipeline.js");
const { queueDocumentSyncIfNeeded } = await import("../../mcp-server/graph/knowledge_linker.js");
const { triggerBackgroundSync } = await import("../../mcp-server/db/sync_queue.js");
const { enqueueSyncTask } = await import("../../mcp-server/db/sync_queue.js");
const { exportDocumentData } = await import("../../mcp-server/ingest/exporter.js");
const { writeMemory } = await import("../../mcp-server/memory.js");
const { pullRagFromCloud } = await import("../../mcp-server/db/rag_sync.js");
const { blobExists } = await import("../../mcp-server/storage/blob_store.js");
const { registerRagTools } = await import("../../mcp-server/tools/rag_tools.js");

let db;
let execute;
try {
  updateConfig({ mode: "hybrid-sync", tursoUrl: `file:${join(root, "cloud.sqlite")}` });
  db = await getDatabase();
  await ensureCloudConnection(db);
  const victim = await ingestDocument({ content: "# Remove me\n\nPrivate memory to remove.", type: "text", path: "memory://pending-deletion", generateEmbeddings: false, projectScope: "global" });
  const survivor = await ingestDocument({ content: "# Keep me\n\nUnrelated technical memory.", type: "text", path: "memory://survivor", generateEmbeddings: false, projectScope: "global" });
  await triggerBackgroundSync();
  assert.ok((await db.cloudClient.execute({ sql: "SELECT id FROM documents WHERE id=?", args: [victim.docId] })).rows.length);

  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => /INSERT INTO sync_queue/.test(sql)
    ? { run: async () => { throw new Error("Deletion queue unavailable"); } } : prepare(sql);
  const handlers = new Map();
  registerRagTools({ registerTool: (name, definition, handler) => handlers.set(name, handler) });
  await assert.rejects(handlers.get("manage_knowledge_base")({ action: "delete", docId: survivor.docId, scope: "global" }), /Deletion queue unavailable/);
  db.prepare = prepare;
  assert.ok(await db.prepare("SELECT id FROM documents WHERE id=?").get(survivor.docId), "queue failure must roll back the local deletion");
  assert.equal(await db.prepare("SELECT doc_id FROM rag_document_tombstones WHERE doc_id=?").get(survivor.docId), undefined);
  assert.equal(await blobExists(survivor.blobHash), true);
  assert.equal((await db.prepare("SELECT COUNT(*) AS cnt FROM document_scopes WHERE doc_id=?").get(survivor.docId)).cnt, 1, "failed public deletion must preserve the last visible scope");

  // A write outage/backlog holds the deletion locally; cloud reads still work.
  execute = db.cloudClient.execute.bind(db.cloudClient);
  db.cloudClient.execute = async (statement) => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    if (!/^\s*(SELECT|PRAGMA)/i.test(sql)) throw new Error("Simulated cloud write outage");
    return await execute(statement);
  };
  const result = await deleteDocument(victim.docId, db);
  assert.equal(result.deleted, true);
  assert.equal(result.syncPending, true);
  const errors = [];
  const error = console.error;
  console.error = (...args) => errors.push(args);
  try {
    for (let attempt = 0; attempt < 6; attempt++) await triggerBackgroundSync();
  } finally { console.error = error; }
  assert.ok(errors.length >= 6, "exercise repeated unavailable cloud writes");
  const pending = await db.prepare("SELECT attempts FROM sync_queue WHERE action='delete_document' AND key_or_id=?").get(victim.docId);
  assert.ok(pending?.attempts >= 6, "deletion intent must survive the retry threshold");
  const pull = await pullRagFromCloud(db);
  assert.equal(await db.prepare("SELECT id FROM documents WHERE id=?").get(victim.docId), undefined, "reverse pull must not resurrect a locally deleted document while push is blocked");
  assert.ok(await db.prepare("SELECT id FROM documents WHERE id=?").get(survivor.docId));
  assert.ok(await db.prepare("SELECT doc_id FROM rag_document_tombstones WHERE doc_id=?").get(victim.docId));
  assert.equal(await blobExists(victim.blobHash), false);
  assert.equal(pull.errors, 0);

  db.cloudClient.execute = execute;
  await triggerBackgroundSync();
  assert.equal((await execute({ sql: "SELECT id FROM documents WHERE id=?", args: [victim.docId] })).rows.length, 0);
  assert.equal((await execute({ sql: "SELECT doc_id FROM rag_document_tombstones WHERE doc_id=?", args: [victim.docId] })).rows.length, 1);
  assert.equal((await execute({ sql: "SELECT hash FROM rag_blobs WHERE hash=?", args: [victim.blobHash] })).rows.length, 0);
  assert.ok((await execute({ sql: "SELECT id FROM documents WHERE id=?", args: [survivor.docId] })).rows.length);

  const partial = await ingestDocument({ content: "# Partial purge\n\nRetry cloud blob cleanup.", generateEmbeddings: false });
  await triggerBackgroundSync();
  db.cloudClient.execute = async (statement) => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    if (/DELETE FROM rag_blobs/i.test(sql)) throw new Error("Simulated cloud blob deletion outage");
    return await execute(statement);
  };
  console.error = (...args) => errors.push(args);
  try {
    await deleteDocument(partial.docId, db);
    await triggerBackgroundSync();
  } finally { console.error = error; }
  assert.equal((await execute({ sql: "SELECT id FROM documents WHERE id=?", args: [partial.docId] })).rows.length, 0);
  assert.equal((await execute({ sql: "SELECT hash FROM rag_blobs WHERE hash=?", args: [partial.blobHash] })).rows.length, 1);
  assert.ok(await db.prepare("SELECT id FROM sync_queue WHERE action='delete_document' AND key_or_id=?").get(partial.docId));
  db.cloudClient.execute = execute;
  await triggerBackgroundSync();
  assert.equal((await execute({ sql: "SELECT hash FROM rag_blobs WHERE hash=?", args: [partial.blobHash] })).rows.length, 0, "retry must clean the blob after the remote document was already removed");
  assert.equal(await db.prepare("SELECT id FROM sync_queue WHERE action='delete_document' AND key_or_id=?").get(partial.docId), undefined);

  const poison = await exportDocumentData(survivor.docId, db);
  poison.document.blob_hash = "f".repeat(64);
  await enqueueSyncTask("ingest_document", survivor.docId, poison, { db, trigger: false });
  console.error = (...args) => errors.push(args);
  try {
    await writeMemory("global", ["- [2026-10-03 01:00] **Independent rule** — must sync past broken document <!-- id:independent -->"]);
    await triggerBackgroundSync();
  } finally { console.error = error; }
  const notebook = (await execute({ sql: "SELECT content FROM notebooks WHERE key='global'" })).rows[0];
  assert.match(notebook?.content || "", /must sync past broken document/, "missing blob task must not block a different Notebook object");
  assert.ok(await db.prepare("SELECT id FROM sync_queue WHERE key_or_id=?").get(survivor.docId));
  // Remove this deliberately broken test task before final cleanup, retaining its document.
  await db.prepare("DELETE FROM sync_queue WHERE action='ingest_document' AND key_or_id=?").run(survivor.docId);

  // Explicit databases obey their own mode and never enqueue in the default
  // database, even when the installed configuration enables hybrid sync.
  const customBlobs = join(root, "custom-blobs");
  for (const mode of ["only-local", "hybrid-sync"]) {
    const custom = await getDatabase(join(root, `${mode}.sqlite`), mode);
    try {
      const isolated = await ingestDocument({ content: "# Isolated database\n\nKeep this separate.", customDb: custom, customBlobDir: customBlobs, generateEmbeddings: false });
      await queueDocumentSyncIfNeeded(custom, isolated.docId);
      await reindexEmbeddings({ customDb: custom, dimension: 2, embedFn: async (texts) => texts.map(() => new Float32Array([0.5, 0.5])) });
      await deleteDocument(isolated.docId, custom, customBlobs);
      assert.equal((await db.prepare("SELECT COUNT(*) AS cnt FROM sync_queue").get()).cnt, 0, "custom database must not use the default queue");
      if (mode === "hybrid-sync") {
        assert.equal((await custom.prepare("SELECT COUNT(*) AS cnt FROM sync_queue WHERE action='delete_document'").get()).cnt, 1);
        assert.ok((await custom.prepare("SELECT COUNT(*) AS cnt FROM sync_queue WHERE action='ingest_document'").get()).cnt >= 3);
      } else {
        assert.equal(await custom.prepare("SELECT name FROM sqlite_master WHERE name='sync_queue'").get(), undefined, "local-only operations must not create a sync queue");
      }
      assert.equal(custom.cloudClient, null, "custom operation must not start the default background worker");
    } finally { custom.close(); }
  }
  console.log("PASS: Durable deletion, transaction rollback, outage recovery and independent queue progress.");
} finally {
  if (execute && db?.cloudClient) db.cloudClient.execute = execute;
  await triggerBackgroundSync();
  closeDatabase();
  try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch (err) { if (!["EPERM", "EBUSY"].includes(err.code)) throw err; }
}
