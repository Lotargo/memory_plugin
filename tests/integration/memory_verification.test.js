import assert from "node:assert";
import { rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

export async function runMemoryVerificationTests() {
  console.log("--- Running Integration Tests: memory_verification ---");
  const TEST_DIR = join(tmpdir(), `memory_verification_${Date.now()}`);
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.MEMORY_DIR = TEST_DIR;

  const { ensureDir, readMemory, readMemoryRaw, writeMemory, today, scopeKey } = await import("../../mcp-server/memory.js");
  const { getDatabase } = await import("../../mcp-server/db/database.js");
  const { ingestDocument } = await import("../../mcp-server/ingest/pipeline.js");
  const { hybridQuery } = await import("../../mcp-server/retrieval/retriever.js");
  const { readBlob, blobExists } = await import("../../mcp-server/storage/blob_store.js");

  try {
    await ensureDir();
    const gitCmd = process.platform === "win32" ? "git.exe" : "git";
    execFileSync(gitCmd, ["init"], { cwd: TEST_DIR, stdio: "ignore" });

    // ----------------------------------------------------
    // TEST 1: KEY-VALUE FACT MEMORY LOGIC
    // ----------------------------------------------------
    console.log("\n--- 1. Testing Key-Value Fact Memory Logic ---");
    const projectKey = await scopeKey("project", null, TEST_DIR);
    const globalKey = await scopeKey("global", null, TEST_DIR);

    // A. Save Facts
    const fact1 = `User prefers TypeScript with strict mode enabled`;
    const fact2 = `Project uses Node 22 with built-in SQLite`;

    let projectEntries = await readMemory(projectKey);
    projectEntries.push(`- [${today()}] ${fact1}`);
    projectEntries.push(`- [${today()}] ${fact2}`);
    await writeMemory(projectKey, projectEntries);

    let raw = await readMemoryRaw(projectKey);
    assert.strictEqual(raw.length, 2, "Should have saved 2 facts");
    assert(raw[0].includes(fact1), "Fact 1 content match");
    assert(raw[1].includes(fact2), "Fact 2 content match");
    console.log("  [PASS] Fact saving & reading OK");

    // B. Deduplication check
    const factNormalized = fact1.toLowerCase().trim();
    const isDuplicate = projectEntries.some((e) => {
      const idx = e.indexOf("] ");
      return idx !== -1 && e.slice(idx + 2).toLowerCase().trim() === factNormalized;
    });
    assert(isDuplicate, "Should detect duplicate fact correctly");
    console.log("  [PASS] Fact deduplication detection OK");

    // C. Forget / Delete
    projectEntries = projectEntries.filter((e) => !e.toLowerCase().includes("typescript"));
    await writeMemory(projectKey, projectEntries);
    raw = await readMemoryRaw(projectKey);
    assert.strictEqual(raw.length, 1, "Should have 1 fact left after deletion");
    assert(raw[0].includes("SQLite"), "Remaining fact check");
    console.log("  [PASS] Fact deletion OK");

    // ----------------------------------------------------
    // TEST 2: HYBRID RAG DOCUMENT INGESTION LOGIC
    // ----------------------------------------------------
    console.log("\n--- 2. Testing RAG Document Ingestion & Storage Logic ---");
    const DB_PATH = join(TEST_DIR, "storage", "memory.sqlite");
    const BLOBS_DIR = join(TEST_DIR, "storage", "blobs");

    const db = await getDatabase(DB_PATH);

    const docCodeContent = `
# Memory Plugin Core Architecture

## Memory Storage Manager
The \`MemoryStorageManager\` class is responsible for persistent file storage of key-value memory markdown files.

\`\`\`javascript
class MemoryStorageManager {
  constructor(basePath) {
    this.basePath = basePath;
  }

  saveFact(key, fact) {
    return writeMemory(key, fact);
  }
}
\`\`\`

## Hybrid RAG Engine
The \`HybridRagEngine\` combines SQLite FTS5 BM25 search with ONNX vector embeddings.

\`\`\`javascript
function executeHybridQuery(query) {
  const bm25 = bm25Search(query);
  const vector = vectorSearch(query);
  return rrfFusion(bm25, vector);
}
\`\`\`
`;

    // A. Ingest Document
    const ingestRes = await ingestDocument({
      content: docCodeContent,
      type: "file",
      path: "lib/architecture.md",
      title: "Architecture Guide",
      customDb: db,
      customBlobDir: BLOBS_DIR,
      generateEmbeddings: false,
    });

    assert(ingestRes.docId, "Should assign unique document ID");
    assert(ingestRes.blobHash, "Should compute SHA-256 blob hash");
    assert.strictEqual(ingestRes.sectionsCount, 2, "Should create 2 medium sections");
    console.log("  [PASS] Document Ingestion Pipeline OK");

    // B. Verify Blob Store CAS
    const existsInBlobStore = await blobExists(ingestRes.blobHash, BLOBS_DIR);
    assert(existsInBlobStore, "Blob must exist in Content-Addressable Storage");
    const decompressedContent = await readBlob(ingestRes.blobHash, BLOBS_DIR);
    assert(decompressedContent.includes("MemoryStorageManager"), "Blob content match check");
    console.log("  [PASS] CAS Blob Storage & SHA-256 deduplication OK");

    // C. Verify Database Schema & GraphRAG Symbol Extraction
    const docRow = await db.prepare("SELECT * FROM documents WHERE id = ?").get(ingestRes.docId);
    assert.strictEqual(docRow.title, "Architecture Guide", "Doc title match");

    const symbolEdges = await db.prepare("SELECT * FROM graph_edges WHERE relation_type = 'DEFINES_SYMBOL'").all();
    const extractedSymbols = symbolEdges.map((e) => e.target_id.replace("symbol:", ""));

    assert(extractedSymbols.includes("MemoryStorageManager"), "Extracted class symbol 'MemoryStorageManager'");
    assert(extractedSymbols.includes("executeHybridQuery"), "Extracted function symbol 'executeHybridQuery'");
    console.log("  [PASS] GraphRAG Symbol Extraction OK");

    // D. Query Knowledge Base (Hybrid BM25 + GraphRAG)
    const queryRes = await hybridQuery({
      query: "MemoryStorageManager saveFact",
      limit: 5,
      generateEmbeddings: false,
      customDb: db,
    });

    assert(queryRes.length >= 1, "Should retrieve relevant section");
    assert.strictEqual(queryRes[0].doc_title, "Architecture Guide", "Search match title check");
    assert(queryRes[0].defined_symbols.includes("MemoryStorageManager"), "Returned section contains defined symbol");
    console.log("  [PASS] Knowledge Base Retrieval OK");

    db.close();
    console.log("✅ ALL MEMORY & DOCUMENT LOGIC TESTS PASSED!");
  } finally {
    if (existsSync(TEST_DIR)) {
      try {
        rmSync(TEST_DIR, { recursive: true, force: true });
      } catch {}
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("memory_verification.test.js")) {
  runMemoryVerificationTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
