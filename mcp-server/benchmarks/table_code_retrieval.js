import { getDatabase } from "../db/database.js";
import { ingestDocument } from "../ingest/pipeline.js";
import { hybridQuery } from "../retrieval/retriever.js";

const TABLE_DOCS = [
  {
    id: "benchmark_results_table",
    title: "Retrieval Benchmark Results",
    content: `# Retrieval Benchmark Results

## Performance Metrics

| Model | MRR@5 | Recall@5 | NDCG@5 | Latency | Throughput |
| --- | --- | --- | --- | --- | --- |
| BM25 | 0.65 | 0.72 | 0.68 | 12ms | 8500 qps |
| Vector | 0.78 | 0.81 | 0.79 | 45ms | 2200 qps |
| RRF | 0.82 | 0.88 | 0.85 | 52ms | 1900 qps |
| RSF | 0.80 | 0.85 | 0.82 | 48ms | 2100 qps |
| Hybrid | 0.84 | 0.90 | 0.87 | 55ms | 1800 qps |

The table above shows retrieval quality metrics across different fusion algorithms.
All experiments were conducted on a corpus of 27 technical documents.
`,
  },
  {
    id: "model_config_table",
    title: "Model Configuration Reference",
    content: `# Model Configuration Reference

## Supported Models

| Model Name | Dimensions | Size | Context | License |
| --- | --- | --- | --- | --- |
| multilingual-e5-small | 384 | 118MB | 512 | MIT |
| multilingual-e5-large | 1024 | 560MB | 512 | MIT |
| bge-m3 | 1024 | 2.2GB | 8192 | MIT |
| bge-small | 384 | 95MB | 512 | MIT |
| MiniLM-L6 | 384 | 23MB | 512 | MIT |
| MiniLM-L12 | 384 | 34MB | 512 | MIT |

Choose a model based on your accuracy, latency, and memory requirements.
`,
  },
  {
    id: "api_endpoints_table",
    title: "API Endpoints Reference",
    content: `# API Endpoints Reference

## REST API

| Method | Endpoint | Description | Auth | Rate Limit |
| --- | --- | --- | --- | --- |
| GET | /api/documents | List all documents | Bearer | 100/min |
| POST | /api/documents | Ingest new document | Bearer | 10/min |
| GET | /api/documents/:id | Get document by ID | Bearer | 100/min |
| DELETE | /api/documents/:id | Delete document | Bearer | 10/min |
| POST | /api/query | Search knowledge base | Bearer | 50/min |
| GET | /api/stats | Get system stats | Bearer | 100/min |

All endpoints return JSON responses with standard HTTP status codes.
`,
  },
];

