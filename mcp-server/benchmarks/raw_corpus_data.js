// Raw corpus for policy dominance benchmark.
// Each document is designed to produce BOTH policy chunks (table_summary,
// code_signature) AND micro_chunks (raw rows/lines) so we can measure which
// type dominates search results across BM25 / Vector / RRF / RSF modes.
//
// Categories:
//   table_only    — structured data in markdown tables (no code)
//   code_only     — code blocks (no tables)
//   text_only     — prose only (control: no policy chunks expected)
//   mixed         — tables + code + prose interleaved

export const RAW_CORPUS = [
  // ──────────────────────────────────────────────────────────────
  // Category: table_only
  // ──────────────────────────────────────────────────────────────
  {
    id: "benchmark_results_table",
    title: "Search Algorithm Benchmark Results",
    category: "table_only",
    content: `# Search Algorithm Benchmark Results

This document contains performance metrics for various search algorithms tested on our hybrid RAG system.

## Performance Summary

The table below shows MRR@5, Recall@5, and Latency measurements across four search modes.

| Algorithm | MRR@5 | Recall@5 | NDCG@5 | Latency_ms |
|-----------|-------|----------|--------|------------|
| BM25      | 0.6706| 0.7619   | 0.6934 | 12         |
| Vector    | 0.8135| 1.0000   | 0.8612 | 45         |
| RRF       | 0.8810| 0.9524   | 0.8997 | 48         |
| RSF       | 0.9286| 1.0000   | 0.9473 | 51         |

## Dataset Breakdown

Results per dataset category showing how each algorithm handles different query types.

| Dataset Category   | N | BM25_MRR | Vector_MRR | RRF_MRR | RSF_MRR |
|--------------------|---|----------|------------|---------|---------|
| Semantic RU->EN    | 7 | 0.6190   | 0.7500     | 0.8571  | 0.8571  |
| Cross-Lingual      | 7 | 0.5238   | 0.7143     | 0.8095  | 0.8571  |
| Code/Keyword       | 7 | 0.8571   | 0.9524     | 0.9524  | 0.9524  |

The RSF algorithm achieves the highest MRR@5 of 0.9286 across all categories.
`,
  },

  {
    id: "model_comparison_table",
    title: "Embedding Model Comparison",
    category: "table_only",
    content: `# Embedding Model Comparison

Comparison of different embedding models used for vector search in the knowledge base.

## Model Specifications

| Model                          | Dimensions | Size_MB | Language | Accuracy |
|--------------------------------|------------|---------|----------|----------|
| multilingual-e5-small          | 384        | 117     | 100+     | 0.82     |
| paraphrase-multilingual-MiniLM | 384        | 90      | 50+      | 0.78     |
| all-MiniLM-L6-v2               | 384        | 80      | EN       | 0.74     |
| bge-small-en-v1.5              | 384        | 130     | EN       | 0.85     |
| distiluse-base-multilingual    | 512        | 130     | 15+      | 0.76     |

## Inference Speed

Benchmark results for ONNX quantized inference on CPU.

| Model                        | Tokens_Per_Second | RAM_MB | Quantization |
|------------------------------|-------------------|--------|--------------|
| multilingual-e5-small        | 1250              | 95     | q8           |
| paraphrase-multilingual-MiniLM| 1480              | 78     | q8           |
| all-MiniLM-L6-v2             | 1620              | 65     | q8           |
| bge-small-en-v1.5            | 1100              | 110    | q4           |

The multilingual-e5-small model provides the best balance of accuracy and speed for multilingual retrieval.
`,
  },

  // ──────────────────────────────────────────────────────────────
  // Category: code_only
  // ──────────────────────────────────────────────────────────────
  {
    id: "retrieval_pipeline_code",
    title: "Hybrid Retrieval Pipeline Implementation",
    category: "code_only",
    content: `# Hybrid Retrieval Pipeline Implementation

This document describes the core retrieval pipeline code for the memory plugin.

## BM25 Search Function

The bm25Search function performs full-text search using SQLite FTS5.

\`\`\`javascript
async function bm25Search(db, query, limit = 30) {
  const ftsQuery = sanitizeFtsQuery(query);
  if (!ftsQuery) return [];

  const stmt = db.prepare(\`
    SELECT id, content, breadcrumbs, rank
    FROM micro_chunks_fts
    WHERE micro_chunks_fts MATCH ?
    ORDER BY rank
    LIMIT ?;
  \`);
  const rows = await stmt.all(ftsQuery, limit);
  return rows.map((r, i) => ({
    id: r.id,
    content: r.content,
    breadcrumbs: r.breadcrumbs,
    bm25_rank: i + 1,
    fts_rank: r.rank,
  }));
}
\`\`\`

## Vector Search Function

The vectorSearch function computes cosine similarity between query and document embeddings.

\`\`\`javascript
async function vectorSearch(db, queryVector, limit = 30, minSim = 0.25) {
  const vectorDim = queryVector.length;
  const tempBuf = new ArrayBuffer(vectorDim * 4);
  const tempView = new Uint8Array(tempBuf);
  const tempVec = new Float32Array(tempBuf);

  const stmt = db.prepare(\`
    SELECT m.id, m.section_id, m.doc_id, m.content, m.vector, s.breadcrumbs
    FROM micro_chunks m
    JOIN sections s ON m.section_id = s.id;
  \`);
  const rows = await stmt.all();
  const scored = [];

  for (const r of rows) {
    const vecSub = toVectorBytes(r.vector);
    if (!vecSub || vecSub.byteLength !== vectorDim * 4) continue;
    tempView.set(vecSub.subarray(0, vectorDim * 4));
    const sim = cosineSimilarity(queryVector, tempVec);
    if (!isNaN(sim) && sim >= minSim) {
      scored.push({ id: r.id, content: r.content, cosine_sim: sim });
    }
  }

  scored.sort((a, b) => b.cosine_sim - a.cosine_sim);
  return scored.slice(0, limit);
}
\`\`\`

## RRF Fusion

Reciprocal Rank Fusion combines BM25 and vector results.

\`\`\`javascript
function rrfFusion(bm25Hits, vectorHits, k = 60, scoreThreshold = 0.01) {
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
`,
  },

  {
    id: "ingestion_pipeline_code",
    title: "Document Ingestion Pipeline",
    category: "code_only",
    content: `# Document Ingestion Pipeline

The ingestion pipeline processes raw documents into searchable chunks.

## Main Ingestion Function

\`\`\`javascript
async function ingestDocument({ content, type, title, path, generateEmbeddings, customDb, customBlobDir }) {
  const db = customDb || await getDatabase();
  
  // Step 1: Parse document into hierarchical sections
  const sections = parseSections(content, { headingPattern: /^#{1,3}\s+/ });
  
  // Step 2: Generate medium chunks (500-1000 tokens)
  const mediumChunks = [];
  for (const section of sections) {
    const medium = createMediumChunks(section, { maxTokens: 1000, overlap: 50 });
    mediumChunks.push(...medium);
  }
  
  // Step 3: Generate micro chunks (100-250 tokens)
  const microChunks = [];
  for (const medium of mediumChunks) {
    const micro = createMicroChunks(medium, { maxTokens: 250, overlap: 25 });
    microChunks.push(...micro);
  }
  
  // Step 4: Detect and create policy chunks for tables/code
  const policyChunks = detectPolicyChunks(content);
  
  // Step 5: Generate embeddings if enabled
  if (generateEmbeddings) {
    for (const chunk of [...microChunks, ...policyChunks]) {
      chunk.vector = await embedText(chunk.content, true);
    }
  }
  
  // Step 6: Store in database
  await storeChunks(db, { sections, mediumChunks, microChunks, policyChunks });
  
  return {
    sectionsCount: sections.length,
    microChunksCount: microChunks.length,
    policyChunksCount: policyChunks.length,
  };
}
\`\`\`

## Policy Chunk Detection

\`\`\`javascript
function detectPolicyChunks(content) {
  const policies = [];
  
  // Detect markdown tables
  const tableRegex = /\|.+\|[\s\S]*?(?=\n\n|\n#{1,3}|\Z)/g;
  const tables = content.match(tableRegex) || [];
  for (const table of tables) {
    if (table.split('\n').length >= 3) {
      policies.push({
        type: 'table_summary',
        content: summarizeTable(table),
        sourceContent: table,
      });
    }
  }
  
  // Detect code blocks
  const codeRegex = /\`\`\`[\s\S]*?\`\`\`/g;
  const codes = content.match(codeRegex) || [];
  for (const code of codes) {
    policies.push({
      type: 'code_signature',
      content: summarizeCode(code),
      sourceContent: code,
    });
  }
  
  return policies;
}
\`\`\`
`,
  },

  // ──────────────────────────────────────────────────────────────
  // Category: text_only
  // ──────────────────────────────────────────────────────────────
  {
    id: "architecture_overview",
    title: "System Architecture Overview",
    category: "text_only",
    content: `# System Architecture Overview

The memory plugin uses a hybrid retrieval architecture combining lexical and semantic search to provide accurate document retrieval across multiple languages.

## Design Principles

The system is built on three core principles. First, all search modes operate on the same underlying chunk store, ensuring consistency. Second, policy chunks provide structured summaries of tables and code blocks for better search targeting. Third, the fusion layer combines multiple retrieval signals to improve recall.

## Retrieval Flow

When a user submits a query, the system first tokenizes and sanitizes the input. For lexical search, it queries the SQLite FTS5 index using BM25 ranking. For semantic search, it computes a dense vector embedding using the ONNX model and performs a brute-force cosine similarity scan across all stored vectors.

The hybrid modes combine these two signals. RRF uses reciprocal rank fusion to merge the ranked lists, while RSF uses relative score fusion with a configurable alpha weight. The alpha parameter controls the balance between semantic and lexical signals.

## Storage Layer

Documents are stored in a SQLite database with three hierarchical levels. The document level stores metadata and raw content. The section level represents logical divisions based on headings. The chunk level contains the actual searchable units, with micro chunks being the smallest granularity.

The blob store uses content-addressable storage with SHA-256 hashing and zstd compression. This ensures deduplication and efficient storage of repeated content across documents.

## Performance Characteristics

The system is designed for single-machine operation with modest resource requirements. The ONNX model loads once and stays in memory. Vector search is brute-force with no index approximation, which is acceptable for corpora up to 100K chunks. For larger corpora, an HNSW index would be needed.
`,
  },

  {
    id: "multilingual_design",
    title: "Multilingual Search Design",
    category: "text_only",
    content: `# Multilingual Search Design

The memory plugin supports search across 100+ languages using multilingual embedding models.

## Cross-Lingual Challenge

Traditional lexical search fails when the query language differs from the document language. A Russian query for "библиотека HTTP" will not match an English document containing "HTTP library" because there is zero lexical overlap.

## Embedding Solution

Multilingual models like multilingual-e5-small map text from different languages into a shared vector space. Semantically similar phrases in different languages end up close together in the embedding space, enabling cross-lingual retrieval.

## Query Processing

When a non-English query is detected, the system still generates an embedding using the multilingual model. The embedding captures the semantic meaning regardless of language. This embedding is then compared against all document chunk embeddings using cosine similarity.

## BM25 Limitations

BM25 relies on exact term matching. It cannot bridge the language gap between Russian queries and English documents. However, BM25 excels at keyword searches where exact terms are known, such as function names, error codes, or API endpoints.

## Hybrid Approach

The hybrid modes combine BM25's strength in keyword matching with vector search's strength in semantic understanding. For cross-lingual queries, the vector signal dominates. For code and keyword queries, BM25 provides precise matches that complement the semantic signal.
`,
  },

  // ──────────────────────────────────────────────────────────────
  // Category: mixed
  // ──────────────────────────────────────────────────────────────
  {
    id: "full_system_spec",
    title: "Memory Plugin Complete Specification",
    category: "mixed",
    content: `# Memory Plugin Complete Specification

This document provides the complete technical specification for the memory plugin's retrieval system.

## System Components

The plugin consists of several interconnected components that work together to provide hybrid search capabilities.

### Ingestion Pipeline

The ingestion pipeline processes raw markdown documents into searchable chunks. It handles tables, code blocks, and prose differently to optimize search quality.

\`\`\`javascript
async function processDocument(content, metadata) {
  const doc = await createDocument(metadata);
  const sections = splitIntoSections(content);
  
  for (const section of sections) {
    const chunks = await chunkSection(section);
    await storeChunks(doc.id, chunks);
  }
  
  return doc.id;
}
\`\`\`

### Search Modes

The system supports four distinct search modes, each with different characteristics.

| Mode   | Type        | Strengths                              | Weaknesses                    |
|--------|-------------|----------------------------------------|-------------------------------|
| BM25   | Lexical     | Fast, exact keywords, code symbols     | No semantic understanding     |
| Vector | Semantic    | Cross-lingual, paraphrase, conceptual | Slower, misses exact keywords |
| RRF    | Hybrid      | Combines both signals, robust          | Fixed fusion formula          |
| RSF    | Hybrid      | Configurable balance, best MRR         | Requires tuning alpha         |

### Configuration Parameters

The following parameters control search behavior.

| Parameter    | Default | Range   | Description                          |
|--------------|---------|---------|--------------------------------------|
| alpha        | 0.5     | 0-1     | Semantic weight in RSF fusion        |
| k            | 60      | 1-200   | RRF smoothing parameter              |
| vectorScanLimit | 0   | 0-100000| Max chunks to scan (0=unlimited)     |
| minSim       | 0.25    | 0-1     | Minimum cosine similarity threshold  |

### Policy Chunk Expansion

When a policy chunk (table_summary or code_signature) is retrieved, the system expands it to full content. This ensures users receive complete tables or code blocks rather than just summaries.

\`\`\`javascript
function expandPolicyChunk(hit) {
  if (hit.retrieval_policy === 'table_summary') {
    return getFullTable(hit.policy_source_id);
  }
  if (hit.retrieval_policy === 'code_signature') {
    return getFullCode(hit.policy_source_id);
  }
  return hit.content;
}
\`\`\`

## Performance Metrics

The system was evaluated on 21 challenging queries across three categories. RSF achieved the best MRR@5 of 0.9286, followed by RRF at 0.8810, Vector at 0.8135, and BM25 at 0.6706.

## Storage Architecture

Documents are stored in SQLite with FTS5 for full-text search and BLOB columns for dense vectors. The blob store uses SHA-256 content addressing with zstd compression for deduplication.
`,
  },

  {
    id: "api_reference_doc",
    title: "Memory Plugin API Reference",
    category: "mixed",
    content: `# Memory Plugin API Reference

Complete API reference for the memory plugin's public interface.

## Core Functions

The plugin exposes several core functions for document management and search.

### ingestDocument

Ingests a document into the knowledge base with optional embedding generation.

\`\`\`javascript
async function ingestDocument({
  content,        // Raw markdown content
  type,           // 'file' | 'text' | 'url'
  title,          // Document title
  path,           // Source path or identifier
  generateEmbeddings, // boolean, default true
  customDb,       // Optional database instance
  customBlobDir,  // Optional blob directory
})
// Returns: { sectionsCount, microChunksCount, deduplicated }
\`\`\`

### hybridQuery

Performs hybrid search with configurable fusion algorithm.

\`\`\`javascript
async function hybridQuery({
  query,              // Search query string
  limit,              // Max results (default 5)
  scoreThreshold,     // Minimum score (default 0.01)
  fusionAlgorithm,    // 'rsf' | 'rrf' | 'bm25_only' | 'vector_only'
  alpha,              // RSF alpha weight (default 0.5)
  embeddingModel,     // Model identifier
  instruction,        // Optional instruction for embedding
})
// Returns: Array of result objects with snippet, score, retrieval_policy
\`\`\`

### queryKnowledgeBase

High-level query function that returns formatted results.

\`\`\`javascript
async function queryKnowledgeBase(query, options = {})
// Returns: { results, mode, timing }
\`\`\`

## Configuration

The following configuration options control system behavior.

| Option              | Type   | Default | Description                        |
|---------------------|--------|---------|------------------------------------|
| fusionAlgorithm     | string | 'rsf'   | Fusion mode for hybrid search      |
| alpha               | number | 0.5     | Semantic weight (0=lexical, 1=semantic) |
| vectorScanLimit     | number | 0       | Max vectors to scan (0=all)        |
| rerankerEnabled     | bool   | false   | Enable cross-encoder reranking     |
| embeddingModel      | string | 'Xenova/multilingual-e5-small' | Model for embeddings |

## Result Format

Search results include the following fields.

| Field              | Type   | Description                          |
|--------------------|--------|--------------------------------------|
| chunk_id           | string | Unique chunk identifier              |
| snippet            | string | Result content (expanded if policy)  |
| score              | number | Final fusion score                   |
| retrieval_policy   | string | 'micro_chunk' | 'table_summary' | 'code_signature' |
| doc_title          | string | Source document title                |
| breadcrumbs        | string | Section path                         |
| defined_symbols    | array  | GraphRAG symbols from section        |

## Error Handling

All functions return empty arrays on error rather than throwing. Warnings are logged to console for diagnostic purposes.
`,
  },
];

