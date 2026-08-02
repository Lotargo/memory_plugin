import assert from "node:assert";
import { rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `memory_test_phase2_cloud_${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });

// Set process.env.MEMORY_DIR to isolate tests from production databases and folders
process.env.MEMORY_DIR = TEST_DIR;

const CLOUD_DB_PATH = `file:${join(TEST_DIR, "cloud_memory.sqlite")}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTests() {
  // Use dynamic imports to prevent ESM hoisting from importing files before process.env.MEMORY_DIR is set
  const { getDatabase, closeDatabase } = await import("./db/database.js");
  const { readMemory, writeMemory, listProjectStores } = await import("./memory.js");
  const { ingestDocument, deleteDocument } = await import("./ingest/pipeline.js");
  const { updateConfig, resetConfig } = await import("./config/config_manager.js");
  const { triggerBackgroundSync } = await import("./db/sync_queue.js");

  console.log("--- Starting Cloud & Sync Phase 2 Integration Tests ---");

  try {
    // Set up cloud database URL in config
    updateConfig({ mode: "only-local", tursoUrl: CLOUD_DB_PATH });

    // 1. Testing ONLY-CLOUD Mode
    console.log("1. Testing Only-Cloud mode (fully serverless notebooks & RAG)...");
    updateConfig({ mode: "only-cloud" });

    const dbCloud = await getDatabase();
    assert.strictEqual(dbCloud.mode, "only-cloud", "Database wrapper should be in only-cloud mode");

    // Verify memory writes to notebooks table
    const testKey = "project_cloud_test";
    const testFacts = ["- [2026-08-02 12:00] User prefers React and Next.js <!-- id:abc123, keep:1 -->"];
    await writeMemory(testKey, testFacts);

    // Read memory and verify
    const retrievedFacts = await readMemory(testKey);
    assert.strictEqual(retrievedFacts.length, 1, "Should retrieve 1 fact from cloud database");
    assert(retrievedFacts[0].includes("React and Next.js"), "Retrieved fact content should match");

    // Verify that NO local markdown file was created
    const localFile = join(TEST_DIR, `${testKey}.md`);
    assert.strictEqual(existsSync(localFile), false, "No local markdown file should be created in only-cloud mode");

    // Verify listProjectStores reads from notebooks table
    const stores = await listProjectStores();
    assert(stores.length >= 1, "Should list cloud project stores");
    assert.strictEqual(stores[0].key, testKey, "Cloud store key should match");

    // Verify document ingestion goes directly to cloud DB
    const sampleDoc = "# Serverless Deployment\nCloud-only mode is ideal for serverless environments.";
    const ingestRes = await ingestDocument({
      content: sampleDoc,
      type: "text",
      title: "Serverless Deployment Guide",
      path: "docs/serverless.md",
      customDb: dbCloud,
      generateEmbeddings: false,
    });

    assert(ingestRes.docId, "Should return docId");
    const docRow = await dbCloud.prepare("SELECT * FROM documents WHERE id = ?;").get(ingestRes.docId);
    assert.strictEqual(docRow.title, "Serverless Deployment Guide", "Document should exist in cloud database");

    closeDatabase();
    console.log("  [PASS] Only-Cloud Mode OK");


    // 2. Testing HYBRID-SYNC Mode & Replication Queue
    console.log("2. Testing Hybrid-Sync mode & background replication queue...");

    // Clean cloud database
    const dbRemoteInit = await getDatabase(CLOUD_DB_PATH.replace("file:", ""), "only-local");
    await dbRemoteInit.exec("PRAGMA foreign_keys = OFF;");
    await dbRemoteInit.exec("DROP TABLE IF EXISTS notebooks;");
    await dbRemoteInit.exec("DROP TABLE IF EXISTS documents;");
    await dbRemoteInit.exec("DROP TABLE IF EXISTS sections;");
    await dbRemoteInit.exec("DROP TABLE IF EXISTS medium_chunks;");
    await dbRemoteInit.exec("DROP TABLE IF EXISTS micro_chunks;");
    await dbRemoteInit.exec("DROP TABLE IF EXISTS micro_chunks_fts;");
    await dbRemoteInit.exec("DROP TABLE IF EXISTS graph_edges;");
    await dbRemoteInit.exec("DROP TABLE IF EXISTS knowledge_links;");
    await dbRemoteInit.exec("DROP TABLE IF EXISTS schema_migrations;");
    await dbRemoteInit.exec("PRAGMA foreign_keys = ON;");
    dbRemoteInit.close();

    // Reset config to hybrid-sync
    updateConfig({ mode: "hybrid-sync" });

    const dbLocal = await getDatabase();
    assert.strictEqual(dbLocal.mode, "hybrid-sync", "Database wrapper should be in hybrid-sync mode");

    // Verify memory write enqueues sync task
    const syncKey = "project_hybrid_test";
    const syncFacts = ["- [2026-08-02 12:15] User prefers Svelte and Vite <!-- id:xyz789, keep:1 -->"];
    await writeMemory(syncKey, syncFacts);

    // Verify sync task in local DB queue
    const queueRow = await dbLocal.prepare("SELECT * FROM sync_queue WHERE action = 'write_memory';").get();
    assert(queueRow, "Should enqueue a write_memory task");
    assert.strictEqual(queueRow.key_or_id, syncKey, "Task key should match");

    // Wait for background sync to complete
    await sleep(250);

    // Verify task removed from local queue
    const queueRowAfter = await dbLocal.prepare("SELECT * FROM sync_queue WHERE action = 'write_memory';").get();
    assert(!queueRowAfter, "Replication task should be removed from queue after successful sync");

    // Verify written memory exists in remote cloud DB notebooks table
    const dbRemote = await getDatabase(CLOUD_DB_PATH.replace("file:", ""), "only-local");
    const cloudMemoryRow = await dbRemote.prepare("SELECT content FROM notebooks WHERE key = ?;").get(syncKey);
    assert(cloudMemoryRow, "Notebook must be successfully replicated to remote notebooks table");
    assert(cloudMemoryRow.content.includes("Svelte and Vite"), "Replicated content should match");

    // Verify document ingestion enqueues sync task
    const sampleDocV2 = "# Microservices\nHybrid-sync replicates everything in the background.";
    const ingestResV2 = await ingestDocument({
      content: sampleDocV2,
      type: "text",
      title: "Microservices Specification",
      path: "docs/microservices.md",
      customDb: dbLocal,
      generateEmbeddings: false,
    });

    const ingestQueueRow = await dbLocal.prepare("SELECT * FROM sync_queue WHERE action = 'ingest_document';").get();
    assert(ingestQueueRow, "Should enqueue an ingest_document task");
    assert.strictEqual(ingestQueueRow.key_or_id, ingestResV2.docId, "Task key should match docId");

    // Wait for background sync
    await sleep(250);

    // Verify document successfully replicated to cloud DB
    const cloudDocRow = await dbRemote.prepare("SELECT * FROM documents WHERE id = ?;").get(ingestResV2.docId);
    assert(cloudDocRow, "Document metadata must be successfully replicated to remote cloud DB");
    assert.strictEqual(cloudDocRow.title, "Microservices Specification", "Replicated doc title must match");

    const cloudSections = await dbRemote.prepare("SELECT * FROM sections WHERE doc_id = ?;").all(ingestResV2.docId);
    assert(cloudSections.length >= 1, "Document sections must be successfully replicated to remote cloud DB");

    // Verify document deletion enqueues sync task
    await deleteDocument(ingestResV2.docId, dbLocal);
    const deleteQueueRow = await dbLocal.prepare("SELECT * FROM sync_queue WHERE action = 'delete_document';").get();
    assert(deleteQueueRow, "Should enqueue a delete_document task");

    // Wait for background sync
    await sleep(250);

    // Verify document successfully deleted from cloud DB
    const cloudDocRowAfterDelete = await dbRemote.prepare("SELECT * FROM documents WHERE id = ?;").get(ingestResV2.docId);
    assert(!cloudDocRowAfterDelete, "Document should be completely deleted from remote cloud DB after sync");

    dbLocal.close();
    dbRemote.close();
    closeDatabase();
    resetConfig();

    console.log("\n✅ ALL CLOUD & SYNC PHASE 2 INTEGRATION TESTS PASSED SUCCESSFULLY!");
  } catch (err) {
    console.error("\n❌ CLOUD & SYNC PHASE 2 INTEGRATION TEST FAILED:", err);
    process.exit(1);
  } finally {
    if (existsSync(TEST_DIR)) {
      try {
        rmSync(TEST_DIR, { recursive: true, force: true });
      } catch {}
    }
  }
}

runTests();
