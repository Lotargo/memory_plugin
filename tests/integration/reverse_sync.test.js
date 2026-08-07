import assert from "node:assert";
import { rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

  try {
    closeDatabase();
    updateConfig({ mode: "only-local", tursoUrl: CLOUD_DB_PATH });

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
    const dbRemote = await getDatabase(CLOUD_DB_PATH.replace("file:", ""), "only-local");
    const pushedRow = await dbRemote.prepare("SELECT content FROM notebooks WHERE key = 'local_only_key';").get();
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

    const dbRemote2 = await getDatabase(CLOUD_DB_PATH.replace("file:", ""), "only-local");
    const mergedCloudRow = await dbRemote2.prepare("SELECT content FROM notebooks WHERE key = 'conflict_key';").get();
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
    const dbRemote3 = await getDatabase(CLOUD_DB_PATH.replace("file:", ""), "only-local");
    const lwCloudRow = await dbRemote3.prepare("SELECT content FROM notebooks WHERE key = 'lw_key';").get();
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