const CODE_DOCS = [
  {
    id: "fusion_functions",
    title: "Fusion Algorithm Implementation",
    content: `# Fusion Algorithm Implementation

## Reciprocal Rank Fusion

\`\`\`javascript
/**
 * Combines BM25 and vector search results using Reciprocal Rank Fusion.
 * @param {Array} bm25Hits - BM25 search results
 * @param {Array} vectorHits - Vector search results
 * @param {number} k - RRF constant (default 60)
 * @param {number} scoreThreshold - Minimum score to include
 * @returns {Array} Fused and ranked results
 */
export function rrfFusion(bm25Hits, vectorHits, k = 60, scoreThreshold = 0.01) {
  const scoreMap = new Map();

  bm25Hits.forEach((hit) => {
    const existing = scoreMap.get(hit.id) || { id: hit.id, rrf_score: 0 };
    existing.bm25_rank = hit.bm25_rank;
    existing.rrf_score += 1.0 / (k + hit.bm25_rank);
    scoreMap.set(hit.id, existing);
  });

  vectorHits.forEach((hit) => {
    const existing = scoreMap.get(hit.id) || { id: hit.id, rrf_score: 0 };
    existing.vector_rank = hit.vector_rank;
    existing.rrf_score += 1.0 / (k + hit.vector_rank);
    scoreMap.set(hit.id, existing);
  });

  const merged = Array.from(scoreMap.values());
  merged.sort((a, b) => b.rrf_score - a.rrf_score);
  return merged.filter((item) => item.rrf_score >= scoreThreshold);
}
\`\`\`

## Rank Score Fusion

\`\`\`javascript
/**
 * Combines BM25 and vector results using normalized weighted fusion.
 * @param {Array} bm25Hits - BM25 search results
 * @param {Array} vectorHits - Vector search results
 * @param {number} alpha - Weight for semantic component (0-1)
 * @returns {Array} Fused and ranked results
 */
export function rsfFusion(bm25Hits, vectorHits, alpha = 0.5, scoreThreshold = 0.01) {
  const scoreMap = new Map();

  let minFts = Infinity, maxFts = -Infinity;
  bm25Hits.forEach((hit) => {
    const r = hit.fts_rank !== undefined ? hit.fts_rank : -hit.bm25_rank;
    if (r < minFts) minFts = r;
    if (r > maxFts) maxFts = r;
  });

  let minSim = Infinity, maxSim = -Infinity;
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
    scoreMap.set(hit.id, { id: hit.id, norm_lexical: normLexical, norm_semantic: 0.0 });
  });

  vectorHits.forEach((hit) => {
    const existing = scoreMap.get(hit.id) || { id: hit.id, norm_lexical: 0.0, norm_semantic: 0.0 };
    let normSemantic = hit.cosine_sim || 0;
    if (maxSim > minSim) {
      normSemantic = (hit.cosine_sim - minSim) / (maxSim - minSim);
    }
    existing.norm_semantic = normSemantic;
    scoreMap.set(hit.id, existing);
  });

  const merged = Array.from(scoreMap.values()).map((item) => ({
    ...item,
    rsf_score: alpha * item.norm_semantic + (1.0 - alpha) * item.norm_lexical,
  }));

  merged.sort((a, b) => b.rsf_score - a.rsf_score);
  return merged.filter((item) => item.rsf_score >= scoreThreshold);
}
\`\`\`
`,
  },
  {
    id: "chunker_functions",
    title: "Chunker Implementation",
    content: `# Chunker Implementation

## Table Chunking

\`\`\`javascript
/**
 * Generates a semantic summary of a Markdown table for vector search.
 * @param {string} tableContent - Raw table Markdown
 * @param {string} breadcrumbs - Section breadcrumbs for context
 * @returns {string|null} Semantic description or null if empty
 */
export function generateTableSummary(tableContent, breadcrumbs = "") {
  const lines = tableContent.split("\\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  const headerLine = lines[0];
  const columns = headerLine
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const separatorLine = lines[1] || "";
  const hasSeparator = /^\\s*\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)+\\|?\\s*$/.test(separatorLine);
  const dataLines = hasSeparator ? lines.slice(2) : lines.slice(1);
  const rowCount = dataLines.length;

  const contextPart = breadcrumbs ? \` Context: \${breadcrumbs}.\` : "";
  return \`Table with columns [\${columns.join(", ")}] containing \${rowCount} row\${rowCount !== 1 ? "s" : ""}.\${contextPart}\`;
}
\`\`\`

## Code Signature Extraction

\`\`\`javascript
/**
 * Extracts function signatures with docstrings from code blocks.
 * Supports JavaScript, Python, Rust, and Go.
 * @param {string} codeContent - Fenced code block content
 * @returns {Array} Array of { signature, line_number } objects
 */
export function extractCodeSignatures(codeContent) {
  const lines = codeContent.split("\\n");
  const signatures = [];

  const fenceMatch = lines[0] && lines[0].match(/^(\\s*)(~~~|~~~)/);
  const bodyStart = fenceMatch ? 1 : 0;
  const lastLine = lines[lines.length - 1];
  const tb = String.fromCharCode(96).repeat(3);
  const bodyEnd = fenceMatch && (lastLine.startsWith(tb) || lastLine.startsWith("~~~")) ? lines.length - 1 : lines.length;
  const bodyLines = lines.slice(bodyStart, bodyEnd);

  let i = 0;
  while (i < bodyLines.length) {
    const line = bodyLines[i];
    const isBoundary = /^\\s*(?:export\\s+|async\\s+)?(?:function|class|def|pub\\s+fn|fn|struct|interface|enum)\\s+/.test(line);
    if (isBoundary) {
      signatures.push({ signature: line.trim(), line_number: i + bodyStart + 1 });
    }
    i++;
  }

  return signatures;
}
\`\`\`
`,
  },
  {
    id: "python_pipeline",
    title: "Python Ingestion Pipeline",
    content: `# Python Ingestion Pipeline

## Document Processing

\`\`\`python
"""Document ingestion pipeline for RAG knowledge base."""

import hashlib
from typing import Optional


def normalize_content(content: str, doc_type: str = "text") -> dict:
    """Normalize raw content into clean Markdown for ingestion.
    
    Args:
        content: Raw document content
        doc_type: Content type (text, html, markdown)
    
    Returns:
        dict with markdown, title, and metadata
    """
    if doc_type == "html":
        return _html_to_markdown(content)
    
    title = _extract_title(content)
    return {
        "markdown": content.strip(),
        "title": title,
        "metadata": {"source_type": doc_type}
    }


def _html_to_markdown(html: str) -> dict:
    """Convert HTML content to clean Markdown."""
    # Strip script/style tags
    cleaned = re.sub(r"<script.*?</script>", "", html, flags=re.DOTALL)
    cleaned = re.sub(r"<style.*?</style>", "", cleaned, flags=re.DOTALL)
    
    # Convert headers
    for i in range(6, 0, -1):
        cleaned = re.sub(
            rf"<h{i}[^>]*>(.*?)</h{i}>",
            lambda m: "#" * i + " " + m.group(1),
            cleaned,
            flags=re.DOTALL,
        )
    
    return {"markdown": cleaned, "title": "", "metadata": {"source_type": "html"}}


def _extract_title(content: str) -> str:
    """Extract the first heading as document title."""
    match = re.search(r"^#\\s+(.+)$", content, re.MULTILINE)
    return match.group(1).strip() if match else "Untitled"
\`\`\`
`,
  },
];

