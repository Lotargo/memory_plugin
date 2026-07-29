import assert from "node:assert";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase } from "./db/database.js";
import { cleanHtml, normalizeContent } from "./ingest/normalizer.js";
import { parseSections, createMicroChunks, buildTripleHierarchy } from "./ingest/chunker.js";
import { vectorToBuffer, bufferToVector, cosineSimilarity } from "./ml/model_manager.js";
import { ingestDocument } from "./ingest/pipeline.js";

const TEST_DIR = join(tmpdir(), `memory_test_phase2_${Date.now()}`);
const TEST_DB_PATH = join(TEST_DIR, "test_memory.sqlite");

console.log("--- Starting Phase 2 Unit & Integration Tests ---");

try {
  // 1. Normalizer Test
  console.log("1. Testing HTML & Markdown Normalizer...");
  const rawHtml = "<html><body><header>Nav</header><h1>RAG Engine</h1><p>Welcome to <b>hybrid</b> search!</p></body></html>";
  const cleaned = cleanHtml(rawHtml);
  assert(cleaned.includes("# RAG Engine"), "HTML h1 should be converted to markdown heading");
  assert(!cleaned.includes("header"), "Header tags should be stripped");
  assert(cleaned.includes("Welcome to hybrid search!"), "Text content should be preserved");

  const codeNorm = normalizeContent({
    content: "console.log('hello');",
    type: "file",
    path: "test.js",
  });
  assert(codeNorm.markdown.includes("```javascript"), "Code file should be wrapped in code block");
  console.log("  [PASS] Normalizer OK");

  // 2. Triple-Hierarchy Chunker Test
  console.log("2. Testing Triple-Hierarchy Chunker...");
  const sampleMarkdown = `# Zero-Docker RAG
Overview of the RAG engine architecture.

## Storage Philosophy
Raw documents are stored in CAS blob storage. SQLite contains search indices.

## ML Architecture
Uses ONNX Runtime with Transformers.js for zero native build overhead.
`;

  const hierarchy = buildTripleHierarchy(sampleMarkdown, "doc_test_1", "Zero-Docker RAG");
  assert.strictEqual(hierarchy.sections.length, 3, "Should parse 3 sections (Title, Storage, ML)");
  assert(hierarchy.microChunks.length >= 3, "Should generate micro-chunks for all sections");
  assert(hierarchy.microChunks[1].breadcrumbs.includes("Storage Philosophy"), "Micro-chunk should preserve breadcrumbs");
  console.log("  [PASS] Chunker OK");

  // 3. Vector Serialization Test
  console.log("3. Testing Vector Serialization & Cosine Similarity...");
  const vecA = new Float32Array([1.0, 0.0, 0.5]);
  const vecB = new Float32Array([1.0, 0.0, 0.5]);
  const vecC = new Float32Array([0.0, 1.0, 0.0]);

  const simIdentical = cosineSimilarity(vecA, vecB);
  assert(Math.abs(simIdentical - 1.0) < 0.0001, "Identical vectors similarity should be 1.0");

  const simOrthogonal = cosineSimilarity(vecA, vecC);
  assert.strictEqual(simOrthogonal, 0, "Orthogonal vectors similarity should be 0");

  const buf = vectorToBuffer(vecA);
  const reconstructedVec = bufferToVector(buf);
  assert.strictEqual(reconstructedVec.length, 3, "Deserialized vector length match");
  assert.strictEqual(reconstructedVec[0], 1.0, "Deserialized vector element match");
  console.log("  [PASS] Vector Serialization OK");

  // 4. Ingestion Pipeline Integration Test (Mock Embeddings mode for speed)
  console.log("4. Testing Ingestion Pipeline into SQLite...");
  const db = getDatabase(TEST_DB_PATH);

  const ingestRes = await ingestDocument({
    content: sampleMarkdown,
    type: "text",
    title: "Zero-Docker RAG Guide",
    customDb: db,
    generateEmbeddings: false, // mock vector mode for test speed
  });

  assert(ingestRes.doc_id, "Ingest should return doc_id");
  assert.strictEqual(ingestRes.sections_count, 3, "Ingest should record 3 sections");
  assert(ingestRes.micro_chunks_count >= 3, "Ingest should record micro chunks");

  const docRow = db.prepare("SELECT * FROM documents WHERE id = ?").get(ingestRes.doc_id);
  assert.strictEqual(docRow.title, "Zero-Docker RAG Guide", "DB Document title match");

  const ftsHits = db.prepare("SELECT * FROM micro_chunks_fts WHERE micro_chunks_fts MATCH 'ONNX Runtime';").all();
  assert(ftsHits.length >= 1, "FTS5 query should find ONNX Runtime chunk");

  db.close();
  console.log("\n✅ ALL PHASE 2 TESTS PASSED SUCCESSFULLY!");
} catch (err) {
  console.error("\n❌ PHASE 2 TEST FAILED:", err);
  process.exit(1);
} finally {
  if (existsSync(TEST_DIR)) {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore Windows temp locks
    }
  }
}
