import { getDatabase } from "../db/database.js";
import { embedText, bufferToVector, cosineSimilarity, rerankHits } from "../ml/model_manager.js";
import { getRelatedSymbols } from "../graph/graph_extractor.js";
import { getConfig } from "../config/config_manager.js";

export function sanitizeFtsQuery(query) {
  if (!query) return "";
  const cleaned = query.replace(/[^a-zA-Z0-9_\u0400-\u04FF\s]/g, " ").trim();
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return "";
  return words.join(" OR ");
}

export function bm25Search(db, query, limit = 30) {
  const ftsQuery = sanitizeFtsQuery(query);
  if (!ftsQuery) return [];

  try {
    const stmt = db.prepare(`
      SELECT id, content, breadcrumbs, rank
      FROM micro_chunks_fts
      WHERE micro_chunks_fts MATCH ?
      ORDER BY rank
      LIMIT ?;
    `);
    const rows = stmt.all(ftsQuery, limit);
    return rows.map((r, i) => ({
      id: r.id,
      content: r.content,
      breadcrumbs: r.breadcrumbs,
      bm25_rank: i + 1,
      fts_rank: r.rank,
    }));
  } catch (err) {
    console.warn("FTS5 query execution failed:", err.message);
    return [];
  }
}

export function vectorSearch(db, queryVector, limit = 30, minSim = 0.25) {
  if (!queryVector || queryVector.length === 0) return [];

  const stmt = db.prepare(`
    SELECT m.id, m.section_id, m.doc_id, m.content, m.vector, s.breadcrumbs
    FROM micro_chunks m
    JOIN sections s ON m.section_id = s.id;
  `);
  const rows = stmt.all();

  const scored = [];
  for (const r of rows) {
    const vec = bufferToVector(r.vector);
    const sim = cosineSimilarity(queryVector, vec);
    if (!isNaN(sim) && sim >= minSim) {
      scored.push({
        id: r.id,
        section_id: r.section_id,
        doc_id: r.doc_id,
        content: r.content,
        breadcrumbs: r.breadcrumbs,
        cosine_sim: sim,
      });
    }
  }

  scored.sort((a, b) => b.cosine_sim - a.cosine_sim);
  const top = scored.slice(0, limit);

  return top.map((item, idx) => ({
    ...item,
    vector_rank: idx + 1,
  }));
}

export function rrfFusion(bm25Hits, vectorHits, k = 60, scoreThreshold = 0.01) {
  const scoreMap = new Map();

  bm25Hits.forEach((hit) => {
    const existing = scoreMap.get(hit.id) || {
      id: hit.id,
      content: hit.content,
      breadcrumbs: hit.breadcrumbs,
      rrf_score: 0,
      bm25_rank: null,
      vector_rank: null,
    };
    existing.bm25_rank = hit.bm25_rank;
    existing.rrf_score += 1.0 / (k + hit.bm25_rank);
    scoreMap.set(hit.id, existing);
  });

  vectorHits.forEach((hit) => {
    const existing = scoreMap.get(hit.id) || {
      id: hit.id,
      content: hit.content,
      breadcrumbs: hit.breadcrumbs,
      rrf_score: 0,
      bm25_rank: null,
      vector_rank: null,
    };
    existing.vector_rank = hit.vector_rank;
    existing.cosine_sim = hit.cosine_sim;
    existing.rrf_score += 1.0 / (k + hit.vector_rank);
    scoreMap.set(hit.id, existing);
  });

  const merged = Array.from(scoreMap.values()).map((item) => ({
    ...item,
    score: item.rrf_score,
  }));
  merged.sort((a, b) => b.rrf_score - a.rrf_score);

  return merged.filter((item) => item.rrf_score >= scoreThreshold);
}