const TABLE_QUERIES = [
  { query: "Table with columns containing Model and MRR", expectedDocIds: ["benchmark_results_table"], category: "Table Retrieval", description: "Column lookup" },
  { query: "What is the MRR@5 score for RRF fusion?", expectedDocIds: ["benchmark_results_table"], category: "Table Retrieval", description: "Numeric lookup" },
  { query: "Which model has the highest throughput?", expectedDocIds: ["benchmark_results_table"], category: "Table Retrieval", description: "Row lookup" },
  { query: "Table with columns containing Model Name and Dimensions", expectedDocIds: ["model_config_table"], category: "Table Retrieval", description: "Column lookup" },
  { query: "What is the size of bge-m3 model?", expectedDocIds: ["model_config_table"], category: "Table Retrieval", description: "Numeric lookup" },
  { query: "Table with columns containing Method and Endpoint", expectedDocIds: ["api_endpoints_table"], category: "Table Retrieval", description: "Column lookup" },
  { query: "What is the rate limit for query endpoint?", expectedDocIds: ["api_endpoints_table"], category: "Table Retrieval", description: "Row lookup" },
];

const CODE_QUERIES = [
  { query: "rrfFusion function signature", expectedDocIds: ["fusion_functions"], category: "Code Retrieval", description: "Function behavior" },
  { query: "How does rsfFusion work?", expectedDocIds: ["fusion_functions"], category: "Code Retrieval", description: "API usage" },
  { query: "generateTableSummary function", expectedDocIds: ["chunker_functions"], category: "Code Retrieval", description: "Function behavior" },
  { query: "extractCodeSignatures implementation", expectedDocIds: ["chunker_functions"], category: "Code Retrieval", description: "API usage" },
  { query: "normalize_content function python", expectedDocIds: ["python_pipeline"], category: "Code Retrieval", description: "Function behavior" },
  { query: "_html_to_markdown implementation", expectedDocIds: ["python_pipeline"], category: "Code Retrieval", description: "API usage" },
];

