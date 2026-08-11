# PLAN: Policy-Driven RAG — Code & Table Retrieval Enhancement

> **Source research:** `docs/need_verification.md`
> **Goal:** Extend the existing 3-tier semantic chunking with policy-driven retrieval for tables and code, improving search precision and LLM context faithfulness.

---

## 1. Current State Assessment

### Already implemented (~70% of target architecture)

| Capability | Status | Location |
|---|---|---|
| 3-tier hierarchy chunking (Big/Medium/Small) | ✅ | `mcp-server/ingest/chunker.js` |
| Type-aware splitting (AST for code, row-batches for tables) | ✅ | `chunker.js:184-249` |
| Hybrid search (BM25 + vector + RRF/RSF fusion) | ✅ | `mcp-server/retrieval/retriever.js` |
| Parent-Child Rollup deduplication | ✅ | `retriever.js:285-303` |
| Dual storage (vectors in SQLite + full text in SQLite) | ✅ | `micro_chunks` table + FTS5 |
| Reranking (cross-encoder) | ✅ | `retriever.js` via `rerankHits()` |
| Multilingual E5 embeddings | ✅ | `mcp-server/ml/model_manager.js` |

### Gaps to address

| Gap | Impact | Priority |
|---|---|---|
| No `retrieval_policy` — all chunks treated uniformly | Medium | High |
| Tables vectorized as raw rows, not as semantic summaries | High | High |
| Code vectorized as raw chunks, not as signatures/docstrings | High | High |
| No type-specific context expansion after retrieval | Medium | Medium |
| Benchmarks don't measure table/code retrieval quality | High | High |
| No tests for policy-driven retrieval behavior | High | High |

---

## 2. Architecture Changes

### 2.1. Add `retrieval_policy` metadata field

**Where:** `micro_chunks` table + chunker output

```sql
ALTER TABLE micro_chunks ADD COLUMN retrieval_policy TEXT DEFAULT 'micro_chunk';
```

**Policy types:**

| Policy | Chunk content (vectorized) | Retrieval expansion |
|---|---|---|
| `table_summary` | Generated description: "Table with columns [X, Y, Z] containing [N] rows about [topic]" | Pull full original table from `medium_chunks` |
| `code_signature` | Function signature + docstring (no body) | Pull full function body + imports + class context |
| `micro_chunk` | Current behavior (unchanged) | Pull neighboring chunks or parent section |

### 2.2. Table ingestion enhancement

**Current:** Tables >350 tokens → split into row-batches of 8, each batch vectorized as-is.

**New:**
1. Parse table structure (columns, row count, data types)
2. Generate `table_summary` text: semantic description of the table
3. Store summary as a `table_summary` policy chunk (vectorized)
4. Keep original table in `medium_chunks` (truth store)
5. Row-batch chunks still created for fine-grained search, but marked as `micro_chunk` policy

**Location:** `mcp-server/ingest/chunker.js` — `createSmallChunks()` table branch (lines 184-211)

### 2.3. Code ingestion enhancement

**Current:** Code >350 tokens → split by AST regex boundaries, each chunk vectorized.

**New:**
1. For each function/class: extract signature + docstring as `code_signature` policy chunk
2. Vectorize the signature+docstring (not the body)
3. Keep full function body in `medium_chunks` (truth store)
4. AST-split chunks still created for body-level search, marked as `micro_chunk`

**Location:** `mcp-server/ingest/chunker.js` — `createSmallChunks()` code branch (lines 213-249)

### 2.4. Post-retrieval context expansion

**Where:** `mcp-server/retrieval/retriever.js` — `hybridQuery()` post-processing

After fusion and deduplication, for each hit:

```
if policy == 'table_summary':
    replace chunk content with full table from medium_chunks
elif policy == 'code_signature':
    replace chunk content with full function + imports + class context
elif policy == 'micro_chunk':
    keep current behavior (section-level expansion)
```

**Deduplication:** If 3 hits resolve to the same table/function, include it only once.

### 2.5. Schema changes

