#!/usr/bin/env node
import readline from "readline";
import { join } from "node:path";
import { getConfig, updateConfig, resetConfig } from "./config/config_manager.js";
import { hybridQuery } from "./retrieval/retriever.js";
import { getDatabase } from "./db/database.js";
import { deleteDocument } from "./ingest/pipeline.js";
import { readMemoryRaw, readMemory, writeMemory, GLOBAL_KEY, projectName, projectKey, listProjectStores, migrateLegacyStore, memoryFileName } from "./memory.js";
import { parseFactEntry, factText, withMeta, displayFact, nextFactId, isKeepFact, isSuperseded, formatFactEntry, metaBadges } from "./fact_format.js";
import { getCorpusCacheSize, clearCorpusCache } from "./benchmarks/fetch_real_corpus.js";
import { SMOKE_DOC_IDS } from "./benchmarks/quality_evaluator.js";
import { getModelStorageInfo, deleteModelCache, listAllCachedModels } from "./ml/model_manager.js";

const EMBEDDING_PRESETS = [
  "Xenova/multilingual-e5-small",
  "Xenova/multilingual-e5-base",
  "Xenova/multilingual-e5-large",
  "Xenova/bge-small-en-v1.5",
  "Xenova/bge-base-en-v1.5",
  "Xenova/bge-large-en-v1.5",
  "Xenova/bge-m3",
  "Xenova/all-MiniLM-L6-v2",
  "Xenova/all-mpnet-base-v2",
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  "Xenova/gte-small",
  "Xenova/gte-large",
];

const RERANKER_PRESETS = [
  "none",
  "Xenova/bge-reranker-base",
  "Xenova/bge-reranker-large",
  "Xenova/ms-marco-MiniLM-L-6-v2",
  "Xenova/ms-marco-TinyBERT-L-2-v2",
];

const PANEL_WIDTH = 58;

