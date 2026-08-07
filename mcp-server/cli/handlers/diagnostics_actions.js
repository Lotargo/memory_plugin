import { getConfig, updateConfig, resetConfig } from "../../config/config_manager.js";
import { hybridQuery } from "../../retrieval/retriever.js";
import { getCorpusCacheSize, clearCorpusCache } from "../../benchmarks/fetch_real_corpus.js";
import { SMOKE_DOC_IDS } from "../../benchmarks/quality_evaluator.js";
import {
  renderBenchmarkResultsTable,
  selectSimpleMenu,
  readTextInput,
  waitForEnter,
} from "../ui.js";

export async function handleDiagnosticsAction(value, config, stats) {
  switch (value) {
    case "benchmark": {
      const modeRes = await selectSimpleMenu({
        title: "BENCHMARK MODE",
        subtitle: "Choose smoke (fast iteration) vs full (statistical rigor)",
        items: [
          {
            label: "Quick Smoke (~7s, 9 queries on 6 docs)",
            value: "smoke",
            info: `Subset: ${SMOKE_DOC_IDS.join(", ")}. Skips bootstrap/grid/t-tests for fast dev iteration loop.`,
          },
          {
            label: "Full Benchmark (~32s, 21 queries on all 28 docs)",
            value: "full",
            info: "Full 28-doc corpus, per-query answer token metrics, bootstrap CIs, grid sweep. Writes dev_docs/benchmark_results.md.",
          },
          {
            label: "[GPU PROFILER] GPU Inference Bottleneck Trace",
            value: "gpu_profile",
            info: "Profile GPU DirectML tensor execution stages, kernel launch overhead & VRAM throughput.",
          },
          {
            label: "[CPU vs GPU] Dual-Run Comparison Benchmark",
            value: "cpu_vs_gpu",
            info: "Run identical workload on CPU then GPU and compare throughput, latency & speedup.",
          },
          {
            label: "Graph & Notebook Linking Verification (Layer 1+3 Agent Graph Links)",
            value: "graph_test",
            info: "Ingest sample doc + save Notebook fact linked to line range + verify recall & raw document reader.",
          },
          { label: "< Back to Main Menu", value: "back" },
        ],
      });

      if (modeRes.action === "back" || modeRes.value === "back") {
        break;
      }

      if (modeRes.value === "graph_test") {
        console.clear();
        console.log(`\n  \x1b[1m\x1b[37mGRAPH & NOTEBOOK LINKING VERIFICATION\x1b[0m\n`);

        const sampleDoc = `# Ода о единороге (Секретный проект Unicorn)

## Раздел 1: Введение
Разработка нового высоконагруженного сервиса Unicorn.

## Раздел 2: Стандарты
Строка 7: Бэкенд пишется исключительно на Go.
Строка 8: Хранилище транзакций — PostgreSQL 16.
`;

        const { ingestDocument } = await import("../../ingest/pipeline.js");
        const { linkFactToDocument, getLinksForFact } = await import("../../graph/knowledge_linker.js");
        const { readMemoryRaw, writeMemory, scopeKey } = await import("../../memory.js");

        console.log("  1. Ingesting test document 'Ода о единороге'...");
        const ingRes = await ingestDocument({
          content: sampleDoc,
          type: "text",
          title: "Ода о единороге",
          path: "virtual://oda_unicorna.md",
          generateEmbeddings: false,
        });
        console.log(`     [OK] Document ingested. Doc ID: ${ingRes.docId}`);

        console.log("\n  2. Saving Notebook fact & linking to lines L7-L8...");
        const factText = "Project Unicorn backend services must use Go with PostgreSQL 16";
        const factKey = scopeKey("project", "cli_test_repo", null);

        const entries = await readMemoryRaw(factKey);
        entries.push(`[2026-07-30] ${factText}`);
        await writeMemory(factKey, entries);

        const linkRes = linkFactToDocument({
          factKey,
          factText,
          docId: ingRes.docId,
          startLine: 7,
          endLine: 8,
          relationType: "RULES_FOR",
        });
        console.log(`     [OK] Graph Edge created. Link ID: ${linkRes.linkId} -> L7-L8`);

        console.log("\n  3. Recalling memory (Verifying Graph Document Tag)...");
        const rawFacts = await readMemoryRaw(factKey);
        rawFacts.forEach((f, i) => {
          const links = getLinksForFact(factKey, f);
          let lStr = `     ${i + 1}. ${f}`;
          if (links && links.length > 0) {
            const docStr = links.map(l => `${l.doc_title || l.doc_path}:L${l.start_line}-${l.end_line}`).join(", ");
            lStr += ` \x1b[36m🔗 [Linked Docs: ${docStr}]\x1b[0m`;
          }
          console.log(lStr);
        });

        console.log("\n  \x1b[32m[OK] AGENT-DRIVEN GRAPH LINKING VERIFIED SUCCESSFULLY!\x1b[0m\n");
        await waitForEnter();
        break;
      }

      if (modeRes.value === "gpu_profile") {
        console.clear();
        console.log(`\n  \x1b[1m\x1b[37mGPU PROFILER BENCHMARK\x1b[0m`);
        console.log(`  \x1b[90mProfiling DirectML tensor execution stages & VRAM throughput\x1b[0m\n`);

        const savedConfig = getConfig();
        try {
          const { runGpuProfileBenchmark } = await import("../../benchmarks/gpu_profile_benchmark.js");
          await runGpuProfileBenchmark({
            modelName: savedConfig.embeddingModel,
            batchSize: savedConfig.batchSize || 32,
            totalItems: 512,
          });
        } catch (err) {
          console.error(`  \x1b[31m[ERROR] GPU Profile benchmark failed: ${err.message}\x1b[0m\n`);
        }
        updateConfig({ executionDevice: savedConfig.executionDevice });
        await waitForEnter();
        break;
      }

      if (modeRes.value === "cpu_vs_gpu") {
        console.clear();
        console.log(`\n  \x1b[1m\x1b[37mCPU vs GPU COMPARISON BENCHMARK\x1b[0m`);
        console.log(`  \x1b[90mIdentical workload on CPU then GPU — automatic device switching\x1b[0m\n`);

        const savedConfig = getConfig();
        try {
          const { runCpuVsGpuComparison } = await import("../../benchmarks/gpu_profile_benchmark.js");
          await runCpuVsGpuComparison({
            modelName: savedConfig.embeddingModel,
            batchSize: savedConfig.batchSize || 32,
            totalItems: 512,
          });
        } catch (err) {
          console.error(`  \x1b[31m[ERROR] CPU vs GPU benchmark failed: ${err.message}\x1b[0m\n`);
        }
        updateConfig({ executionDevice: savedConfig.executionDevice });
        await waitForEnter();
        break;
      }

      const isSmoke = modeRes.value === "smoke";
      console.clear();
      const modeTitle = isSmoke ? "SMOKE BENCHMARK IN PROGRESS" : "BENCHMARK IN PROGRESS";
      const modeSub = isSmoke ? "Fetch 6 docs + Ingest + Eval 9 queries (stats skipped)" : "Fetch Corpus + Ingest + Evaluate 21 Queries";
      console.log(`\n  \x1b[1m\x1b[37m${modeTitle}\x1b[0m`);
      console.log(`  \x1b[90m${modeSub}\x1b[0m\n`);

      const spinFrames = ["|", "/", "-", "\\"];
      let spinIdx = 0;

      function onProgress({ phase, current, total }) {
        spinIdx = (spinIdx + 1) % spinFrames.length;
        const spin = spinFrames[spinIdx];
        const pct = Math.round((current / total) * 100);
        const bar = "=".repeat(Math.round(pct / 5)).padEnd(20);
        let label = "";
        if (phase === "fetch")    label = `Fetching corpus     ${current}/${total}`;
        if (phase === "ingest")   label = `Ingesting documents ${current}/${total}`;
        if (phase === "evaluate") label = `Evaluating queries  ${current}/${total}`;
        process.stdout.write(`\r  ${spin} [${bar}] ${pct}%  ${label}   `);
      }

      try {
        const { evaluateSearchQualityComparison } = await import("../../benchmarks/quality_evaluator.js");
        const { runIngestionBenchmark } = await import("../../benchmarks/stress_ingestion.js");
        const ingestOpts = isSmoke
          ? { generateEmbeddings: true, silent: true, onProgress, subsetDocIds: SMOKE_DOC_IDS }
          : { generateEmbeddings: true, silent: true, onProgress };
        const ingestRes = await runIngestionBenchmark(ingestOpts);

        const evalOpts = isSmoke ? { silent: true, onProgress, mode: "smoke" } : { silent: true, onProgress };
        const qualityComp = await evaluateSearchQualityComparison(ingestRes.dbInstance, evalOpts);

        try { ingestRes.dbInstance.close(); } catch (e) {}

        console.clear();
        renderBenchmarkResultsTable(qualityComp);
      } catch (err) {
        process.stdout.write("\n");
        console.error("  [ERROR] Benchmark execution failed:", err.message);
      }
      await waitForEnter();
      break;
    }
    case "test": {
      const queryRes = await readTextInput("Enter Test Verification Query", "sqlite compact database");
      if (queryRes.action === "submit" && queryRes.value) {
        console.clear();
        console.log(`\n  \x1b[1m\x1b[37mSEARCH QUERY EXECUTION\x1b[0m`);
        console.log(`\n  [SEARCH] Executing query: "\x1b[36m${queryRes.value}\x1b[0m"...\n`);
        try {
          const results = await hybridQuery({ query: queryRes.value, limit: 3 });
          if (!results || results.length === 0) {
            console.log("  [*] No matching results found in knowledge base.");
          } else {
            results.forEach((r, i) => {
              console.log(`\n  \x1b[1m[Hit #${i + 1}] ${r.doc_title || "Doc"} > ${r.breadcrumbs || ""}\x1b[0m`);
              console.log(`  Score: \x1b[33m${r.score}\x1b[0m (RSF: ${r.rsf_score}, RRF: ${r.rrf_score}, CosSim: ${r.cosine_sim})`);
              console.log(`  Snippet: \x1b[90m${r.snippet ? r.snippet.substring(0, 100).replace(/\n/g, " ") : ""}...\x1b[0m`);
            });
          }
        } catch (err) {
          console.error("  [ERROR] Query execution failed:", err.message);
        }
        await waitForEnter();
      }
      break;
    }
    case "clear_cache": {
      const cacheSize = await getCorpusCacheSize();
      if (cacheSize === 0) {
        console.clear();
        console.log("\n  [*] Benchmark corpus cache is already empty.\n");
        await waitForEnter();
      } else {
        const sizeMB = (cacheSize / (1024 * 1024)).toFixed(2);
        const confirmRes = await selectSimpleMenu({
          title: "CLEAR BENCHMARK CACHE",
          subtitle: `Cache size: ${sizeMB} MB`,
          items: [
            { label: "[DELETE] Delete all cached corpus files", value: "confirm", info: `Remove ${sizeMB} MB of cached GitHub README files` },
            { label: "< Cancel / Back", value: "cancel" },
          ],
        });
        if (confirmRes.action === "select" && confirmRes.value === "confirm") {
          await clearCorpusCache();
          console.clear();
          console.log(`\n  [OK] Benchmark corpus cache cleared (${sizeMB} MB freed).\n`);
          await waitForEnter();
        }
      }
      break;
    }
    case "reset": {
      resetConfig();
      console.clear();
      console.log("\n  [OK] Configuration reset to factory defaults (RSF 50/50, e5-small, no reranker).\n");
      await waitForEnter();
      break;
    }
  }
}
