import assert from "node:assert";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `memory_test_audit_${Date.now()}`);
const TEST_DB_PATH = join(TEST_DIR, "test_memory.sqlite");
const TEST_BLOB_DIR = join(TEST_DIR, "blobs");

// MEMORY_DIR must be set BEFORE any module is imported: config_manager.js
// resolves CONFIG_FILE at import time, so static imports here would make
// updateConfig/resetConfig overwrite the developer's real config.json.
mkdirSync(TEST_DIR, { recursive: true });
mkdirSync(TEST_BLOB_DIR, { recursive: true });
process.env.MEMORY_DIR = TEST_DIR;

const { extractSymbolsFromContent } = await import("../../mcp-server/graph/graph_extractor.js");
const { extractTitle, validateUrlForSsrf } = await import("../../mcp-server/ingest/normalizer.js");
const { exportDocumentToJsonString } = await import("../../mcp-server/ingest/exporter.js");
const {
  sanitizeFtsQuery: retrieverSanitizeFts,
  toVectorBytes,
  vectorSearch,
} = await import("../../mcp-server/retrieval/retriever.js");
const { updateConfig, getConfig, resetConfig } = await import("../../mcp-server/config/config_manager.js");
const { resizeVector, formatInputText } = await import("../../mcp-server/ml/model_manager.js");
const { validateSnapshotPath } = await import("../../mcp-server/admin/snapshot.js");
const { getDatabase, closeDatabase } = await import("../../mcp-server/db/database.js");
const { ingestDocument, reindexEmbeddings } = await import("../../mcp-server/ingest/pipeline.js");

