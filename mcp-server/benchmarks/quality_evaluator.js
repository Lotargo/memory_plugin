import { bm25Search, vectorSearch, hybridQuery, rrfFusion, rsfFusion } from "../retrieval/retriever.js";
import { embedText } from "../ml/model_manager.js";
import { basename } from "node:path";

const PANEL_WIDTH = 58;

function printRichPanel(title, subtitle = "") {
  const line = "─".repeat(PANEL_WIDTH - 2);
  console.log(`\x1b[36m╭${line}╮\x1b[0m`);
  console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37m${title.padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[36m│\x1b[0m`);
  if (subtitle) {
    console.log(`\x1b[36m│\x1b[0m  \x1b[90m${subtitle.padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[36m│\x1b[0m`);
  }
  console.log(`\x1b[36m╰${line}╯\x1b[0m`);
}

export const CHALLENGING_EVALUATION_QUERIES = [
  // Category A: Semantic & Paraphrased Queries (No exact keyword overlap)
  { query: "Библиотека для выполнения HTTP запросов и отмены отправки данных", expectedDocIds: ["axios_readme"], category: "Semantic RU->EN", instruction: "Retrieve relevant software documentation and technical guides" },
  { query: "Инструмент для мгновенной горячей перезагрузки кода при разработке frontend", expectedDocIds: ["vite_readme"], category: "Semantic RU->EN", instruction: "Retrieve relevant software documentation and technical guides" },
  { query: "Централизованное управление состоянием приложения в одном сторе", expectedDocIds: ["redux_readme"], category: "Semantic RU->EN", instruction: "Retrieve relevant software documentation and technical guides" },
  { query: "Управление изолированными контейнерами приложений через командную строку", expectedDocIds: ["docker_cli_readme"], category: "Semantic RU->EN", instruction: "Retrieve relevant software documentation and technical guides" },
  { query: "Компактная база данных прямо внутри процесса без отдельного сервера", expectedDocIds: ["sqlite_readme", "sqlite_fts5_spec"], category: "Semantic RU->EN", instruction: "Retrieve relevant software documentation and technical guides" },
  { query: "JavaScript рантайм с нативной поддержкой TypeScript и JSX из коробки", expectedDocIds: ["bun_readme"], category: "Semantic RU->EN", instruction: "Retrieve relevant software documentation and technical guides" },
  { query: "Библиотека для декларативной валидации схем с автоматическим выводом типов TypeScript", expectedDocIds: ["zod_readme"], category: "Semantic RU->EN", instruction: "Retrieve relevant software documentation and technical guides" },

  // Category B: Cross-Lingual Technical Concepts (Russian prompt -> English documentation)
  { query: "Асинхронный веб фреймворк на Python с автоматической OpenAPI документацией", expectedDocIds: ["fastapi_readme"], category: "Cross-Lingual", instruction: "Retrieve relevant technical documentation and framework specs" },
  { query: "Язык программирования с гарантией безопасности памяти без Garbage Collector", expectedDocIds: ["rust_readme"], category: "Cross-Lingual", instruction: "Retrieve relevant technical documentation and framework specs" },
  { query: "Верстка элементов интерфейса через атомарные CSS утилиты", expectedDocIds: ["tailwindcss_readme"], category: "Cross-Lingual", instruction: "Retrieve relevant technical documentation and framework specs" },
  { query: "Безопасная среда выполнения TypeScript с возможностью бана сетевых прав", expectedDocIds: ["deno_readme"], category: "Cross-Lingual", instruction: "Retrieve relevant technical documentation and framework specs" },
  { query: "Автоматизация сценариев пользователя в браузере и проверка работы веб-страниц", expectedDocIds: ["playwright_readme"], category: "Cross-Lingual", instruction: "Retrieve relevant technical documentation and framework specs" },
  { query: "Прогрессивный JavaScript фреймворк для создания пользовательских интерфейсов с реактивной моделью данных", expectedDocIds: ["vue_readme"], category: "Cross-Lingual", instruction: "Retrieve relevant technical documentation and framework specs" },
  { query: "Фреймворк для серверного рендеринга React приложений с файловой маршрутизацией", expectedDocIds: ["nextjs_readme"], category: "Cross-Lingual", instruction: "Retrieve relevant technical documentation and framework specs" },

  // Category C: Direct Code & Keyword Searches
  { query: "isCancel AxiosError require default export", expectedDocIds: ["axios_readme"], category: "Code/Keyword", instruction: "Retrieve relevant code snippets and API function signatures" },
  { query: "PRAGMA user_version FTS5 unicode61 tokenizer", expectedDocIds: ["sqlite_readme", "sqlite_fts5_spec"], category: "Code/Keyword", instruction: "Retrieve relevant code snippets and API function signatures" },
  { query: "pipeline feature-extraction quantized ONNX", expectedDocIds: ["transformers_js_readme", "onnx_runtime_spec"], category: "Code/Keyword", instruction: "Retrieve relevant code snippets and API function signatures" },
  { query: "useContext useReducer JSX render DOM", expectedDocIds: ["react_readme"], category: "Code/Keyword", instruction: "Retrieve relevant code snippets and API function signatures" },
  { query: "browser page goto expect locator test", expectedDocIds: ["playwright_readme"], category: "Code/Keyword", instruction: "Retrieve relevant code snippets and API function signatures" },
  { query: "z.object z.string z.number z.enum z.array infer output", expectedDocIds: ["zod_readme"], category: "Code/Keyword", instruction: "Retrieve relevant code snippets and API function signatures" },
  { query: "next dev build start create-next-app React framework", expectedDocIds: ["nextjs_readme"], category: "Code/Keyword", instruction: "Retrieve relevant code snippets and API function signatures" },
];

// Smoke mode: representative subset for fast iteration loops (e.g. during dev).
// Nine queries over five target docs span all three categories. Targets are picked
// so each doc is exercised by ≥2 queries across categories (axios/sqlite/zod in A+C,
// playwright/nextjs in B+C), giving quick signal on whether hybrid fusion still
// works without paying the ~30s full-corpus ingestion + 1000-iter bootstrap cost.
export const SMOKE_QUERY_INDICES = [0, 4, 6, 11, 13, 14, 15, 18, 20];
export const SMOKE_DOC_IDS = [
  "axios_readme",
  "sqlite_readme",
  "sqlite_fts5_spec",
  "zod_readme",
  "playwright_readme",
  "nextjs_readme",
];

// Derives the corpus source-id from a stored doc path. Benchmark corpus files are
// named exactly as in RAW_DOC_SOURCES (e.g. "axios_readme.md"), so basename-no-ext
// gives a stable, strict key to compare against qObj.expectedDocIds.
function deriveSourceId(docMeta) {
  if (!docMeta) return null;
  const p = (docMeta.path || docMeta.doc_path || "") || "";
  if (p.startsWith("virtual://")) return null;
  return basename(p).replace(/\.[^.]+$/, "");
}

function getTopHitSourceId(hits, docMetaStmt) {
  if (!Array.isArray(hits) || hits.length === 0) return "NONE";
  const hit = hits[0];
  let meta = null;
  if (hit.id && docMetaStmt) meta = docMetaStmt.get(hit.id);
  else if (hit.chunk_id && docMetaStmt) meta = docMetaStmt.get(hit.chunk_id);
  return deriveSourceId(meta || hit) || "UNKNOWN";
}

function rankHitsById(hits, docMetaStmt, expectedDocIds, K = 5) {
  const top = Array.isArray(hits) ? hits.slice(0, K) : [];
  for (let r = 0; r < top.length; r++) {
    const hit = top[r];
    let meta = null;
    if (hit.id && docMetaStmt) meta = docMetaStmt.get(hit.id);
    else if (hit.chunk_id && docMetaStmt) meta = docMetaStmt.get(hit.chunk_id);
    const sourceId = deriveSourceId(meta || hit);
    if (sourceId && expectedDocIds.includes(sourceId)) return r + 1;
  }
  return 0;
}

// Computes rank given pre-fetched candidate lists. Avoids redundant embedText
// (ONNX inference) calls per query, which previously inflated latency ~4x.
function rankFromPrepared(prepared, docMetaStmt, qObj, mode, K = 5, { alpha = 0.5, rrfK = 60 } = {}) {
  let hits = [];
  if (mode === "bm25_only") {
    hits = prepared.bm25Hits.slice(0, K);
  } else if (mode === "vector_only") {
    hits = prepared.vectorHits.slice(0, K);
  } else if (mode === "hybrid_rrf") {
    hits = rrfFusion(prepared.bm25Hits, prepared.vectorHits, rrfK, 0.01);
  } else if (mode === "hybrid_rsf") {
    hits = rsfFusion(prepared.bm25Hits, prepared.vectorHits, alpha, 0.01);
  } else {
    return 0;
  }
  return rankHitsById(hits, docMetaStmt, qObj.expectedDocIds, K);
}

async function runQueryForMode(db, docMetaStmt, qObj, mode, K = 5, opts = {}) {
  const bm25Hits = bm25Search(db, qObj.query, Math.max(30, K));
  const qVec = await embedText(qObj.query, true);
  const vectorHits = vectorSearch(db, qVec, Math.max(30, K), 0.10);
  return rankFromPrepared({ bm25Hits, qVec, vectorHits }, docMetaStmt, qObj, mode, K, opts);
}

// Compute per-query metric contribution
function metricFromRank(rank) {
  if (rank <= 0) return { mrr: 0, recall: 0, ndcg: 0 };
  return { mrr: 1 / rank, recall: 1, ndcg: 1 / Math.log2(rank + 1) };
}

function aggregate(perQuery) {
  // perQuery = array of {rank}
  let mrr = 0, recall = 0, ndcg = 0;
  for (const q of perQuery) {
    const m = metricFromRank(q.rank);
    mrr += m.mrr;
    recall += m.recall;
    ndcg += m.ndcg;
  }
  const n = perQuery.length || 1;
  return {
    mrr: Number((mrr / n).toFixed(4)),
    recall: Number((recall / n).toFixed(4)),
    ndcg: Number((ndcg / n).toFixed(4)),
    n,
  };
}

// Bootstrap 95% confidence intervals for aggregate metrics over query resampling.
function bootstrapCI(perQuery, { iterations = 1000, seed = 42 } = {}) {
  const n = perQuery.length;
  if (n === 0) return { mrrCI: [0, 0], recallCI: [0, 0], ndcgCI: [0, 0] };
  let s = seed;
  function randInt(max) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s % max;
  }
  const mrrSamples = new Array(iterations);
  const recallSamples = new Array(iterations);
  const ndcgSamples = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    let mrr = 0, recall = 0, ndcg = 0;
    for (let j = 0; j < n; j++) {
      const q = perQuery[randInt(n)];
      const m = metricFromRank(q.rank);
      mrr += m.mrr;
      recall += m.recall;
      ndcg += m.ndcg;
    }
    mrrSamples[i] = mrr / n;
    recallSamples[i] = recall / n;
    ndcgSamples[i] = ndcg / n;
  }
  const quantile = (arr, p) => {
    arr.sort((a, b) => a - b);
    const idx = Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))));
    return Number(arr[idx].toFixed(4));
  };
  return {
    mrrCI: [quantile([...mrrSamples], 0.025), quantile([...mrrSamples], 0.975)],
    recallCI: [quantile([...recallSamples], 0.025), quantile([...recallSamples], 0.975)],
    ndcgCI: [quantile([...ndcgSamples], 0.025), quantile([...ndcgSamples], 0.975)],
    iterations,
  };
}

// Pairwise paired t-test comparing per-query reciprocal rank (MRR contributions).
function pairedTTestLR(a, b) {
  let d = 0, d2 = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const av = a[i].rank > 0 ? 1 / a[i].rank : 0;
    const bv = b[i].rank > 0 ? 1 / b[i].rank : 0;
    const diff = av - bv;
    d += diff;
    d2 += diff * diff;
  }
  const mean = d / n;
  let t = 0, p = 1, sem = 0;
  if (n > 1) {
    const variance = (d2 - (d * d) / n) / (n - 1);
    sem = Math.sqrt(variance / n);
    t = sem > 0 ? mean / sem : 0;
    // Approximate two-sided p from t using a rough normal-df-based CDF (n-1 df).
    // This is an approximation sufficient for binary "significantly different?" calls.
    const z = Math.abs(t);
    // Survival function approx (Abramowitz-Stegun 26.2.17).
    const zz = z / Math.sqrt(2);
    const sf = Math.exp(-zz * zz) * (0.254829592 + -0.284496736 * zz + 1.421413741 * zz * zz + -1.453152027 * zz * zz * zz + 1.061405429 * zz * zz * zz * zz) / (1 + 0.3275911 * Math.abs(zz));
    p = Math.min(1, 2 * sf);
  }
  return { meanDiff: Number(mean.toFixed(4)), t, p: Number(p.toFixed(4)), sem: Number(sem.toFixed(4)), n };
}

function renderQueryBreakdownTable(breakdown) {
  console.log("\n \x1b[1m\x1b[36m=== [PER-QUERY BENCHMARK BREAKDOWN & ANSWER EVALUATION] ===\x1b[0m\n");

  const termCols = Math.min(process.stdout.columns || 130, 150);

  function visibleLength(str) {
    return String(str).replace(/\x1b\[[0-9;]*m/g, "").length;
  }

  function padVisible(str, width, alignRight = false) {
    const len = visibleLength(str);
    if (len >= width) return str;
    const pad = " ".repeat(width - len);
    return alignRight ? pad + str : str + pad;
  }

  function wrapText(text, width) {
    if (!text) return [""];
    const words = String(text).split(/\s+/);
    const lines = [];
    let currentLine = "";

    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
      } else if (currentLine.length + 1 + word.length <= width) {
        currentLine += " " + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines.length > 0 ? lines : [""];
  }

  const wId = 4;
  const wBM = 6;
  const wVec = 6;
  const wRRF = 6;
  const wRSF = 6;
  const wAnsTok = 9;

  const remain = Math.max(70, termCols - (wId + wBM + wVec + wRRF + wRSF + wAnsTok + 20));
  const wQ = Math.floor(remain * 0.38);
  const wTarget = Math.floor(remain * 0.24);
  const wSnippet = remain - (wQ + wTarget);

  const header = `│ ${padVisible("#", wId)} │ ${padVisible("Question / Query", wQ)} │ ${padVisible("Target Doc (Tokens)", wTarget)} │ ${padVisible("BM25", wBM)} │ ${padVisible("Vector", wVec)} │ ${padVisible("RRF", wRRF)} │ ${padVisible("RSF", wRSF)} │ ${padVisible("Top Hit & Answer Snippet", wSnippet)} │ ${padVisible("Ans Tok", wAnsTok, true)} │`;
  const sep = `├─${"─".repeat(wId)}─┼─${"─".repeat(wQ)}─┼─${"─".repeat(wTarget)}─┼─${"─".repeat(wBM)}─┼─${"─".repeat(wVec)}─┼─${"─".repeat(wRRF)}─┼─${"─".repeat(wRSF)}─┼─${"─".repeat(wSnippet)}─┼─${"─".repeat(wAnsTok)}─┤`;
  const topBorder = `┌─${"─".repeat(wId)}─┬─${"─".repeat(wQ)}─┬─${"─".repeat(wTarget)}─┬─${"─".repeat(wBM)}─┬─${"─".repeat(wVec)}─┬─${"─".repeat(wRRF)}─┬─${"─".repeat(wRSF)}─┬─${"─".repeat(wSnippet)}─┬─${"─".repeat(wAnsTok)}─┐`;
  const botBorder = `└─${"─".repeat(wId)}─┴─${"─".repeat(wQ)}─┴─${"─".repeat(wTarget)}─┴─${"─".repeat(wBM)}─┴─${"─".repeat(wVec)}─┴─${"─".repeat(wRRF)}─┴─${"─".repeat(wRSF)}─┴─${"─".repeat(wSnippet)}─┴─${"─".repeat(wAnsTok)}─┘`;

  console.log(`\x1b[36m${topBorder}\x1b[0m`);
  console.log(`\x1b[36m${header}\x1b[0m`);
  console.log(`\x1b[36m${sep}\x1b[0m`);

  breakdown.forEach((row, rIdx) => {
    const qLines = wrapText(row.query, wQ);

    const docTokFormatted = row.docTokens > 1000 ? `${(row.docTokens / 1000).toFixed(1)}k tok` : `${row.docTokens} tok`;
    const targetStr = `${row.target} (${docTokFormatted})`;
    const targetLines = wrapText(targetStr, wTarget);

    const topHitStr = row.topHitSnippet ? `${row.topHit}: "${row.topHitSnippet.substring(0, 120).replace(/\n/g, " ")}..."` : (row.topHit || "None");
    const snippetLines = wrapText(topHitStr, wSnippet);

    const maxSubLines = Math.max(qLines.length, targetLines.length, snippetLines.length);

    for (let l = 0; l < maxSubLines; l++) {
      const cellId = l === 0 ? `Q${row.id}` : "";
      const cellQ = qLines[l] || "";
      const cellTarget = targetLines[l] || "";
      const cellBM = l === 0 ? row.bm25Rank : "";
      const cellVec = l === 0 ? row.vectorRank : "";
      const cellRRF = l === 0 ? row.rrfRank : "";
      const cellRSF = l === 0 ? (row.rsfRank === "#1" ? `\x1b[32m${row.rsfRank}\x1b[0m` : row.rsfRank) : "";
      const cellSnippet = snippetLines[l] || "";
      const cellAnsTok = l === 0 ? `${row.outputTokens} tok` : "";

      console.log(
        `│ ${padVisible(cellId, wId)} │ ${padVisible(cellQ, wQ)} │ ${padVisible(cellTarget, wTarget)} │ ${padVisible(cellBM, wBM)} │ ${padVisible(cellVec, wVec)} │ ${padVisible(cellRRF, wRRF)} │ ${padVisible(cellRSF, wRSF)} │ ${padVisible(cellSnippet, wSnippet)} │ ${padVisible(cellAnsTok, wAnsTok, true)} │`
      );
    }

    if (rIdx < breakdown.length - 1) {
      console.log(`\x1b[90m${sep}\x1b[0m`);
    }
  });

  console.log(`\x1b[36m${botBorder}\x1b[0m\n`);
}

export async function evaluateSearchQualityComparison(db, {
  silent = false,
  onProgress = null,
  alphaGrid = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
  kGrid = [10, 30, 60, 100],
  defaultAlpha = 0.5,
  defaultRrfK = 60,
  mode = "full",
} = {}) {
  if (!db) {
    const { getDatabase } = await import("../db/database.js");
    db = getDatabase();
  }
  const isSmoke = mode === "smoke";
  // In smoke mode we drop grid search: nothing produced, no cost.
  if (isSmoke) {
    alphaGrid = [];
    kGrid = [];
  }
  // Select query subset for smoke; full otherwise.
  const queryList = isSmoke
    ? SMOKE_QUERY_INDICES.map((i) => CHALLENGING_EVALUATION_QUERIES[i]).filter(Boolean)
    : CHALLENGING_EVALUATION_QUERIES;

  if (!silent) {
    printRichPanel(
      isSmoke ? "SMOKE SEARCH QUALITY EVALUATION" : "SEARCH QUALITY EVALUATION",
      isSmoke
        ? `${queryList.length} queries on ${SMOKE_DOC_IDS.length} docs | stats skipped`
        : `${queryList.length} queries | strict doc-id match | bootstrap CI + grid search`,
    );
  }

  const docMetaStmt = db.prepare(`
    SELECT d.id, d.path, d.title,
           (SELECT COALESCE(SUM(token_count), 0) FROM sections WHERE doc_id = d.id) as doc_tokens
    FROM micro_chunks m
    JOIN documents d ON m.doc_id = d.id
    WHERE m.id = ?;
  `);

  const targetTokensStmt = db.prepare(`
    SELECT d.id, d.title, d.path,
           (SELECT COALESCE(SUM(token_count), 0) FROM sections WHERE doc_id = d.id) as doc_tokens
    FROM documents d
    WHERE d.path LIKE ? OR d.id = ?;
  `);

  const K = 5;
  const total = queryList.length;
  const queryBreakdown = [];

  // per-query rank arrays (parallel) for paired comparison & bootstrap
  const perQueryRanks = {
    bm25: [],
    vector: [],
    rrf: [],
    rsf: [],
  };

  // grid search aggregation: [{alpha, mrr, recall, ndcg}, ...] for RSF, [{k, ...}] for RRF
  const rsfGridAcc = new Map();
  const rrfGridAcc = new Map();
  for (const a of alphaGrid) rsfGridAcc.set(a, { wins: 0, mrr: 0, recall: 0, ndcg: 0 });
  for (const k of kGrid) rrfGridAcc.set(k, { wins: 0, mrr: 0, recall: 0, ndcg: 0 });

  // per-category per-mode ranks (map<category, {bm25:[], vector:[], rrf[], rsf[]}>)
  const catMap = new Map();

  for (let i = 0; i < queryList.length; i++) {
    const qObj = queryList[i];

    // Pre-fetch bm25 hits, query embedding, and vector hits ONCE — reused across
    // all 4 modes and the grid search. Eliminates ~3 redundant ONNX inferences per query.
    const startQ = performance.now();
    const bm25Hits = bm25Search(db, qObj.query, 30);
    const qVec = await embedText(qObj.query, true, null, null, qObj.instruction || null);
    const vectorHits = vectorSearch(db, qVec, 30, 0.10);
    const prepared = { bm25Hits, qVec, vectorHits };
    const qLatencyMs = performance.now() - startQ;

    const bm25Rank = rankFromPrepared(prepared, docMetaStmt, qObj, "bm25_only", K);
    const vecRank = rankFromPrepared(prepared, docMetaStmt, qObj, "vector_only", K);
    const rrfRank = rankFromPrepared(prepared, docMetaStmt, qObj, "hybrid_rrf", K, { rrfK: defaultRrfK });
    const rsfRank = rankFromPrepared(prepared, docMetaStmt, qObj, "hybrid_rsf", K, { alpha: defaultAlpha });

    perQueryRanks.bm25.push({ rank: bm25Rank, idx: i, latencyMs: qLatencyMs });
    perQueryRanks.vector.push({ rank: vecRank, idx: i, latencyMs: qLatencyMs });
    perQueryRanks.rrf.push({ rank: rrfRank, idx: i, latencyMs: qLatencyMs });
    perQueryRanks.rsf.push({ rank: rsfRank, idx: i, latencyMs: qLatencyMs });

    // Track per category
    const cat = qObj.category || "Uncategorized";
    if (!catMap.has(cat)) catMap.set(cat, { bm25: [], vector: [], rrf: [], rsf: [] });
    catMap.get(cat).bm25.push({ rank: bm25Rank, idx: i });
    catMap.get(cat).vector.push({ rank: vecRank, idx: i });
    catMap.get(cat).rrf.push({ rank: rrfRank, idx: i });
    catMap.get(cat).rsf.push({ rank: rsfRank, idx: i });

    // Grid search: reuse pre-fetched hits; fusion is in-memory, cheap.
    for (const a of alphaGrid) {
      const fused = rsfFusion(bm25Hits, vectorHits, a, 0.01);
      const r = rankHitsById(fused, docMetaStmt, qObj.expectedDocIds, K);
      const m = metricFromRank(r);
      const acc = rsfGridAcc.get(a);
      acc.mrr += m.mrr;
      acc.recall += m.recall;
      acc.ndcg += m.ndcg;
      if (r > 0 && r === 1) acc.wins += 1;
    }
    for (const k of kGrid) {
      const fused = rrfFusion(bm25Hits, vectorHits, k, 0.01);
      const r = rankHitsById(fused, docMetaStmt, qObj.expectedDocIds, K);
      const m = metricFromRank(r);
      const acc = rrfGridAcc.get(k);
      acc.mrr += m.mrr;
      acc.recall += m.recall;
      acc.ndcg += m.ndcg;
      if (r > 0 && r === 1) acc.wins += 1;
    }

    if (onProgress) onProgress({ phase: "evaluate", current: i + 1, total });

    const rsfHits = rsfFusion(bm25Hits, vectorHits, defaultAlpha, 0.01);
    const topHitDoc = getTopHitSourceId(rsfHits, docMetaStmt);
    const topHitObj = Array.isArray(rsfHits) && rsfHits.length > 0 ? rsfHits[0] : null;

    let targetDocTokens = 0;
    if (qObj.expectedDocIds && qObj.expectedDocIds.length > 0) {
      const primaryTarget = qObj.expectedDocIds[0];
      const match = targetTokensStmt.get(`%${primaryTarget}%`, primaryTarget);
      if (match) targetDocTokens = match.doc_tokens || 0;
    }

    let outputTokens = 0;
    let snippetPreview = "";
    if (topHitObj) {
      snippetPreview = topHitObj.snippet || topHitObj.content || "";
      outputTokens = topHitObj.token_count || (snippetPreview ? Math.round(snippetPreview.length / 4) : 0);
    }

    queryBreakdown.push({
      id: i + 1,
      target: qObj.expectedDocIds.join("/"),
      category: qObj.category,
      bm25Rank: bm25Rank > 0 ? `#${bm25Rank}` : "MISSED",
      vectorRank: vecRank > 0 ? `#${vecRank}` : "MISSED",
      rrfRank: rrfRank > 0 ? `#${rrfRank}` : "MISSED",
      rsfRank: rsfRank > 0 ? `#${rsfRank}` : "MISSED",
      topHit: topHitDoc,
      topHitSnippet: snippetPreview,
      docTokens: targetDocTokens,
      outputTokens,
      query: qObj.query,
      expectedDocIds: qObj.expectedDocIds,
    });
  }

  // Determine actual winner (not hardcoded); pick by MRR, then recall.
  const agg = (perQuery) => aggregate(perQuery);
  const bm25Res = agg(perQueryRanks.bm25);
  const vectorRes = agg(perQueryRanks.vector);
  const rrfRes = agg(perQueryRanks.rrf);
  const rsfRes = agg(perQueryRanks.rsf);
  const candidates = [
    { name: "bm25", ...bm25Res },
    { name: "vector", ...vectorRes },
    { name: "hybrid_rrf", ...rrfRes },
    { name: "hybrid_rsf", ...rsfRes },
  ];
  const winner = candidates.slice().sort((a, b) => b.mrr - a.mrr || b.recall - a.recall)[0].name;

  // Bootstrap CIs (using per-query reciprocal ranks) — skipped in smoke mode.
  const bm25CI = isSmoke ? null : bootstrapCI(perQueryRanks.bm25);
  const vectorCI = isSmoke ? null : bootstrapCI(perQueryRanks.vector);
  const rrfCI = isSmoke ? null : bootstrapCI(perQueryRanks.rrf);
  const rsfCI = isSmoke ? null : bootstrapCI(perQueryRanks.rsf);

  // Paired comparisons: hybrid vs best single retriever (vector), rrf vs rsf.
  // Skipped in smoke mode (no need for significance testing on a 9-query subset).
  const tRrfSel = isSmoke ? null : pairedTTestLR(perQueryRanks.rrf, perQueryRanks.vector);
  const tRsfSel = isSmoke ? null : pairedTTestLR(perQueryRanks.rsf, perQueryRanks.vector);
  const tRrfRsf = isSmoke ? null : pairedTTestLR(perQueryRanks.rrf, perQueryRanks.rsf);

  // Per-category aggregate metrics
  const categoryBreakdown = [];
  for (const [cat, ranks] of catMap.entries()) {
    categoryBreakdown.push({
      category: cat,
      n: ranks.bm25.length,
      bm25: agg(ranks.bm25),
      vector: agg(ranks.vector),
      rrf: agg(ranks.rrf),
      rsf: agg(ranks.rsf),
    });
  }

  // Grid summaries normalized by N
  const rsfGrid = [...rsfGridAcc.entries()].map(([a, acc]) => ({
    alpha: a,
    mrr: Number((acc.mrr / total).toFixed(4)),
    recall: Number((acc.recall / total).toFixed(4)),
    ndcg: Number((acc.ndcg / total).toFixed(4)),
    top1Wins: acc.wins,
  }));
  const rrfGrid = [...rrfGridAcc.entries()].map(([k, acc]) => ({
    k,
    mrr: Number((acc.mrr / total).toFixed(4)),
    recall: Number((acc.recall / total).toFixed(4)),
    ndcg: Number((acc.ndcg / total).toFixed(4)),
    top1Wins: acc.wins,
  }));

  const bestRsfAlpha = rsfGrid.slice().sort((a, b) => b.mrr - a.mrr)[0];
  const bestRrfK = rrfGrid.slice().sort((a, b) => b.mrr - a.mrr)[0];

  // Latency stats from per-query pre-fetch latencies (shared across modes).
  const latencies = perQueryRanks.vector.map((q) => q.latencyMs || 0).sort((a, b) => a - b);
  const quant = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))] : 0);
  const latencyStats = {
    p50: Number((quant(latencies, 0.5) || 0).toFixed(2)),
    p95: Number((quant(latencies, 0.95) || 0).toFixed(2)),
    p99: Number((quant(latencies, 0.99) || 0).toFixed(2)),
    mean: Number((latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)).toFixed(2)),
    max: Number((latencies[latencies.length - 1] || 0).toFixed(2)),
    n: latencies.length,
  };

  if (!silent) {
    renderQueryBreakdownTable(queryBreakdown);

    console.log("\n [Aggregate Metric Comparison]");
    console.table([bm25Res, vectorRes, rrfRes, rsfRes]);

    if (!isSmoke) {
      console.log("\n [Bootstrap 95% CIs]");
      console.table([
        { mode: "bm25", mrrLow: bm25CI.mrrCI[0], mrrHigh: bm25CI.mrrCI[1], recallLow: bm25CI.recallCI[0], recallHigh: bm25CI.recallCI[1] },
        { mode: "vector", mrrLow: vectorCI.mrrCI[0], mrrHigh: vectorCI.mrrCI[1], recallLow: vectorCI.recallCI[0], recallHigh: vectorCI.recallCI[1] },
        { mode: "rrf", mrrLow: rrfCI.mrrCI[0], mrrHigh: rrfCI.mrrCI[1], recallLow: rrfCI.recallCI[0], recallHigh: rrfCI.recallCI[1] },
        { mode: "rsf", mrrLow: rsfCI.mrrCI[0], mrrHigh: rsfCI.mrrCI[1], recallLow: rsfCI.recallCI[0], recallHigh: rsfCI.recallCI[1] },
      ]);
    }

    console.log(`\n [Winner by MRR]: ${winner}`);

    if (!isSmoke) {
      console.log(`\n [Paired t-tests]`);
      console.table([
        { test: "rrf vs vector", meanDiff: tRrfSel.meanDiff, t: tRrfSel.t.toFixed(2), p: tRrfSel.p, n: tRrfSel.n },
        { test: "rsf vs vector", meanDiff: tRsfSel.meanDiff, t: tRsfSel.t.toFixed(2), p: tRsfSel.p, n: tRsfSel.n },
        { test: "rrf vs rsf", meanDiff: tRrfRsf.meanDiff, t: tRrfRsf.t.toFixed(2), p: tRrfRsf.p, n: tRrfRsf.n },
      ]);
    }

    console.log("\n [Per-Category Aggregate]");
    console.table(
      categoryBreakdown.map((c) => ({
        category: c.category,
        n: c.n,
        bm25Mrr: c.bm25.mrr,
        vecMrr: c.vector.mrr,
        rrfMrr: c.rrf.mrr,
        rsfMrr: c.rsf.mrr,
        rrfRecall: c.rrf.recall,
        rsfRecall: c.rsf.recall,
      })),
    );

    if (!isSmoke) {
      console.log("\n [RSF Alpha Grid]");
      console.table(rsfGrid);
      console.log("\n [RRF k Grid]");
      console.table(rrfGrid);
    }
  }

  return {
    mode: isSmoke ? "smoke" : "full",
    bm25: bm25Res,
    vector: vectorRes,
    hybridRrf: rrfRes,
    hybridRsf: rsfRes,
    winner,
    bootstrap: isSmoke ? null : { bm25: bm25CI, vector: vectorCI, rrf: rrfCI, rsf: rsfCI },
    pairedTests: isSmoke ? null : { rrfVsVector: tRrfSel, rsfVsVector: tRsfSel, rrfVsRsf: tRrfRsf },
    categoryBreakdown,
    rsfGrid,
    rrfGrid,
    bestRsfAlpha,
    bestRrfK,
    latency: latencyStats,
    breakdown: queryBreakdown,
    perQueryRanks,
  };
}

if (process.argv[1] && process.argv[1].includes("quality_evaluator.js")) {
  console.log("Run main benchmark runner run_benchmarks.js.");
}
