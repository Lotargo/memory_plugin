import assert from "node:assert";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase } from "./db/database.js";
import { ingestDocument } from "./ingest/pipeline.js";
import { exportSnapshot, importSnapshot } from "./admin/snapshot.js";
import { startAdminServer, findAvailablePort } from "./admin/server.js";

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
  assert.strictEqual(exported.documents.length, 1, "Snapshot should contain 1 document");
  assert.strictEqual(exported.sections.length, 2, "Snapshot should contain 2 sections");
  assert(exported.blobs.length >= 1, "Snapshot should contain exported blobs");

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

  // 3. Web Admin Server Endpoints Test
  console.log("3. Testing Web Admin Server & API Endpoints...");
  const testPort = await findAvailablePort(8900, 8950);
  const { server, port, url } = await startAdminServer({
    port: testPort,
    customDb: db,
    customBlobDir: TEST_BLOB_DIR,
  });

  assert.strictEqual(port, testPort, "Server should bind to specified port");

  // Test GET /api/stats
  const statsRes = await fetch(`${url}/api/stats`);
  const statsData = await statsRes.json();
  assert.strictEqual(statsData.documents, 1, "Stats API should return 1 document");
  assert.strictEqual(statsData.sections, 2, "Stats API should return 2 sections");

  // Test GET /api/documents
  const docsRes = await fetch(`${url}/api/documents`);
  const docsData = await docsRes.json();
  assert.strictEqual(docsData.length, 1, "Documents API should return document list");

  // Test POST /api/query
  const queryRes = await fetch(`${url}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "exportSnapshot port", limit: 5, generateEmbeddings: false }),
  });
  const queryData = await queryRes.json();
  assert(queryData.results.length >= 1, "Query API should return search results");

  // Test GET /api/graph
  const graphRes = await fetch(`${url}/api/graph`);
  const graphData = await graphRes.json();
  assert(graphData.nodes.length >= 1, "Graph API should return nodes");

  server.close();
  db.close();
  console.log("  [PASS] Web Admin Server API Endpoints OK");

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
