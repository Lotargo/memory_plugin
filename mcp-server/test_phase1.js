import assert from "node:assert";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase } from "./db/database.js";
import { saveBlob, readBlob, blobExists, deleteBlob, hashContent } from "./storage/blob_store.js";

const TEST_DIR = join(tmpdir(), `memory_test_phase1_${Date.now()}`);
const TEST_DB_PATH = join(TEST_DIR, "test_memory.sqlite");
const TEST_BLOBS_DIR = join(TEST_DIR, "blobs");

console.log("--- Starting Phase 1 Unit Tests ---");

try {
  // 1. Database & Migrations Test
  console.log("1. Testing SQLite Database & Migrations...");
  const db = await getDatabase(TEST_DB_PATH);

  const userVersionRow = await db.prepare("PRAGMA user_version;").get();
  const userVersion = userVersionRow ? (userVersionRow.user_version || userVersionRow.v || 0) : 0;
  assert(userVersion >= 3, "Database user_version should be at least 3 after migration");

  const tables = (await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table';")
    .all())
    .map((r) => r.name);

  assert(tables.includes("documents"), "Table 'documents' should exist");
  assert(tables.includes("sections"), "Table 'sections' should exist");
  assert(tables.includes("micro_chunks"), "Table 'micro_chunks' should exist");
  assert(tables.includes("micro_chunks_fts"), "FTS table 'micro_chunks_fts' should exist");
  assert(tables.includes("graph_edges"), "Table 'graph_edges' should exist");
  console.log("  [PASS] Database & Migrations OK");

  // 2. Blob Storage CAS Test
  console.log("2. Testing Content-Addressable Blob Storage...");
  const sampleText = "Hello RAG Engine! Zero-Docker Local Hybrid RAG Engine.";
  const expectedHash = hashContent(Buffer.from(sampleText, "utf-8"));

  const saveRes1 = await saveBlob(sampleText, TEST_BLOBS_DIR);
  assert.strictEqual(saveRes1.hash, expectedHash, "Hash mismatch on blob save");
  assert.strictEqual(saveRes1.deduplicated, false, "First save should not be deduplicated");
  assert(existsSync(saveRes1.path), "Blob file should exist on filesystem");

  // Test Deduplication
  const saveRes2 = await saveBlob(sampleText, TEST_BLOBS_DIR);
  assert.strictEqual(saveRes2.deduplicated, true, "Second save of identical content should be deduplicated");

  // Test Reading & Decompression
  const retrievedContent = await readBlob(expectedHash, TEST_BLOBS_DIR);
  assert.strictEqual(retrievedContent, sampleText, "Decompressed blob content should match original");

  // Test Deleting
  const deleted = await deleteBlob(expectedHash, TEST_BLOBS_DIR);
  assert.strictEqual(deleted, true, "Blob deletion should return true");
  assert.strictEqual(await blobExists(expectedHash, TEST_BLOBS_DIR), false, "Blob should no longer exist");
  console.log("  [PASS] Blob Storage CAS OK");

  // 3. FTS5 Index & Search Test
  console.log("3. Testing SQLite FTS5 Keyword Search...");
  const docId = "doc_101";
  const sectionId = "sec_201";
  const chunkId = "chunk_301";
  const chunkContent = "DeepMind Antigravity RAG architecture provides high performance search.";
  const breadcrumbs = "Docs > Architecture > RAG";

  await db.prepare(`
    INSERT INTO documents (id, path, blob_hash, title, checksum, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?);
  `).run(docId, "dev_docs/rag.md", expectedHash, "RAG Specs", expectedHash, Date.now(), Date.now());

  await db.prepare(`
    INSERT INTO sections (id, doc_id, heading, breadcrumbs, content, token_count)
    VALUES (?, ?, ?, ?, ?, ?);
  `).run(sectionId, docId, "Architecture", breadcrumbs, chunkContent, 10);

  const emptyVectorBuffer = Buffer.alloc(384 * 4); // 384 Float32 elements
  await db.prepare(`
    INSERT INTO micro_chunks (id, section_id, doc_id, content, vector, token_count)
    VALUES (?, ?, ?, ?, ?, ?);
  `).run(chunkId, sectionId, docId, chunkContent, emptyVectorBuffer, 10);

  await db.prepare(`
    INSERT INTO micro_chunks_fts (id, content, breadcrumbs)
    VALUES (?, ?, ?);
  `).run(chunkId, chunkContent, breadcrumbs);

  const searchHits = await db.prepare(`
    SELECT id, content, breadcrumbs, rank
    FROM micro_chunks_fts
    WHERE micro_chunks_fts MATCH 'Antigravity RAG'
    ORDER BY rank;
  `).all();

  assert.strictEqual(searchHits.length, 1, "FTS5 query should return 1 matching record");
  assert.strictEqual(searchHits[0].id, chunkId, "Matched chunk ID should match inserted ID");
  console.log("  [PASS] FTS5 Keyword Search OK");

  db.close();
  console.log("\n✅ ALL PHASE 1 TESTS PASSED SUCCESSFULLY!");
} catch (err) {
  console.error("\n❌ PHASE 1 TEST FAILED:", err);
  process.exit(1);
} finally {
  if (existsSync(TEST_DIR)) {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore temporary file cleanup locks on Windows
    }
  }
}
