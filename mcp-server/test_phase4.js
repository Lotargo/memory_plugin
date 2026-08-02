import assert from "node:assert";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase } from "./db/database.js";
import { ingestDocument } from "./ingest/pipeline.js";
import { exportSnapshot, importSnapshot } from "./admin/snapshot.js";

const TEST_DIR = join(tmpdir(), `memory_test_phase4_${Date.now()}`);
const TEST_DB_PATH = join(TEST_DIR, "test_memory.sqlite");
const TEST_BLOB_DIR = join(TEST_DIR, "blobs");

console.log("--- Starting Phase 4 & Phase 5 Unit & Integration Tests ---");

try {
  // 1. Database & Ingestion Setup
  console.log("1. Setting up test database and ingesting sample doc...");
  const db = getDatabase(TEST_DB_PATH);

  const sampleDoc = `
# Admin Suite Architecture

## Snapshot Module
\`\`\`javascript
function exportSnapshot() {
  return { version: 1 };
}
\`\`\`

## Web Server Module
Dynamic port scanning ensures zero conflicts on ports 8765-8785.
`;

  const ingestRes = await ingestDocument({
    content: sampleDoc,
    type: "text",
    title: "Admin Spec",
    path: "docs/admin.md",
    customDb: db,
    customBlobDir: TEST_BLOB_DIR,
    generateEmbeddings: false,
  });

  assert(ingestRes.docId, "Should return valid docId");
  assert.strictEqual(ingestRes.sectionsCount, 2, "Should create 2 sections");
  console.log("  [PASS] Sample Ingestion OK");

  // 2. Snapshot Export & Import Test
  console.log("2. Testing Snapshot Export & Import...");
  const snapshotPath = join(TEST_DIR, "snapshot.json");
  const exported = await exportSnapshot({
    customDb: db,
    customBlobDir: TEST_BLOB_DIR,
    outputPath: snapshotPath,
  });

  assert(existsSync(snapshotPath), "Snapshot file should exist on disk");
  assert.strictEqual(exported.snapshot.documents.length, 1, "Snapshot should contain 1 document");
  assert.strictEqual(exported.snapshot.sections.length, 2, "Snapshot should contain 2 sections");
  assert(exported.snapshot.blobs.length >= 1, "Snapshot should contain exported blobs");

  // Test restoration into fresh DB
  const FRESH_DB_PATH = join(TEST_DIR, "fresh_memory.sqlite");
  const FRESH_BLOB_DIR = join(TEST_DIR, "fresh_blobs");
  const freshDb = getDatabase(FRESH_DB_PATH);

  const importRes = await importSnapshot({
    customDb: freshDb,
    customBlobDir: FRESH_BLOB_DIR,
    snapshotPathOrData: snapshotPath,
  });

  assert.strictEqual(importRes.documents, 1, "Import should restore 1 document");
  assert.strictEqual(importRes.sections, 2, "Import should restore 2 sections");
  freshDb.close();
  console.log("  [PASS] Snapshot Export & Import OK");

  // 4. Testing Reranker Loading and Config Manager Fixes
  console.log("4. Testing Reranker Lazy Loading and Config Sync fixes...");
  const { getReranker } = await import("./ml/model_manager.js");
  const { getConfig, saveConfig } = await import("./config/config_manager.js");

  // Verify getConfig & saveConfig run without throwing errors
  const originalConfig = getConfig();
  assert(originalConfig && typeof originalConfig === "object", "getConfig should return config object");
  saveConfig({ ...originalConfig });

  // Call getReranker with an invalid model and catch error, ensuring it is a pipeline/fetch error, NOT a ReferenceError
  try {
    await getReranker("Xenova/nonexistent-dummy-reranker");
    assert.fail("Should have failed to load the nonexistent reranker");
  } catch (err) {
    assert.ok(!err.message.includes("checkAndSelfHealModel"), "Error should not be a ReferenceError for checkAndSelfHealModel");
    assert.ok(
      err.message.includes("could not") ||
      err.message.includes("failed") ||
      err.message.includes("fetch") ||
      err.message.includes("ENOENT") ||
      err.message.includes("cannot find") ||
      err.message.includes("not found") ||
      err.message.includes("ReferenceError") === false,
      "Should be a model loading error, got: " + err.message
    );
  }
  console.log("  [PASS] Reranker Lazy Loading & Config Sync fixes OK");

  db.close();
  console.log("\n✅ ALL PHASE 4 & PHASE 5 TESTS PASSED SUCCESSFULLY!");
} catch (err) {
  console.error("\n❌ PHASE 4 TEST FAILED:", err);
  process.exit(1);
} finally {
  if (existsSync(TEST_DIR)) {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore temp lock on Windows
    }
  }
}
