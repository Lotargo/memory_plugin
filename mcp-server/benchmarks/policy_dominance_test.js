import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, existsSync } from "node:fs";
import { getDatabase } from "../db/database.js";
import { ingestDocument } from "../ingest/pipeline.js";
import { embedText } from "../ml/model_manager.js";
import { hybridQuery } from "../retrieval/retriever.js";
import { RAW_CORPUS, POLICY_DOMINANCE_QUERIES } from "./raw_corpus_data.js";

const K = 5;

function chunkTypeLabel(retrievalPolicy) {
  if (retrievalPolicy === "table_summary") return "TABLE";
  if (retrievalPolicy === "code_signature") return "CODE";
  return "MICRO";
}

async function ingestCorpus(db, blobDir) {
  let totalSections = 0;
  let totalMicro = 0;

  for (const doc of RAW_CORPUS) {
    const res = await ingestDocument({
      content: doc.content,
      type: "text",
      title: doc.title,
      path: `benchmark://${doc.id}`,
      generateEmbeddings: true,
      customDb: db,
      customBlobDir: blobDir,
    });
    totalSections += res.sectionsCount;
    totalMicro += res.microChunksCount;
    if (global.gc) global.gc();
  }

  const policyRow = await db.prepare(
    `SELECT COUNT(*) as cnt FROM micro_chunks WHERE retrieval_policy IN ('table_summary', 'code_signature')`
  ).get();
  const totalPolicy = policyRow?.cnt || 0;

  return { totalSections, totalMicro, totalPolicy };
}

async function runMode(db, query, mode, alpha = 0.5) {
  const hits = await hybridQuery({
    query: query.query,
    limit: K,
    customDb: db,
    fusionAlgorithm: mode,
    alpha,
    generateEmbeddings: true,
    includeGraphContext: false,
  });
  return hits;
}

function analyzeChunkTypes(hits) {
  let policyCount = 0;
  let microCount = 0;
  const types = [];
  for (const hit of hits) {
    const isPolicy = hit.retrieval_policy === "table_summary" || hit.retrieval_policy === "code_signature";
    if (isPolicy) {
      policyCount++;
      types.push(chunkTypeLabel(hit.retrieval_policy));
    } else {
      microCount++;
      types.push("MICRO");
    }
  }
  return { policyCount, microCount, types };
}

function renderResultsTable(results) {
  const wQ = 42;
  const wMode = 12;
  const wTypes = 32;
  const wWinner = 8;

  const sep = `├${"─".repeat(wQ + 2)}┼${"─".repeat(wMode + 2)}┼${"─".repeat(wTypes + 2)}┼${"─".repeat(wWinner + 2)}┤`;
  const top = `┌${"─".repeat(wQ + 2)}┬${"─".repeat(wMode + 2)}┬${"─".repeat(wTypes + 2)}┬${"─".repeat(wWinner + 2)}┐`;
  const bot = `└${"─".repeat(wQ + 2)}┴${"─".repeat(wMode + 2)}┴${"─".repeat(wTypes + 2)}┴${"─".repeat(wWinner + 2)}┘`;

  console.log(`\x1b[36m${top}\x1b[0m`);
  console.log(`\x1b[36m│\x1b[0m \x1b[1m${"Query".padEnd(wQ)}\x1b[0m \x1b[36m│\x1b[0m \x1b[1m${"Mode".padEnd(wMode)}\x1b[0m \x1b[36m│\x1b[0m \x1b[1m${"Chunk Types (top-5)".padEnd(wTypes)}\x1b[0m \x1b[36m│\x1b[0m \x1b[1m${"Winner".padEnd(wWinner)}\x1b[0m \x1b[36m│\x1b[0m`);
  console.log(`\x1b[36m${sep}\x1b[0m`);

  for (const r of results) {
    const qShort = r.query.length > wQ ? r.query.substring(0, wQ - 3) + "..." : r.query;
    const typesStr = r.types.join(", ") || "(none)";
    const winner = r.policyCount > r.microCount ? "\x1b[33mPOLICY\x1b[0m" : r.microCount > 0 ? "\x1b[32mMICRO\x1b[0m" : "—";
    console.log(
      `\x1b[36m│\x1b[0m ${qShort.padEnd(wQ)} \x1b[36m│\x1b[0m ${r.mode.padEnd(wMode)} \x1b[36m│\x1b[0m ${typesStr.padEnd(wTypes)} \x1b[36m│\x1b[0m ${winner.padEnd(wWinner)} \x1b[36m│\x1b[0m`
    );
  }
  console.log(`\x1b[36m${bot}\x1b[0m`);
}

