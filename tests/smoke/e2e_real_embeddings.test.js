import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

// End-to-end smoke test with REAL ONNX embeddings.
//
// Why this exists: every suite in `npm test` runs with `generateEmbeddings:
// false` so it stays fast and offline. That means the dense-vector half of the
// engine is never exercised there — and it is exactly how a regression shipped
// in v1.5.3+ went unnoticed for two days: `node:sqlite` returns BLOBs as
// Uint8Array, a `Buffer.isBuffer()` guard dropped every stored vector, and
// vector + hybrid retrieval silently degraded to BM25-only while all 12 suites
// stayed green.
//
// This test downloads/loads the embedding model, so it is NOT part of
// `npm test`. Run it before a release: `npm run smoke`.

const TEST_DIR = mkdtempSync(join(tmpdir(), "memory_smoke_"));
process.env.MEMORY_DIR = TEST_DIR;

// Facts and the RAG database stay isolated in TEST_DIR, but the ONNX model cache
// (MEMORY_DIR/storage/models, ~2 GB) is reused from the real data directory —
// otherwise every run would re-download the weights. Falls back to a plain
// download when no cache exists yet (fresh CI machine).
function reuseModelCache() {
  const candidates = [
    process.env.MEMORY_MODEL_CACHE,
    process.env.OPENCODE_CONFIG_DIR && join(process.env.OPENCODE_CONFIG_DIR, "memory", "storage", "models"),
    join(homedir(), ".config", "opencode", "memory", "storage", "models"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "opencode", "memory", "storage", "models"),
  ].filter(Boolean);

  const source = candidates.find((p) => existsSync(p));
  if (!source) {
    console.log("    [note] no local model cache found — the model will be downloaded once");
    return null;
  }

  const storageDir = join(TEST_DIR, "storage");
  mkdirSync(storageDir, { recursive: true });
  try {
    symlinkSync(source, join(storageDir, "models"), "junction");
    return source;
  } catch (err) {
    console.log(`    [note] could not link the model cache (${err.code}); it will be downloaded`);
    return null;
  }
}

const modelCache = reuseModelCache();
if (modelCache) console.log(`    [note] reusing cached model weights from ${modelCache}`);

// MEMORY_DIR must be set before anything imports config/memory modules.
const { rememberFact, recallFacts, getFactById, forgetFacts, updateFactText, memoryInfo } =
  await import("../../mcp-server/tools/core/memory_core.js");
const { ingestDocument } = await import("../../mcp-server/ingest/pipeline.js");
const { hybridQuery } = await import("../../mcp-server/retrieval/retriever.js");
const { linkFactToDocument } = await import("../../mcp-server/graph/knowledge_linker.js");
const { getDatabase, closeDatabase } = await import("../../mcp-server/db/database.js");
const { assertIngestPathAllowed } = await import("../../mcp-server/security/path_guard.js");

const ctx = { worktree: process.cwd(), directory: process.cwd() };
const FACT = "Smoke test fact: hybrid retrieval verified with real embeddings";

const SAMPLE_DOC =
  "# Vector Search\n\n" +
  "Vector search uses dense embeddings to find semantically similar documents. " +
  "Cosine similarity measures the angle between two vectors in high dimensional space.\n\n" +
  "## Hybrid Retrieval\n\n" +
  "Hybrid retrieval fuses BM25 lexical scores with dense vector similarity using " +
  "relative score fusion, which balances keyword precision and semantic recall.\n";

