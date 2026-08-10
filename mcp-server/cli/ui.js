import readline from "readline";

export const EMBEDDING_PRESETS = [
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

export const RERANKER_PRESETS = [
  "none",
  "Xenova/bge-reranker-base",
  "Xenova/bge-reranker-large",
  "Xenova/ms-marco-MiniLM-L-6-v2",
  "Xenova/ms-marco-TinyBERT-L-2-v2",
];

export const PANEL_WIDTH = 58;

export async function downloadModelWithProgress(modelName, type = "embedding") {
  console.clear();
  console.log(`\n  MODEL DOWNLOAD & PRELOAD`);
  console.log(`  \x1b[90m${type.toUpperCase()}: ${modelName.substring(0, 36)}\x1b[0m\n`);

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
    const { preloadModel } = await import("../ml/model_manager.js");
    await preloadModel(modelName, type, handleProgress);
    process.stdout.write("\r" + " ".repeat(72) + "\r");
    console.log(`  \x1b[32m[OK] Model "${modelName}" ready!\x1b[0m\n`);
  } catch (err) {
    process.stdout.write("\r" + " ".repeat(72) + "\r");
    console.error(`  \x1b[31m[ERROR] Download for "${modelName}" failed: ${err.message}\x1b[0m\n`);
  }
}

export function printHeaderPanel(title, stats) {
  console.log(`\n  \x1b[1m\x1b[37m${title}\x1b[0m`);
  console.log(`  \x1b[90mStorage: ${stats.docCount} Docs | ${stats.chunkCount} Chunks | ${stats.factCount} Facts\x1b[0m`);
}

export function printQuickInfoBox(infoText) {
  console.log(`  \x1b[90mINFO: ${infoText}\x1b[0m\n`);
}

