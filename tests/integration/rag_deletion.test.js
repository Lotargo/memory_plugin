import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "rag-deletion-"));
process.env.MEMORY_DIR = join(root, "memory");
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = "1";
process.env.MEMORY_DISABLE_PERSONA_SYNC = "1";
const { getDatabase, closeDatabase } = await import("../../mcp-server/db/database.js");
const { updateConfig } = await import("../../mcp-server/config/config_manager.js");
const { ingestDocument, deleteDocument, reindexEmbeddings } = await import("../../mcp-server/ingest/pipeline.js");
const { touchDocument } = await import("../../mcp-server/graph/knowledge_linker.js");
const { blobExists } = await import("../../mcp-server/storage/blob_store.js");
const { registerRagTools } = await import("../../mcp-server/tools/rag_tools.js");

try {
  for (const mode of ["only-local", "cloud-snapshots"]) {
    updateConfig({ mode });
    const db = await getDatabase();
    const victim = await ingestDocument({ content: "# Remove me\n\nPrivate memory to remove.", generateEmbeddings: false });
    const survivor = await ingestDocument({ content: "# Keep me\n\nUnrelated memory.", generateEmbeddings: false });
    const handlers = new Map();
    registerRagTools({ registerTool: (name, definition, handler) => handlers.set(name, handler) });
    const prepare = db.prepare.bind(db);
    db.prepare = sql => /DELETE FROM documents/.test(sql)
      ? { run: async () => { throw new Error("Deletion unavailable"); } } : prepare(sql);
    await assert.rejects(handlers.get("manage_knowledge_base")({ action: "delete", docId: survivor.docId, scope: "global" }), /Deletion unavailable/);
    db.prepare = prepare;
    assert.ok(await db.prepare("SELECT id FROM documents WHERE id=?").get(survivor.docId));
    assert.equal((await db.prepare("SELECT count(*) n FROM document_scopes WHERE doc_id=?").get(survivor.docId)).n, 1, "failed public deletion preserves its last visible scope");
    assert.equal(await blobExists(survivor.blobHash), true);
    const result = await deleteDocument(victim.docId, db);
    assert.equal(result.deleted, true);
    assert.equal(result.syncPending, false);
    assert.equal(await db.prepare("SELECT id FROM documents WHERE id=?").get(victim.docId), undefined);
    assert.equal(await blobExists(victim.blobHash), false);
    assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name='sync_queue'").get(), undefined);
    assert.equal(db.cloudClient, null, "local deletion never opens a cloud client");
  }

  const primary = await getDatabase();

  // Custom databases never affect the default working state.
  const customBlobs = join(root, "custom-blobs");
  for (const mode of ["only-local", "cloud-snapshots"]) {
    const custom = await getDatabase(join(root, `${mode}.sqlite`), mode);
    try {
      const isolated = await ingestDocument({ content: "# Isolated database\n\nKeep this separate.", customDb: custom, customBlobDir: customBlobs, generateEmbeddings: false });
      await touchDocument(custom, isolated.docId);
      await reindexEmbeddings({ customDb: custom, dimension: 2, embedFn: async texts => texts.map(() => new Float32Array([0.5, 0.5])) });
      await deleteDocument(isolated.docId, custom, customBlobs);
      assert.equal(await custom.prepare("SELECT name FROM sqlite_master WHERE name='sync_queue'").get(), undefined);
      assert.equal(custom.cloudClient, null);
      assert.equal(await primary.prepare("SELECT id FROM documents WHERE id=?").get(isolated.docId), undefined);
    } finally { custom.close(); }
  }
  console.log("PASS: Local deletion rollback and custom database isolation in both working modes.");
} finally {
  closeDatabase();
  try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch (error) { if (!["EPERM", "EBUSY"].includes(error.code)) throw error; }
}
