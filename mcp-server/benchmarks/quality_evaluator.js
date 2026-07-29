import { bm25Search, vectorSearch, hybridQuery } from "../retrieval/retriever.js";
import { embedText } from "../ml/model_manager.js";

console.log("==========================================================");
console.log("=== RAG Search Quality Evaluator: BM25 vs Vector vs RRF ===");
console.log("==========================================================");

export const CHALLENGING_EVALUATION_QUERIES = [
  // Category A: Semantic & Paraphrased Queries (No exact keyword overlap)
  { query: "Библиотека для выполнения HTTP запросов и отмены отправки данных", expectedKeyword: "axios", category: "Semantic RU->EN" },
  { query: "Инструмент для мгновенной горячей перезагрузки кода при разработке frontend", expectedKeyword: "vite", category: "Semantic RU->EN" },
  { query: "Централизованное управление состоянием приложения в одном сторе", expectedKeyword: "redux", category: "Semantic RU->EN" },
  { query: "Управление изолированными контейнерами приложений через командную строку", expectedKeyword: "docker", category: "Semantic RU->EN" },
  { query: "Компактная база данных прямо внутри процесса без отдельного сервера", expectedKeyword: "sqlite", category: "Semantic RU->EN" },

  // Category B: Cross-Lingual Technical Concepts (Russian prompt -> English documentation)
  { query: "Асинхронный веб фреймворк на Python с автоматической OpenAPI документацией", expectedKeyword: "fastapi", category: "Cross-Lingual" },
  { query: "Язык программирования с гарантией безопасности памяти без Garbage Collector", expectedKeyword: "rust", category: "Cross-Lingual" },
  { query: "Верстка элементов интерфейса через атомарные CSS утилиты", expectedKeyword: "tailwind", category: "Cross-Lingual" },
  { query: "Безопасная среда выполнения TypeScript с возможностью бана сетевых прав", expectedKeyword: "deno", category: "Cross-Lingual" },
  { query: "Локальный векторный поиск знаний без использования тяжелого Docker контейнера", expectedKeyword: "memory_plugin", category: "Cross-Lingual" },

  // Category C: Direct Code & Keyword Searches
  { query: "isCancel AxiosError require default export", expectedKeyword: "axios", category: "Code/Keyword" },
  { query: "PRAGMA user_version FTS5 unicode61 tokenizer", expectedKeyword: "sqlite", category: "Code/Keyword" },
  { query: "pipeline feature-extraction quantized ONNX", expectedKeyword: "transformers", category: "Code/Keyword" },
  { query: "useContext useReducer JSX render DOM", expectedKeyword: "react", category: "Code/Keyword" },
  { query: "micro_chunks graph_edges Reciprocal Rank Fusion", expectedKeyword: "memory_plugin", category: "Code/Keyword" },
];

async function runQueryForMode(db, qObj, mode, K = 5) {
  let hits = [];
  if (mode === "bm25_only") {
    hits = bm25Search(db, qObj.query, K);
  } else if (mode === "vector_only") {
    const qVec = await embedText(qObj.query, true);
    hits = vectorSearch(db, qVec, K, 0.10);
  } else {
    hits = await hybridQuery({
      query: qObj.query,
      limit: K,
      generateEmbeddings: true,
      customDb: db,
    });
  }

  for (let r = 0; r < hits.length; r++) {
    const item = hits[r];
    let textToSearch = "";
    if (item.doc_title || item.snippet) {
      textToSearch = `${item.doc_title || ""} ${item.heading || ""} ${item.snippet || ""} ${item.full_section_content || ""}`;
    } else {
      textToSearch = `${item.breadcrumbs || ""} ${item.content || ""}`;
    }
    textToSearch = textToSearch.toLowerCase();

    if (textToSearch.includes(qObj.expectedKeyword.toLowerCase())) {
      return r + 1; // 1-indexed rank
    }
  }
  return 0; // Not found in Top K
}

export async function evaluateSearchQualityComparison(db) {
  console.log(`\n🔬 Executing Per-Query Granular Search Evaluation across ${CHALLENGING_EVALUATION_QUERIES.length} hard queries...\n`);

  const queryBreakdown = [];
  const K = 5;

  let bm25Mrr = 0, bm25Recall = 0, bm25Ndcg = 0;
  let vecMrr = 0, vecRecall = 0, vecNdcg = 0;
  let hybridMrr = 0, hybridRecall = 0, hybridNdcg = 0;

  for (let i = 0; i < CHALLENGING_EVALUATION_QUERIES.length; i++) {
    const qObj = CHALLENGING_EVALUATION_QUERIES[i];

    const bm25Rank = await runQueryForMode(db, qObj, "bm25_only", K);
    const vecRank = await runQueryForMode(db, qObj, "vector_only", K);
    const hybridRank = await runQueryForMode(db, qObj, "hybrid_rrf", K);

    if (bm25Rank > 0) {
      bm25Mrr += 1 / bm25Rank;
      bm25Recall += 1;
      bm25Ndcg += 1 / Math.log2(bm25Rank + 1);
    }

    if (vecRank > 0) {
      vecMrr += 1 / vecRank;
      vecRecall += 1;
      vecNdcg += 1 / Math.log2(vecRank + 1);
    }

    if (hybridRank > 0) {
      hybridMrr += 1 / hybridRank;
      hybridRecall += 1;
      hybridNdcg += 1 / Math.log2(hybridRank + 1);
    }

    queryBreakdown.push({
      id: i + 1,
      target: qObj.expectedKeyword,
      category: qObj.category,
      bm25Rank: bm25Rank > 0 ? `#${bm25Rank}` : "MISSED",
      vectorRank: vecRank > 0 ? `#${vecRank}` : "MISSED",
      hybridRank: hybridRank > 0 ? `#${hybridRank}` : "MISSED",
      query: qObj.query.length > 40 ? `${qObj.query.substring(0, 40)}...` : qObj.query,
    });
  }

  const total = CHALLENGING_EVALUATION_QUERIES.length;

  const bm25Res = {
    mode: "bm25_only",
    mrrAtK: Number((bm25Mrr / total).toFixed(4)),
    recallAtK: Number((bm25Recall / total).toFixed(4)),
    ndcgAtK: Number((bm25Ndcg / total).toFixed(4)),
  };

  const vectorRes = {
    mode: "vector_only",
    mrrAtK: Number((vecMrr / total).toFixed(4)),
    recallAtK: Number((vecRecall / total).toFixed(4)),
    ndcgAtK: Number((vecNdcg / total).toFixed(4)),
  };

  const hybridRes = {
    mode: "hybrid_rrf",
    mrrAtK: Number((hybridMrr / total).toFixed(4)),
    recallAtK: Number((hybridRecall / total).toFixed(4)),
    ndcgAtK: Number((hybridNdcg / total).toFixed(4)),
  };

  console.log("📌 Granular Query-by-Query Ranking Breakdown:");
  console.table(queryBreakdown);

  console.log("\n📊 Final Aggregate Metric Comparison:");
  console.table([bm25Res, vectorRes, hybridRes]);

  return {
    bm25: bm25Res,
    vector: vectorRes,
    hybrid: hybridRes,
    breakdown: queryBreakdown,
  };
}

if (process.argv[1] && process.argv[1].includes("quality_evaluator.js")) {
  console.log("Run main benchmark runner run_benchmarks.js.");
}
