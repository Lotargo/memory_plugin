import { getDatabase } from "../db/database.js";
import { embedText, bufferToVector, cosineSimilarity } from "../ml/model_manager.js";
import { getRelatedSymbols } from "../graph/graph_extractor.js";

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

  const merged = Array.from(scoreMap.values());
  merged.sort((a, b) => b.rrf_score - a.rrf_score);

  return merged.filter((item) => item.rrf_score >= scoreThreshold);
}

export async function hybridQuery({
  query,
  limit = 5,
  scoreThreshold = 0.01,
  customDb = null,
  includeGraphContext = true,
}) {
  const db = customDb || getDatabase();

  const bm25Hits = bm25Search(db, query, 30);
  const queryVector = await embedText(query, true);
  const vectorHits = vectorSearch(db, queryVector, 30);

  const fusedHits = rrfFusion(bm25Hits, vectorHits, 60, scoreThreshold);
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
      rrf_score: parseFloat(hit.rrf_score.toFixed(4)),
      cosine_sim: hit.cosine_sim ? parseFloat(hit.cosine_sim.toFixed(4)) : null,
      defined_symbols: symbols,
    });
  }

  return results;
}