export async function runAuditUnitTests() {
  console.log("--- Running Unit Tests: unit_audit_fixes ---");
  assert.ok(
    process.env.MEMORY_DIR === TEST_DIR,
    "hermetic guard: MEMORY_DIR must point at the temp dir before any import"
  );

  // 1. Test extractSymbolsFromContent
  console.log("1. Testing extractSymbolsFromContent...");
  const polyglotCode = `
    function processRequest(req) {}
    class PipelineManager {}
    def train_model(data): pass
    fn parse_tokens() {}
    func HandleHttp(w http.ResponseWriter) {}
  `;
  const symbols = extractSymbolsFromContent(polyglotCode);
  assert(symbols.includes("processRequest"), "JS function extracted");
  assert(symbols.includes("PipelineManager"), "JS class extracted");
  assert(symbols.includes("train_model"), "Python function extracted");
  assert(symbols.includes("parse_tokens"), "Rust fn extracted");
  assert(symbols.includes("HandleHttp"), "Go func extracted");
  console.log("   [PASS] extractSymbolsFromContent OK");

  // 2. Test extractTitle
  console.log("2. Testing extractTitle...");
  const markdownHeading = "# Architecture Overview\n\nSome text content...";
  assert.strictEqual(extractTitle(markdownHeading), "Architecture Overview", "Should extract H1 heading");
  assert.strictEqual(extractTitle("No heading here", "Fallback Title"), "Fallback Title", "Should use fallback title");
  console.log("   [PASS] extractTitle OK");

  // 3. Test sanitizeFtsQuery
  console.log("3. Testing sanitizeFtsQuery...");
  assert.strictEqual(retrieverSanitizeFts("hello world!"), "hello OR world", "Should convert words to OR query");
  assert.strictEqual(retrieverSanitizeFts("поиск кода AND 123"), "поиск OR кода OR AND OR 123", "Should sanitize Cyrillic & numbers");
  assert.strictEqual(retrieverSanitizeFts("   "), "", "Empty string returns empty");
  console.log("   [PASS] sanitizeFtsQuery OK");

  // 4. Test updateConfig
  console.log("4. Testing updateConfig...");
  const initial = getConfig();
  const updated = updateConfig({ alpha: 0.85 });
  assert.strictEqual(updated.alpha, 0.85, "Config alpha should update to 0.85");
  assert.strictEqual(getConfig().alpha, 0.85, "getConfig() reflects persistent update");
  resetConfig();
  assert.strictEqual(getConfig().alpha, initial.alpha, "Config reset restores defaults");
  console.log("   [PASS] updateConfig OK");

  // 5. Test exportDocumentToJsonString
  console.log("5. Testing exportDocumentToJsonString...");
  const db = await getDatabase(TEST_DB_PATH);
  const ingRes = await ingestDocument({
    content: "# Audit Test Doc\n\nTesting JSON string export function.",
    type: "text",
    title: "Audit Test Doc",
    path: "virtual://audit_test.md",
    generateEmbeddings: false,
    customDb: db,
    customBlobDir: TEST_BLOB_DIR,
  });

  const jsonString = await exportDocumentToJsonString(ingRes.docId, db);
  assert(typeof jsonString === "string", "exportDocumentToJsonString returns a string");
  const parsed = JSON.parse(jsonString);
  assert.strictEqual(parsed.document.id, ingRes.docId, "Exported JSON contains matching doc_id");
  assert.strictEqual(parsed.document.title, "Audit Test Doc", "Exported JSON contains title");
  console.log("   [PASS] exportDocumentToJsonString OK");

  // 6. Test validateUrlForSsrf Security Controls
  console.log("6. Testing validateUrlForSsrf Security Controls...");
  assert.throws(() => validateUrlForSsrf("http://localhost:8080"), /blocked/i, "Blocks localhost");
  assert.throws(() => validateUrlForSsrf("http://127.0.0.1/admin"), /blocked/i, "Blocks loopback IP");
  assert.throws(() => validateUrlForSsrf("http://169.254.169.254/latest/meta-data/"), /blocked/i, "Blocks cloud metadata");
  assert.throws(() => validateUrlForSsrf("http://192.168.1.1/router"), /blocked/i, "Blocks private subnet IP");
  const validUrl = validateUrlForSsrf("https://example.com/docs");
  assert.strictEqual(validUrl.hostname, "example.com", "Valid public URL passes");
  console.log("   [PASS] validateUrlForSsrf OK");

  // 7. Test validateSnapshotPath Security Controls
  console.log("7. Testing validateSnapshotPath Security Controls...");
  assert.throws(() => validateSnapshotPath("bad_file.txt", true), /Invalid snapshot file extension/i, "Rejects invalid extension");
  assert.throws(() => validateSnapshotPath("non_existent_snapshot.json", false), /not found/i, "Rejects non-existent import path");
  const validExportPath = validateSnapshotPath(join(TEST_DIR, "snapshot.json.gz"), true);
  assert(validExportPath.endsWith("snapshot.json.gz"), "Valid export path accepted");
  console.log("   [PASS] validateSnapshotPath OK");

  // 8. Test resizeVector dimension override
  console.log("8. Testing resizeVector dimension override...");
  const origVector = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `expected ${expected}, got ${actual}`);
  const padded = resizeVector(origVector, 768);
  assert.strictEqual(padded.length, 768, "Vector padded up to target dimension");
  approx(padded[0], 0.1, "Padding preserves leading values");
  approx(padded[3], 0.4, "Padding preserves trailing values");
  assert.strictEqual(padded[4], 0, "Padding fills missing values with zero");
  const truncated = resizeVector(origVector, 2);
  assert.strictEqual(truncated.length, 2, "Vector truncated down to target dimension");
  approx(truncated[0], 0.1, "Truncation preserves first values");
  const unchanged = resizeVector(origVector, 4);
  assert.strictEqual(unchanged, origVector, "Same-dimension vector returned as-is (no copy)");
  const disabled = resizeVector(origVector, 0);
  assert.strictEqual(disabled, origVector, "0 target returns vector untouched (auto mode)");
  console.log("   [PASS] resizeVector OK");

  // 9. Test vectorDimension config round-trip
  console.log("9. Testing vectorDimension config round-trip...");
  const origDim = getConfig().vectorDimension;
  const updatedDim = updateConfig({ vectorDimension: 768 });
  assert.strictEqual(updatedDim.vectorDimension, 768, "Config vectorDimension should update to 768");
  assert.strictEqual(getConfig().vectorDimension, 768, "getConfig() reflects vectorDimension update");
  resetConfig();
  assert.strictEqual(getConfig().vectorDimension, origDim, "Config reset restores default vectorDimension");
  console.log("   [PASS] vectorDimension config round-trip OK");

  // 10. Test formatInputText model-profile auto-detection
  console.log("10. Testing formatInputText model-profile auto-detection...");
  const E5 = "Xenova/multilingual-e5-small";
  const BGE = "Xenova/bge-base-en-v1.5";
  const BGE_M3 = "Xenova/bge-m3";
  const MINILM = "Xenova/all-MiniLM-L6-v2";
  const MPNET = "Xenova/all-mpnet-base-v2";
  const PARAPHRASE = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
  const GTE = "Xenova/gte-small";

  assert.strictEqual(formatInputText("hello", true, E5), "query: hello", "e5 query gets query: prefix");
  assert.strictEqual(formatInputText("hello", false, E5), "passage: hello", "e5 passage gets passage: prefix");
  assert.strictEqual(
    formatInputText("hello", true, "Xenova/multilingual-e5-small-instruct", "Find docs"),
    "Instruct: Find docs\nQuery: hello",
    "e5-instruct query embeds instruction"
  );
  assert.strictEqual(
    formatInputText("query: hello", true, E5),
    "query: hello",
    "e5 strips existing query: prefix (idempotent)"
  );

  assert.strictEqual(
    formatInputText("hello", true, BGE),
    "Represent this sentence for searching relevant passages: hello",
    "bge query gets retrieval instruction prefix"
  );
  assert.strictEqual(formatInputText("hello", false, BGE), "hello", "bge passage keeps plain text");
  assert.strictEqual(formatInputText("hello", true, BGE_M3), formatInputText("hello", true, BGE), "bge-m3 shares bge query profile");
  assert.strictEqual(
    formatInputText("hello", true, BGE, "Search docs"),
    "Represent this sentence for searching relevant passages: Search docs hello",
    "bge query prepends instruction to prompt"
  );

  for (const plainModel of [MINILM, MPNET, PARAPHRASE, GTE]) {
    assert.strictEqual(formatInputText("hello", true, plainModel), "hello", `${plainModel} query has no prefix`);
    assert.strictEqual(formatInputText("hello", false, plainModel), "hello", `${plainModel} passage has no prefix`);
  }
  assert.strictEqual(formatInputText("", true, E5), "", "Empty text returns empty string");
  console.log("   [PASS] formatInputText model-profile auto-detection OK");

  // 11. Test reindexEmbeddings re-embedding (model/dimension switch)
  console.log("11. Testing reindexEmbeddings re-embedding...");
  const reindexDbPath = join(TEST_DIR, "reindex.sqlite");
  const reindexDb = await getDatabase(reindexDbPath);
  const reIng = await ingestDocument({
    content: "# Reindex Doc\n\nAlpha content for re-embedding verification.",
    type: "text",
    title: "Reindex Doc",
    path: "virtual://reindex_test.md",
    generateEmbeddings: false,
    customDb: reindexDb,
    customBlobDir: TEST_BLOB_DIR,
  });

  const beforeRow = await reindexDb.prepare("SELECT COUNT(*) as cnt, COALESCE(SUM(LENGTH(vector)),0) as bytes FROM micro_chunks WHERE doc_id = ?").get(reIng.docId);
  assert.ok(beforeRow.cnt > 0, "Reindex test doc has chunks");
  assert.strictEqual(beforeRow.bytes, 0, "generateEmbeddings:false stores empty vectors");

  const fakeEmbed = async (texts) => texts.map(() => new Float32Array(8).fill(0.01));
  const res1 = await reindexEmbeddings({
    model: "Fake/model",
    dimension: 8,
    embedFn: fakeEmbed,
    customDb: reindexDb,
  });
  assert.strictEqual(res1.reindexed, beforeRow.cnt, "Re-index processes every stored chunk");
  assert.strictEqual(res1.dimension, 8, "Re-index reports target dimension");

  const afterRow1 = await reindexDb.prepare("SELECT COUNT(*) as cnt, COALESCE(SUM(LENGTH(vector)),0) as bytes FROM micro_chunks WHERE doc_id = ?").get(reIng.docId);
  assert.strictEqual(afterRow1.bytes, beforeRow.cnt * 32, "Vectors updated to 8-dim (32 bytes each)");

  const docStill = await reindexDb.prepare("SELECT id, title FROM documents WHERE id = ?").get(reIng.docId);
  assert.ok(docStill && docStill.title === "Reindex Doc", "Document preserved after re-index");

  const res2 = await reindexEmbeddings({
    model: "Fake/model",
    dimension: 16,
    embedFn: async (texts) => texts.map(() => new Float32Array(16).fill(0.02)),
    customDb: reindexDb,
  });
  assert.strictEqual(res2.reindexed, beforeRow.cnt, "Second re-index re-embeds the same chunks");
  const afterRow2 = await reindexDb.prepare("SELECT COALESCE(SUM(LENGTH(vector)),0) as bytes FROM micro_chunks WHERE doc_id = ?").get(reIng.docId);
  assert.strictEqual(afterRow2.bytes, beforeRow.cnt * 64, "Vectors updated to 16-dim (64 bytes each)");
  console.log("   [PASS] reindexEmbeddings re-embedding OK");

  // 12. Regression: vector BLOBs must survive the driver round-trip.
  // node:sqlite returns BLOBs as Uint8Array (NOT Buffer). A Buffer.isBuffer()
  // gate in vectorSearch silently dropped every row and made vector search
  // return zero hits while BM25 kept working.
  console.log("12. Testing vector BLOB round-trip (Uint8Array from node:sqlite)...");
  const storedVec = await reindexDb
    .prepare("SELECT vector FROM micro_chunks WHERE doc_id = ? LIMIT 1")
    .get(reIng.docId);
  assert.ok(storedVec && storedVec.vector, "stored vector column is present");
  assert.ok(
    storedVec.vector instanceof Uint8Array,
    "driver returns the BLOB as a Uint8Array — do not gate on Buffer.isBuffer()"
  );

  const normalized = toVectorBytes(storedVec.vector);
  assert.ok(normalized instanceof Uint8Array, "toVectorBytes normalizes a Uint8Array");
  assert.strictEqual(normalized.byteLength, 64, "16-dim float32 vector = 64 bytes");

  // Every shape a driver may return must normalize to the same bytes.
  const asBuffer = Buffer.from(normalized);
  const asBase64 = asBuffer.toString("base64");
  const asJson = { type: "Buffer", data: [...normalized] };
  for (const [label, shape] of [
    ["Buffer", asBuffer],
    ["base64 string", asBase64],
    ["{type:Buffer,data}", asJson],
    ["plain array", [...normalized]],
  ]) {
    const out = toVectorBytes(shape);
    assert.ok(out, `toVectorBytes handles ${label}`);
    assert.strictEqual(out.byteLength, 64, `${label} round-trips to 64 bytes`);
    assert.deepStrictEqual([...out], [...normalized], `${label} preserves the bytes`);
  }
  assert.strictEqual(toVectorBytes(null), null, "null stays null");
  assert.strictEqual(toVectorBytes(undefined), null, "undefined stays null");

  // End-to-end: a real query must actually retrieve the chunk by vector.
  const probeVec = new Float32Array(16).fill(0.02);
  const vecHits = await vectorSearch(reindexDb, probeVec, 5, 0.1);
  assert.ok(vecHits.length > 0, "vectorSearch returns hits for a matching vector (regression)");
  console.log("   [PASS] vector BLOB round-trip + vectorSearch OK");

  // Cleanup: close every SQLite handle first, otherwise Windows keeps the files
  // locked and leaves an empty %TEMP% directory behind.
  try { db.close(); } catch {}
  try { reindexDb.close(); } catch {}
  try { closeDatabase(); } catch {}
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}

  console.log("✅ ALL AUDIT UNIT TESTS PASSED SUCCESSFULLY!");
}

if (process.argv[1] && process.argv[1].endsWith("unit_audit_fixes.test.js")) {
  runAuditUnitTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