export async function runTableCodeRetrievalBenchmark(options = {}) {
  const { customDb = null, generateEmbeddings = false, verbose = true } = options;
  const db = customDb || await getDatabase();

  if (verbose) {
    console.log("\n╭──────────────────────────────────────────────────────╮");
    console.log("│  TABLE & CODE RETRIEVAL BENCHMARK                    │");
    console.log("╰──────────────────────────────────────────────────────╯\n");
  }

  // Ingest all documents
  const allDocs = [...TABLE_DOCS, ...CODE_DOCS];
  for (const doc of allDocs) {
    await ingestDocument({ content: doc.content, path: `${doc.id}.md`, customDb: db });
  }

  if (verbose) console.log(`Ingested ${allDocs.length} documents (${TABLE_DOCS.length} table, ${CODE_DOCS.length} code)\n`);

  // Run table queries
  const tableResults = [];
  for (const q of TABLE_QUERIES) {
    const hits = await hybridQuery({ query: q.query, limit: 5, customDb: db, generateEmbeddings });
    const policyHit = hits.find((h) => h.retrieval_policy === "table_summary");
    const correctDoc = hits.some((h) => {
      const path = h.doc_path || "";
      return q.expectedDocIds.some((id) => path.includes(id));
    });
    const expandedFully = policyHit ? policyHit.snippet.includes("Model") && policyHit.snippet.length > 100 : false;

    tableResults.push({
      query: q.query,
      category: q.category,
      description: q.description,
      found: correctDoc,
      hasPolicyHit: !!policyHit,
      expandedFully,
      topPolicy: hits[0]?.retrieval_policy || "none",
    });
  }

  // Run code queries
  const codeResults = [];
  for (const q of CODE_QUERIES) {
    const hits = await hybridQuery({ query: q.query, limit: 5, customDb: db, generateEmbeddings });
    const policyHit = hits.find((h) => h.retrieval_policy === "code_signature");
    const correctDoc = hits.some((h) => {
      const path = h.doc_path || "";
      return q.expectedDocIds.some((id) => path.includes(id));
    });
    const expandedFully = policyHit ? policyHit.snippet.includes("function") && policyHit.snippet.length > 80 : false;

    codeResults.push({
      query: q.query,
      category: q.category,
      description: q.description,
      found: correctDoc,
      hasPolicyHit: !!policyHit,
      expandedFully,
      topPolicy: hits[0]?.retrieval_policy || "none",
    });
  }

  // Compute metrics
  const tableFound = tableResults.filter((r) => r.found).length;
  const tablePolicyHits = tableResults.filter((r) => r.hasPolicyHit).length;
  const tableExpanded = tableResults.filter((r) => r.expandedFully).length;

  const codeFound = codeResults.filter((r) => r.found).length;
  const codePolicyHits = codeResults.filter((r) => r.hasPolicyHit).length;
  const codeExpanded = codeResults.filter((r) => r.expandedFully).length;

  if (verbose) {
    console.log("── Table Retrieval Results ──────────────────────────");
    for (const r of tableResults) {
      const status = r.found ? "✓" : "✗";
      const policy = r.hasPolicyHit ? ` [${r.topPolicy}]` : "";
      console.log(`  ${status} ${r.description.padEnd(18)} | ${r.query.substring(0, 50)}${policy}`);
    }
    console.log(`  Found: ${tableFound}/${tableResults.length} | Policy hits: ${tablePolicyHits} | Expanded: ${tableExpanded}\n`);

    console.log("── Code Retrieval Results ───────────────────────────");
    for (const r of codeResults) {
      const status = r.found ? "✓" : "✗";
      const policy = r.hasPolicyHit ? ` [${r.topPolicy}]` : "";
      console.log(`  ${status} ${r.description.padEnd(18)} | ${r.query.substring(0, 50)}${policy}`);
    }
    console.log(`  Found: ${codeFound}/${codeResults.length} | Policy hits: ${codePolicyHits} | Expanded: ${codeExpanded}\n`);
  }

  const summary = {
    table: {
      total: tableResults.length,
      found: tableFound,
      policyHits: tablePolicyHits,
      expanded: tableExpanded,
      accuracy: Number((tableFound / tableResults.length).toFixed(2)),
      policyHitRate: Number((tablePolicyHits / tableResults.length).toFixed(2)),
      expansionRate: tablePolicyHits > 0 ? Number((tableExpanded / tablePolicyHits).toFixed(2)) : 0,
    },
    code: {
      total: codeResults.length,
      found: codeFound,
      policyHits: codePolicyHits,
      expanded: codeExpanded,
      accuracy: Number((codeFound / codeResults.length).toFixed(2)),
      policyHitRate: Number((codePolicyHits / codeResults.length).toFixed(2)),
      expansionRate: codePolicyHits > 0 ? Number((codeExpanded / codePolicyHits).toFixed(2)) : 0,
    },
  };

  if (verbose) {
    console.log("── Summary ──────────────────────────────────────────");
    console.log(`  Table Retrieval Accuracy: ${summary.table.accuracy * 100}%`);
    console.log(`  Table Policy Hit Rate:    ${summary.table.policyHitRate * 100}%`);
    console.log(`  Table Expansion Rate:     ${summary.table.expansionRate * 100}%`);
    console.log(`  Code Retrieval Accuracy:  ${summary.code.accuracy * 100}%`);
    console.log(`  Code Policy Hit Rate:     ${summary.code.policyHitRate * 100}%`);
    console.log(`  Code Expansion Rate:      ${summary.code.expansionRate * 100}%`);
    console.log("");
  }

  return summary;
}

if (process.argv[1] && process.argv[1].endsWith("table_code_retrieval.js")) {
  runTableCodeRetrievalBenchmark().then((r) => {
    console.log("Benchmark result:", JSON.stringify(r, null, 2));
    process.exit(0);
  }).catch((err) => {
    console.error("Benchmark failed:", err);
    process.exit(1);
  });
}
