// Hermetic smoke test for the SDK. Uses an isolated MEMORY_DIR (set before
// any core import) so the live opencode store is never touched.
// Run: node sdk/test_sdk.js

import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";

const TEST_DIR = mkdtempSync(join(tmpdir(), "memory-sdk-test-"));

// Must be set before importing the engine (memory dir is captured at first import).
process.env.MEMORY_DIR = TEST_DIR;

const { MemoryEngine, createEngine } = await import("../index.js");

let passed = 0;
let failed = 0;
const assert = (cond, msg) => {
  if (cond) {
    passed++;
    console.log(`  ok  ${msg}`);
  } else {
    failed++;
    console.error(`FAIL  ${msg}`);
  }
};

const engine = new MemoryEngine();
assert(engine instanceof MemoryEngine, "MemoryEngine constructed");
assert(engine.memoryDir === TEST_DIR, `memoryDir isolated: ${engine.memoryDir}`);

// remember + recall
const r1 = await engine.remember({ fact: "SDK test fact alpha", scope: "project" });
assert(r1.status === "added", "remember added");
const r2 = await engine.remember({ fact: "SDK test fact alpha", scope: "project" });
assert(r2.status === "exists" && !r2.added, "remember dedupes identical fact");
await engine.remember({ fact: "SDK global fact", scope: "global" });

const all = await engine.recall({ scope: "all" });
const proj = await engine.recall({ scope: "project" });
assert(all.global.length === 1, "recall('all') has 1 global fact");
assert(all.project.facts.length === 1, "recall('all') has 1 project fact");
assert(all.project.facts[0].text.includes("SDK test fact alpha"), "project fact text correct");
assert(proj.global.length === 0, "recall('project') excludes global");
assert(proj.project.facts[0].index === 1, "recall project index is 1-based");

// forget by number
const f1 = await engine.forget({ query: "1", scope: "project" });
assert(f1.status === "removed" && f1.count === 1, "forget by number removed 1 fact");
const afterForget = await engine.recall({ scope: "project" });
assert(afterForget.project.facts.length === 0, "project store empty after forget");

// listStores
const stores = await engine.listStores();
assert(Array.isArray(stores), "listStores returns array");

// knowledge base (lexical-only, no model loading)
const ingest = await engine.ingestDocument({
  content: "# SDK Doc\n\nThis is a test document about hybrid RAG engines.",
  title: "SDK Doc",
  type: "text",
  generateEmbeddings: false,
});
assert(ingest.status === "success" && ingest.docId, `ingestDocument ok (${ingest.docId})`);

const q = await engine.queryKnowledgeBase({ query: "hybrid RAG", generateEmbeddings: false });
assert(q.results.length >= 1, `queryKnowledgeBase found ${q.results.length} hit(s)`);
assert(q.fusionAlgorithm === "LEXICAL_ONLY", "lexical-only fusion when embeddings disabled");

const stats = await engine.kbStats();
assert(stats.documents === 1, `kbStats documents = ${stats.documents}`);

const docs = await engine.kbList();
assert(docs.length === 1, "kbList returns 1 doc");

const readDoc = await engine.kbReadDocument(ingest.docId);
assert(readDoc.content.includes("hybrid RAG"), "kbReadDocument returns content");

// export/import round-trip
const snap = await engine.kbExportSnapshot();
assert(snap.outputPath.endsWith(".gz"), "kbExportSnapshot wrote .gz");
await engine.kbDelete(ingest.docId);
assert((await engine.kbStats()).documents === 0, "kbDelete removed doc");
await engine.kbImportSnapshot(snap.outputPath);
assert((await engine.kbStats()).documents === 1, "kbImportSnapshot restored doc");

// config
const cfg = await engine.getConfig();
assert(cfg.embeddingModel.includes("e5"), "getConfig returns defaults");
const upd = await engine.updateConfig({ batchSize: 7 });
assert(upd.batchSize === 7, "updateConfig applied");
await engine.resetConfig();

// factory
const engine2 = await createEngine();
assert(engine2 instanceof MemoryEngine, "createEngine factory works");

// cleanup
try {
  await engine.kbHardReset();
} catch {}
await engine.close();
await engine2.close();
rmSync(TEST_DIR, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
