import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ingestDocument } from "../../mcp-server/ingest/pipeline.js";
import { getDatabase, closeDatabase } from "../../mcp-server/db/database.js";
import { hybridQuery } from "../../mcp-server/retrieval/retriever.js";

export async function runPolicyRetrievalTests() {
  console.log("--- Running Unit Tests: policy_retrieval ---");
  const temp = mkdtempSync(join(tmpdir(), "policy-retrieval-"));
  const MEMORY_DIR = join(temp, "mem");
  const GIT_CMD = process.platform === "win32" ? "git.exe" : "git";
  execFileSync(GIT_CMD, ["init"], { cwd: temp, stdio: "ignore" });

  const db = await getDatabase(MEMORY_DIR);
  let passed = 0;

  function ok(name) {
    console.log(`  [PASS] ${name}`);
    passed++;
  }

  // ── 1. table_summary chunk creation ──────────────────────────────────
  {
    const tableDoc = [
      "# Benchmark Results",
      "",
      "| Model | MRR@5 | Recall@5 | Latency |",
      "| --- | --- | --- | --- |",
      "| BM25 | 0.65 | 0.72 | 12ms |",
      "| Vector | 0.78 | 0.81 | 45ms |",
      "| RRF | 0.82 | 0.88 | 52ms |",
      "| RSF | 0.80 | 0.85 | 48ms |",
      "",
      "The table above shows retrieval quality metrics.",
    ].join("\n");

    const r = await ingestDocument({ content: tableDoc, path: "test_table.md", customDb: db });
    const chunks = await db.prepare("SELECT retrieval_policy, content FROM micro_chunks WHERE doc_id = ?").all(r.docId);

    const summary = chunks.find((c) => c.retrieval_policy === "table_summary");
    assert.ok(summary, "table_summary chunk created");
    assert.ok(summary.content.includes("Model"), "summary contains column names");
    assert.ok(summary.content.includes("4 rows"), "summary contains row count");
    assert.ok(chunks.filter((c) => c.retrieval_policy === "micro_chunk").length >= 1, "micro_chunk also created");
    ok("table_summary chunk creation");
  }

  // ── 2. code_signature chunk creation ─────────────────────────────────
  {
    const codeDoc = [
      "# Utils",
      "",
      "```javascript",
      "/**",
      " * Calculates the cosine similarity between two vectors.",
      " * @param {number[]} a",
      " * @param {number[]} b",
      " */",
      "function cosineSimilarity(a, b) {",
      "  let dot = 0, normA = 0, normB = 0;",
      "  for (let i = 0; i < a.length; i++) {",
      "    dot += a[i] * b[i];",
      "    normA += a[i] * a[i];",
      "    normB += b[i] * b[i];",
      "  }",
      "  return dot / (Math.sqrt(normA) * Math.sqrt(normB));",
      "}",
      "```",
    ].join("\n");

    const r = await ingestDocument({ content: codeDoc, path: "test_code.md", customDb: db });
    const chunks = await db.prepare("SELECT retrieval_policy, content FROM micro_chunks WHERE doc_id = ?").all(r.docId);

    const sig = chunks.find((c) => c.retrieval_policy === "code_signature");
    assert.ok(sig, "code_signature chunk created");
    assert.ok(sig.content.includes("cosineSimilarity"), "signature contains function name");
    assert.ok(sig.content.includes("Calculates the cosine similarity"), "signature contains JSDoc");
    ok("code_signature chunk creation");
  }

  // ── 3. table_summary expansion ───────────────────────────────────────
  {
    const result = await hybridQuery({ query: "Table with columns", limit: 5, customDb: db, generateEmbeddings: false });
    const hit = result.find((r) => r.retrieval_policy === "table_summary");
    assert.ok(hit, "table_summary hit found via BM25");
    assert.ok(hit.snippet.includes("RRF"), "expanded to full table content");
    assert.ok(hit.snippet.includes("0.82"), "expanded includes numeric data");
    assert.ok(hit.snippet.includes("Model"), "expanded includes header");
    ok("table_summary expansion");
  }

  // ── 4. code_signature expansion ──────────────────────────────────────
  {
    const result = await hybridQuery({ query: "cosineSimilarity", limit: 5, customDb: db, generateEmbeddings: false });
    const hit = result.find((r) => r.retrieval_policy === "code_signature");
    assert.ok(hit, "code_signature hit found via BM25");
    assert.ok(hit.snippet.includes("Calculates the cosine similarity"), "expanded to full JSDoc");
    assert.ok(hit.snippet.includes("let dot = 0"), "expanded to function body");
    ok("code_signature expansion");
  }

  // ── 5. Policy deduplication ──────────────────────────────────────────
  {
    const result = await hybridQuery({ query: "cosine", limit: 10, customDb: db, generateEmbeddings: false });
    const sigHits = result.filter((r) => r.retrieval_policy === "code_signature");
    assert.strictEqual(sigHits.length, 1, "code_signature deduplicated to 1");
    ok("policy deduplication");
  }

  // ── 6. policyExpansion = false disables policy chunks ────────────────
  {
    const result = await hybridQuery({ query: "cosineSimilarity", limit: 5, customDb: db, generateEmbeddings: false, policyExpansion: false });
    const sigHits = result.filter((r) => r.retrieval_policy === "code_signature");
    assert.strictEqual(sigHits.length, 0, "no code_signature when policyExpansion=false");
    const allMicro = result.every((r) => r.retrieval_policy === "micro_chunk");
    assert.ok(allMicro, "all results are micro_chunk when policyExpansion=false");
    ok("policyExpansion=false disables policy chunks");
  }

  // ── 7. policyExpansion = false: table_summary query returns micro ─────
  {
    const result = await hybridQuery({ query: "Table with columns", limit: 5, customDb: db, generateEmbeddings: false, policyExpansion: false });
    const tableHits = result.filter((r) => r.retrieval_policy === "table_summary");
    assert.strictEqual(tableHits.length, 0, "no table_summary when policyExpansion=false");
    ok("policyExpansion=false: table query returns micro_chunks");
  }

  closeDatabase();
  try { rmSync(temp, { recursive: true, force: true }); } catch {}
  console.log(`✅ ALL POLICY RETRIEVAL TESTS PASSED (${passed}/7)`);
}

if (process.argv[1] && process.argv[1].endsWith("policy_retrieval.test.js")) {
  runPolicyRetrievalTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
