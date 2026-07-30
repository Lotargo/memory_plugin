import assert from "node:assert";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase } from "./db/database.js";
import { ingestDocument } from "./ingest/pipeline.js";
import { extractSymbolsFromContent, getRelatedSymbols } from "./graph/graph_extractor.js";
import { bm25Search, vectorSearch, rrfFusion, hybridQuery } from "./retrieval/retriever.js";

const TEST_DIR = join(tmpdir(), `memory_test_phase3_${Date.now()}`);
const TEST_DB_PATH = join(TEST_DIR, "test_memory.sqlite");

console.log("--- Starting Phase 3 Unit & Integration Tests ---");

try {
  // 1. Symbol Extractor & Graph Test
  console.log("1. Testing Code Symbol Extractor...");
  const codeContent = `
function calculateRrfScore(rank) {
  return 1.0 / (60 + rank);
}

class HybridSearchRetriever {
  constructor(db) {
    this.db = db;
  }
}
`;
  const symbols = extractSymbolsFromContent(codeContent);
  assert(symbols.includes("calculateRrfScore"), "Should extract function name 'calculateRrfScore'");
  assert(symbols.includes("HybridSearchRetriever"), "Should extract class name 'HybridSearchRetriever'");
  console.log("  [PASS] Symbol Extractor OK");

  // 2. RRF Fusion Algorithm Test
  console.log("2. Testing RRF Fusion Math...");
  const bm25Hits = [{ id: "c1", content: "test", breadcrumbs: "b", bm25_rank: 1 }];
  const vectorHits = [
    { id: "c1", content: "test", breadcrumbs: "b", vector_rank: 2, cosine_sim: 0.9 },
    { id: "c2", content: "test2", breadcrumbs: "b", vector_rank: 1, cosine_sim: 0.95 },
  ];

  const fused = rrfFusion(bm25Hits, vectorHits, 60, 0.01);
  assert.strictEqual(fused.length, 2, "Should merge 2 unique chunks");
  assert.strictEqual(fused[0].id, "c1", "Chunk 'c1' present in both BM25 and Vector should rank top");
  console.log("  [PASS] RRF Fusion Math OK");

  // 3. Hybrid Retrieval End-to-End Test
  console.log("3. Testing End-to-End Hybrid Retrieval...");
  const db = getDatabase(TEST_DB_PATH);

  const docCode = `
# Hybrid Search Architecture

## Retriever Engine
\`\`\`javascript
function executeHybridQuery(query) {
  return rrfFusion(bm25, vector);
}
\`\`\`

## Performance Optimization
SQLite WAL mode ensures fast concurrency for FTS5 full text search.
`;

  await ingestDocument({
    content: docCode,
    type: "file",
    path: "lib/search.js",
    title: "Search Docs",
    customDb: db,
    generateEmbeddings: false,
  });

  const retrieved = await hybridQuery({
    query: "executeHybridQuery RRF",
    limit: 5,
    customDb: db,
  });

  assert(retrieved.length >= 1, "Hybrid search should return matching results");
  assert.strictEqual(retrieved[0].doc_title, "Search Docs", "Retrieved document title match");
  assert(retrieved[0].defined_symbols.includes("executeHybridQuery"), "GraphRAG should include defined symbol 'executeHybridQuery'");

  db.close();
  console.log("\n✅ ALL PHASE 3 TESTS PASSED SUCCESSFULLY!");
} catch (err) {
  console.error("\n❌ PHASE 3 TEST FAILED:", err);
  process.exit(1);
} finally {
  if (existsSync(TEST_DIR)) {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore Windows temp file locks
    }
  }
}