// Queries designed to test policy vs micro_chunk competition.
// Each query targets a specific document and has an expected chunk type
// that SHOULD win (depending on the query formulation).
//
// query_types:
//   'summary'     — descriptive query → policy chunk should win
//   'exact_value' — specific value lookup → micro_chunk should win
//   'code_symbol' — function/class name → code_signature should win
//   'keyword'     — keyword match → depends on mode

export const POLICY_DOMINANCE_QUERIES = [
  // ── table_only queries ──
  {
    query: "Table with columns Algorithm MRR Recall Latency containing benchmark results",
    expectedDocIds: ["benchmark_results_table"],
    query_type: "summary",
    expectedWinner: "table_summary",
    description: "Descriptive table query — policy chunk should win",
  },
  {
    query: "What is the MRR@5 score for RRF algorithm",
    expectedDocIds: ["benchmark_results_table"],
    query_type: "exact_value",
    expectedWinner: "micro_chunk",
    description: "Exact value lookup — micro_chunk (raw row) should win",
  },
  {
    query: "Table with columns Model Dimensions Size Accuracy for embedding models",
    expectedDocIds: ["model_comparison_table"],
    query_type: "summary",
    expectedWinner: "table_summary",
    description: "Model comparison table — policy chunk should win",
  },
  {
    query: "What is the accuracy of bge-small-en-v1.5 model",
    expectedDocIds: ["model_comparison_table"],
    query_type: "exact_value",
    expectedWinner: "micro_chunk",
    description: "Specific model accuracy — micro_chunk should win",
  },

  // ── code_only queries ──
  {
    query: "Function bm25Search with FTS5 MATCH query and rank ordering",
    expectedDocIds: ["retrieval_pipeline_code"],
    query_type: "code_symbol",
    expectedWinner: "code_signature",
    description: "Function description — code_signature should win",
  },
  {
    query: "rrfFusion scoreMap rrf_score 1.0 divided by k plus rank",
    expectedDocIds: ["retrieval_pipeline_code"],
    query_type: "code_symbol",
    expectedWinner: "code_signature",
    description: "RRF formula — code_signature should win",
  },
  {
    query: "ingestDocument parseSections createMediumChunks createMicroChunks",
    expectedDocIds: ["ingestion_pipeline_code"],
    query_type: "code_symbol",
    expectedWinner: "code_signature",
    description: "Pipeline function names — code_signature should win",
  },

  // ── text_only queries (control) ──
  {
    query: "System architecture combining lexical and semantic search principles",
    expectedDocIds: ["architecture_overview"],
    query_type: "summary",
    expectedWinner: "micro_chunk",
    description: "Architecture description — only micro_chunks available (control)",
  },
  {
    query: "Cross-lingual retrieval using multilingual embedding models",
    expectedDocIds: ["multilingual_design"],
    query_type: "summary",
    expectedWinner: "micro_chunk",
    description: "Multilingual design — only micro_chunks available (control)",
  },

  // ── mixed queries ──
  {
    query: "Table with columns Mode Type Strengths Weaknesses for search modes",
    expectedDocIds: ["full_system_spec"],
    query_type: "summary",
    expectedWinner: "table_summary",
    description: "Search modes table — policy chunk should win",
  },
  {
    query: "alpha parameter default value range description configuration",
    expectedDocIds: ["full_system_spec"],
    query_type: "exact_value",
    expectedWinner: "micro_chunk",
    description: "Config parameter lookup — micro_chunk should win",
  },
  {
    query: "hybridQuery function signature fusionAlgorithm alpha embeddingModel",
    expectedDocIds: ["api_reference_doc"],
    query_type: "code_symbol",
    expectedWinner: "code_signature",
    description: "API function signature — code_signature should win",
  },
  {
    query: "result format fields chunk_id snippet score retrieval_policy",
    expectedDocIds: ["api_reference_doc"],
    query_type: "exact_value",
    expectedWinner: "micro_chunk",
    description: "Result field lookup — micro_chunk should win",
  },
];
