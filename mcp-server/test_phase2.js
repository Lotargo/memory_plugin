import assert from "node:assert";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase } from "./db/database.js";
import { cleanHtml, normalizeContent } from "./ingest/normalizer.js";
import { parseSections, createMicroChunks, buildTripleHierarchy } from "./ingest/chunker.js";
import { splitSentencesMultilingual } from "./ingest/sentence_segmenter.js";
import { vectorToBuffer, bufferToVector, cosineSimilarity } from "./ml/model_manager.js";
import { ingestDocument } from "./ingest/pipeline.js";

const TEST_DIR = join(tmpdir(), `memory_test_phase2_${Date.now()}`);
const TEST_DB_PATH = join(TEST_DIR, "test_memory.sqlite");

console.log("--- Starting Phase 2 Unit & Integration Tests ---");

try {
  // 1. Multilingual Sentence Segmenter Test
  console.log("1. Testing Multilingual Sentence Segmenter...");
  const ruText = "Это первый запуск МКС. В т. ч. проверяем модуль. Все прошло успешно.";
  const ruSentences = splitSentencesMultilingual(ruText, "ru");
  assert.strictEqual(ruSentences.length, 3, "Russian text should split into 3 sentences, preserving 'т. ч.'");

  const enText = "This is e.g. a test case. Dr. Smith verified v1.0.3 architecture. It works.";
  const enSentences = splitSentencesMultilingual(enText, "en");
  assert.strictEqual(enSentences.length, 3, "English text should split into 3 sentences, preserving 'e.g.' and 'Dr.'");
  console.log("  [PASS] Multilingual Sentence Segmenter OK");

  // 2. Normalizer Test
  console.log("2. Testing HTML & Markdown Normalizer...");
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

  // 3. Triple-Hierarchy Chunker Test (Big -> Medium -> Small)
  console.log("3. Testing Triple-Hierarchy Chunker (Big -> Medium -> Small)...");
  const sampleMarkdown = `# Zero-Docker RAG
Overview of the RAG engine architecture. It supports local vector search.

## Storage Philosophy
Raw documents are stored in CAS blob storage. SQLite contains search indices.

## Table Example
| Parameter | Value |
| --- | --- |
| Chunking | Big -> Medium -> Small |

## ML Architecture
Uses ONNX Runtime with Transformers.js for zero native build overhead.
`;

  const hierarchy = buildTripleHierarchy(sampleMarkdown, "doc_test_1", "Zero-Docker RAG");
  assert(hierarchy.sections.length >= 4, "Should parse sections (Title, Storage, Table, ML)");
  assert(hierarchy.mediumChunks.length >= 4, "Should generate Medium blocks for paragraphs and table");
  assert(hierarchy.microChunks.length >= 4, "Should generate Small sentence chunks");
  assert(hierarchy.mediumChunks[0].id, "Medium chunk must have id");
  assert(hierarchy.microChunks[0].medium_id, "Micro chunk must reference medium_id");
  console.log("  [PASS] Chunker OK");

  // 4. E5 & BGE Model Input Formatting Test (Prefixes Verification)
  console.log("4. Testing E5 & BGE Prefix Formatting (formatInputText)...");
  const { formatInputText } = await import("./ml/model_manager.js");

  const e5Passage = formatInputText("Hello world", false, "Xenova/multilingual-e5-small");
  assert.strictEqual(e5Passage, "passage: Hello world", "E5 indexing must prepend 'passage: '");

  const e5Query = formatInputText("Hello world", true, "Xenova/multilingual-e5-small");
  assert.strictEqual(e5Query, "query: Hello world", "E5 queries must prepend 'query: '");

  const e5CleanPassage = formatInputText("passage: Hello world", false, "Xenova/multilingual-e5-small");
  assert.strictEqual(e5CleanPassage, "passage: Hello world", "E5 formatting must prevent double prefixing");

  const bgeQuery = formatInputText("Hello world", true, "Xenova/bge-small-en-v1.5");
  assert(bgeQuery.startsWith("Represent this sentence for searching relevant passages: "), "BGE query prefix check");

  console.log("  [PASS] E5 & BGE Prefix Formatting OK");

  // 5. Vector Serialization Test
  console.log("5. Testing Vector Serialization & Cosine Similarity...");
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

  // 5. Ingestion Pipeline Integration Test
  console.log("5. Testing Ingestion Pipeline into SQLite...");
  const db = getDatabase(TEST_DB_PATH);

  const ingestRes = await ingestDocument({
    content: sampleMarkdown,
    type: "text",
    title: "Zero-Docker RAG Guide",
    customDb: db,
    generateEmbeddings: false, // mock vector mode for test speed
  });

  assert(ingestRes.doc_id, "Ingest should return doc_id");
  assert(ingestRes.sections_count >= 4, "Ingest should record sections");
  assert(ingestRes.micro_chunks_count >= 4, "Ingest should record micro chunks");

  const docRow = db.prepare("SELECT * FROM documents WHERE id = ?").get(ingestRes.doc_id);
  assert.strictEqual(docRow.title, "Zero-Docker RAG Guide", "DB Document title match");

  const mediumRows = db.prepare("SELECT * FROM medium_chunks WHERE doc_id = ?").all(ingestRes.doc_id);
  assert(mediumRows.length >= 4, "DB medium_chunks table should contain logical blocks");

  const ftsHits = db.prepare("SELECT * FROM micro_chunks_fts WHERE micro_chunks_fts MATCH 'ONNX Runtime';").all();
  assert(ftsHits.length >= 1, "FTS5 query should find ONNX Runtime chunk");

  // 6. Testing Snapshot Export, Import & Hard Reset
  console.log("6. Testing Snapshot Export, Import & Hard Reset...");
  const { exportSnapshot, importSnapshot, hardResetDatabase } = await import("./admin/snapshot.js");

  const snapPath = join(TEST_DIR, "test_snapshot.json.gz");
  const expRes = await exportSnapshot({ customDb: db, outputPath: snapPath });
  assert(existsSync(snapPath), "Snapshot export file must exist");
  assert(expRes.snapshot.documents.length >= 1, "Snapshot documents must not be empty");

  const resetRes = hardResetDatabase({ customDb: db });
  assert(resetRes.purgedDocuments >= 1, "Hard reset must purge documents");

  const emptyDocsCount = db.prepare("SELECT COUNT(*) as cnt FROM documents").get().cnt;
  assert.strictEqual(emptyDocsCount, 0, "Database must be empty after Hard Reset");

  const impRes = await importSnapshot({ customDb: db, snapshotPathOrData: snapPath });
  assert(impRes.documents >= 1, "Snapshot import must restore documents");

  const restoredDocsCount = db.prepare("SELECT COUNT(*) as cnt FROM documents").get().cnt;
  assert(restoredDocsCount >= 1, "Database documents must be restored after Import");
  console.log("  [PASS] Snapshot Export, Import & Hard Reset OK");

  db.close();
  console.log("\n✅ ALL PHASE 2 & HIERARCHY TESTS PASSED SUCCESSFULLY!");
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