async function main() {
  const line = "─".repeat(60);
  console.log(`\x1b[36m╭${line}╮\x1b[0m`);
  console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37mPOLICY DOMINANCE BENCHMARK\x1b[0m`.padEnd(72) + `\x1b[36m│\x1b[0m`);
  console.log(`\x1b[36m│\x1b[0m  \x1b[90mRaw docs: tables + code + text | chunk-type distribution\x1b[0m`.padEnd(72) + `\x1b[36m│\x1b[0m`);
  console.log(`\x1b[36m╰${line}╯\x1b[0m`);

  const TEST_DIR = join(tmpdir(), `memory_policy_bench_${Date.now()}`);
  const TEST_DB_PATH = join(TEST_DIR, "bench_memory.sqlite");
  const TEST_BLOB_DIR = join(TEST_DIR, "blobs");

  const db = await getDatabase(TEST_DB_PATH);

  console.log("\n[INGEST] Processing raw corpus...");
  const ingestMeta = await ingestCorpus(db, TEST_BLOB_DIR);
  console.log(`  Sections: ${ingestMeta.totalSections}, Micro-chunks: ${ingestMeta.totalMicro}, Policy chunks: ${ingestMeta.totalPolicy}`);

  const modes = ["bm25_only", "vector_only", "rrf", "rsf"];
  const allResults = [];

  // Per-mode aggregation
  const modeStats = {};
  for (const mode of modes) modeStats[mode] = { policy: 0, micro: 0, total: 0 };

  // Per-category aggregation
  const catStats = {};

  console.log("\n[EVAL] Running queries across modes...");
  for (const q of POLICY_DOMINANCE_QUERIES) {
    const cat = q.expectedDocIds[0].split("_")[0];
    if (!catStats[cat]) catStats[cat] = { policy: 0, micro: 0, total: 0 };

    for (const mode of modes) {
      const hits = await runMode(db, q, mode);
      const analysis = analyzeChunkTypes(hits);

      allResults.push({
        query: q.query,
        mode,
        types: analysis.types,
        policyCount: analysis.policyCount,
        microCount: analysis.microCount,
        expectedWinner: q.expectedWinner,
        queryType: q.query_type,
      });

      modeStats[mode].policy += analysis.policyCount;
      modeStats[mode].micro += analysis.microCount;
      modeStats[mode].total += hits.length;

      catStats[cat].policy += analysis.policyCount;
      catStats[cat].micro += analysis.microCount;
      catStats[cat].total += hits.length;
    }
  }

  // Render detailed table
  console.log("\n[RESULTS] Chunk-type distribution per query per mode:");
  renderResultsTable(allResults);

  // Render mode summary
  console.log("\n[SUMMARY] Aggregate chunk-type ratio per mode:");
  console.log("┌────────────┬─────────┬─────────┬──────────┐");
  console.log("│ Mode       │ Policy  │ Micro   │ Policy % │");
  console.log("├────────────┼─────────┼─────────┼──────────┤");
  for (const mode of modes) {
    const s = modeStats[mode];
    const pct = s.total > 0 ? ((s.policy / s.total) * 100).toFixed(1) : "0.0";
    console.log(`│ ${mode.padEnd(10)} │ ${String(s.policy).padStart(7)} │ ${String(s.micro).padStart(7)} │ ${pct.padStart(7)}% │`);
  }
  console.log("└────────────┴─────────┴─────────┴──────────┘");

  // Render category summary
  console.log("\n[CATEGORY] Chunk-type ratio by document category:");
  console.log("┌──────────────────┬─────────┬─────────┬──────────┐");
  console.log("│ Category         │ Policy  │ Micro   │ Policy % │");
  console.log("├──────────────────┼─────────┼─────────┼──────────┤");
  for (const [cat, s] of Object.entries(catStats)) {
    const pct = s.total > 0 ? ((s.policy / s.total) * 100).toFixed(1) : "0.0";
    console.log(`│ ${cat.padEnd(16)} │ ${String(s.policy).padStart(7)} │ ${String(s.micro).padStart(7)} │ ${pct.padStart(7)}% │`);
  }
  console.log("└──────────────────┴─────────┴─────────┴──────────┘");

  // Diagnosis
  console.log("\n[DIAGNOSIS]");
  const allPolicy = Object.values(modeStats).reduce((a, m) => a + m.policy, 0);
  const allMicro = Object.values(modeStats).reduce((a, m) => a + m.micro, 0);
  const allTotal = allPolicy + allMicro;
  const globalPct = allTotal > 0 ? ((allPolicy / allTotal) * 100).toFixed(1) : "0.0";
  console.log(`  Global policy dominance: ${globalPct}% (${allPolicy}/${allTotal} chunks)`);

  if (Number(globalPct) > 80) {
    console.log("  ⚠️  Policy chunks dominate — benchmark confirms the issue.");
    console.log("  → Consider: separate policy/micro slots (Option A) or per-source dedup (Option B)");
  } else if (Number(globalPct) < 40) {
    console.log("  ✅ Micro chunks dominate — policy expansion is conservative.");
  } else {
    console.log("  ✅ Balanced distribution — both chunk types compete fairly.");
  }

  // Check if modes differ
  const modePcts = modes.map(m => {
    const s = modeStats[m];
    return s.total > 0 ? (s.policy / s.total) : 0;
  });
  const modeSpread = Math.max(...modePcts) - Math.min(...modePcts);
  console.log(`  Mode spread: ${(modeSpread * 100).toFixed(1)}% (max policy% - min policy% across modes)`);
  if (modeSpread < 0.1) {
    console.log("  ⚠️  All modes produce similar distributions — modes are not differentiated.");
  } else {
    console.log("  ✅ Modes produce different distributions — benchmark can distinguish them.");
  }

  // Cleanup
  try { db.close(); } catch {}
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

main().catch(err => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
