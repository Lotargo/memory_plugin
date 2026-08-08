import assert from "node:assert";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { extractSymbolsFromContent } from "../../mcp-server/graph/graph_extractor.js";
import { extractTitle, validateUrlForSsrf } from "../../mcp-server/ingest/normalizer.js";
import { exportDocumentToJsonString } from "../../mcp-server/ingest/exporter.js";
import { sanitizeFtsQuery as retrieverSanitizeFts } from "../../mcp-server/retrieval/retriever.js";
import { updateConfig, getConfig, resetConfig } from "../../mcp-server/config/config_manager.js";
import { resizeVector } from "../../mcp-server/ml/model_manager.js";
import { validateSnapshotPath } from "../../mcp-server/admin/snapshot.js";
import { getDatabase } from "../../mcp-server/db/database.js";
import { ingestDocument } from "../../mcp-server/ingest/pipeline.js";

const TEST_DIR = join(tmpdir(), `memory_test_audit_${Date.now()}`);
const TEST_DB_PATH = join(TEST_DIR, "test_memory.sqlite");

export async function runAuditUnitTests() {
  console.log("--- Running Unit Tests: unit_audit_fixes ---");

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

  // Cleanup test directory
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