export function padVisible(str, width, align = "left") {
  const visibleLength = String(str).replace(/\x1b\[[0-9;]*m/g, "").length;
  const padding = " ".repeat(Math.max(0, width - visibleLength));
  return align === "right" ? padding + str : str + padding;
}

export function formatRankColor(rankStr) {
  if (rankStr === "#1") return "\x1b[1m\x1b[32m#1\x1b[0m";
  if (rankStr.startsWith("#")) return `\x1b[33m${rankStr}\x1b[0m`;
  return "\x1b[90mMISSED\x1b[0m";
}

export function wrapText(text, width) {
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

export function renderPerQueryBreakdownTable(breakdown) {
  if (!breakdown || breakdown.length === 0) return;

  console.log(`\n  PER-QUERY RESULTS BREAKDOWN (${breakdown.length} Queries)\n`);

  breakdown.forEach((item, itemIdx) => {
    const isMatch = item.topHit && (item.topHit === item.target || (item.expectedDocIds && item.expectedDocIds.includes(item.topHit)));

    console.log(`  ${item.id}. ${item.query}`);
    console.log(`     Target: \x1b[36m${item.target}\x1b[0m`);
    console.log(`     BM25: ${formatRankColor(item.bm25Rank)}  Vector: ${formatRankColor(item.vectorRank)}  RRF: ${formatRankColor(item.rrfRank)}  RSF: ${formatRankColor(item.rsfRank)}`);
    console.log(`     Top Hit: ${isMatch ? "\x1b[32m" : "\x1b[33m"}${item.topHit || "NONE"}\x1b[0m`);
    
    if (itemIdx < breakdown.length - 1) {
      console.log("");
    }
  });

  console.log("");
}

export function renderBenchmarkResultsTable(results) {
  const isSmoke = results && results.mode === "smoke";
  const title = isSmoke ? "SMOKE BENCHMARK RESULTS" : "SEARCH QUALITY BENCHMARK RESULTS";
  const nQueries = results && results.bm25 ? results.bm25.n : 0;
  const subtitle = isSmoke
    ? `Smoke: ${nQueries} queries (stats skipped, fast iteration)`
    : `Evaluated over ${nQueries} challenging cross-lingual queries`;

  console.log(`\n  \x1b[1m\x1b[37m${title}\x1b[0m`);
  console.log(`  \x1b[90m${subtitle}\x1b[0m\n`);

  if (results && results.breakdown) {
    renderPerQueryBreakdownTable(results.breakdown);
  }

  console.log(`\n  METRIC COMPARISON BY SEARCH STRATEGY\n`);
  console.log(`  Strategy            MRR@5     Recall@5     NDCG@5`);
  console.log(`  ${"─".repeat(50)}`);

  const strategies = [
    { name: "BM25 Search Only", data: results.bm25, key: "bm25" },
    { name: "Dense ONNX Vector", data: results.vector, key: "vector" },
    { name: "Hybrid RRF (Rank)", data: results.hybridRrf, key: "hybrid_rrf" },
    { name: "Hybrid RSF (Score)", data: results.hybridRsf, key: "hybrid_rsf" },
  ];

  const getMrr = (d) => (d ? (d.mrr ?? d.mrrAtK ?? 0) : 0);
  const getRecall = (d) => (d ? (d.recall ?? d.recallAtK ?? 0) : 0);
  const getNdcg = (d) => (d ? (d.ndcg ?? d.ndcgAtK ?? 0) : 0);

  strategies.forEach((s) => {
    const nameStr = s.name.padEnd(20);
    const mrrStr = getMrr(s.data).toFixed(4).padEnd(10);
    const recallPct = (getRecall(s.data) * 100).toFixed(1) + "%";
    const recallStr = recallPct.padEnd(13);
    const ndcgStr = getNdcg(s.data).toFixed(4);

    const isBest = results.winner && s.key === results.winner;
    const color = isBest ? "\x1b[1m\x1b[36m" : "\x1b[37m";

    console.log(`  ${color}${nameStr}${mrrStr}${recallStr}${ndcgStr}\x1b[0m`);
  });

  console.log("");

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
    console.log(`  \x1b[90m Winner by MRR: \x1b[1m\x1b[36m${winnerLabel}\x1b[0m\x1b[90m${sigNote}\x1b[0m\n`);
  }
}

export function selectCategoryMenu({ title, stats, categories, initialIndex = 0 }) {
  return new Promise((resolve) => {
    let activeIndex = Math.min(Math.max(0, initialIndex), categories.length - 1);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    function render() {
      console.clear();
      console.log(`\n  ${title}\n`);
      console.log(`  Storage: ${stats.docCount} Docs | ${stats.chunkCount} Chunks | ${stats.factCount} Facts\n`);
      console.log("  Controls: ↑ / ↓ - Navigate   [ENTER] - Select   [BACKSPACE] - Exit\n");

      categories.forEach((cat, idx) => {
        const isSelected = idx === activeIndex;
        const pointer = isSelected ? "  > " : "    ";
        const label = isSelected ? `\x1b[1m\x1b[36m${cat.label}\x1b[0m` : cat.label;
        const hint = cat.hint ? ` \x1b[90m(${cat.hint})\x1b[0m` : "";
        console.log(`${pointer}${label}${hint}`);
      });

      console.log("");

      const activeCat = categories[activeIndex];
      if (activeCat && activeCat.info) {
        console.log(`  \x1b[90m${activeCat.info}\x1b[0m\n`);
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
        activeIndex = (activeIndex - 1 + categories.length) % categories.length;
        render();
      } else if (key.name === "down") {
        activeIndex = (activeIndex + 1) % categories.length;
        render();
      } else if (key.name === "return") {
        cleanup();
        resolve({ action: "select", index: activeIndex, value: categories[activeIndex].value });
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

export function selectSimpleMenu({ title, subtitle = "", items, initialIndex = 0 }) {
  return new Promise((resolve) => {
    let index = Math.min(Math.max(0, initialIndex), items.length - 1);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    function render() {
      console.clear();
      console.log(`\n  ${title}`);
      if (subtitle) {
        console.log(`  \x1b[90m${subtitle}\x1b[0m`);
      }
      console.log("\n  Controls: ↑ / ↓ - Navigate   [ENTER] - Select   [BACKSPACE] - Back\n");

      items.forEach((item, idx) => {
        const isSelected = idx === index;
        const pointer = isSelected ? "  > " : "    ";
        const label = isSelected ? `\x1b[1m\x1b[36m${item.label}\x1b[0m` : item.label;
        const badge = item.badge ? ` \x1b[33m[${item.badge}]\x1b[0m` : "";
        const hint = item.hint ? ` \x1b[90m(${item.hint})\x1b[0m` : "";
        console.log(`${pointer}${label}${badge}${hint}`);
      });

      console.log("");

      const activeItem = items[index];
      if (activeItem && activeItem.info) {
        console.log(`  \x1b[90m${activeItem.info}\x1b[0m\n`);
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

export function adjustAlphaMenu(initialAlpha) {
  return new Promise((resolve) => {
    let alpha = initialAlpha;

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    function render() {
      console.clear();
      console.log(`\n  RSF ALPHA WEIGHT BALANCER`);
      console.log(`  \x1b[90mAdjust Vector Similarity vs BM25 Score Weight\x1b[0m`);
      console.log("\n  Controls: ← / → or ↑ / ↓ - Adjust (5% step)   [ENTER] - Save   [BACKSPACE] - Cancel\n");

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

export function readTextInput(promptText, defaultValue = "") {
  return new Promise((resolve) => {
    let text = defaultValue;

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    function render() {
      console.clear();
      console.log(`\n  INPUT: ${promptText.toUpperCase()}`);
      console.log("  Controls: Type text   [ENTER] - Submit   [BACKSPACE] - Delete / Cancel\n");
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

export function waitForEnter() {
  return new Promise((resolve) => {
    console.log("\n \x1b[90mPress [ENTER] or [BACKSPACE] to return to menu...\x1b[0m");
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

export function promptText(question) {
  return new Promise((resolve) => {
    let input = "";
    let cursorPos = 0;

    console.log(`\n  ${question}\n  > `);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    function render() {
      process.stdout.write(`\r  > ${input}\x1b[K`);
      process.stdout.write(`\r  > ${input.substring(0, cursorPos)}`);
    }

    function onKeypress(str, key) {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }
      if (key.name === "return") {
        cleanup();
        resolve(input.trim());
      } else if (key.name === "backspace") {
        if (cursorPos > 0) {
          input = input.substring(0, cursorPos - 1) + input.substring(cursorPos);
          cursorPos--;
          render();
        }
      } else if (key.name === "delete") {
        if (cursorPos < input.length) {
          input = input.substring(0, cursorPos) + input.substring(cursorPos + 1);
          render();
        }
      } else if (key.name === "left") {
        if (cursorPos > 0) { cursorPos--; render(); }
      } else if (key.name === "right") {
        if (cursorPos < input.length) { cursorPos++; render(); }
      } else if (key.name === "home") {
        cursorPos = 0; render();
      } else if (key.name === "end") {
        cursorPos = input.length; render();
      } else if (str && !key.ctrl && !key.meta) {
        input = input.substring(0, cursorPos) + str + input.substring(cursorPos);
        cursorPos += str.length;
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
