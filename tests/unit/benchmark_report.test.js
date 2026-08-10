import assert from "node:assert";

// Guards the benchmark report generator (audit item L21). The headline
// RRF/RSF rows are computed with the RUNTIME defaults (k=60, alpha=0.5), but
// used to be labelled with the grid-search winner (k=10) — so every published
// report, README and BENCHMARKS.md carried a wrong k for the quoted numbers.
//
// Importing run_benchmarks.js must also stay side-effect free: it used to kick
// off a full ONNX benchmark run on import.
const { buildMarkdownReport } = await import("../../mcp-server/benchmarks/run_benchmarks.js");

// Mirrors the shape of a real dev_docs/benchmark_*.json artifact.
const agg = (mrr, recall, ndcg) => ({ mrr, recall, ndcg, n: 21 });

const qualityComp = {
  mode: "full",
  defaultAlpha: 0.5,
  defaultRrfK: 60,
  winner: "hybrid_rsf",
  bm25: agg(0.6706, 0.7619, 0.6934),
  vector: agg(0.8135, 1, 0.8612),
  hybridRrf: agg(0.881, 0.9524, 0.8997),
  hybridRsf: agg(0.9286, 1, 0.9473),
  bootstrap: {
    bm25: { mrrCI: [0.4802, 0.8492], recallCI: [0.5714, 0.9048], ndcgCI: [0.5062, 0.8696] },
    vector: { mrrCI: [0.7024, 0.9286], recallCI: [1, 1], ndcgCI: [0.7784, 0.9473] },
    rrf: { mrrCI: [0.7381, 0.9762], recallCI: [0.8571, 1], ndcgCI: [0.7817, 0.9824] },
    rsf: { mrrCI: [0.8571, 1], recallCI: [1, 1], ndcgCI: [0.8946, 1] },
  },
  pairedTests: {
    rrfVsVector: { meanDiff: 0.0675, t: 1.23, p: 0.2312, sem: 0.055, n: 21 },
    rsfVsVector: { meanDiff: 0.1151, t: 2.01, p: 0.0581, sem: 0.057, n: 21 },
    rrfVsRsf: { meanDiff: -0.0476, t: -1.45, p: 0.1623, sem: 0.033, n: 21 },
  },
  categoryBreakdown: [
    { category: "Semantic RU->EN", n: 7, bm25: agg(0.619, 0.7143, 0.6429), vector: agg(0.75, 1, 0.8132), rrf: agg(0.8571, 1, 0.8946), rsf: agg(0.8571, 1, 0.8946) },
  ],
  rsfGrid: [{ alpha: 0.5, mrr: 0.9286, recall: 1, ndcg: 0.9473, top1Wins: 18 }],
  rrfGrid: [
    { k: 10, mrr: 0.8905, recall: 1, ndcg: 0.9181, top1Wins: 17 },
    { k: 60, mrr: 0.881, recall: 0.9524, ndcg: 0.8997, top1Wins: 17 },
  ],
  // Deliberately DIFFERENT from the runtime defaults: this is what used to
  // leak into the headline labels.
  bestRsfAlpha: { alpha: 0.5, mrr: 0.9286, recall: 1, ndcg: 0.9473, top1Wins: 18 },
  bestRrfK: { k: 10, mrr: 0.8905, recall: 1, ndcg: 0.9181, top1Wins: 17 },
  latency: { mean: 42.1, p50: 39, p95: 71, p99: 88, max: 91 },
  breakdown: [
    { id: "Q1", target: "axios_readme", category: "Semantic RU->EN", bm25Rank: "#1", vectorRank: "#2", rrfRank: "#1", rsfRank: "#1", query: "http client" },
    { id: "Q2", target: "rust_readme", category: "Cross-Lingual", bm25Rank: "MISSED", vectorRank: "#1", rrfRank: "#1", rsfRank: "#1", query: "memory safety" },
  ],
};

const ingestMetrics = {
  docCount: 32,
  networkDocCount: 0,
  localDocCount: 32,
  totalSections: 281,
  totalMicroChunks: 1202,
  durationSec: 50.99,
  docsPerSec: 0.63,
  chunksPerSec: 23.57,
  dbSizeMB: 5.19,
  blobSizeMB: 0.1,
  ramUsageMB: 38.42,
  settledRamUsageMB: 38.16,
  peakRamUsageMB: 93.95,
  ramBaseline: "post-model-warmup(post-gc)",
  metric: "heapUsed + external",
};

export async function runBenchmarkReportTests() {
  console.log("--- Running Unit Tests: benchmark_report ---");

  console.log("1. Testing headline rows are labelled with the RUNTIME defaults...");
  const md = buildMarkdownReport({ ingestMetrics, qualityComp, totalTimeSec: "61.20" });
  const line = (needle) => md.split("\n").find((l) => l.includes(needle));

  const rrfRow = line("Hybrid RRF (Reciprocal Rank)");
  const rsfRow = line("Hybrid RSF (Relative Score)");
  assert.ok(rrfRow.includes("k=60"), "RRF headline must be labelled k=60 (the value used)");
  assert.ok(!rrfRow.includes("k=10"), "RRF headline must NOT use the grid winner k=10");
  assert.ok(rsfRow.includes("α=0.5"), "RSF headline must be labelled alpha=0.5");
  assert.ok(rrfRow.includes("0.881"), "RRF row carries the measured MRR");
  assert.ok(rsfRow.includes("0.9286"), "RSF row carries the measured MRR");
  console.log("   [PASS] headline labels match the measured parameters OK");

  console.log("2. Testing the grid winner is still reported separately...");
  const bestK = line("**Best k by MRR**");
  const takeaway = line("Configurable CLI Architecture");
  assert.ok(bestK.includes("10"), "section 6 still reports the grid winner k=10");
  assert.ok(takeaway.includes("k=60"), "takeaway states the runtime default");
  assert.ok(takeaway.includes("k=10"), "takeaway still surfaces the grid winner");
  console.log("   [PASS] grid sweep reported without polluting the headline OK");

  console.log("3. Testing the report renders completely...");
  assert.ok(!md.includes("${"), "no unresolved template placeholders");
  assert.ok(!md.includes("undefined"), "no 'undefined' leaked into the report");
  for (const section of ["## 1.", "## 2.", "## 3.", "## 4.", "## 5.", "## 6.", "## 7.", "## 8.", "## 9."]) {
    assert.ok(md.includes(section), `report contains section ${section}`);
  }
  assert.ok(md.includes("1202 chunks"), "ingestion metrics rendered");
  console.log("   [PASS] full report renders OK");

  console.log("4. Testing fallbacks when the evaluator omits the defaults...");
  const legacy = buildMarkdownReport({
    ingestMetrics,
    qualityComp: { ...qualityComp, defaultAlpha: undefined, defaultRrfK: undefined },
    totalTimeSec: "61.20",
  });
  assert.ok(
    legacy.split("\n").find((l) => l.includes("Hybrid RRF (Reciprocal Rank)")).includes("k=60"),
    "falls back to k=60, never to the grid winner"
  );
  console.log("   [PASS] defaults fallback OK");

  console.log("✅ ALL BENCHMARK REPORT TESTS PASSED SUCCESSFULLY!");
}

if (process.argv[1] && process.argv[1].endsWith("benchmark_report.test.js")) {
  runBenchmarkReportTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
