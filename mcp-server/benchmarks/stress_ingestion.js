import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync, existsSync } from "node:fs";
import { getDatabase } from "../db/database.js";
import { ingestDocument } from "../ingest/pipeline.js";
import { CORPUS_DIR, fetchRealCorpus } from "./fetch_real_corpus.js";

console.log("==========================================================");
console.log("=== Real-World Document Ingestion Benchmark            ===");
console.log("==========================================================");

export async function runIngestionBenchmark(options = { generateEmbeddings: false }) {
  const corpus = await fetchRealCorpus();
  const TEST_DIR = join(tmpdir(), `memory_bench_ingest_${Date.now()}`);
  const TEST_DB_PATH = join(TEST_DIR, "bench_memory.sqlite");
  const TEST_BLOB_DIR = join(TEST_DIR, "blobs");

  const db = getDatabase(TEST_DB_PATH);

  console.log(`\n🚀 Starting ingestion benchmark across ${corpus.length} real documents...`);
  console.log(`   ONNX Embeddings Enabled: ${options.generateEmbeddings}`);

  const startMem = process.memoryUsage().rss;
  const startTime = performance.now();

  let totalSections = 0;
  let totalMicroChunks = 0;
  let totalBytes = 0;
  let deduplicatedCount = 0;

  for (let i = 0; i < corpus.length; i++) {
    const file = corpus[i];
    const content = await readFile(file.path, "utf-8");
    totalBytes += content.length;

    const ingestRes = await ingestDocument({
      content,
      type: "file",
      title: file.title,
      path: file.path,
      generateEmbeddings: options.generateEmbeddings,
      customDb: db,
      customBlobDir: TEST_BLOB_DIR,
    });

    totalSections += ingestRes.sectionsCount;
    totalMicroChunks += ingestRes.microChunksCount;
    if (ingestRes.deduplicated) deduplicatedCount++;

    if ((i + 1) % 5 === 0 || i === corpus.length - 1) {
      console.log(`   [Progress] Ingested ${i + 1}/${corpus.length} docs (${totalMicroChunks} micro-chunks)`);
    }
  }

  const endTime = performance.now();
  const endMem = process.memoryUsage().rss;

  const durationMs = endTime - startTime;
  const durationSec = durationMs / 1000;
  const docsPerSec = corpus.length / durationSec;
  const chunksPerSec = totalMicroChunks / durationSec;

  const dbStat = await stat(TEST_DB_PATH);
  const dbSizeBytes = dbStat.size;

  let blobSizeBytes = 0;
  if (existsSync(TEST_BLOB_DIR)) {
    const blobFiles = await readdir(TEST_BLOB_DIR, { recursive: true });
    for (const bf of blobFiles) {
      const p = join(TEST_BLOB_DIR, bf);
      const st = await stat(p);
      if (st.isFile()) blobSizeBytes += st.size;
    }
  }

  const metrics = {
    docCount: corpus.length,
    totalSections,
    totalMicroChunks,
    totalBytes,
    deduplicatedCount,
    durationSec: Number(durationSec.toFixed(2)),
    docsPerSec: Number(docsPerSec.toFixed(2)),
    chunksPerSec: Number(chunksPerSec.toFixed(2)),
    dbSizeMB: Number((dbSizeBytes / (1024 * 1024)).toFixed(2)),
    blobSizeMB: Number((blobSizeBytes / (1024 * 1024)).toFixed(2)),
    ramUsageMB: Number(((endMem - startMem) / (1024 * 1024)).toFixed(2)),
    dbPath: TEST_DB_PATH,
    blobDir: TEST_BLOB_DIR,
    dbInstance: db,
  };

  console.log("\n📊 Ingestion Performance Summary:");
  console.log(`  - Total Documents: ${metrics.docCount}`);
  console.log(`  - Total Sections: ${metrics.totalSections}`);
  console.log(`  - Total Micro-Chunks: ${metrics.totalMicroChunks}`);
  console.log(`  - Duration: ${metrics.durationSec}s`);
  console.log(`  - Throughput: ${metrics.docsPerSec} docs/sec | ${metrics.chunksPerSec} chunks/sec`);
  console.log(`  - Database Size: ${metrics.dbSizeMB} MB`);
  console.log(`  - Blob Storage Size: ${metrics.blobSizeMB} MB`);
  console.log(`  - Memory Footprint (Delta RSS): ${metrics.ramUsageMB} MB`);

  return metrics;
}

if (process.argv[1] && process.argv[1].includes("stress_ingestion.js")) {
  const metrics = await runIngestionBenchmark({ generateEmbeddings: false });
  if (existsSync(dirname(metrics.dbPath))) {
    try {
      metrics.dbInstance.close();
      rmSync(dirname(metrics.dbPath), { recursive: true, force: true });
    } catch {}
  }
}
