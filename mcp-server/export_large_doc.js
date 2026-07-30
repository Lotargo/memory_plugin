import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CORPUS_DIR } from "./benchmarks/fetch_real_corpus.js";
import { ingestDocument } from "./ingest/pipeline.js";
import { exportDocumentToFile, exportDocumentData } from "./ingest/exporter.js";
import { getDatabase } from "./db/database.js";
import { runMigrations } from "./db/migrations.js";

async function run() {
  const db = getDatabase();
  runMigrations(db);

  const targetFile = "axios_readme.md";
  const filePath = join(CORPUS_DIR, targetFile);

  console.log(`Reading large corpus document: ${targetFile}...`);
  const rawContent = await readFile(filePath, "utf-8");
  console.log(`File size: ${(rawContent.length / 1024).toFixed(1)} KB (${rawContent.length} chars)`);

  console.log("Ingesting document through pipeline...");
  const startIngest = performance.now();
  const ingRes = await ingestDocument({
    content: rawContent,
    type: "file",
    title: "Axios HTTP README",
    path: filePath,
    customDb: db,
    generateEmbeddings: false, // fast ingestion mode for export inspection
  });
  const ingestTime = (performance.now() - startIngest).toFixed(2);
  console.log(`Ingested in ${ingestTime} ms. Doc ID: ${ingRes.docId}`);

  console.log("Exporting document structure & metadata to JSON...");
  const exportPath = exportDocumentToFile(ingRes.docId, null, db);
  const exportedData = exportDocumentData(ingRes.docId, db);

  const tableBlocks = exportedData.medium_chunks.filter((m) => m.block_type === "table").length;
  const codeBlocks = exportedData.medium_chunks.filter((m) => m.block_type === "code").length;
  const paragraphBlocks = exportedData.medium_chunks.filter((m) => m.block_type === "paragraph").length;

  console.log("\n=== EXPORT DIAGNOSTICS ===");
  console.log(`Document Title:     ${exportedData.document.title}`);
  console.log(`Document Path:      ${exportedData.document.path}`);
  console.log(`Exported JSON File: ${exportPath}`);
  console.log(`Big Sections:       ${exportedData.counts.sections}`);
  console.log(`Medium Blocks:      ${exportedData.counts.medium_chunks} (Paragraphs: ${paragraphBlocks}, Code: ${codeBlocks}, Tables: ${tableBlocks})`);
  console.log(`Small Sentences:    ${exportedData.counts.micro_chunks}`);
  console.log(`TOC Items:          ${exportedData.document.toc ? exportedData.document.toc.length : 0}`);
  console.log("==========================\n");
}

run().catch((err) => {
  console.error("Export large doc failed:", err);
  process.exit(1);
});
