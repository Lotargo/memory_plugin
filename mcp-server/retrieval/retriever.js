import { getDatabase } from "../db/database.js";
import { embedText, cosineSimilarity, rerankHits } from "../ml/model_manager.js";
import { getRelatedSymbols } from "../graph/graph_extractor.js";
import { getConfig } from "../config/config_manager.js";

export function sanitizeFtsQuery(query) {
  if (!query) return "";
  const cleaned = query.replace(/[^a-zA-Z0-9_\u0400-\u04FF\s]/g, " ").trim();
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return "";
  return words.join(" OR ");
}

export async function bm25Search(db, query, limit = 30) {
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
    const rows = await stmt.all(ftsQuery, limit);
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

export async function vectorSearch(db, queryVector, limit = 30, minSim = 0.25) {
  if (!queryVector || queryVector.length === 0) return [];

  const vectorDim = queryVector.length;
  const tempBuf = new ArrayBuffer(vectorDim * 4);
  const tempView = new Uint8Array(tempBuf);
  const tempVec = new Float32Array(tempBuf);

  const stmt = db.prepare(`
    SELECT m.id, m.section_id, m.doc_id, m.content, m.vector, s.breadcrumbs
    FROM micro_chunks m
    JOIN sections s ON m.section_id = s.id;
  `);

  const scored = [];
  const rows = await stmt.all();
  for (const r of rows) {
    let vecSub = r.vector;
    if (typeof vecSub === "string") {
      vecSub = Buffer.from(vecSub, "base64");
    } else if (vecSub.type === "Buffer" && Array.isArray(vecSub.data)) {
      vecSub = Buffer.from(vecSub.data);
    } else if (Array.isArray(vecSub)) {
      vecSub = Buffer.from(vecSub);
    }
    tempView.set(vecSub.subarray(0, vectorDim * 4));

    const sim = cosineSimilarity(queryVector, tempVec);
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
  instruction = null,
  generateEmbeddings = true,
}) {
  const db = customDb || await getDatabase();
  const activeConfig = getConfig();

  // If embeddings are disabled (e.g. fast/offline test mode or model not cached),
  // fall back to pure lexical search instead of attempting to load the model.
  if (generateEmbeddings === false) {
    fusionAlgorithm = "lexical_only";
  }

  const algo = fusionAlgorithm || activeConfig.fusionAlgorithm || "rsf";
  const alphaWeight = alpha !== null && alpha !== undefined ? alpha : (activeConfig.alpha ?? 0.5);
  const embModel = embeddingModel || activeConfig.embeddingModel || "Xenova/multilingual-e5-small";
  const useReranker = rerankerEnabled !== null ? rerankerEnabled : (activeConfig.rerankerEnabled ?? false);
  const rerankModelName = rerankerModel || activeConfig.rerankerModel || "Xenova/bge-reranker-base";

  let fusedHits = [];

  if (algo === "lexical_only" || algo === "bm25_only") {
    const bm25Hits = await bm25Search(db, query, limit * 4);
    fusedHits = bm25Hits.map((hit) => ({
      ...hit,
      score: 1.0 / hit.bm25_rank,
    }));
  } else if (algo === "semantic_only" || algo === "vector_only") {
    const queryVector = await embedText(query, true, embModel, null, instruction);
    const vectorHits = await vectorSearch(db, queryVector, limit * 4, 0.10);
    fusedHits = vectorHits.map((hit) => ({
      ...hit,
      score: hit.cosine_sim,
    }));
  } else if (algo === "rrf") {
    const bm25Hits = await bm25Search(db, query, 30);
    const queryVector = await embedText(query, true, embModel, null, instruction);
    const vectorHits = await vectorSearch(db, queryVector, 30, 0.10);
    fusedHits = rrfFusion(bm25Hits, vectorHits, 60, scoreThreshold);
  } else {
    // Default: RSF
    const bm25Hits = await bm25Search(db, query, 30);
    const queryVector = await embedText(query, true, embModel, null, instruction);
    const vectorHits = await vectorSearch(db, queryVector, 30, 0.10);
    fusedHits = rsfFusion(bm25Hits, vectorHits, alphaWeight, scoreThreshold);
  }

  if (useReranker && rerankModelName !== "none") {
    fusedHits = await rerankHits(query, fusedHits, rerankModelName);
  }

  // Parent-Child Rollup: Deduplicate hits sharing the same medium_id or section_id to prevent noise
  const parentDeduplicatedHits = [];
  if (fusedHits.length > 0) {
    const hitIds = fusedHits.map((h) => h.id);
    const placeholders = hitIds.map(() => "?").join(",");
    const rows = await db.prepare(`
      SELECT id, medium_id, section_id FROM micro_chunks WHERE id IN (${placeholders});
    `).all(...hitIds);
    const parentMap = new Map(rows.map((r) => [r.id, r]));

    const seenParents = new Set();
    for (const hit of fusedHits) {
      const row = parentMap.get(hit.id);
      const parentKey = row ? (row.medium_id || row.section_id) : hit.id;
      if (!seenParents.has(parentKey)) {
        seenParents.add(parentKey);
        parentDeduplicatedHits.push(hit);
      }
    }
  }

  const topHits = parentDeduplicatedHits.slice(0, limit);
  const results = [];

  if (topHits.length > 0) {
    const topIds = topHits.map((h) => h.id);
    const placeholders = topIds.map(() => "?").join(",");
    const details = await db.prepare(`
      SELECT m.id as micro_id, s.id as section_id, s.heading, s.breadcrumbs, s.content as section_content,
             med.content as medium_content, d.title as doc_title, d.path as doc_path
      FROM micro_chunks m
      JOIN sections s ON m.section_id = s.id
      JOIN documents d ON m.doc_id = d.id
      LEFT JOIN medium_chunks med ON m.medium_id = med.id
      WHERE m.id IN (${placeholders});
    `).all(...topIds);

    const detailMap = new Map(details.map((d) => [d.micro_id, d]));

    let symbolsBySection = new Map();
    if (includeGraphContext) {
      const sectionIds = [...new Set(details.map((d) => d.section_id).filter(Boolean))];
      if (sectionIds.length > 0) {
        const { getRelatedSymbolsBatch } = await import("../graph/graph_extractor.js");
        symbolsBySection = await getRelatedSymbolsBatch(db, sectionIds);
      }
    }

    for (const hit of topHits) {
      const detail = detailMap.get(hit.id);
      if (!detail) continue;

      const symbols = symbolsBySection.get(detail.section_id) || [];

      results.push({
        chunk_id: hit.id,
        doc_title: detail.doc_title,
        doc_path: detail.doc_path,
        heading: detail.heading,
        breadcrumbs: detail.breadcrumbs,
        snippet: hit.content,
        paragraph_context: detail.medium_content || hit.content,
        full_section_content: detail.section_content,
        score: parseFloat((hit.score || 0).toFixed(4)),
        rsf_score: hit.rsf_score ? parseFloat(hit.rsf_score.toFixed(4)) : null,
        rrf_score: hit.rrf_score ? parseFloat(hit.rrf_score.toFixed(4)) : null,
        cosine_sim: hit.cosine_sim ? parseFloat(hit.cosine_sim.toFixed(4)) : null,
        defined_symbols: symbols,
      });
    }
  }

  return results;
}
