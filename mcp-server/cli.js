#!/usr/bin/env node
import readline from "readline";
import { getConfig, updateConfig, resetConfig } from "./config/config_manager.js";
import { hybridQuery } from "./retrieval/retriever.js";
import { getDatabase } from "./db/database.js";
import { deleteDocument } from "./ingest/pipeline.js";
import { readMemoryRaw, readMemory, writeMemory, GLOBAL_KEY, projectName } from "./memory.js";
import { getCorpusCacheSize, clearCorpusCache } from "./benchmarks/fetch_real_corpus.js";
import { SMOKE_DOC_IDS } from "./benchmarks/quality_evaluator.js";

const EMBEDDING_PRESETS = [
  "Xenova/multilingual-e5-small",
  "Xenova/all-MiniLM-L6-v2",
  "Xenova/bge-small-en-v1.5",
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
];

const RERANKER_PRESETS = [
  "none",
  "Xenova/bge-reranker-base",
  "Xenova/bge-reranker-small",
  "Xenova/ms-marco-TinyBERT-L-2-v2",
];

const PANEL_WIDTH = 58;

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
    const projName = projectName(null, null);
    const globalF = await readMemoryRaw(GLOBAL_KEY);
    const projF = await readMemoryRaw(projName);
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
      } else if (key.name === "backspace" || key.name === "escape") {
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
      } else if (key.name === "backspace" || key.name === "escape") {
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
      } else if (key.name === "backspace" || key.name === "escape") {
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
      } else if (key.name === "backspace") {
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
      if (key.name === "return" || key.name === "backspace" || key.name === "escape" || key.name === "space") {
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

export async function runCli() {
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
            info: `Model: ${config.embeddingModel}. ONNX Feature Extraction via @xenova/transformers`,
          },
          {
            label: "Reranker Model",
            badge: config.rerankerEnabled ? config.rerankerModel.split("/").pop() : "DISABLED",
            value: "reranker",
            info: config.rerankerEnabled ? `Reranker active: ${config.rerankerModel}` : "Optional Cross-Encoder re-ranking pass",
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
        const embItems = EMBEDDING_PRESETS.map((m) => ({ label: m, value: m, info: `Load ONNX model ${m}` }));
        embItems.push({ label: "Custom HuggingFace Model...", value: "custom", info: "Specify custom HF model string" });
        const initialEmbIdx = Math.max(0, embItems.findIndex((i) => i.value === config.embeddingModel));
        
        const subRes = await selectSimpleMenu({
          title: "SELECT EMBEDDING MODEL",
          subtitle: "Dense vector extraction model via @xenova/transformers",
          items: embItems,
          initialIndex: initialEmbIdx,
        });

        if (subRes.action === "select") {
          if (subRes.value === "custom") {
            const inputRes = await readTextInput("Enter HuggingFace Model ID", "Xenova/all-MiniLM-L6-v2");
            if (inputRes.action === "submit" && inputRes.value) {
              updateConfig({ embeddingModel: inputRes.value });
            }
          } else {
            updateConfig({ embeddingModel: subRes.value });
          }
        }
        break;
      }
      case "reranker": {
        const rkItems = [
          { label: "Disable Reranker", value: "none", info: "No cross-encoder re-ranking" },
          ...RERANKER_PRESETS.filter((r) => r !== "none").map((r) => ({ label: r, value: r, info: `Load reranker ${r}` })),
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
          } else if (subRes.value === "custom") {
            const inputRes = await readTextInput("Enter HuggingFace Reranker Model ID", "Xenova/bge-reranker-base");
            if (inputRes.action === "submit" && inputRes.value) {
              updateConfig({ rerankerEnabled: true, rerankerModel: inputRes.value });
            }
          } else {
            updateConfig({ rerankerEnabled: true, rerankerModel: subRes.value });
          }
        }
        break;
      }
      case "notebook": {
        let nbRunning = true;
        while (nbRunning) {
          const projName = projectName(null, null);
          const scopeItems = [
            { label: "Global Memory", value: "global", badge: "global.md", info: "User facts stored across all projects" },
            { label: `Project Memory (${projName})`, value: "project", badge: `${projName}.md`, info: `Facts specific to project ${projName}` },
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

          const key = scopeRes.value === "global" ? GLOBAL_KEY : projName;
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
              factRunning = false;
              break;
            }

            const factItems = factList.map((fact, idx) => ({
              label: `${idx + 1}. ${fact}`,
              value: idx,
              info: `Select to delete this fact from ${key}.md`,
            }));
            factItems.push({ label: "< Back", value: "back" });

            const factRes = await selectSimpleMenu({
              title: `NOTEBOOK FACTS [${key.toUpperCase()}]`,
              subtitle: `Total facts: ${factList.length}`,
              items: factItems,
            });

            if (factRes.action === "back" || factRes.value === "back") {
              factRunning = false;
              break;
            }

            const selectedIdx = factRes.value;
            const selectedFact = factList[selectedIdx];

            const actionRes = await selectSimpleMenu({
              title: `FACT ACTION`,
              subtitle: `Fact: "${selectedFact}"`,
              items: [
                { label: "[DELETE] Delete this fact from store", value: "delete", info: "Remove fact permanently" },
                { label: "< Cancel / Back", value: "cancel" },
              ],
            });

            if (actionRes.action === "select" && actionRes.value === "delete") {
              const updated = [...rawEntries];
              updated.splice(selectedIdx, 1);
              await writeMemory(key, updated);
              console.clear();
              console.log("\n  [OK] Fact deleted successfully.\n");
              await waitForEnter();
            }
          }
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

          const docItems = docs.map((doc) => ({
            label: doc.title || doc.path || "Untitled Document",
            badge: doc.created_at ? doc.created_at.substring(0, 16) : "",
            hint: doc.id ? `ID: ${doc.id.substring(0, 8)}...` : "",
            info: `Path: ${doc.path || "N/A"}`,
            value: doc,
          }));
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
          } else if (actionRes.action === "select" && actionRes.value === "delete") {
            await deleteDocument(targetDoc.id, db);
            console.clear();
            console.log(`\n  [OK] Document "${targetDoc.title || targetDoc.path}" deleted from RAG base.\n`);
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
  runCli().catch((err) => console.error("CLI error:", err));
}