```sql
-- New column in micro_chunks
ALTER TABLE micro_chunks ADD COLUMN retrieval_policy TEXT DEFAULT 'micro_chunk';

-- New index for policy-based filtering
CREATE INDEX IF NOT EXISTS idx_micro_chunks_policy ON micro_chunks(retrieval_policy);

-- FTS5 rebuild to include new policy chunks
-- (triggered automatically by reindex)
```

---

## 3. Implementation Phases

### Phase 1: Metadata & Schema
- [ ] Add `retrieval_policy` column to `micro_chunks`
- [ ] Update chunker to output policy field for all chunk types
- [ ] Migration: backfill existing chunks with `micro_chunk` policy
- [ ] Tests: verify schema migration, policy field persistence

### Phase 2: Table Summary Generation
- [ ] Implement `generateTableSummary(tableContent, breadcrumbs)` → semantic description
- [ ] Integrate into chunker table branch
- [ ] Store summary as `table_summary` policy chunk
- [ ] Tests: table summary content, policy assignment, retrieval expansion

### Phase 3: Code Signature Extraction
- [ ] Implement `extractCodeSignature(codeBlock)` → signature + docstring
- [ ] Integrate into chunker code branch
- [ ] Store signature as `code_signature` policy chunk
- [ ] Tests: signature extraction for JS/Python/Rust/etc., policy assignment

### Phase 4: Context Expansion in Retriever
- [ ] Implement policy-driven expansion in `hybridQuery()` post-processing
- [ ] Deduplication: same table/function → include once
- [ ] Tests: expansion correctness, dedup behavior, mixed-policy results

### Phase 5: Benchmark & Evaluation
- [ ] Add table-specific benchmark queries (numeric lookup, column questions)
- [ ] Add code-specific benchmark queries (function behavior, API usage)
- [ ] Measure: table retrieval accuracy, code retrieval accuracy, hallucination rate
- [ ] Compare: baseline (current) vs policy-driven (new) with statistical significance

---

## 4. Test Plan

### 4.1. Unit Tests

| Test | File | What to verify |
|---|---|---|
| `retrieval_policy` field assignment | `unit/chunker.test.js` | Each chunk type gets correct policy |
| Table summary generation | `unit/chunker.test.js` | Summary contains column names, row count, topic |
| Code signature extraction | `unit/chunker.test.js` | Signature extracted for JS/Python/Rust/Go |
| Policy column migration | `unit/unit_audit_fixes.test.js` | Existing chunks backfilled correctly |
| Context expansion logic | NEW: `unit/policy_retrieval.test.js` | Each policy type expands correctly |
| Deduplication by policy | NEW: `unit/policy_retrieval.test.js` | Same table/function deduped |

### 4.2. Integration Tests

| Test | File | What to verify |
|---|---|---|
| End-to-end table retrieval | `integration/rag_mcp_tools.test.js` | Ingest doc with table → query → get full table |
| End-to-end code retrieval | `integration/rag_mcp_tools.test.js` | Ingest code file → query → get full function |
| Mixed corpus (tables + code + prose) | NEW: `integration/policy_driven_rag.test.js` | All policies work together |
| Policy isolation | NEW: `integration/policy_driven_rag.test.js` | Table query doesn't return code chunks |

### 4.3. Smoke Tests

| Test | File | What to verify |
|---|---|---|
| Real embeddings + policy retrieval | `smoke/e2e_real_embeddings.test.js` | Policy expansion works with real ONNX model |

---

## 5. Benchmark Improvements

### 5.1. Current Benchmark Gaps

Current benchmarks (`quality_evaluator.js`) test 21 queries in 3 categories:
- **Category A:** Semantic RU→EN (paraphrase search)
- **Category B:** Cross-lingual (RU queries → EN docs)
- **Category C:** Code/keyword (exact tokens)

**What's missing:**
- Table retrieval accuracy (numeric data, column lookups)
- Code retrieval accuracy (function behavior, API usage)
- Context completeness (is the full table/function returned?)
- Hallucination measurement (does LLM get faithful data?)
- Context redundancy (how much noise in the prompt?)

### 5.2. New Benchmark Categories