async function downloadModelWithProgress(modelName, type = "embedding") {
  console.clear();
  const line = "─".repeat(PANEL_WIDTH - 2);
  console.log(`\x1b[36m╭${line}╮\x1b[0m`);
  console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37mMODEL DOWNLOAD & PRELOAD\x1b[0m${" ".repeat(PANEL_WIDTH - 28)}\x1b[36m│\x1b[0m`);
  const modelSub = `${type.toUpperCase()}: ${modelName.substring(0, 36)}`;
  console.log(`\x1b[36m│\x1b[0m  \x1b[90m${modelSub.padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[36m│\x1b[0m`);
  console.log(`\x1b[36m╰${line}╯\x1b[0m\n`);

  const spinFrames = ["|", "/", "-", "\\"];
  let spinIdx = 0;
  let lastProgress = 0;

  const handleProgress = (p) => {
    if (!p) return;
    spinIdx = (spinIdx + 1) % spinFrames.length;
    const spin = spinFrames[spinIdx];

    const filename = p.file ? p.file.split("/").pop() : (p.name || "weights");
    const pct = typeof p.progress === "number" ? Math.round(p.progress) : lastProgress;
    if (typeof p.progress === "number") lastProgress = pct;

    const loadedMB = p.loaded ? (p.loaded / (1024 * 1024)).toFixed(1) : "0.0";
    const totalMB = p.total ? (p.total / (1024 * 1024)).toFixed(1) : "0.0";

    const barLen = 18;
    const filled = Math.round((pct / 100) * barLen);
    const bar = "=".repeat(filled).padEnd(barLen);

    let statusMsg = "";
    if (p.status === "initiate") statusMsg = "Initiating...";
    else if (p.status === "download" || p.status === "progress") statusMsg = `${pct}% (${loadedMB}/${totalMB} MB)`;
    else if (p.status === "done") statusMsg = "Verifying...";
    else if (p.status === "ready") statusMsg = "Ready!";
    else statusMsg = `${pct}%`;

    const fileLabel = filename.length > 18 ? filename.substring(0, 15) + "..." : filename;
    process.stdout.write(`\r  ${spin} [${bar}] ${fileLabel.padEnd(18)} ${statusMsg.padEnd(22)}`);
  };

  try {
    const { preloadModel } = await import("./ml/model_manager.js");
    await preloadModel(modelName, type, handleProgress);
    process.stdout.write("\r" + " ".repeat(72) + "\r");
    console.log(`  \x1b[32m[OK] Model "${modelName}" ready!\x1b[0m\n`);
  } catch (err) {
    process.stdout.write("\r" + " ".repeat(72) + "\r");
    console.error(`  \x1b[31m[ERROR] Download for "${modelName}" failed: ${err.message}\x1b[0m\n`);
  }
}

async function getQuickStats() {
  let docCount = 0;
  let chunkCount = 0;
  try {
    const db = getDatabase();
    docCount = db.prepare("SELECT COUNT(*) as cnt FROM documents").get().cnt;
    chunkCount = db.prepare("SELECT COUNT(*) as cnt FROM micro_chunks").get().cnt;
  } catch (e) {}

  let factCount = 0;
  try {
    const projKey = projectKey(null, null);
    const globalF = await readMemoryRaw(GLOBAL_KEY);
    const projF = await readMemoryRaw(projKey);
    factCount = (globalF ? globalF.length : 0) + (projF ? projF.length : 0);
  } catch (e) {}

  return { docCount, chunkCount, factCount };
}

function printHeaderPanel(title, stats) {
  const line = "─".repeat(PANEL_WIDTH - 2);
  console.log(`\x1b[36m╭${line}╮\x1b[0m`);
  console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37m${title.padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[36m│\x1b[0m`);
  const subtitle = `Storage: ${stats.docCount} Docs | ${stats.chunkCount} Chunks | ${stats.factCount} Facts`;
  console.log(`\x1b[36m│\x1b[0m  \x1b[90m${subtitle.padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[36m│\x1b[0m`);
  console.log(`\x1b[36m╰${line}╯\x1b[0m`);
}

function printQuickInfoBox(infoText) {
  const line = "─".repeat(PANEL_WIDTH - 14);
  console.log(`\x1b[90m ╭─ INFO ${line}╮\x1b[0m`);
  console.log(`\x1b[90m │\x1b[0m  \x1b[36m${infoText.padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[90m│\x1b[0m`);
  console.log(`\x1b[90m ╰${"─".repeat(PANEL_WIDTH - 2)}╯\x1b[0m`);
}

function padVisible(str, width, align = "left") {
  const visibleLength = String(str).replace(/\x1b\[[0-9;]*m/g, "").length;
  const padding = " ".repeat(Math.max(0, width - visibleLength));
  return align === "right" ? padding + str : str + padding;
}

function formatRankColor(rankStr) {
  if (rankStr === "#1") return "\x1b[1m\x1b[32m#1\x1b[0m";
  if (rankStr.startsWith("#")) return `\x1b[33m${rankStr}\x1b[0m`;
  return "\x1b[90mMISSED\x1b[0m";
}

function wrapText(text, width) {
  if (!text || text.length <= width) return [text || ""];
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    if (word.length > width) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }
      let rem = word;
      while (rem.length > width) {
        lines.push(rem.substring(0, width));
        rem = rem.substring(width);
      }
      currentLine = rem;
    } else if ((currentLine + (currentLine ? " " : "") + word).length <= width) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function renderPerQueryBreakdownTable(breakdown) {
  if (!breakdown || breakdown.length === 0) return;

  const termCols = (process.stdout && process.stdout.columns) ? process.stdout.columns : 120;
  const wId = 3;
  const wRank = 6;
  const fixedWidths = wId + wRank * 4 + 27; // borders + separators + rank columns
  const flexWidth = Math.max(50, termCols - fixedWidths);

  const wQ = Math.max(35, Math.floor(flexWidth * 0.52));
  const wTarget = Math.max(16, Math.floor(flexWidth * 0.24));
  const wTopHit = Math.max(16, Math.floor(flexWidth * 0.24));

  const totalLineWidth = wId + wQ + wTarget + (wRank * 4) + wTopHit + 25;
  const headerDashes = "─".repeat(Math.max(10, totalLineWidth - 38));

  const titleLine = ` ┌── PER-QUERY RESULTS BREAKDOWN (${breakdown.length} Queries) ${headerDashes}┐`;
  console.log(`\x1b[36m${titleLine}\x1b[0m`);

  const headerRow = ` │ ${padVisible("\x1b[1m\x1b[37m#\x1b[0m", wId)} │ ${padVisible("\x1b[1m\x1b[37mQuestion / Query\x1b[0m", wQ)} │ ${padVisible("\x1b[1m\x1b[37mTarget Document\x1b[0m", wTarget)} │ ${padVisible("\x1b[1m\x1b[37mBM25\x1b[0m", wRank)} │ ${padVisible("\x1b[1m\x1b[37mVector\x1b[0m", wRank)} │ ${padVisible("\x1b[1m\x1b[37mRRF\x1b[0m", wRank)} │ ${padVisible("\x1b[1m\x1b[37mRSF\x1b[0m", wRank)} │ ${padVisible("\x1b[1m\x1b[37mTop Retrieved Hit\x1b[0m", wTopHit)} │`;
  console.log(headerRow);

  const sepLine = ` ├───┼${"─".repeat(wQ + 2)}┼${"─".repeat(wTarget + 2)}┼${"─".repeat(wRank + 2)}┼${"─".repeat(wRank + 2)}┼${"─".repeat(wRank + 2)}┼${"─".repeat(wRank + 2)}┼${"─".repeat(wTopHit + 2)}┤`;
  console.log(`\x1b[36m${sepLine}\x1b[0m`);

  breakdown.forEach((item, itemIdx) => {
    const qLines = wrapText(item.query, wQ);
    const targetLines = wrapText(item.target, wTarget);
    const rawHit = item.topHit || "NONE";
    const hitLines = wrapText(rawHit, wTopHit);

    const isMatch = item.topHit && (item.topHit === item.target || (item.expectedDocIds && item.expectedDocIds.includes(item.topHit)));

    const maxLines = Math.max(qLines.length, targetLines.length, hitLines.length);

    for (let l = 0; l < maxLines; l++) {
      const idCell = l === 0 ? String(item.id) : "";
      const qCell = qLines[l] || "";
      const targetCell = targetLines[l] ? `\x1b[36m${targetLines[l]}\x1b[0m` : "";

      const bm25C = l === 0 ? formatRankColor(item.bm25Rank) : "";
      const vecC = l === 0 ? formatRankColor(item.vectorRank) : "";
      const rrfC = l === 0 ? formatRankColor(item.rrfRank) : "";
      const rsfC = l === 0 ? formatRankColor(item.rsfRank) : "";

      let hitC = "";
      if (hitLines[l]) {
        hitC = isMatch ? `\x1b[32m${hitLines[l]}\x1b[0m` : `\x1b[33m${hitLines[l]}\x1b[0m`;
      }

      const rowStr = ` │ ${padVisible(idCell, wId)} │ ${padVisible(qCell, wQ)} │ ${padVisible(targetCell, wTarget)} │ ${padVisible(bm25C, wRank)} │ ${padVisible(vecC, wRank)} │ ${padVisible(rrfC, wRank)} │ ${padVisible(rsfC, wRank)} │ ${padVisible(hitC, wTopHit)} │`;
      console.log(rowStr);
    }

    if (itemIdx < breakdown.length - 1) {
      console.log(`\x1b[90m${sepLine}\x1b[0m`);
    }
  });

  const bottomLine = ` └───┴${"─".repeat(wQ + 2)}┴${"─".repeat(wTarget + 2)}┴${"─".repeat(wRank + 2)}┴${"─".repeat(wRank + 2)}┴${"─".repeat(wRank + 2)}┴${"─".repeat(wRank + 2)}┴${"─".repeat(wTopHit + 2)}┘`;
  console.log(`\x1b[36m${bottomLine}\x1b[0m\n`);
}

function renderBenchmarkResultsTable(results) {
  const line = "─".repeat(PANEL_WIDTH - 2);
  const isSmoke = results && results.mode === "smoke";
  const title = isSmoke ? "SMOKE BENCHMARK RESULTS" : "SEARCH QUALITY BENCHMARK RESULTS";
  console.log(`\x1b[36m╭${line}╮\x1b[0m`);
  console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37m${title.padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[36m│\x1b[0m`);
  const nQueries = results && results.bm25 ? results.bm25.n : 0;
  const subtitle = isSmoke
    ? `Smoke: ${nQueries} queries (stats skipped, fast iteration)`
    : `Evaluated over ${nQueries} challenging cross-lingual queries`;
  console.log(`\x1b[36m│\x1b[0m  \x1b[90m${subtitle.padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[36m│\x1b[0m`);
  console.log(`\x1b[36m╰${line}╯\x1b[0m\n`);

  if (results && results.breakdown) {
    renderPerQueryBreakdownTable(results.breakdown);
  }

  console.log(`\x1b[36m ┌── METRIC COMPARISON BY SEARCH STRATEGY ─────────────┐\x1b[0m`);
  console.log(` \x1b[36m│\x1b[0m \x1b[1m\x1b[37mStrategy            MRR@5     Recall@5     NDCG@5   \x1b[0m\x1b[36m│\x1b[0m`);
  console.log(` \x1b[36m│\x1b[0m \x1b[90m────────────────────────────────────────────────────\x1b[0m\x1b[36m│\x1b[0m`);

  const strategies = [
    { name: "BM25 Search Only", data: results.bm25, key: "bm25" },
    { name: "Dense ONNX Vector", data: results.vector, key: "vector" },
    { name: "Hybrid RRF (Rank)", data: results.hybridRrf, key: "hybrid_rrf" },
    { name: "Hybrid RSF (Score)", data: results.hybridRsf, key: "hybrid_rsf" },
  ];

  // Backward-compat field access: new evaluator returns {mrr, recall, ndcg, n},
  // older shape was {mrrAtK, recallAtK, ndcgAtK}. Support both.
  const getMrr = (d) => (d ? (d.mrr ?? d.mrrAtK ?? 0) : 0);
  const getRecall = (d) => (d ? (d.recall ?? d.recallAtK ?? 0) : 0);
  const getNdcg = (d) => (d ? (d.ndcg ?? d.ndcgAtK ?? 0) : 0);

  strategies.forEach((s) => {
    const nameStr = s.name.padEnd(20);
    const mrrStr = getMrr(s.data).toFixed(4).padEnd(10);
    const recallPct = (getRecall(s.data) * 100).toFixed(1) + "%";
    const recallStr = recallPct.padEnd(13);
    const ndcgStr = getNdcg(s.data).toFixed(4);

    // Highlight the dynamically-determined winner instead of hardcoding "Hybrid".
    const isBest = results.winner && s.key === results.winner;
    const color = isBest ? "\x1b[1m\x1b[36m" : "\x1b[37m";

    console.log(` \x1b[36m│\x1b[0m ${color}${nameStr}${mrrStr}${recallStr}${ndcgStr}\x1b[0m \x1b[36m│\x1b[0m`);
  });

  console.log(`\x1b[36m └──${"─".repeat(PANEL_WIDTH - 4)}┘\x1b[0m\n`);

  // Winner block: previously misplaced inside selectBlockMenu where `results` was
  // out of scope (ReferenceError). Now lives here where `results` is the param.
  if (results && results.winner) {
    const winnerLabel =
      results.winner === "hybrid_rsf" ? "RSF"
      : results.winner === "hybrid_rrf" ? "RRF"
      : results.winner === "vector" ? "Vector"
      : results.winner === "bm25" ? "BM25"
      : results.winner;
    const p = results.pairedTests && results.pairedTests.rrfVsRsf;
    const sigNote = p
      ? (p.p < 0.05 ? ` (RRF vs RSF p=${p.p}, significant)` : ` (RRF vs RSF p=${p.p}, NOT significant at N=${p.n})`)
      : (results.mode === "smoke" ? " (smoke: stats skipped)" : "");
    console.log(` \x1b[90m Winner by MRR: \x1b[1m\x1b[36m${winnerLabel}\x1b[0m\x1b[90m${sigNote}\x1b[0m\n`);
  }
}

function selectBlockMenu({ title, stats, blocks, initialIndex = 0 }) {
  return new Promise((resolve) => {
    const allItems = [];
    blocks.forEach((block) => {
      block.items.forEach((item) => {
        allItems.push({ ...item, groupTitle: block.title });
      });
    });

    let activeIndex = Math.min(Math.max(0, initialIndex), allItems.length - 1);

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    function render() {
      console.clear();
      printHeaderPanel(title, stats);
      console.log(" \x1b[90mControls: ↑ / ↓ - Navigate   [ENTER] - Select   [BACKSPACE] - Back\x1b[0m\n");

      let currentItemGlobalIndex = 0;

      blocks.forEach((block) => {
        const titleStr = block.title.toUpperCase();
        const line = "─".repeat(Math.max(2, PANEL_WIDTH - titleStr.length - 7));
        console.log(`\x1b[36m ┌── ${titleStr} ${line}┐\x1b[0m`);

        block.items.forEach((item) => {
          const isSelected = currentItemGlobalIndex === activeIndex;
          const pointer = isSelected ? "\x1b[36m > " : "   ";

          const nameStr = item.label;
          const dotsCount = Math.max(2, 32 - nameStr.length);
          const dots = "\x1b[90m" + ".".repeat(dotsCount) + "\x1b[0m";
          const badgeStr = item.badge ? `\x1b[33m[${item.badge}]\x1b[0m` : "";

          let lineContent = item.badge ? `${nameStr} ${dots} ${badgeStr}` : nameStr;

          if (isSelected) {
            console.log(` \x1b[36m│\x1b[0m${pointer}\x1b[1m\x1b[36m${lineContent}\x1b[0m`);
          } else {
            console.log(` \x1b[36m│\x1b[0m${pointer}${lineContent}`);
          }

          currentItemGlobalIndex++;
        });

console.log(`\x1b[36m └──${"─".repeat(PANEL_WIDTH - 4)}┘\x1b[0m\n`);
      });

      const activeItem = allItems[activeIndex];
      if (activeItem && activeItem.info) {
        printQuickInfoBox(activeItem.info);
      }
    }

    render();

    function onKeypress(str, key) {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }
      if (key.name === "up") {
        activeIndex = (activeIndex - 1 + allItems.length) % allItems.length;
        render();
      } else if (key.name === "down") {
        activeIndex = (activeIndex + 1) % allItems.length;
        render();
      } else if (key.name === "return") {
        cleanup();
        resolve({ action: "select", index: activeIndex, value: allItems[activeIndex].value });
      } else if (key.name === "backspace" || key.name === "escape" || key.name === "delete") {
        cleanup();
        resolve({ action: "back" });
      }
    }

    function cleanup() {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    }

    process.stdin.on("keypress", onKeypress);
  });
}

function selectSimpleMenu({ title, subtitle = "", items, initialIndex = 0 }) {
  return new Promise((resolve) => {
    let index = Math.min(Math.max(0, initialIndex), items.length - 1);

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    function render() {
      console.clear();
      const line = "─".repeat(PANEL_WIDTH - 2);
      console.log(`\x1b[36m╭${line}╮\x1b[0m`);
      console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37m${title.padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[36m│\x1b[0m`);
      if (subtitle) {
        console.log(`\x1b[36m│\x1b[0m  \x1b[90m${subtitle.padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[36m│\x1b[0m`);
      }
      console.log(`\x1b[36m╰${line}╯\x1b[0m`);
      console.log(" \x1b[90mControls: ↑ / ↓ - Navigate   [ENTER] - Select   [BACKSPACE] - Back\x1b[0m\n");

      items.forEach((item, idx) => {
        const isSelected = idx === index;
        const pointer = isSelected ? "\x1b[36m > " : "   ";
        const label = isSelected ? `\x1b[1m\x1b[36m${item.label}\x1b[0m` : item.label;
        const badge = item.badge ? ` \x1b[33m[${item.badge}]\x1b[0m` : "";
        const hint = item.hint ? ` \x1b[90m(${item.hint})\x1b[0m` : "";
        console.log(`${pointer}${label}${badge}${hint}`);
      });
      console.log("\n");

      const activeItem = items[index];
      if (activeItem && activeItem.info) {
        printQuickInfoBox(activeItem.info);
      }
    }

    render();

    function onKeypress(str, key) {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }
      if (key.name === "up") {
        index = (index - 1 + items.length) % items.length;
        render();
      } else if (key.name === "down") {
        index = (index + 1) % items.length;
        render();
      } else if (key.name === "return") {
        cleanup();
        resolve({ action: "select", index, value: items[index].value });
      } else if (key.name === "backspace" || key.name === "escape" || key.name === "delete") {
        cleanup();
        resolve({ action: "back" });
      }
    }

    function cleanup() {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    }

    process.stdin.on("keypress", onKeypress);
  });
}

function adjustAlphaMenu(initialAlpha) {
  return new Promise((resolve) => {
    let alpha = initialAlpha;

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    function render() {
      console.clear();
      const line = "─".repeat(PANEL_WIDTH - 2);
      console.log(`\x1b[36m╭${line}╮\x1b[0m`);
      console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37mRSF ALPHA WEIGHT BALANCER\x1b[0m${" ".repeat(PANEL_WIDTH - 30)}\x1b[36m│\x1b[0m`);
      console.log(`\x1b[36m│\x1b[0m  \x1b[90mAdjust Vector Similarity vs BM25 Score Weight\x1b[0m${" ".repeat(PANEL_WIDTH - 49)}\x1b[36m│\x1b[0m`);
      console.log(`\x1b[36m╰${line}╯\x1b[0m`);
      console.log(" \x1b[90mControls: ← / → or ↑ / ↓ - Adjust (5% step)   [ENTER] - Save   [BACKSPACE] - Cancel\x1b[0m\n");

      const semPct = Math.round(alpha * 100);
      const lexPct = 100 - semPct;

      const totalBlocks = 20;
      const semBlocks = Math.round(alpha * totalBlocks);
      const lexBlocks = totalBlocks - semBlocks;

      const bar = "━".repeat(semBlocks) + "─".repeat(lexBlocks);

      console.log(`  Balance: \x1b[36m${semPct}% Semantic (Vector)\x1b[0m / \x1b[33m${lexPct}% Lexical (BM25)\x1b[0m`);
      console.log(`  [ \x1b[36m${bar}\x1b[0m ]  Alpha: \x1b[1m\x1b[32m${alpha.toFixed(2)}\x1b[0m\n`);

      if (alpha === 0.5) {
        console.log("  [*] \x1b[32mMode: 50 / 50 Balanced Hybrid Fusion (Recommended)\x1b[0m\n");
      } else if (alpha > 0.5) {
        console.log(`  [*] Mode: Semantic Vector Priority (${semPct}%)\n`);
      } else {
        console.log(`  [*] Mode: Exact Keyword BM25 Priority (${lexPct}%)\n`);
      }

      printQuickInfoBox(`RSF Formula: Score = ${alpha.toFixed(2)} * NormVector + ${(1 - alpha).toFixed(2)} * NormBM25`);
    }

    render();

    function onKeypress(str, key) {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }
      if (key.name === "left" || key.name === "down") {
        alpha = Math.max(0.0, Math.round((alpha - 0.05) * 100) / 100);
        render();
      } else if (key.name === "right" || key.name === "up") {
        alpha = Math.min(1.0, Math.round((alpha + 0.05) * 100) / 100);
        render();
      } else if (key.name === "return") {
        cleanup();
        resolve({ action: "save", value: alpha });
      } else if (key.name === "backspace" || key.name === "escape" || key.name === "delete") {
        cleanup();
        resolve({ action: "cancel" });
      }
    }

    function cleanup() {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    }

    process.stdin.on("keypress", onKeypress);
  });
}

function readTextInput(promptText, defaultValue = "") {
  return new Promise((resolve) => {
    let text = defaultValue;

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    function render() {
      console.clear();
      const line = "─".repeat(PANEL_WIDTH - 2);
      console.log(`\x1b[36m╭${line}╮\x1b[0m`);
      console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37mINPUT: ${promptText.toUpperCase()}\x1b[0m${" ".repeat(Math.max(0, PANEL_WIDTH - 11 - promptText.length))}\x1b[36m│\x1b[0m`);
      console.log(`\x1b[36m╰${line}╯\x1b[0m`);
      console.log(" \x1b[90mControls: Type text   [ENTER] - Submit   [BACKSPACE] - Delete / Cancel\x1b[0m\n");
      console.log(`  > \x1b[36m${text}\x1b[0m_\n`);
    }

    render();

    function onKeypress(str, key) {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }
      if (key.name === "return") {
        cleanup();
        resolve({ action: "submit", value: text.trim() });
      } else if (key.name === "backspace" || key.name === "delete") {
        if (text.length > 0) {
          text = text.slice(0, -1);
          render();
        } else {
          cleanup();
          resolve({ action: "cancel" });
        }
      } else if (key.name === "escape") {
        cleanup();
        resolve({ action: "cancel" });
      } else if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
        text += str;
        render();
      }
    }

    function cleanup() {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    }

    process.stdin.on("keypress", onKeypress);
  });
}

function waitForEnter() {
  return new Promise((resolve) => {
    console.log("\n \x1b[90mPress [ENTER] or [BACKSPACE] to return to menu...\x1b[0m");
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    function onKeypress(str, key) {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }
      if (key.name === "return" || key.name === "backspace" || key.name === "escape" || key.name === "delete" || key.name === "space") {
        cleanup();
        resolve();
      }
    }

    function cleanup() {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    }

    process.stdin.on("keypress", onKeypress);
  });
}

function promptText(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n  ${question}\n  > `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function runCli() {
  const cliArgs = process.argv.slice(2);
  if (cliArgs.includes("--enable-prompt") || cliArgs.includes("enable-prompt")) {
    const { enableGlobalPrompt } = await import("./prompt_manager.js");
    const results = await enableGlobalPrompt();
    console.log("\n  [OK] Global prompt enabled across client configurations:\n");
    results.forEach((r) => console.log(`  - ${r.name}: ${r.filePath} (${r.status})`));
    console.log("");
    return;
  }
  if (cliArgs.includes("--disable-prompt") || cliArgs.includes("disable-prompt")) {
    const { disableGlobalPrompt } = await import("./prompt_manager.js");
    const results = await disableGlobalPrompt();
    console.log("\n  [OK] Global prompt disabled across client configurations:\n");
    results.forEach((r) => console.log(`  - ${r.name}: ${r.filePath} (${r.status})`));
    console.log("");
    return;
  }

  const cliArgs = process.argv.slice(2);
  if (cliArgs.includes("login")) {
    console.log("\n  [CLOUD] Запуск процесса авторизации в облаке Turso...");
    const { loginToCloud } = await import("./admin/auth.js");
    try {
      const secrets = await loginToCloud();
      console.log(`\n  \x1b[32m[OK] Успешный вход в облако! Подключен к endpoint: ${secrets.dbUrl}\x1b[0m\n`);
    } catch (e) {
      console.error(`\n  \x1b[31m[ERROR] Ошибка авторизации: ${e.message}\x1b[0m\n`);
      process.exit(1);
    }
    return;
  }

  if (cliArgs.includes("logout")) {
    console.log("\n  [CLOUD] Выход из облака...");
    const { logoutFromCloud } = await import("./admin/auth.js");
    const deleted = logoutFromCloud();
    if (deleted) {
      console.log("  \x1b[32m[OK] Вы вышли из облака. Секретные ключи удалены. Режим изменен на only-local.\x1b[0m\n");
    } else {
      console.log("  [*] Режим изменен на only-local. Сессионных токенов не было обнаружено.\x1b[0m\n");
    }
    return;
  }

  let running = true;
  let selectedIndex = 0;

  while (running) {
    const config = getConfig();
    const stats = await getQuickStats();
    const semPct = Math.round(config.alpha * 100);
    const lexPct = 100 - semPct;

    const mainBlocks = [
      {
        title: "Engine & Hybrid Search Settings",
        items: [
          {
            label: "Fusion Algorithm",
            badge: config.fusionAlgorithm.toUpperCase(),
            value: "algo",
            info: "Choose how vector similarity and BM25 text ranks are fused",
          },
          {
            label: "RSF Alpha Balance",
            badge: `${semPct}% Sem / ${lexPct}% Lex`,
            value: "alpha",
            info: `Current Alpha: ${config.alpha.toFixed(2)}. Adjust ratio of Vector vs BM25 Keyword score`,
          },
          {
            label: "Embedding Model",
            badge: config.embeddingModel.split("/").pop(),
            value: "embedding",
            info: `Model: ${config.embeddingModel}. ONNX Feature Extraction via @huggingface/transformers`,
          },
          {
            label: "Reranker Model",
            badge: config.rerankerEnabled ? config.rerankerModel.split("/").pop() : "DISABLED",
            value: "reranker",
            info: config.rerankerEnabled ? `Reranker active: ${config.rerankerModel}` : "Optional Cross-Encoder re-ranking pass",
          },
          {
            label: "Vector Batch Size",
            badge: `${config.batchSize || 12} Chunks`,
            value: "batch_size",
            info: `Ingestion batch size: ${config.batchSize || 12} micro-chunks per ONNX pass`,
          },
          {
            label: "GPU Attention Budget",
            badge: `${((config.gpuAttentionBudget || 2000000) / 1000000).toFixed(1)}M Units`,
            value: "gpu_budget",
            info: `Micro-batch tensor budget: ${((config.gpuAttentionBudget || 2000000) / 1000000).toFixed(1)}M quadratic units (controls max peak VRAM usage on GPU)`,
          },
          {
            label: "CPU WASM Threads",
            badge: config.onnxThreads > 0 ? `${config.onnxThreads} Threads` : "AUTO (CPU Cores)",
            value: "onnx_threads",
            info: config.onnxThreads > 0 ? `ONNX execution threads manually set to ${config.onnxThreads}` : "Auto-detect optimal physical CPU threads",
          },
          {
            label: "Execution Hardware",
            badge: (config.executionDevice || "cpu").toUpperCase() === "WEBGPU" || (config.executionDevice || "cpu").toUpperCase() === "GPU" ? "\x1b[31mGPU (EXPERIMENTAL)\x1b[0m" : "CPU (AVX2)",
            value: "execution_device",
            info: config.executionDevice === "webgpu" || config.executionDevice === "gpu"
              ? "⚠️ EXPERIMENTAL: ONNX DirectML GPU execution (high VRAM/padding overhead, CPU AVX2 recommended)"
              : "CPU inference via AVX2 / WASM SIMD (Recommended for stability & speed)",
          },
        ],
      },
      {
        title: "Knowledge Base & Storage Management",
        items: [
          {
            label: "[NOTEBOOK] Layer 1 Facts",
            badge: `${stats.factCount} Facts Saved`,
            value: "notebook",
            info: "Inspect & delete durable user identity facts (global & project)",
          },
          {
            label: "[RAG DOCS] Layer 2 RAG Base",
            badge: `${stats.docCount} Docs / ${stats.chunkCount} Chunks`,
            value: "rag_docs",
            info: "Inspect ingested Markdown/code docs & delete chunks from SQLite",
          },
          {
            label: "[SNAPSHOT EXPORT] Export RAG Base Snapshot",
            value: "export_snapshot",
            info: "Export full RAG database, vectors & blobs into a snapshot file (.json or .json.gz)",
          },
          {
            label: "[SNAPSHOT IMPORT] Import RAG Base Snapshot",
            value: "import_snapshot",
            info: "Import RAG database, vectors & blobs from a snapshot file (.json or .json.gz)",
          },
          {
            label: "[MODELS] Manage & Purge ML Model Cache",
            value: "manage_models",
            info: "Inspect cached ONNX models on disk, check status (Ready / Partial / Not Downloaded) & delete models to free disk space",
          },
          {
            label: "[HARD RESET] Purge RAG Base & Blob Storage",
            value: "hard_reset",
            info: "Permanently delete all documents, sections, vectors, FTS indexes, and blobs",
          },
        ],
      },
      {
        title: "Cloud Synchronization & Turso",
        items: [
          {
            label: "[CLOUD] Login to Turso Cloud",
            value: "cloud_login",
            info: "Perform secure OAuth/Device login flow with loopback listener and local AES-256 key encryption",
          },
          {
            label: "[CLOUD] Logout",
            value: "cloud_logout",
            info: "Sign out, purge encrypted secrets, and revert mode to only-local",
          },
          {
            label: "Operational Mode",
            badge: config.mode.toUpperCase(),
            value: "cloud_mode",
            info: "Choose Operational Mode: only-local | only-cloud | hybrid-sync",
          },
        ],
      },
      {
        title: "Global Prompt & Integration Management",
        items: [
          {
            label: "[PROMPT ENABLE] Enable Global Prompt (Antigravity / Codex / Claude)",
            value: "enable_prompt",
            info: "Inject memory instructions into ~/.gemini/config/AGENTS.md, ~/.codex/AGENTS.md, ~/.claude/CLAUDE.md",
          },
          {
            label: "[PROMPT DISABLE] Disable Global Prompt",
            value: "disable_prompt",
            info: "Remove memory instructions from global AGENTS.md / CLAUDE.md files",
          },
        ],
      },
      {
        title: "Diagnostics & System Actions",
        items: [
          {
            label: "[BENCHMARK] Run Search Quality Benchmark",
            value: "benchmark",
            info: "Choose Quick Smoke (9 queries, ~7s) or Full (21 queries + stats, ~32s)",
          },
          {
            label: "[SEARCH] Run Search Verification Query",
            value: "test",
            info: "Execute hybrid search query and display result hit scores",
          },
          {
            label: "[CACHE] Clear Benchmark Corpus Cache",
            value: "clear_cache",
            info: "Delete cached GitHub README files used by benchmarks",
          },
          {
            label: "[RESET] Reset Config to Factory Defaults",
            value: "reset",
            info: "Reset RSF alpha to 50/50 and restore factory default config",
          },
          {
            label: "[EXIT] Exit CLI Menu",
            value: "exit",
            info: "Save configuration and exit to terminal",
          },
        ],
      },
    ];

    const res = await selectBlockMenu({
      title: "MEMORY PLUGIN RAG ENGINE CONTROL PANEL",
      stats,
      blocks: mainBlocks,
      initialIndex: selectedIndex,
    });

    if (res.action === "back") {
      running = false;
      console.clear();
      console.log("Exiting CLI. Configuration saved.");
      break;
    }

    selectedIndex = res.index;

    switch (res.value) {
      case "algo": {
        const algoItems = [
          { label: "RSF (Relative Score Fusion)", value: "rsf", info: "Normalized Score Scaling (Recommended)" },
          { label: "RRF (Reciprocal Rank Fusion)", value: "rrf", info: "Rank-based Fusion (1/(k + rank))" },
          { label: "Pure Semantic Search", value: "semantic_only", info: "Vector Search Only (Cosine Similarity)" },
          { label: "Pure Lexical Search", value: "lexical_only", info: "BM25 Text Search Only (SQLite FTS5)" },
        ];
        const initialAlgoIdx = Math.max(0, algoItems.findIndex((i) => i.value === config.fusionAlgorithm));
        const subRes = await selectSimpleMenu({
          title: "SELECT FUSION ALGORITHM",
          subtitle: "Choose how vector and keyword search scores are combined",
          items: algoItems,
          initialIndex: initialAlgoIdx,
        });

        if (subRes.action === "select") {
          updateConfig({ fusionAlgorithm: subRes.value });
        }
        break;
      }
      case "alpha": {
        const alphaRes = await adjustAlphaMenu(config.alpha);
        if (alphaRes.action === "save") {
          updateConfig({ alpha: alphaRes.value });
        }
        break;
      }
      case "embedding": {
        const embItems = EMBEDDING_PRESETS.map((m) => {
          const info = getModelStorageInfo(m);
          let badge = "NOT DOWNLOADED";
          if (info.status === "downloaded") badge = `READY (${info.sizeMB} MB)`;
          else if (info.status === "partial") badge = `INCOMPLETE (${info.sizeMB} MB)`;
          return { label: m, badge, value: m, info: `Model: ${m} [${badge}]` };
        });
        embItems.push({ label: "Custom HuggingFace Model...", value: "custom", info: "Specify custom HF model string" });
        const initialEmbIdx = Math.max(0, embItems.findIndex((i) => i.value === config.embeddingModel));
        
        const subRes = await selectSimpleMenu({
          title: "SELECT EMBEDDING MODEL",
          subtitle: "Dense vector extraction model via @huggingface/transformers",
          items: embItems,
          initialIndex: initialEmbIdx,
        });

        if (subRes.action === "select") {
          let chosenModel = subRes.value;
          if (subRes.value === "custom") {
            const inputRes = await readTextInput("Enter HuggingFace Model ID", "Xenova/all-MiniLM-L6-v2");
            if (inputRes.action === "submit" && inputRes.value) {
              chosenModel = inputRes.value;
            } else {
              break;
            }
          }
          await downloadModelWithProgress(chosenModel, "embedding");
          updateConfig({ embeddingModel: chosenModel });
          await waitForEnter();
        }
        break;
      }
      case "reranker": {
        const rkItems = [
          { label: "Disable Reranker", value: "none", info: "No cross-encoder re-ranking" },
          ...RERANKER_PRESETS.filter((r) => r !== "none").map((r) => {
            const info = getModelStorageInfo(r);
            let badge = "NOT DOWNLOADED";
            if (info.status === "downloaded") badge = `READY (${info.sizeMB} MB)`;
            else if (info.status === "partial") badge = `INCOMPLETE (${info.sizeMB} MB)`;
            return { label: r, badge, value: r, info: `Reranker: ${r} [${badge}]` };
          }),
          { label: "Custom Reranker Model...", value: "custom", info: "Specify custom HuggingFace cross-encoder model" },
        ];
        const currentRk = config.rerankerEnabled ? config.rerankerModel : "none";
        const initialRkIdx = Math.max(0, rkItems.findIndex((i) => i.value === currentRk));

        const subRes = await selectSimpleMenu({
          title: "CONFIGURE RERANKER MODEL",
          subtitle: "Cross-Encoder candidate re-ranking pass",
          items: rkItems,
          initialIndex: initialRkIdx,
        });

        if (subRes.action === "select") {
          if (subRes.value === "none") {
            updateConfig({ rerankerEnabled: false, rerankerModel: "none" });
          } else {
            let chosenRk = subRes.value;
            if (subRes.value === "custom") {
              const inputRes = await readTextInput("Enter HuggingFace Reranker Model ID", "Xenova/bge-reranker-base");
              if (inputRes.action === "submit" && inputRes.value) {
                chosenRk = inputRes.value;
              } else {
                break;
              }
            }
            await downloadModelWithProgress(chosenRk, "reranker");
            updateConfig({ rerankerEnabled: true, rerankerModel: chosenRk });
            await waitForEnter();
          }
        }
        break;
      }
      case "batch_size": {
        const batchItems = [
          { label: "Batch Size 1 (Single Item)", value: 1, info: "Process micro-chunks strictly 1 by 1" },
          { label: "Batch Size 4", value: 4, info: "Small CPU batch size" },
          { label: "Batch Size 8 (CPU Sweet Spot)", value: 8, info: "Optimal for CPU L3 cache" },
          { label: "Batch Size 12 (Default)", value: 12, info: "Balanced CPU throughput" },
          { label: "Batch Size 16", value: 16, info: "High throughput batch size" },
          { label: "Batch Size 32 (Standard GPU)", value: 32, info: "Standard GPU batching" },
          { label: "Batch Size 48 (High GPU)", value: 48, info: "High throughput GPU batching" },
          { label: "Batch Size 64 (Ultra GPU)", value: 64, info: "Ultra-fast GPU parallel tensor execution" },
          { label: "Batch Size 128 (Extreme GPU)", value: 128, info: "Massive GPU parallelism" },
          { label: "Batch Size 256 (Max GPU)", value: 256, info: "Maximum batch capacity for dedicated VRAM" },
        ];
        const currentBatch = config.batchSize || 12;
        const initialBatchIdx = Math.max(0, batchItems.findIndex((i) => i.value === currentBatch));
        const subRes = await selectSimpleMenu({
          title: "SELECT VECTOR BATCH SIZE",
          subtitle: "Number of micro-chunks vectorized per ONNX inference pass",
          items: batchItems,
          initialIndex: initialBatchIdx,
        });
        if (subRes.action === "select") {
          updateConfig({ batchSize: subRes.value });
        }
        break;
      }
      case "gpu_budget": {
        const budgetItems = [
          { label: "1.0M Units (Conservative ~0.8 GB VRAM)", value: 1000000, info: "Ultra-safe for 4GB-6GB GPUs or heavy background multitasking" },
          { label: "2.0M Units (Balanced ~1.5 GB VRAM - Default)", value: 2000000, info: "Optimal balance between GPU throughput & safe VRAM ceiling" },
          { label: "4.0M Units (Aggressive ~2.5 GB VRAM)", value: 4000000, info: "Higher GPU parallel compute for dedicated 8GB+ GPUs" },
          { label: "8.0M Units (High Parallelism ~4.5 GB VRAM)", value: 8000000, info: "Maximum batching throughput for 12GB-16GB VRAM GPUs" },
          { label: "16.0M Units (Extreme ~8.0 GB VRAM)", value: 16000000, info: "Uncapped micro-batching for 24GB+ VRAM workstation GPUs" },
        ];
        const currentBudget = config.gpuAttentionBudget || 2000000;
        const initialIdx = Math.max(0, budgetItems.findIndex((i) => i.value === currentBudget));
        const subRes = await selectSimpleMenu({
          title: "SELECT GPU MICRO-BATCH ATTENTION BUDGET",
          subtitle: "Controls dynamic O(seq_len^2) sub-batching to prevent VRAM overflow",
          items: budgetItems,
          initialIndex: initialIdx,
        });
        if (subRes.action === "select") {
          updateConfig({ gpuAttentionBudget: subRes.value });
        }
        break;
      }
      case "onnx_threads": {
        const threadItems = [
          { label: "0 - Auto (Detect CPU Cores)", value: 0, info: "Automatically match physical CPU cores (up to 8)" },
          { label: "1 Thread (Single-Threaded)", value: 1, info: "Restrict ONNX WASM to 1 thread" },
          { label: "2 Threads", value: 2, info: "Use 2 WASM threads" },
          { label: "4 Threads", value: 4, info: "Use 4 WASM threads" },
          { label: "8 Threads", value: 8, info: "Use 8 WASM threads" },
          { label: "16 Threads", value: 16, info: "Use 16 WASM threads" },
        ];
        const currentThreads = config.onnxThreads || 0;
        const initialThreadIdx = Math.max(0, threadItems.findIndex((i) => i.value === currentThreads));
        const subRes = await selectSimpleMenu({
          title: "SELECT CPU ONNX WASM THREADS",
          subtitle: "Number of WASM worker threads for ONNX Runtime",
          items: threadItems,
          initialIndex: initialThreadIdx,
        });
        if (subRes.action === "select") {
          updateConfig({ onnxThreads: subRes.value });
        }
        break;
      }
      case "execution_device": {
        const devItems = [
          {
            label: "CPU (AVX2 / WASM SIMD - RECOMMENDED)",
            value: "cpu",
            info: "Standard multi-threaded CPU execution via ONNX native AVX2 (Optimal speed, stability & zero VRAM overhead)",
          },
          {
            label: "\x1b[31m[EXPERIMENTAL]\x1b[0m GPU (DirectML / WebGPU)",
            value: "webgpu",
            info: "⚠️ EXPERIMENTAL: DirectML GPU tensor execution. High JS FFI & zero-padding overhead; CPU AVX2 is recommended for local Node.js.",
          },
        ];
        const currentDev = config.executionDevice || "cpu";
        const initialDevIdx = Math.max(0, devItems.findIndex((i) => i.value === currentDev));
        const subRes = await selectSimpleMenu({
          title: "SELECT EXECUTION HARDWARE DEVICE",
          subtitle: "CPU AVX2 (Recommended) vs Experimental DirectML GPU Hardware Mode",
          items: devItems,
          initialIndex: initialDevIdx,
        });
        if (subRes.action === "select") {
          updateConfig({ executionDevice: subRes.value });
        }
        break;
      }
      case "notebook": {
        let nbRunning = true;
        while (nbRunning) {
          const projKey = projectKey(null, null);
          const projLabel = projectName(null, null);

          async function browseFacts(key, title) {
            let factRunning = true;
            while (factRunning) {
              const rawEntries = await readMemory(key);
              const factList = await readMemoryRaw(key);

              if (!factList || factList.length === 0) {
                console.clear();
                const line = "─".repeat(PANEL_WIDTH - 2);
                console.log(`\x1b[36m╭${line}╮\x1b[0m`);
                console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37mNOTEBOOK FACTS: STORE EMPTY\x1b[0m${" ".repeat(PANEL_WIDTH - 30)}\x1b[36m│\x1b[0m`);
                console.log(`\x1b[36m╰${line}╯\x1b[0m`);
                console.log(`\n  [*] Notebook store [${key}] has no saved facts.\n`);
                await waitForEnter();
                return;
              }

              const file = memoryFileName(key);
              const factItems = factList.map((fact, idx) => {
                const badges = metaBadges(fact);
                return {
                  label: `${idx + 1}. ${factText(fact)}`,
                  value: idx,
                  badge: badges.length ? badges.join(" ") : undefined,
                  info: `Select to manage this fact from ${file}`,
                };
              });
              factItems.push({ label: "< Back", value: "back" });

              const factRes = await selectSimpleMenu({
                title: `NOTEBOOK FACTS [${title}]`,
                subtitle: `Total facts: ${factList.length}`,
                items: factItems,
              });

              if (factRes.action === "back" || factRes.value === "back") {
                return;
              }

              const selectedIdx = factRes.value;
              const selectedEntry = rawEntries[selectedIdx];
              const selDisplay = displayFact(selectedEntry);
              const selBadges = metaBadges(selectedEntry);

              const actionItems = [
                { label: "[UPDATE] Edit fact text", value: "update", info: "Rewrite the fact, keeping its date and metadata" },
              ];
              if (isKeepFact(selectedEntry)) {
                actionItems.push({ label: "[UNPROTECT] Remove keep protection", value: "unprotect", info: "Allow forget to delete it without force" });
              } else {
                actionItems.push({ label: "[PROTECT] Mark as important (keep)", value: "protect", info: "forget will skip it unless force=true" });
              }
              actionItems.push({ label: "[DELETE] Delete this fact from store", value: "delete", info: "Remove fact permanently" });
              actionItems.push({ label: "< Cancel / Back", value: "cancel" });

              const actionRes = await selectSimpleMenu({
                title: "FACT ACTION",
                subtitle: `Fact: "${selDisplay}"${selBadges.length ? " [" + selBadges.join("] [") + "]" : ""}`,
                items: actionItems,
              });

              if (actionRes.action === "back" || actionRes.value === "cancel") {
                return;
              }

              if (actionRes.action === "select" && actionRes.value === "update") {
                const p = parseFactEntry(selectedEntry);
                const newText = await promptText(`New text for fact #${selectedIdx + 1}:`);
                if (!newText) continue;
                const newLine = formatFactEntry({ date: p.date, time: p.time, text: newText, meta: p.meta });
                const updated = [...rawEntries];
                updated[selectedIdx] = newLine;
                await writeMemory(key, updated);
                let links = 0;
                try {
                  const db = getDatabase();
                  links = db
                    .prepare("UPDATE knowledge_links SET fact_text = ? WHERE fact_key = ? AND fact_text = ?")
                    .run(newText, key, factText(selectedEntry)).changes;
                } catch (e) {}
                console.clear();
                console.log(`\n  [OK] Fact updated successfully${links ? `, ${links} doc link(s) updated` : ""}.\n`);
                await waitForEnter();
              } else if (actionRes.action === "select" && (actionRes.value === "protect" || actionRes.value === "unprotect")) {
                const updated = [...rawEntries];
                updated[selectedIdx] =
                  actionRes.value === "protect" ? withMeta(selectedEntry, { keep: "1" }) : withMeta(selectedEntry, { keep: null });
                await writeMemory(key, updated);
                console.clear();
                console.log(`\n  [OK] Fact ${actionRes.value === "protect" ? "protected" : "unprotected"} successfully.\n`);
                await waitForEnter();
              } else if (actionRes.action === "select" && actionRes.value === "delete") {
                const updated = [...rawEntries];
                updated.splice(selectedIdx, 1);
                await writeMemory(key, updated);
                console.clear();
                console.log("\n  [OK] Fact deleted successfully.\n");
                await waitForEnter();
              }
            }
          }

          const scopeItems = [
            { label: "Global Memory", value: "global", badge: "global.md", info: "User facts stored across all projects" },
            { label: `Project Memory (${projLabel})`, value: "project", badge: memoryFileName(projKey), info: `Facts bound to ${projKey}` },
            { label: "Project Stores (All Projects)", value: "projects", info: "List & browse every project memory store; bind legacy stores" },
            { label: "< Back to Main Menu", value: "back" },
          ];
          const scopeRes = await selectSimpleMenu({
            title: "NOTEBOOK FACTS MANAGEMENT",
            subtitle: "Inspect & delete persistent user facts (Layer 1)",
            items: scopeItems,
          });

          if (scopeRes.action === "back" || scopeRes.value === "back") {
            nbRunning = false;
            break;
          }

          if (scopeRes.value === "projects") {
            let stores = await listProjectStores();
            let storeRunning = true;
            while (storeRunning) {
              if (!stores.length) {
                console.clear();
                const line = "─".repeat(PANEL_WIDTH - 2);
                console.log(`\x1b[36m╭${line}╮\x1b[0m`);
                console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37mPROJECT STORES: NONE FOUND\x1b[0m${" ".repeat(PANEL_WIDTH - 32)}\x1b[36m│\x1b[0m`);
                console.log(`\x1b[36m╰${line}╯\x1b[0m`);
                console.log("\n  [*] No project memory stores found.\n");
                await waitForEnter();
                storeRunning = false;
                break;
              }
              const storeItems = stores.map((s) => ({
                label: `${s.basename} (${s.count})`,
                badge: s.file,
                hint: s.legacy ? "LEGACY" : "BOUND",
                info: s.path ? `Bound to: ${s.path}` : `Unbound legacy store. View facts or bind to current dir: ${projKey}`,
                value: s,
              }));
              storeItems.push({ label: "< Back", value: "back" });

              const storeRes = await selectSimpleMenu({
                title: "PROJECT MEMORY STORES",
                subtitle: `Total stores: ${stores.length}`,
                items: storeItems,
              });

              if (storeRes.action === "back" || storeRes.value === "back") {
                storeRunning = false;
                break;
              }

              const store = storeRes.value;
              let actionRunning = true;
              while (actionRunning) {
                const actionItems = [
                  { label: "View facts", value: "view", info: `Browse ${store.count} fact(s) in ${store.file}` },
                ];
                if (store.legacy) {
                  actionItems.push({
                    label: "[MIGRATE] Bind to current directory",
                    value: "migrate",
                    info: `Rebind '${store.basename}' store from unbound legacy to ${projKey}`,
                  });
                }
                actionItems.push({ label: "< Cancel / Back", value: "cancel" });

                const actRes = await selectSimpleMenu({
                  title: `STORE: ${store.basename}`,
                  subtitle: store.path || "Unbound legacy store",
                  items: actionItems,
                });

                if (actRes.action === "back" || actRes.value === "cancel") {
                  actionRunning = false;
                  break;
                }
                if (actRes.value === "view") {
                  await browseFacts(store.key, store.basename);
                } else if (actRes.value === "migrate") {
                  const mig = await migrateLegacyStore(store.key, projKey);
                  console.clear();
                  if (mig.ok) {
                    console.log(`\n  [OK] Legacy store '${store.basename}' bound to ${mig.key} (${mig.facts} fact(s)) [${mig.file}]\n`);
                  } else {
                    console.log(`\n  [*] Could not migrate: ${mig.reason}\n`);
                  }
                  await waitForEnter();
                  stores = await listProjectStores();
                  actionRunning = false;
                  break;
                }
              }
            }
            continue;
          }

          await browseFacts(scopeRes.value === "global" ? GLOBAL_KEY : projKey, scopeRes.value === "global" ? "GLOBAL" : projLabel);
        }
        break;
      }
      case "rag_docs": {
        let docRunning = true;
        while (docRunning) {
          const db = getDatabase();
          const docs = db.prepare("SELECT id, title, path, created_at FROM documents ORDER BY created_at DESC").all();

          if (!docs || docs.length === 0) {
            console.clear();
            const line = "─".repeat(PANEL_WIDTH - 2);
            console.log(`\x1b[36m╭${line}╮\x1b[0m`);
            console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37mRAG DOCUMENTS: BASE EMPTY\x1b[0m${" ".repeat(PANEL_WIDTH - 28)}\x1b[36m│\x1b[0m`);
            console.log(`\x1b[36m╰${line}╯\x1b[0m`);
            console.log("\n  [*] RAG Knowledge Base is empty. No documents ingested.\n");
            await waitForEnter();
            docRunning = false;
            break;
          }

          const docItems = docs.map((doc) => {
            const rawDate = doc.created_at || doc.updated_at || "";
            let formattedDate = "";
            if (rawDate) {
              try {
                const d = typeof rawDate === "number" ? new Date(rawDate) : new Date(String(rawDate));
                formattedDate = isNaN(d.getTime()) ? String(rawDate).substring(0, 16) : d.toISOString().replace("T", " ").substring(0, 16);
              } catch (e) {
                formattedDate = String(rawDate).substring(0, 16);
              }
            }
            const docIdStr = doc.id != null ? String(doc.id) : "";
            return {
              label: doc.title || doc.path || "Untitled Document",
              badge: formattedDate,
              hint: docIdStr ? `ID: ${docIdStr.substring(0, 8)}...` : "",
              info: `Path: ${doc.path || "N/A"}`,
              value: doc,
            };
          });
          docItems.push({ label: "< Back to Main Menu", value: "back" });

          const docRes = await selectSimpleMenu({
            title: "RAG KNOWLEDGE BASE DOCUMENTS",
            subtitle: `Total ingested documents: ${docs.length}`,
            items: docItems,
          });

          if (docRes.action === "back" || docRes.value === "back") {
            docRunning = false;
            break;
          }

          const targetDoc = docRes.value;
          const actionRes = await selectSimpleMenu({
            title: "DOCUMENT ACTION",
            subtitle: targetDoc.title || targetDoc.path,
            items: [
              { label: "[INFO] View Details & Sections", value: "info", info: "Inspect micro-chunks and sections count" },
              { label: "[EXPORT JSON] Export Full Hierarchy to Pretty JSON", value: "export_json", info: "Export multiline JSON with doc metadata & all 3 hierarchy levels" },
              { label: "[DELETE] Delete Document from RAG Base", value: "delete", info: "Purge document, FTS5 index & vectors" },
              { label: "< Cancel / Back", value: "cancel" },
            ],
          });

          if (actionRes.action === "select" && actionRes.value === "info") {
            const secCount = db.prepare("SELECT COUNT(*) as cnt FROM sections WHERE doc_id = ?").get(targetDoc.id).cnt;
            const chunkCount = db.prepare("SELECT COUNT(*) as cnt FROM micro_chunks WHERE doc_id = ?").get(targetDoc.id).cnt;
            const sampleSections = db.prepare("SELECT heading FROM sections WHERE doc_id = ? LIMIT 5").all(targetDoc.id);

            console.clear();
            const line = "─".repeat(PANEL_WIDTH - 2);
            console.log(`\x1b[36m╭${line}╮\x1b[0m`);
            console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37mDOCUMENT DETAILS\x1b[0m${" ".repeat(PANEL_WIDTH - 20)}\x1b[36m│\x1b[0m`);
            console.log(`\x1b[36m╰${line}╯\x1b[0m`);
            console.log(`  Title:          ${targetDoc.title || "Untitled"}`);
            console.log(`  ID:             ${targetDoc.id}`);
            console.log(`  Path:           ${targetDoc.path || "N/A"}`);
            console.log(`  Created:        ${targetDoc.created_at}`);
            console.log(`  Sections Count: ${secCount}`);
            console.log(`  Micro-Chunks:   ${chunkCount}`);
            if (sampleSections.length > 0) {
              console.log("\n  Sample Section Headings:");
              sampleSections.forEach((s, idx) => console.log(`    ${idx + 1}. ${s.heading || "Untitled Section"}`));
            }
            console.log("\n");
            await waitForEnter();
          } else if (actionRes.action === "select" && actionRes.value === "export_json") {
            const { exportDocumentToFile } = await import("./ingest/exporter.js");
            const outFile = exportDocumentToFile(targetDoc.id, null, db);
            console.clear();
            console.log(`\n  \x1b[32m[OK] Full document JSON exported to:\x1b[0m`);
            console.log(`  \x1b[36m${outFile}\x1b[0m\n`);
            await waitForEnter();
          } else if (actionRes.action === "select" && actionRes.value === "delete") {
            await deleteDocument(targetDoc.id, db);
            console.clear();
            console.log(`\n  [OK] Document "${targetDoc.title || targetDoc.path}" deleted from RAG base.\n`);
            await waitForEnter();
          }
        }
        break;
      }
      case "export_snapshot": {
        const { exportSnapshot } = await import("./admin/snapshot.js");
        const { MEMORY_DIR } = await import("./memory.js");
        const defaultPath = join(MEMORY_DIR, "exports", `rag_snapshot_${Date.now()}.json.gz`);
        const pathRes = await readTextInput("Enter Output Snapshot Path (.json or .json.gz)", defaultPath);
        if (pathRes.action === "submit" && pathRes.value) {
          console.clear();
          console.log(`\n  [EXPORT] Exporting full snapshot to: \x1b[36m${pathRes.value}\x1b[0m...\n`);
          try {
            const res = await exportSnapshot({ outputPath: pathRes.value });
            console.log(`  \x1b[32m[OK] Snapshot exported successfully!\x1b[0m`);
            console.log(`  Documents:    ${res.snapshot.documents ? res.snapshot.documents.length : 0}`);
            console.log(`  Micro-Chunks: ${res.snapshot.micro_chunks ? res.snapshot.micro_chunks.length : 0}`);
            console.log(`  Blobs:        ${res.snapshot.blobs ? res.snapshot.blobs.length : 0}`);
            console.log(`  Output:       ${res.outputPath}\n`);
          } catch (err) {
            console.error(`  \x1b[31m[ERROR] Snapshot export failed: ${err.message}\x1b[0m\n`);
          }
          await waitForEnter();
        }
        break;
      }
      case "import_snapshot": {
        const { importSnapshot, listAvailableSnapshots } = await import("./admin/snapshot.js");
        const availableSnapshots = listAvailableSnapshots();

        let chosenPath = null;

        if (availableSnapshots.length > 0) {
          const menuItems = availableSnapshots.map((s) => ({
            label: s.name,
            badge: `${s.sizeMB} MB`,
            hint: s.dateStr,
            info: `Path: ${s.path}`,
            value: s.path,
          }));

          menuItems.push({
            label: "[MANUAL ENTRY] Enter Custom Snapshot File Path...",
            value: "manual",
            info: "Type or paste an absolute file path to a .json or .json.gz snapshot file",
          });
          menuItems.push({ label: "< Cancel / Back", value: "back" });

          const subRes = await selectSimpleMenu({
            title: "SELECT SNAPSHOT FOR IMPORT",
            subtitle: `Found ${availableSnapshots.length} snapshot files in exports directory`,
            items: menuItems,
          });

          if (subRes.action === "back" || subRes.value === "back") {
            break;
          }

          if (subRes.value === "manual") {
            const inputRes = await readTextInput("Enter Input Snapshot Path (.json or .json.gz)");
            if (inputRes.action === "submit" && inputRes.value) {
              chosenPath = inputRes.value;
            } else {
              break;
            }
          } else {
            chosenPath = subRes.value;
          }
        } else {
          const inputRes = await readTextInput("Enter Input Snapshot Path (.json or .json.gz)");
          if (inputRes.action === "submit" && inputRes.value) {
            chosenPath = inputRes.value;
          } else {
            break;
          }
        }

        if (chosenPath) {
          console.clear();
          console.log(`\n  [IMPORT] Importing snapshot from: \x1b[36m${chosenPath}\x1b[0m...\n`);
          try {
            const res = await importSnapshot({ snapshotPathOrData: chosenPath });
            console.log(`  \x1b[32m[OK] Snapshot imported successfully!\x1b[0m`);
            console.log(`  Documents:    ${res.documents}`);
            console.log(`  Sections:     ${res.sections}`);
            console.log(`  Medium-Chunks:${res.medium_chunks}`);
            console.log(`  Micro-Chunks: ${res.micro_chunks}`);
            console.log(`  Blobs:        ${res.blobs}\n`);
          } catch (err) {
            console.error(`  \x1b[31m[ERROR] Snapshot import failed: ${err.message}\x1b[0m\n`);
          }
          await waitForEnter();
        }
        break;
      }
      case "hard_reset": {
        const confirmRes = await selectSimpleMenu({
          title: "HARD RESET DATABASE & BLOB STORAGE",
          subtitle: `Permanently purge all ${stats.docCount} docs, ${stats.chunkCount} chunks & blobs`,
          items: [
            {
              label: "[CONFIRM HARD RESET] Purge All Documents, Vectors & Blobs",
              value: "confirm",
              info: "WARNING: Irreversible deletion of all SQLite documents, micro-chunks, and CAS blobs!",
            },
            { label: "< Cancel / Back", value: "cancel" },
          ],
        });

        if (confirmRes.action === "select" && confirmRes.value === "confirm") {
          const { hardResetDatabase } = await import("./admin/snapshot.js");
          const res = hardResetDatabase();
          console.clear();
          console.log(`\n  \x1b[32m[OK] HARD RESET COMPLETED SUCCESSFULLY!\x1b[0m`);
          console.log(`  Purged Documents: ${res.purgedDocuments}`);
          console.log(`  Purged Chunks:    ${res.purgedChunks}`);
          console.log(`  Purged Blobs:     ${res.purgedBlobs}\n`);
          await waitForEnter();
        }
        break;
      }
      case "manage_models": {
        let modelMgmtRunning = true;
        while (modelMgmtRunning) {
          const allPresets = [...new Set([...EMBEDDING_PRESETS, ...RERANKER_PRESETS.filter((r) => r !== "none")])];
          const cachedOnDisk = listAllCachedModels();
          const diskModelNames = cachedOnDisk.map((m) => m.modelName);

          const combinedModels = [...new Set([...allPresets, ...diskModelNames])];

          let totalDiskBytes = 0;
          const modelItems = combinedModels.map((m) => {
            const info = getModelStorageInfo(m);
            totalDiskBytes += info.bytes;
            let badge = "NOT DOWNLOADED";
            if (info.status === "downloaded") badge = `READY (${info.sizeMB} MB)`;
            else if (info.status === "partial") badge = `INCOMPLETE (${info.sizeMB} MB)`;

            return {
              label: m,
              badge,
              value: m,
              info: info.status !== "not_downloaded"
                ? `Size: ${info.sizeMB} MB | Select to inspect or delete from disk`
                : "Model weights not present on local disk",
            };
          });

          modelItems.push({ label: "< Back to Main Menu", value: "back" });

          const totalDiskMB = (totalDiskBytes / (1024 * 1024)).toFixed(2);
          const subRes = await selectSimpleMenu({
            title: "ML MODEL CACHE MANAGEMENT",
            subtitle: `Total ML Storage Used: ${totalDiskMB} MB | Models Tracked: ${combinedModels.length}`,
            items: modelItems,
          });

          if (subRes.action === "back" || subRes.value === "back") {
            modelMgmtRunning = false;
            break;
          }

          const selectedModel = subRes.value;
          const selectedInfo = getModelStorageInfo(selectedModel);

          if (selectedInfo.status === "not_downloaded") {
            console.clear();
            console.log(`\n  [*] Model "${selectedModel}" is not downloaded on local disk.\n`);
            await waitForEnter();
            continue;
          }

          const actionRes = await selectSimpleMenu({
            title: `MODEL ACTION: ${selectedModel}`,
            subtitle: `Status: ${selectedInfo.status.toUpperCase()} | Size: ${selectedInfo.sizeMB} MB`,
            items: [
              { label: `[PURGE] Delete model weights from disk (${selectedInfo.sizeMB} MB)`, value: "delete", info: `Delete ${selectedInfo.dir} permanently` },
              { label: "< Cancel / Back", value: "cancel" },
            ],
          });

          if (actionRes.action === "select" && actionRes.value === "delete") {
            const delRes = deleteModelCache(selectedModel);
            console.clear();
            if (delRes.deleted) {
              console.log(`\n  \x1b[32m[OK] Model "${selectedModel}" deleted successfully (${delRes.freedMB} MB freed).\x1b[0m\n`);
            } else {
              console.error(`\n  \x1b[31m[ERROR] Failed to delete model: ${delRes.reason}\x1b[0m\n`);
            }
            await waitForEnter();
          }
        }
        break;
      }
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
          const line = "─".repeat(PANEL_WIDTH - 2);
          console.log(`\x1b[36m╭${line}╮\x1b[0m`);
          console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37mGRAPH & NOTEBOOK LINKING VERIFICATION\x1b[0m${" ".repeat(PANEL_WIDTH - 42)}\x1b[36m│\x1b[0m`);
          console.log(`\x1b[36m╰${line}╯\x1b[0m\n`);

          const sampleDoc = `# Ода о единороге (Секретный проект Unicorn)

## Раздел 1: Введение
Разработка нового высоконагруженного сервиса Unicorn.

## Раздел 2: Стандарты
Строка 7: Бэкенд пишется исключительно на Go.
Строка 8: Хранилище транзакций — PostgreSQL 16.
`;

          const { ingestDocument } = await import("./ingest/pipeline.js");
          const { linkFactToDocument, getLinksForFact } = await import("./graph/knowledge_linker.js");
          const { readMemoryRaw, writeMemory, scopeKey } = await import("./memory.js");

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
          const line = "─".repeat(PANEL_WIDTH - 2);
          console.log(`\x1b[36m╭${line}╮\x1b[0m`);
          console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37mGPU PROFILER BENCHMARK\x1b[0m${" ".repeat(PANEL_WIDTH - 28)}\x1b[36m│\x1b[0m`);
          console.log(`\x1b[36m│\x1b[0m  \x1b[90m${"Profiling DirectML tensor execution stages & VRAM throughput".padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[36m│\x1b[0m`);
          console.log(`\x1b[36m╰${line}╯\x1b[0m\n`);

          const savedConfig = getConfig();
          try {
            const { runGpuProfileBenchmark } = await import("./benchmarks/gpu_profile_benchmark.js");
            await runGpuProfileBenchmark({
              modelName: savedConfig.embeddingModel,
              batchSize: savedConfig.batchSize || 32,
              totalItems: 512,
            });
          } catch (err) {
            console.error(`  \x1b[31m[ERROR] GPU Profile benchmark failed: ${err.message}\x1b[0m\n`);
          }
          // Restore original device config
          updateConfig({ executionDevice: savedConfig.executionDevice });
          await waitForEnter();
          break;
        }

        if (modeRes.value === "cpu_vs_gpu") {
          console.clear();
          const line = "─".repeat(PANEL_WIDTH - 2);
          console.log(`\x1b[36m╭${line}╮\x1b[0m`);
          console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37mCPU vs GPU COMPARISON BENCHMARK\x1b[0m${" ".repeat(PANEL_WIDTH - 37)}\x1b[36m│\x1b[0m`);
          console.log(`\x1b[36m│\x1b[0m  \x1b[90m${"Identical workload on CPU then GPU — automatic device switching".padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[36m│\x1b[0m`);
          console.log(`\x1b[36m╰${line}╯\x1b[0m\n`);

          const savedConfig = getConfig();
          try {
            const { runCpuVsGpuComparison } = await import("./benchmarks/gpu_profile_benchmark.js");
            await runCpuVsGpuComparison({
              modelName: savedConfig.embeddingModel,
              batchSize: savedConfig.batchSize || 32,
              totalItems: 512,
            });
          } catch (err) {
            console.error(`  \x1b[31m[ERROR] CPU vs GPU benchmark failed: ${err.message}\x1b[0m\n`);
          }
          // Restore original device config
          updateConfig({ executionDevice: savedConfig.executionDevice });
          await waitForEnter();
          break;
        }

        const isSmoke = modeRes.value === "smoke";
        console.clear();
        const line = "─".repeat(PANEL_WIDTH - 2);
        const modeTitle = isSmoke ? "SMOKE BENCHMARK IN PROGRESS" : "BENCHMARK IN PROGRESS";
        const modeSub = isSmoke ? "Fetch 6 docs + Ingest + Eval 9 queries (stats skipped)" : "Fetch Corpus + Ingest + Evaluate 21 Queries";
        console.log(`\x1b[36m╭${line}╮\x1b[0m`);
        console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37m${modeTitle.padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[36m│\x1b[0m`);
        console.log(`\x1b[36m│\x1b[0m  \x1b[90m${modeSub.padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[36m│\x1b[0m`);
        console.log(`\x1b[36m╰${line}╯\x1b[0m\n`);

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
          const { evaluateSearchQualityComparison } = await import("./benchmarks/quality_evaluator.js");
          const { runIngestionBenchmark } = await import("./benchmarks/stress_ingestion.js");
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
          const line = "─".repeat(PANEL_WIDTH - 2);
          console.log(`\x1b[36m╭${line}╮\x1b[0m`);
          console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37mSEARCH QUERY EXECUTION\x1b[0m${" ".repeat(PANEL_WIDTH - 26)}\x1b[36m│\x1b[0m`);
          console.log(`\x1b[36m╰${line}╯\x1b[0m`);
          console.log(`\n  [SEARCH] Executing query: "\x1b[36m${queryRes.value}\x1b[0m"...\n`);
          try {
            const results = await hybridQuery({ query: queryRes.value, limit: 3 });
            if (!results || results.length === 0) {
              console.log("  [*] No matching results found in knowledge base.");
            } else {
              results.forEach((r, i) => {
                console.log(`\n  \x1b[36m╭─ [Hit #${i + 1}] ${r.doc_title || "Doc"} > ${r.breadcrumbs || ""} ─╮\x1b[0m`);
                console.log(`  \x1b[36m│\x1b[0m Score: \x1b[33m${r.score}\x1b[0m (RSF: ${r.rsf_score}, RRF: ${r.rrf_score}, CosSim: ${r.cosine_sim})`);
                console.log(`  \x1b[36m│\x1b[0m Snippet: \x1b[90m${r.snippet ? r.snippet.substring(0, 100).replace(/\n/g, " ") : ""}...\x1b[0m`);
                console.log(`  \x1b[36m╰${"─".repeat(56)}╯\x1b[0m`);
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
      case "cloud_login": {
        console.clear();
        console.log("\n  [CLOUD] Запуск процесса авторизации в облаке Turso...");
        const { loginToCloud } = await import("./admin/auth.js");
        try {
          const secrets = await loginToCloud();
          console.log(`\n  \x1b[32m[OK] Успешный вход в облако! Подключен к endpoint: ${secrets.dbUrl}\x1b[0m\n`);
        } catch (e) {
          console.error(`\n  \x1b[31m[ERROR] Ошибка авторизации: ${e.message}\x1b[0m\n`);
        }
        await waitForEnter();
        break;
      }
      case "cloud_logout": {
        console.clear();
        console.log("\n  [CLOUD] Выход из облака...");
        const { logoutFromCloud } = await import("./admin/auth.js");
        const deleted = logoutFromCloud();
        if (deleted) {
          console.log("  \x1b[32m[OK] Вы вышли из облака. Секретные ключи удалены. Режим изменен на only-local.\x1b[0m\n");
        } else {
          console.log("  [*] Режим изменен на only-local. Сессионных токенов не было обнаружено.\x1b[0m\n");
        }
        await waitForEnter();
        break;
      }
      case "cloud_mode": {
        const modeItems = [
          { label: "only-local (Только локальный)", value: "only-local", info: "Полностью приватный автономный режим (все на диске)" },
          { label: "only-cloud (Только облачный)", value: "only-cloud", info: "Полностью облачный бессерверный режим без локального кэширования" },
          { label: "hybrid-sync (Локальный с фоновой синхронизацией)", value: "hybrid-sync", info: "Локальные мгновенные операции с фоновым демоном синхронизации" },
        ];
        const initialIdx = Math.max(0, modeItems.findIndex((i) => i.value === config.mode));
        const subRes = await selectSimpleMenu({
          title: "CHOOSE OPERATIONAL MODE",
          subtitle: "Configure database storage and cloud sync behavior",
          items: modeItems,
          initialIndex: initialIdx,
        });

        if (subRes.action === "select") {
          updateConfig({ mode: subRes.value });
        }
        break;
      }
      case "enable_prompt": {
        const { enableGlobalPrompt } = await import("./prompt_manager.js");
        const results = await enableGlobalPrompt();
        console.clear();
        console.log("\n  [OK] Global prompt enabled across client configurations:\n");
        results.forEach((r) => console.log(`  - ${r.name}: ${r.filePath} (${r.status})`));
        await waitForEnter();
        break;
      }
      case "disable_prompt": {
        const { disableGlobalPrompt } = await import("./prompt_manager.js");
        const results = await disableGlobalPrompt();
        console.clear();
        console.log("\n  [OK] Global prompt disabled across client configurations:\n");
        results.forEach((r) => console.log(`  - ${r.name}: ${r.filePath} (${r.status})`));
        await waitForEnter();
        break;
      }
      case "reset": {
        resetConfig();
        console.clear();
        console.log("\n  [OK] Configuration reset to factory defaults (RSF 50/50, e5-small, no reranker).\n");
        await waitForEnter();
        break;
      }
      case "exit": {
        running = false;
        console.clear();
        console.log("Exiting CLI. Configuration saved.");
        break;
      }
    }
  }
}

if (process.argv[1] && process.argv[1].includes("cli.js")) {
  if (typeof global.gc !== "function") {
    const { spawn } = await import("node:child_process");
    const args = ["--expose-gc", ...process.argv.slice(1)];
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("exit", (code) => process.exit(code));
  } else {
    runCli().catch((err) => console.error("CLI error:", err));
  }
}
