import assert from "node:assert";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";

const temp = mkdtempSync(join(tmpdir(), "rag-cloud-portability-"));
const memoryDir = join(temp, "memory");
const cloudPath = join(temp, "cloud.sqlite");
const cloudUrl = `file:${cloudPath}`;
process.env.MEMORY_DIR = memoryDir;

const { getDatabase, closeDatabase, BLOBS_DIR } = await import("../../mcp-server/db/database.js");
const { updateConfig, resetConfig } = await import("../../mcp-server/config/config_manager.js");
const { rememberNote } = await import("../../mcp-server/tools/core/note_core.js");
const { readKnowledgeDocument } = await import("../../mcp-server/tools/core/knowledge_read_core.js");
const { deleteDocument } = await import("../../mcp-server/ingest/pipeline.js");
const { triggerBackgroundSync, syncFromCloud, resetReverseSyncThrottle } = await import("../../mcp-server/db/sync_queue.js");
const { blobExists, deleteBlob } = await import("../../mcp-server/storage/blob_store.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForRemote(label, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    const remote = createClient({ url: cloudUrl });
    try {
      const value = await predicate(remote);
      if (value) return value;
    } catch (err) {
      lastError = err;
    } finally {
      remote.close();
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function resetRemoteSchema() {
  const remote = createClient({ url: cloudUrl });
  await remote.executeMultiple(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE IF EXISTS notebooks;
    DROP TABLE IF EXISTS documents;
    DROP TABLE IF EXISTS document_scopes;
    DROP TABLE IF EXISTS sections;
    DROP TABLE IF EXISTS medium_chunks;
    DROP TABLE IF EXISTS micro_chunks;
    DROP TABLE IF EXISTS micro_chunks_fts;
    DROP TABLE IF EXISTS graph_edges;
    DROP TABLE IF EXISTS knowledge_links;
    DROP TABLE IF EXISTS rag_blobs;
    DROP TABLE IF EXISTS rag_document_tombstones;
    DROP TABLE IF EXISTS project_identities;
    DROP TABLE IF EXISTS project_aliases;
    DROP TABLE IF EXISTS schema_migrations;
    PRAGMA foreign_keys = ON;
  `);
  remote.close();
}

export async function runRagCloudPortabilityTests() {
  console.log("--- Running Integration Tests: rag_cloud_portability ---");
  mkdirSync(memoryDir, { recursive: true });

  try {
    closeDatabase();
    resetConfig();
    updateConfig({ mode: "only-local", tursoUrl: cloudUrl, conflictStrategy: "merge" });
    await resetRemoteSchema();

    // 1. Hybrid forward sync publishes normalized RAG + authoritative gzip blob.
    updateConfig({ mode: "hybrid-sync", tursoUrl: cloudUrl, conflictStrategy: "merge" });
    const note = await rememberNote({
      title: "Portable hybrid cold memory",
      content: [
        "portable-hybrid-note-token identifies this cross-device record.",
        "RAW_PORTABLE_BODY must survive reconstruction of a fresh local RAG store.",
      ].join("\n\n"),
      scope: "global",
      kind: "handoff",
      tags: "portable,hybrid",
      generateEmbeddings: false,
    });
    await triggerBackgroundSync();

    const published = await waitForRemote("hybrid RAG document + raw blob", async (remote) => {
      const doc = (await remote.execute({
        sql: "SELECT id, path, blob_hash, metadata_json FROM documents WHERE id = ?;",
        args: [note.docId],
      })).rows[0];
      const blob = (await remote.execute({
        sql: "SELECT hash, raw_size, LENGTH(gzip_base64) AS encoded_size FROM rag_blobs WHERE hash = ?;",
        args: [note.blobHash],
      })).rows[0];
      return doc && blob ? { doc, blob } : null;
    });
    assert.strictEqual(published.doc.blob_hash, note.blobHash);
    assert.ok(Number(published.blob.raw_size) > 0);
    assert.ok(Number(published.blob.encoded_size) > 0);

    // Save a closed, consistent copy to represent a second machine that later becomes stale.
    closeDatabase();
    const staleStorage = join(temp, "stale-machine-storage");
    cpSync(join(memoryDir, "storage"), staleStorage, { recursive: true });

    // 2. Fresh machine: no local SQLite/blob store; reverse sync rebuilds exact note and raw source.
    rmSync(join(memoryDir, "storage"), { recursive: true, force: true });
    resetReverseSyncThrottle();
    const freshSummary = await syncFromCloud();
    assert.ok(freshSummary.rag, "reverse sync reports RAG restoration summary");
    assert.ok(freshSummary.rag.pulled >= 1, `expected at least one pulled RAG document: ${JSON.stringify(freshSummary.rag)}`);

    const freshDb = await getDatabase();
    const restoredDoc = await freshDb.prepare("SELECT id, path, blob_hash, metadata_json FROM documents WHERE id = ?;").get(note.docId);
    assert.ok(restoredDoc, "fresh local SQLite contains restored cloud note");
    assert.strictEqual(restoredDoc.path, note.path);
    assert.strictEqual(restoredDoc.blob_hash, note.blobHash);
    assert.strictEqual(await blobExists(note.blobHash, BLOBS_DIR), true, "fresh machine materializes raw gzip blob");

    const restoredRaw = await readKnowledgeDocument({ docId: note.docId, scope: "global" });
    assert.strictEqual(restoredRaw.source_type, "note");
    assert.strictEqual(restoredRaw.note_kind, "handoff");
    assert.ok(restoredRaw.content.includes("RAW_PORTABLE_BODY"));

    // 3. Delete on machine A, sync tombstone, then boot a stale machine B.
    const deleted = await deleteDocument(note.docId);
    assert.strictEqual(deleted.deleted, true);
    await triggerBackgroundSync();

    const deletedRemote = await waitForRemote("cloud RAG deletion tombstone", async (remote) => {
      const doc = (await remote.execute({
        sql: "SELECT id FROM documents WHERE id = ?;",
        args: [note.docId],
      })).rows[0];
      const tombstone = (await remote.execute({
        sql: "SELECT doc_id, path, deleted_at FROM rag_document_tombstones WHERE doc_id = ?;",
        args: [note.docId],
      })).rows[0];
      const blob = (await remote.execute({
        sql: "SELECT hash FROM rag_blobs WHERE hash = ?;",
        args: [note.blobHash],
      })).rows[0];
      return !doc && tombstone && !blob ? tombstone : null;
    });
    assert.strictEqual(deletedRemote.doc_id, note.docId);

    closeDatabase();
    rmSync(join(memoryDir, "storage"), { recursive: true, force: true });
    cpSync(staleStorage, join(memoryDir, "storage"), { recursive: true });
    assert.strictEqual(await blobExists(note.blobHash, BLOBS_DIR), true, "stale machine starts with old raw blob");

    resetReverseSyncThrottle();
    const staleSummary = await syncFromCloud();
    assert.ok(staleSummary.rag.deleted >= 1, `tombstone should delete stale local note: ${JSON.stringify(staleSummary.rag)}`);
    const staleDb = await getDatabase();
    const staleDocAfterSync = await staleDb.prepare("SELECT id FROM documents WHERE id = ?;").get(note.docId);
    assert.ok(!staleDocAfterSync, "tombstone removes stale local document");
    assert.strictEqual(await blobExists(note.blobHash, BLOBS_DIR), false, "tombstone cleanup removes orphan stale raw blob");

    const noResurrection = await waitForRemote("tombstoned blob to remain absent", async (remote) => {
      const blob = (await remote.execute({
        sql: "SELECT hash FROM rag_blobs WHERE hash = ?;",
        args: [note.blobHash],
      })).rows[0];
      return blob ? null : true;
    });
    assert.strictEqual(noResurrection, true, "stale-machine startup backfill must not resurrect tombstoned raw payload");

    // 4. only-cloud: removing local cache still allows deliberate raw expansion from portable cloud blob.
    closeDatabase();
    updateConfig({ mode: "only-cloud", tursoUrl: cloudUrl });
    const cloudNote = await rememberNote({
      title: "Only-cloud cold memory",
      content: "only-cloud-raw-token proves read_document can restore a deliberately removed local cache blob.",
      scope: "global",
      kind: "research",
      tags: "cloud,raw",
      generateEmbeddings: false,
    });
    assert.strictEqual(await blobExists(cloudNote.blobHash, BLOBS_DIR), true, "only-cloud ingestion keeps a local cache copy initially");
    await deleteBlob(cloudNote.blobHash, BLOBS_DIR);
    assert.strictEqual(await blobExists(cloudNote.blobHash, BLOBS_DIR), false, "test removes only-cloud local raw cache");

    const cloudRaw = await readKnowledgeDocument({ docId: cloudNote.docId, scope: "global" });
    assert.ok(cloudRaw.content.includes("only-cloud-raw-token"), "only-cloud raw read materializes content from rag_blobs");
    assert.strictEqual(await blobExists(cloudNote.blobHash, BLOBS_DIR), true, "cloud raw read re-materializes verified local cache");

    const cloudDelete = await deleteDocument(cloudNote.docId);
    assert.strictEqual(cloudDelete.deleted, true);

    console.log("✅ CROSS-DEVICE RAG NOTE PORTABILITY & TOMBSTONES PASSED!");
  } finally {
    closeDatabase();
    resetConfig();
    if (existsSync(temp)) rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && process.argv[1].endsWith("rag_cloud_portability.test.js")) {
  runRagCloudPortabilityTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