#### Category D — Table Retrieval (7 queries)
| Query type | Example | Expected |
|---|---|---|
| Column lookup | "What are the columns in the benchmark results table?" | Full table with all columns |
| Numeric lookup | "What is the MRR@5 score for RRF?" | Exact value from table |
| Row lookup | "Which model has the highest throughput?" | Correct row |
| Aggregation | "How many documents were tested?" | Correct count |
| Comparison | "Is RRF better than BM25?" | Both values from table |
| Structure | "What metrics are tracked?" | Column headers |
| Semantic table find | "Where are the performance numbers?" | Correct table by meaning |

#### Category E — Code Retrieval (7 queries)
| Query type | Example | Expected |
|---|---|---|
| Function behavior | "How does rrfFusion work?" | Full function body |
| API usage | "What parameters does hybridQuery accept?" | Signature + docs |
| Class context | "Where is the chunker class defined?" | Full class with imports |
| Cross-function | "How does ingest relate to chunker?" | Both functions |
| Error handling | "What happens on vector dimension mismatch?" | Relevant code block |
| Config dependency | "What config affects search alpha?" | Config + usage |
| Semantic code find | "Where is the table splitting logic?" | Correct function by meaning |

### 5.3. New Metrics

| Metric | Description | Measured by |
|---|---|---|
| **Table Retrieval Accuracy** | % of queries where correct table was retrieved | Category D pass rate |
| **Code Retrieval Accuracy** | % of queries where correct function was retrieved | Category E pass rate |
| **Context Completeness** | Is the full object (table/function) in context? | Manual/automated check |
| **Hallucination Rate** | % of answers with wrong numeric data | Numeric assertion |
| **Context Redundancy** | Tokens of irrelevant text in prompt | Token count of context |
| **Expansion Precision** | Does policy expansion add relevant content? | Relevance judgment |

### 5.4. Benchmark Corpus Expansion

Current: 27 README/spec docs (good for prose, weak for tables/code).

**Add:**
- 5 docs with rich Markdown tables (benchmark results, comparison matrices, config references)
- 5 source code files (JS/Python/Rust) with docstrings and multi-function modules
- 3 mixed docs (prose + tables + code)

**Total: ~40 docs** (up from 27)

### 5.5. Evaluation Protocol

1. **Baseline run:** Current system (no policy) → measure all categories A-E
2. **Policy run:** New system (with policy) → measure all categories A-E
3. **Comparison:** Paired t-test on per-query scores, bootstrap 95% CI
4. **Report:** `dev_docs/benchmark_policy_driven.md`

---

## 6. Migration & Backward Compatibility

- Existing chunks: `retrieval_policy` defaults to `'micro_chunk'` → no behavior change
- Existing documents: no re-ingestion required (they continue working as before)
- New documents: automatically get policy-enhanced chunking
- Optional: `reindexEmbeddings()` can be extended to regenerate policies for existing docs
- Schema migration: additive only (new column + index), no breaking changes

---

## 7. Success Criteria

| Criterion | Threshold | Measurement |
|---|---|---|
| Table retrieval accuracy | ≥ 85% on Category D | Benchmark |
| Code retrieval accuracy | ≥ 85% on Category E | Benchmark |
| No regression on prose search | Category A/B/C scores ≥ baseline | Benchmark |
| Context completeness | ≥ 90% (full object present) | Benchmark |
| All new tests pass | 100% green | `npm test` |
| Smoke test passes | 100% green | `npm run smoke` |
| No performance regression | Ingestion throughput ≥ 90% of baseline | `stress_ingestion.js` |

---

## 8. Open Questions

1. **Table summary generation:** Rule-based (column names + row count) or LLM-based (semantic description)? Rule-based is faster and deterministic; LLM-based is richer but slower.
2. **Code signature extraction:** Regex-based (current AST regex) or tree-sitter? Regex is lighter; tree-sitter is more accurate but adds native dependency.
3. **Policy granularity:** 3 policies (table_summary, code_signature, micro_chunk) enough, or need more (e.g., `list_item`, `blockquote`)?
4. **Expansion depth:** For code — how much context? Just the function? The whole class? The whole file?