export async function runSmokeTests() {
  console.log("--- Running Smoke Tests: e2e_real_embeddings ---");
  console.log("    (loads the ONNX embedding model — slower than the offline suites)");

  try {
    // 1. Notebook write/read
    console.log("1. Testing Notebook remember/recall...");
    const saved = await rememberFact({ fact: FACT, scope: "project" }, ctx);
    assert.ok(saved.includes("Memory updated"), "remember stores the fact");

    const recalled = await recallFacts({ scope: "project" }, ctx);
    assert.ok(recalled.includes("Smoke test fact"), "recall returns the fact");
    const factId = (recalled.match(/\[id:([a-z0-9]+)\]/) || [])[1];
    assert.ok(factId, "recall exposes the generated fact id");
    console.log("   [PASS] Notebook remember/recall OK");

    // 2. Ingestion WITH embeddings
    console.log("2. Testing ingestion with real ONNX vectors...");
    const docPath = join(TEST_DIR, "sample.md");
    writeFileSync(docPath, SAMPLE_DOC, "utf-8");

    const ing = await ingestDocument({ content: docPath, type: "file", title: "vector_search_doc" });
    assert.ok(ing.docId, "ingestion returns a docId");
    assert.ok(ing.microChunksCount > 0, "ingestion produced micro-chunks");

    const db = await getDatabase();
    const vecRow = await db
      .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(vector)),0) AS bytes FROM micro_chunks WHERE doc_id = ?")
      .get(ing.docId);
    assert.ok(vecRow.bytes > 0, "vectors were actually written (not empty BLOBs)");
    assert.strictEqual(
      vecRow.bytes % (vecRow.n * 4),
      0,
      "stored vectors are whole float32 arrays"
    );
    console.log(`   [PASS] Ingestion OK (${ing.sectionsCount} sections, ${ing.microChunksCount} chunks)`);

    // 3. THE regression guard: hybrid retrieval must use the dense vectors.
    console.log("3. Testing hybrid retrieval returns a live vector component...");
    const hits = await hybridQuery({ query: "how does semantic similarity work", limit: 3 });
    assert.ok(Array.isArray(hits), "hybridQuery returns an array");
    assert.ok(hits.length > 0, "hybrid query returns hits");

    const cosines = hits.map((h) => h.cosine_sim ?? 0);
    assert.ok(
      cosines.some((c) => c > 0),
      "at least one hit carries a non-zero cosine similarity — " +
        "a zero here means the dense half of the engine is dead (BM25-only fallback)"
    );
    console.log(`   [PASS] Hybrid retrieval OK (top cosine ${Math.max(...cosines).toFixed(4)})`);

    // 4. Cross-lingual: only dense vectors can bridge a RU query to an EN doc.
    console.log("4. Testing cross-lingual retrieval (RU query -> EN document)...");
    const ruHits = await hybridQuery({ query: "поиск по смыслу с помощью векторов", limit: 3 });
    assert.ok(
      ruHits.length > 0,
      "a Russian query must still reach the English document — BM25 alone cannot do this"
    );
    console.log(`   [PASS] Cross-lingual retrieval OK (${ruHits.length} hit(s))`);

    // 5. Graph links between Notebook facts and RAG documents
    console.log("5. Testing fact <-> document linking...");
    const link = await linkFactToDocument({
      factKey: "git:github.com/lotargo/memory_pugin",
      factText: FACT,
      docId: ing.docId,
      startLine: 1,
      endLine: 3,
    });
    assert.ok(link, "link created");

    const linkedRecall = await recallFacts({ scope: "project", query: "Smoke test" }, ctx);
    assert.ok(linkedRecall.includes("Linked Docs"), "recall surfaces the linked document");
    console.log("   [PASS] Fact/document linking OK");

    // 6. update_fact splits "**Title** body" (the plugin's regex was broken)
    console.log("6. Testing update_fact title parsing...");
    const updated = await updateFactText(
      { id: "Smoke test", newText: "**Renamed Fact** hybrid retrieval still verified", scope: "project" },
      ctx
    );
    assert.ok(updated.includes("updated"), "update_fact reports success");

    const afterUpdate = await recallFacts({ scope: "project", query: "Renamed Fact" }, ctx);
    assert.ok(afterUpdate.includes("**Renamed Fact**"), "title was split from the body");
    assert.ok(
      !afterUpdate.includes("**Renamed Fact** hybrid retrieval still verified —"),
      "title is not duplicated into the body"
    );
    console.log("   [PASS] update_fact title parsing OK");

    // 7. get_fact resolves by metadata id
    console.log("7. Testing get_fact by metadata id...");
    const fetched = await getFactById({ id: factId, scope: "project" }, ctx);
    assert.ok(fetched.includes("hybrid retrieval"), "get_fact returns the updated body");
    console.log("   [PASS] get_fact OK");

    // 8. Diagnostics
    console.log("8. Testing memory_info...");
    const info = await memoryInfo({}, ctx);
    assert.ok(info.includes("Version:"), "memory_info reports the version");
    assert.ok(/RAG: \d+ doc/.test(info), "memory_info reports RAG stats");
    console.log("   [PASS] memory_info OK");

    // 9. Security: ingest path guard (audit item H1)
    console.log("9. Testing ingest path guard...");
    assert.throws(
      () => assertIngestPathAllowed(process.platform === "win32" ? "C:/Windows/win.ini" : "/etc/passwd"),
      /blocked/i,
      "reading a system file outside the allowed roots must be blocked"
    );
    console.log("   [PASS] Ingest path guard OK");

    // 10. Cleanup path
    console.log("10. Testing forget...");
    const forgotten = await forgetFacts({ query: "Renamed Fact", scope: "project" }, ctx);
    assert.ok(forgotten.includes("Memory updated"), "forget removes the fact");

    const finalRecall = await recallFacts({ scope: "project" }, ctx);
    assert.ok(!finalRecall.includes("Renamed Fact"), "fact is gone from the store");
    console.log("   [PASS] forget OK");

    console.log("✅ ALL SMOKE TESTS PASSED SUCCESSFULLY!");
  } finally {
    try { closeDatabase(); } catch {}
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  }
}

if (process.argv[1] && process.argv[1].endsWith("e2e_real_embeddings.test.js")) {
  runSmokeTests().catch((err) => {
    console.error("❌ Smoke test failed:", err);
    process.exit(1);
  });
}