export function rsfFusion(bm25Hits, vectorHits, alpha = 0.5, scoreThreshold = 0.01) {
  const scoreMap = new Map();

  let minFts = Infinity;
  let maxFts = -Infinity;
  bm25Hits.forEach((hit) => {
    const r = hit.fts_rank !== undefined ? hit.fts_rank : -hit.bm25_rank;
    if (r < minFts) minFts = r;
    if (r > maxFts) maxFts = r;
  });

  let minSim = Infinity;
  let maxSim = -Infinity;
  vectorHits.forEach((hit) => {
    const sim = hit.cosine_sim || 0;
    if (sim < minSim) minSim = sim;
    if (sim > maxSim) maxSim = sim;
  });

  bm25Hits.forEach((hit) => {
    const r = hit.fts_rank !== undefined ? hit.fts_rank : -hit.bm25_rank;
    let normLexical = 1.0;
    if (maxFts > minFts) {
      normLexical = (maxFts - r) / (maxFts - minFts);
    }
    scoreMap.set(hit.id, {
      id: hit.id,
      content: hit.content,
      breadcrumbs: hit.breadcrumbs,
      bm25_rank: hit.bm25_rank,
      vector_rank: null,
      cosine_sim: null,
      norm_lexical: normLexical,
      norm_semantic: 0.0,
    });
  });

  vectorHits.forEach((hit) => {
    const existing = scoreMap.get(hit.id) || {
      id: hit.id,
      content: hit.content,
      breadcrumbs: hit.breadcrumbs,
      bm25_rank: null,
      vector_rank: null,
      cosine_sim: hit.cosine_sim,
      norm_lexical: 0.0,
      norm_semantic: 0.0,
    };
    existing.vector_rank = hit.vector_rank;
    existing.cosine_sim = hit.cosine_sim;

    let normSemantic = hit.cosine_sim || 0;
    if (maxSim > minSim) {
      normSemantic = (hit.cosine_sim - minSim) / (maxSim - minSim);
    }
    existing.norm_semantic = normSemantic;

    scoreMap.set(hit.id, existing);
  });

  const merged = Array.from(scoreMap.values()).map((item) => {
    const rsfScore = alpha * item.norm_semantic + (1.0 - alpha) * item.norm_lexical;
    return {
      ...item,
      rsf_score: rsfScore,
      score: rsfScore,
    };
  });

  merged.sort((a, b) => b.rsf_score - a.rsf_score);
  return merged.filter((item) => item.rsf_score >= scoreThreshold);
}

export async function hybridQuery({
  query,
  limit = 5,
  scoreThreshold = 0.01,
  customDb = null,
  includeGraphContext = true,
  fusionAlgorithm = null,
  alpha = null,
  embeddingModel = null,
  rerankerModel = null,
  rerankerEnabled = null,
}) {
  const db = customDb || getDatabase();
  const activeConfig = getConfig();

  const algo = fusionAlgorithm || activeConfig.fusionAlgorithm || "rsf";
  const alphaWeight = alpha !== null && alpha !== undefined ? alpha : (activeConfig.alpha ?? 0.5);
  const embModel = embeddingModel || activeConfig.embeddingModel || "Xenova/multilingual-e5-small";
  const useReranker = rerankerEnabled !== null ? rerankerEnabled : (activeConfig.rerankerEnabled ?? false);
  const rerankModelName = rerankerModel || activeConfig.rerankerModel || "Xenova/bge-reranker-base";

  let fusedHits = [];

  if (algo === "lexical_only" || algo === "bm25_only") {
    const bm25Hits = bm25Search(db, query, limit * 4);
    fusedHits = bm25Hits.map((hit) => ({
      ...hit,
      score: 1.0 / hit.bm25_rank,
    }));
  } else if (algo === "semantic_only" || algo === "vector_only") {
    const queryVector = await embedText(query, true, embModel);
    const vectorHits = vectorSearch(db, queryVector, limit * 4, 0.10);
    fusedHits = vectorHits.map((hit) => ({
      ...hit,
      score: hit.cosine_sim,
    }));
  } else if (algo === "rrf") {
    const bm25Hits = bm25Search(db, query, 30);
    const queryVector = await embedText(query, true, embModel);
    const vectorHits = vectorSearch(db, queryVector, 30, 0.10);
    fusedHits = rrfFusion(bm25Hits, vectorHits, 60, scoreThreshold);
  } else {
    // Default: RSF
    const bm25Hits = bm25Search(db, query, 30);
    const queryVector = await embedText(query, true, embModel);
    const vectorHits = vectorSearch(db, queryVector, 30, 0.10);
    fusedHits = rsfFusion(bm25Hits, vectorHits, alphaWeight, scoreThreshold);
  }

  if (useReranker && rerankModelName !== "none") {
    fusedHits = await rerankHits(query, fusedHits, rerankModelName);
  }

  const topHits = fusedHits.slice(0, limit);
  const results = [];

  const secStmt = db.prepare(`
    SELECT s.id, s.heading, s.breadcrumbs, s.content, d.title as doc_title, d.path as doc_path
    FROM micro_chunks m
    JOIN sections s ON m.section_id = s.id
    JOIN documents d ON m.doc_id = d.id
    WHERE m.id = ?;
  `);

  for (const hit of topHits) {
    const detail = secStmt.get(hit.id);
    if (!detail) continue;

    let symbols = [];
    if (includeGraphContext) {
      symbols = getRelatedSymbols(db, detail.id);
    }

    results.push({
      chunk_id: hit.id,
      doc_title: detail.doc_title,
      doc_path: detail.doc_path,
      heading: detail.heading,
      breadcrumbs: detail.breadcrumbs,
      snippet: hit.content,
      full_section_content: detail.content,
      score: parseFloat((hit.score || 0).toFixed(4)),
      rsf_score: hit.rsf_score ? parseFloat(hit.rsf_score.toFixed(4)) : null,
      rrf_score: hit.rrf_score ? parseFloat(hit.rrf_score.toFixed(4)) : null,
      cosine_sim: hit.cosine_sim ? parseFloat(hit.cosine_sim.toFixed(4)) : null,
      defined_symbols: symbols,
    });
  }

  return results;
}
