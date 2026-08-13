import assert from "node:assert";
import { rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@libsql/client";

export async function runReverseSyncTests() {
  console.log("--- Running Integration Tests: reverse_sync ---");
  const TEST_DIR = join(tmpdir(), `memory_test_reverse_sync_${Date.now()}`);
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.MEMORY_DIR = TEST_DIR;

  const CLOUD_DB_PATH = `file:${join(TEST_DIR, "cloud_memory.sqlite")}`;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const { getDatabase, closeDatabase } = await import("../../mcp-server/db/database.js");
  const { readMemory, writeMemory, writeMemoryFile } = await import("../../mcp-server/memory.js");
  const { updateConfig, resetConfig } = await import("../../mcp-server/config/config_manager.js");
  const { syncFromCloud, triggerBackgroundSync, resetReverseSyncThrottle } = await import("../../mcp-server/db/sync_queue.js");
  const { ingestDocument } = await import("../../mcp-server/ingest/pipeline.js");
  const { linkFactToDocument } = await import("../../mcp-server/graph/knowledge_linker.js");
  const { removeDocumentScopes } = await import("../../mcp-server/rag_scope.js");

  try {
    closeDatabase();
    updateConfig({ mode: "only-local", tursoUrl: CLOUD_DB_PATH });

    // Clean cloud database
    const dbRemoteInit = createClient({ url: CLOUD_DB_PATH });
    await dbRemoteInit.executeMultiple(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE IF EXISTS notebooks;
      DROP TABLE IF EXISTS documents;
      DROP TABLE IF EXISTS sections;
      DROP TABLE IF EXISTS medium_chunks;
      DROP TABLE IF EXISTS micro_chunks;
      DROP TABLE IF EXISTS micro_chunks_fts;
      DROP TABLE IF EXISTS graph_edges;
      DROP TABLE IF EXISTS knowledge_links;
      DROP TABLE IF EXISTS schema_migrations;
      PRAGMA foreign_keys = ON;
    `);
    dbRemoteInit.close();
    closeDatabase();

    updateConfig({ mode: "hybrid-sync" });

    // --- 1. Cloud-only store gets pulled down locally ---
    console.log("1. Cloud-only store pulled down to local...");
    const dbCloudSeed = await getDatabase();
    await dbCloudSeed.cloudClient.execute({
      sql: "INSERT OR REPLACE INTO notebooks (key, content, updated_at) VALUES (?, ?, ?);",
      args: ["cloud_only_key", "# Memory: cloud_only_key\n\n- [2026-08-02 10:00] Cloud only fact <!-- id:c1 -->\n", Date.now()],
    });
    closeDatabase();

    const localFile = join(TEST_DIR, "cloud_only_key.md");
    assert.strictEqual(existsSync(localFile), false, "Local file should not exist yet");

    const summary = await syncFromCloud();
    assert.strictEqual(summary.pulled, 1, "Should pull 1 cloud-only store down");
    assert.strictEqual(existsSync(localFile), true, "Cloud-only store should be written locally");

    const pulledFacts = await readMemory("cloud_only_key");
    assert.strictEqual(pulledFacts.length, 1, "Pulled store should have 1 fact");
    assert(pulledFacts[0].includes("Cloud only fact"), "Pulled fact content should match");
    console.log("  [PASS]");

    // --- 2. Local-only store gets pushed up to cloud ---
    console.log("2. Local-only store pushed up to cloud...");
    await writeMemory("local_only_key", ["- [2026-08-02 11:00] Local only fact <!-- id:l1 -->"]);
    await triggerBackgroundSync();
    await sleep(100);
    const dbRemote = createClient({ url: CLOUD_DB_PATH });
    const pushedRowRes = await dbRemote.execute({
      sql: "SELECT content FROM notebooks WHERE key = ?;",
      args: ["local_only_key"]
    });
    const pushedRow = pushedRowRes.rows[0];
    assert(pushedRow, "Local-only store should be pushed to cloud");
    assert(pushedRow.content.includes("Local only fact"), "Pushed content should match");
    dbRemote.close();
    closeDatabase();
    console.log("  [PASS]");

    // --- 3. Merge strategy: union of facts, no data loss ---
    console.log("3. Merge strategy unions differing local + cloud stores...");
    updateConfig({ conflictStrategy: "merge" });
    await writeMemoryFile("conflict_key", "# Memory: conflict_key\n\n- [2026-08-02 12:00] Local fact A <!-- id:a -->\n");
    const dbCloudSeed2 = await getDatabase();
    await dbCloudSeed2.cloudClient.execute({
      sql: "INSERT OR REPLACE INTO notebooks (key, content, updated_at) VALUES (?, ?, ?);",
      args: ["conflict_key", "# Memory: conflict_key\n\n- [2026-08-02 12:30] Cloud fact B <!-- id:b -->\n", Date.now()],
    });
    closeDatabase();

    const mergeSummary = await syncFromCloud();
    assert.strictEqual(mergeSummary.conflicts, 1, "Should detect 1 conflict");
    assert.strictEqual(mergeSummary.merged, 1, "Merge should resolve the conflict");

    const mergedLocalFacts = await readMemory("conflict_key");
    assert.strictEqual(mergedLocalFacts.length, 2, "Merged store should contain both facts (union)");
    assert(mergedLocalFacts.some((f) => f.includes("Local fact A")), "Merged should keep local fact A");
    assert(mergedLocalFacts.some((f) => f.includes("Cloud fact B")), "Merged should keep cloud fact B");

    const dbRemote2 = createClient({ url: CLOUD_DB_PATH });
    const mergedCloudRowRes = await dbRemote2.execute({
      sql: "SELECT content FROM notebooks WHERE key = ?;",
      args: ["conflict_key"]
    });
    const mergedCloudRow = mergedCloudRowRes.rows[0];
    assert(mergedCloudRow.content.includes("Local fact A"), "Merged cloud should also contain local fact A");
    assert(mergedCloudRow.content.includes("Cloud fact B"), "Merged cloud should also contain cloud fact B");
    dbRemote2.close();
    closeDatabase();
    console.log("  [PASS]");

    // --- 4. cloud-wins strategy ---
    console.log("4. cloud-wins strategy...");
    updateConfig({ conflictStrategy: "cloud-wins" });
    await writeMemoryFile("cw_key", "# Memory: cw_key\n\n- [2026-08-02 13:00] Local fact <!-- id:a -->\n");
    const dbCloudSeed3 = await getDatabase();
    await dbCloudSeed3.cloudClient.execute({
      sql: "INSERT OR REPLACE INTO notebooks (key, content, updated_at) VALUES (?, ?, ?);",
      args: ["cw_key", "# Memory: cw_key\n\n- [2026-08-02 13:30] Cloud fact wins <!-- id:b -->\n", Date.now()],
    });
    closeDatabase();

    const cwSummary = await syncFromCloud();
    assert.strictEqual(cwSummary.cloudWins, 1, "Should resolve via cloud-wins");
    const cwFacts = await readMemory("cw_key");
    assert.strictEqual(cwFacts.length, 1, "cloud-wins should leave 1 fact");
    assert(cwFacts[0].includes("Cloud fact wins"), "Cloud content should overwrite local");
    console.log("  [PASS]");

    // --- 5. local-wins strategy ---
    console.log("5. local-wins strategy...");
    updateConfig({ conflictStrategy: "local-wins" });
    await writeMemoryFile("lw_key", "# Memory: lw_key\n\n- [2026-08-02 14:00] Local fact wins <!-- id:a -->\n");
    const dbCloudSeed4 = await getDatabase();
    await dbCloudSeed4.cloudClient.execute({
      sql: "INSERT OR REPLACE INTO notebooks (key, content, updated_at) VALUES (?, ?, ?);",
      args: ["lw_key", "# Memory: lw_key\n\n- [2026-08-02 14:30] Cloud fact <!-- id:b -->\n", Date.now()],
    });
    closeDatabase();

    const lwSummary = await syncFromCloud();
    assert.strictEqual(lwSummary.localWins, 1, "Should resolve via local-wins");
    const dbRemote3 = createClient({ url: CLOUD_DB_PATH });
    const lwCloudRowRes = await dbRemote3.execute({
      sql: "SELECT content FROM notebooks WHERE key = ?;",
      args: ["lw_key"]
    });
    const lwCloudRow = lwCloudRowRes.rows[0];
    assert(lwCloudRow.content.includes("Local fact wins"), "Local content should overwrite cloud");
    dbRemote3.close();
    closeDatabase();
    console.log("  [PASS]");

    // --- 6. Recall in hybrid mode sees cloud records after readMemory reverse-sync ---
    console.log("6. recall/readMemory reverse-syncs automatically in hybrid mode...");
    updateConfig({ conflictStrategy: "merge" });
    await writeMemoryFile("auto_pull_key", "");
    const dbCloudSeed5 = await getDatabase();
    await dbCloudSeed5.cloudClient.execute({
      sql: "INSERT OR REPLACE INTO notebooks (key, content, updated_at) VALUES (?, ?, ?);",
      args: ["auto_pull_key", "# Memory: auto_pull_key\n\n- [2026-08-02 15:00] Auto pulled fact <!-- id:a -->\n", Date.now()],
    });
    closeDatabase();

    resetReverseSyncThrottle();
    const autoFacts = await readMemory("auto_pull_key");
    assert.strictEqual(autoFacts.length, 1, "readMemory should reverse-sync and find cloud fact");
    assert(autoFacts[0].includes("Auto pulled fact"), "Auto pulled fact content should match");
    console.log("  [PASS]");

    // --- 7. RAG sync preserves vectors, policies, scopes, graph edges and Notebook links ---
    console.log("7. RAG hybrid sync preserves complete retrieval and graph data...");
    const localDb = await getDatabase();
    const syncDoc = await ingestDocument({
      content: "# Cloud RAG\n\ncloud-rag-integrity-token verifies complete document synchronization.",
      type: "text",
      path: "virtual://cloud-rag-integrity.md",
      generateEmbeddings: false,
      projectScope: "git:example.com/team/cloud-project",
    });
    await ingestDocument({
      content: "# Cloud RAG\n\ncloud-rag-integrity-token verifies complete document synchronization.",
      type: "text",
      path: "virtual://cloud-rag-integrity.md",
      generateEmbeddings: false,
      projectScope: "global",
    });
    const localChunk = await localDb.prepare("SELECT id, medium_id FROM micro_chunks WHERE doc_id = ? LIMIT 1").get(syncDoc.docId);
    const testVector = Buffer.from(new Float32Array([0.1, 0.2, 0.3, 0.4]).buffer);
    await localDb.prepare("UPDATE micro_chunks SET vector = ?, retrieval_policy = ?, policy_source_id = ? WHERE id = ?")
      .run(testVector, "code_signature", localChunk.medium_id, localChunk.id);
    await linkFactToDocument({
      factKey: "git:example.com/team/cloud-project",
      factText: "Cloud RAG synchronization keeps complete data",
      docId: syncDoc.docId,
      startLine: 1,
      endLine: 2,
      relationType: "VERIFIES",
    });
    await triggerBackgroundSync();
    await sleep(300);

    const remoteRag = createClient({ url: CLOUD_DB_PATH });
    const remoteChunk = (await remoteRag.execute({
      sql: "SELECT LENGTH(vector) AS vector_bytes, retrieval_policy, policy_source_id FROM micro_chunks WHERE id = ?",
      args: [localChunk.id],
    })).rows[0];
    assert.strictEqual(Number(remoteChunk.vector_bytes), testVector.byteLength, "cloud chunk keeps vector bytes");
    assert.strictEqual(remoteChunk.retrieval_policy, "code_signature", "cloud chunk keeps retrieval policy");
    assert.strictEqual(remoteChunk.policy_source_id, localChunk.medium_id, "cloud chunk keeps policy source");
    const remoteScopes = (await remoteRag.execute({
      sql: "SELECT scope_key FROM document_scopes WHERE doc_id = ?",
      args: [syncDoc.docId],
    })).rows.map((row) => row.scope_key).sort();
    assert.deepStrictEqual(remoteScopes, ["git:example.com/team/cloud-project", "global"].sort(), "cloud document keeps every scope");
    const remoteLink = (await remoteRag.execute({
      sql: "SELECT fact_key FROM knowledge_links WHERE doc_id = ?",
      args: [syncDoc.docId],
    })).rows[0];
    assert.strictEqual(remoteLink.fact_key, "git:example.com/team/cloud-project", "cloud document keeps Notebook link");
    const remoteEdges = (await remoteRag.execute({
      sql: "SELECT COUNT(*) AS cnt FROM graph_edges",
      args: [],
    })).rows[0];
    assert.ok(Number(remoteEdges.cnt) > 0, "cloud document keeps graph edges");
    const remoteLinkEdge = (await remoteRag.execute({
      sql: "SELECT target_id FROM graph_edges WHERE target_id = ?",
      args: [`${syncDoc.docId}:L1-2`],
    })).rows[0];
    assert.ok(remoteLinkEdge, "cloud document keeps line-range knowledge graph edge");

    await removeDocumentScopes(localDb, syncDoc.docId, ["git:example.com/team/cloud-project"]);
    await triggerBackgroundSync();
    await sleep(300);
    const remoteScopesAfterUnlink = (await remoteRag.execute({
      sql: "SELECT scope_key FROM document_scopes WHERE doc_id = ?",
      args: [syncDoc.docId],
    })).rows.map((row) => row.scope_key);
    assert.deepStrictEqual(remoteScopesAfterUnlink, ["global"], "partial scope unlink synchronizes to cloud");
    remoteRag.close();
    closeDatabase();
    console.log("  [PASS]");

    resetConfig();
    console.log("✅ ALL REVERSE SYNC & CONFLICT RESOLUTION TESTS PASSED!");
  } finally {
    closeDatabase();
    if (existsSync(TEST_DIR)) {
      try {
        rmSync(TEST_DIR, { recursive: true, force: true });
      } catch {}
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("reverse_sync.test.js")) {
  runReverseSyncTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
