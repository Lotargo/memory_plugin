# Empirical Retrieval Quality & Model Benchmark Evaluation

## 1. Executive Summary

This document presents the empirical evaluation methodology, model configurations, and benchmark results for the local hybrid Retrieval-Augmented Generation (RAG) engine implemented in `@lotargo/memory_plugin`.

The evaluation compares initial baseline performance against an optimized model-aware protocol and asymmetric prefixing paradigm across dense vector retrieval, lexical keyword search (SQLite FTS5 BM25), and Relative Score Fusion (RSF).

---

## 2. Model & Engine Specifications

The benchmark evaluation is conducted on the primary default model architecture:

1. **Xenova/multilingual-e5-small** (Default Micro Model)
   - Parameters: ~47M
   - Vector Dimension ($d$): 384
   - Quantized ONNX Footprint: ~120 MB
   - Primary Protocol: Prefix-based (`passage: ` for indexing, `query: ` for search). Dynamic task instructions (`Instruct: <instruction>\nQuery: <text>`) apply ONLY to `*-instruct` model variants; for standard non-instruct E5 models, any instruction field passed by an agent is safely ignored.

---

## 3. Mathematical Formulations

### Lexical BM25 Score (SQLite FTS5)

$$\text{Score}_{\text{BM25}}(D, Q) = \sum_{i=1}^{n} \text{IDF}(q_i) \cdot \frac{f(q_i, D) \cdot (k_1 + 1)}{f(q_i, D) + k_1 \cdot \left(1 - b + b \cdot \frac{|D|}{\text{avgdl}}\right)}$$
where $k_1 = 1.2$, $b = 0.75$.

### Dense Vector Cosine Similarity

$$\text{Sim}_{\text{cos}}(\mathbf{u}, \mathbf{v}) = \frac{\mathbf{u} \cdot \mathbf{v}}{\|\mathbf{u}\|_2 \|\mathbf{v}\|_2} = \frac{\sum_{i=1}^{d} u_i v_i}{\sqrt{\sum_{i=1}^{d} u_i^2} \sqrt{\sum_{i=1}^{d} v_i^2}}$$

### Reciprocal Rank Fusion (RRF)

$$\text{Score}_{\text{RRF}}(d) = \sum_{m \in M} \frac{1}{k + r_m(d)}$$
where $k = 60$, and $r_m(d)$ represents document $d$'s rank in retrieval method $m$.

### Relative Score Fusion (RSF)

$$\text{Norm}_{\text{semantic}}(d) = \frac{\text{Sim}_{\text{cos}}(d) - \min(\text{Sim})}{\max(\text{Sim}) - \min(\text{Sim}) + \epsilon}$$

$$\text{Norm}_{\text{lexical}}(d) = \frac{\max(\text{Rank}_{\text{FTS}}) - \text{Rank}_{\text{FTS}}(d)}{\max(\text{Rank}_{\text{FTS}}) - \min(\text{Rank}_{\text{FTS}}) + \epsilon}$$

$$\text{Score}_{\text{RSF}}(d) = \alpha \cdot \text{Norm}_{\text{semantic}}(d) + (1 - \alpha) \cdot \text{Norm}_{\text{lexical}}(d)$$
where $\alpha = 0.5$, $\epsilon = 10^{-6}$.

### Evaluation Metrics

- **Mean Reciprocal Rank (MRR@5)**:
  $$\text{MRR}@5 = \frac{1}{|Q|} \sum_{i=1}^{|Q|} \frac{1}{\text{rank}_i} \quad (\text{rank}_i \le 5 \text{ else } 0)$$
- **Recall@5**:
  $$\text{Recall}@5 = \frac{1}{|Q|} \sum_{i=1}^{|Q|} \mathbb{I}(\text{rank}_i \le 5)$$
- **NDCG@5**:
  $$\text{NDCG}@5 = \frac{1}{|Q|} \sum_{i=1}^{|Q|} \frac{\text{DCG}_i@5}{\text{IDCG}_i@5}$$

---

## 4. Benchmark Corpus & Query Dataset

The reference run (`benchmark_2026-08-07T01-36-45-352Z.json`) uses 32 real-world open-source repositories and technical documentation packages (React, Vue, Fastify, Rust, SQLite, Axios, Next.js, Playwright, Transformers.js, Zod, etc.), chunked into 281 sections and 1,202 micro-chunks, evaluated with 21 queries.

The earlier baseline run in §5.1 used a smaller corpus (27 documents, 321 sections, 520 micro-chunks) — corpus sizes are stated per table because they are not comparable across runs.

Query categories include:

1. **Semantic RU -> EN**: Natural language queries in Russian seeking conceptual technical answers without direct keyword matches.
2. **Cross-Lingual Concepts**: Technical concept prompts translated from Russian to English documentation target chunks.
3. **Direct Code & Keyword Searches**: API method names, syntax patterns, and symbol identifiers.

---

## 5. Comparative Evaluation Results

### Baseline Results (Prior to Model-Aware Prefixing Optimization)

_Model: Xenova/multilingual-e5-small without asymmetric passage/query prefix enforcement. Corpus: 27 docs / 321 sections / 520 micro-chunks, 21 queries. Source: `benchmark_2026-07-29T20-37-39-433Z.json`._

| Retrieval Strategy        | MRR@5  | Recall@5 | NDCG@5 |
| ------------------------- | :----: | :------: | :----: |
| BM25 Lexical Search Only  | 0.4802 |  57.14%  | 0.5029 |
| Dense Vector Only         | 0.6048 |  71.43%  | 0.6309 |
| Hybrid RRF ($k=60$)       | 0.6206 |  76.19%  | 0.6547 |
| Hybrid RSF ($\alpha=0.5$) | 0.6087 |  76.19%  | 0.6466 |

---

### Optimized Results (Model-Aware Prefixing & Exact Asymmetric E5 Protocol)

_Model: Xenova/multilingual-e5-small over the full 32-document technical corpus (281 sections, 1,202 micro-chunks, 21 queries). Source: `benchmark_2026-08-07T01-36-45-352Z.json`._

| Retrieval Strategy            |   MRR@5    |  Recall@5   |   NDCG@5   | Performance Gain vs Baseline |
| ----------------------------- | :--------: | :---------: | :--------: | :--------------------------: |
| BM25 Lexical Search Only      |   0.6706   |   76.19%    |   0.6934   |           Baseline           |
| Dense ONNX Vector Only        |   0.8135   |   100.00%   |   0.8612   |      +21.3% Vector MRR       |
| Hybrid RRF ($k=60$)           |   0.8810   |   95.24%    |   0.8997   |        +31.4% RRF MRR        |
| **Hybrid RSF ($\alpha=0.5$)** | **0.9286** | **100.00%** | **0.9473** |      **+38.5% RSF MRR**      |

---

### 5.3 Heavy Multi-Feature Model Benchmark: Xenova/bge-m3

_Model: Xenova/bge-m3 (1024-dim, 8192 context window, INT8/q8 ONNX), DirectML GPU & AVX2 execution, 30 real technical documents (353 sections, 1,503 micro-chunks), 21 evaluation queries. Source: `benchmark_2026-07-30T02-47-01-736Z.json`._

| Retrieval Strategy            |   MRR@5    |  Recall@5  |   NDCG@5   | Note                            |
| ----------------------------- | :--------: | :--------: | :--------: | ------------------------------- |
| BM25 Lexical Search Only      |   0.4476   |   57.14%   |   0.4779   | Baseline FTS5                   |
| Dense ONNX Vector (BGE-M3)    |   0.3667   |   52.38%   |   0.4052   | Single dense vector pass        |
| Hybrid RRF ($k=60$)           |   0.4817   |   61.90%   |   0.5151   | Rank-based fusion               |
| **Hybrid RSF ($\alpha=0.5$)** | **0.4817** | **61.90%** | **0.5151** | **Score-based fusion**          |

> **Corrected 2026-08-10.** The figures previously printed here (BM25 0.6706, vector 0.4476, RRF 0.7183, RSF 0.7540) could not be reproduced from any stored benchmark artifact: the BM25 value was carried over from the e5-small run and the remaining columns were shifted by one. The table above reports the actual bge-m3 run. On this corpus bge-m3 (q8, single dense pass) **underperforms** e5-small, which is why `Xenova/multilingual-e5-small` remains the default.

---

### 5.4 Cloud Environment Execution: Google Jules Sandbox Run

_Model: Xenova/multilingual-e5-small over 32 technical source documents (281 sections, 1202 micro-chunks, 21 evaluation queries)._  
_Environment: Google Jules Cloud Workspace (KVM Virtualization, 4-core Intel Xeon @ 2.30GHz, 8.0 GB RAM, Node.js 22.5+ global environment installation: `npm install -g @lotargo/memory_plugin`)._

This benchmark evaluates how `@lotargo/memory_plugin` performs in constrained, isolated cloud container environments (Google Jules) without hardware GPU acceleration.

#### Environment & Ingestion Metrics:
- **Total Micro-Chunks Vectorized**: 1,202 vectors (384 dimensions)
- **Ingestion Time**: 50.99 s (CPU vectorization speed: 23.57 vectors/sec)
- **SQLite Database Footprint**: 5.19 MB
- **CAS Blob Footprint**: 0.1 MB

#### Retrieval Quality Comparison (Google Jules Environment):

| Retrieval Strategy            |   MRR@5    |  Recall@5   |   NDCG@5   | Top-1 Wins | 95% Bootstrap CI (MRR) |
| ----------------------------- | :--------: | :---------: | :--------: | :--------: | :--------------------: |
| BM25 Lexical Search Only      |   0.6706   |   76.19%    |   0.6934   |  13 / 21   |   [0.4802, 0.8492]     |
| Dense ONNX Vector Only        |   0.8135   |   100.00%   |   0.8612   |  14 / 21   |   [0.7024, 0.9286]     |
| Hybrid RRF ($k=60$)           |   0.8810   |   95.24%    |   0.8997   |  17 / 21   |   [0.7381, 0.9762]     |
| **Hybrid RSF ($\alpha=0.5$)** | **0.9286** | **100.00%** | **0.9473** | **18 / 21**| **[0.8571, 1.0000]**   |

_Key Insight_: In the Google Jules cloud sandbox, Relative Score Fusion (RSF) reached **100.00% Recall@5** and **0.9286 MRR@5**, demonstrating that global environment installation (`npm install -g @lotargo/memory_plugin`) and headless MCP server discovery function reliably without performance degradation under cloud hypervisor constraints.

---

## 6. Category Performance Breakdown

| Category               | Query Count (N) | BM25 MRR@5 | Dense Vector MRR@5 | Hybrid RSF MRR@5 | RSF Recall@5 |
| ---------------------- | :-------------: | :--------: | :----------------: | :--------------: | :----------: |
| Semantic RU -> EN      |        7        |   0.6190   |       0.7500       |      0.8571      |   100.00%    |
| Cross-Lingual Concepts |        7        |   0.3929   |       0.7619       |      0.9286      |   100.00%    |
| Direct Code & Keyword  |        7        |   1.0000   |       0.9286       |      1.0000      |   100.00%    |

---

## 7. Conclusions

1. **ONNX JS & DirectML Optimization**: Successfully eliminated ONNX VRAM memory leaks and DirectX 12 buffer overflows on Windows via Dynamic PyTorch-style Attention Budgeting ($O(\text{seq\_len}^2)$) and fixed tensor shape padding (`padding: "max_length"`).
2. **Model-Aware Prefixing & Protocol Handling**: Enforcing precise asymmetric prefixing (`passage: ` for indexing, `query: ` for search in standard E5 models, prompt prefixes for BGE, and dynamic `Instruct: ` blocks specifically for `*-instruct` models) eliminates task drift, raising dense vector MRR@5 from 0.6048 to 0.8135 on the reference corpus.
3. **Hybrid RSF Convergence**: Relative Score Fusion ($\alpha=0.5$) achieves **0.9286 MRR@5** at **100.00% Recall@5** with e5-small on the reference corpus, and **0.4817 MRR@5** at **61.90% Recall@5** with bge-m3 (q8) on the 30-document corpus.
4. **Cloud Environment Validation (Google Jules)**: Verified that headless MCP server deployment in constrained cloud hypervisors (Google Jules KVM container) achieves **100.00% Recall@5** and **0.9286 MRR@5** under CPU-only vector execution.

---

## 8. Local Dev-Time Retrieval Gate (2026-09, 7-Document Doctest Corpus)

> **Scope honesty note.** This section is a *development-time quality gate*, not a ground-truth benchmark.
> The corpus below is 7 hand-made files, the 12 relevance judgments are the author's own, and the
> sample is far too small and too easy to support any SOTA claim (note the MRR 1.0 ceiling).
> It exists to catch regressions during development (ingest breakage, chunking, linking, rerank wiring).
> Authoritative numbers must come from the backlog in §9 (MIRACL and friends).

### 8.1 Gate corpus

| File | Type | Chars (normalized) | Sections | Micro-chunks | Notes |
| :--- | :--- | ---: | ---: | ---: | :--- |
| `architecture_report.pdf` | PDF (fpdf2) | 375 | 1 | 2 | Decision, budget, risks, timeline |
| `meeting_notes.docx` | DOCX (python-docx) | 489 | 2 | 14 | Headings + Staff table |
| `inventory.xlsx` | XLSX, 2 sheets | 924 | 4 | 10 | Staff + Inventory, `table_summary` x2 |
| `code_sample.js` | code | 371 | 1 | 3 | `code_signature` policy chunks |
| `guide.md` | markdown | 406 | 3 | 3 | EN paraphrase of PDF content |
| `data.csv` | CSV | 422 | 2 | 5 | Same data as Inventory sheet |
| `notes.txt` | plain text (RU) | 230 | 1 | 1 | RU paraphrase of decision |

38 micro-chunks total, 384-dim vectors (~58 KB). Model: `Xenova/multilingual-e5-small` (q8, CPU).
Reranker where used: `SugoLabs/mmarco-mMiniLMv2-L12-H384-v1` (q8, ~129 MB), top-15 head, one batched ONNX pass.

### 8.2 Track 1 — automated gate (12 queries, doc-level Recall@5 / MRR@5 / NDCG@5 / top-1 rate)

| Config | Recall@5 | MRR@5 | NDCG@5 | Top-1 rate | Query latency |
| :--- | ---: | ---: | ---: | ---: | :--- |
| lexical (BM25 only) | 0.819 | 1.000 | 0.854 | 12/12 | ~1 ms |
| hybrid RSF (no rerank) | 0.910 | 1.000 | 0.909 | 12/12 | ~7 ms |
| hybrid RSF + mmarco rerank | 0.931 | 0.958 | 0.908 | 11/12 | ~300 ms (first call ~1.2 s model load) |

Reading: hybrid beats lexical on recall (+0.09); rerank adds a little recall (+0.02) but **loses one top-1**
(`budget for billing migration` → `notes.txt`, which does mention the budget in Russian — a debatable
judgment, not a clear failure). The MRR 1.0 ceiling means this gate **cannot** demonstrate reranker MRR gains.

### 8.3 Track 2 — blind A/B judge (6 fresh adversarial queries, rubric top-1 0/1 + top-3 0/1/2 − junk)

Systems shuffled per query, mapping revealed after scoring. Totals: **hybrid 14 vs hybrid+rerank 16**.

| Query | Hybrid | +Rerank | Decisive detail |
| :--- | ---: | ---: | :--- |
| `Postgres or Mongo for billing` | 3 | 3 | tie, both perfect |
| `E201 employee` | 2 | 2 | tie; exact-ID distractor (E101) shown by both |
| `Gadget X price` | 3 | 3 | tie; rerank prefers full table over record snippet |
| `сроки отключения старой системы` (RU paraphrase, no shared tokens) | 0 | **3** | rerank top-1 = `Deadline is 2026-10-01`; base top-1 = dateless note + code junk |
| `who coordinates the cutover` | 3 | 3 | tie |
| `marketing staff member` | 3 | 2 | rerank swaps top-1 xlsx record → guide sentence (both answer; strict rubric −1) |

Reading: the reranker's value is concentrated in **hard paraphrase / cross-lingual queries where lexical+vector
put junk in the head** (Q4: 0 → 3). Everywhere else it ties. Cost: ~300 ms per query and occasional top-1
swaps on ambiguous queries. This is why reranking stays **opt-in, default off**.

### 8.4 Latency profile (cold model load 1.2 s, cached)

| Stage | PDF | DOCX | XLSX | md/js/txt |
| :--- | ---: | ---: | ---: | ---: |
| normalize | ~330 ms | ~260 ms | ~60 ms | 0–5 ms |
| ingest w/ embeddings (≤14 chunks) | ~80 ms | ~240 ms | ~210 ms | 70–260 ms |
| hybrid query | ~7 ms | — | — | — |
| hybrid + rerank (top-15) | ~300 ms | — | — | — |

Binary-format parsing dominates small-file ingest, not ONNX.

### 8.5 Bugs this gate actually caught

1. `remember_note`/`ingest_document` crashed with `DOMMatrix is not defined` in restricted runtimes:
   top-level `pdf-parse → @napi-rs/canvas` import. Fixed by lazy-loading parsers.
2. DOCX exact-token search broken: Mammoth escapes (`docx\-decision`); fixed by unescaping on ingest.
3. `InStock: false` unfindable via `out of stock`: fixed by header humanization + value verbalization.
4. Reranker was a silent no-op: `text-classification` pipeline returns softmax top-1 (≈1.0 for every
   single-logit candidate). Reworked to raw-logit batched scoring.

---

## 9. Benchmark Backlog (Ground Truth)

Each claimed capability needs an external benchmark before any SOTA-adjacent claim. Status legend:
`gate-only` = covered by §8 dev gate; `open` = no external measurement yet.

| # | Claimed capability | Required bench | Status |
| ---: | :--- | :--- | :--- |
| 1 | Multilingual doc/passage retrieval (EN+RU) | **MIRACL** ru+en sample (~200 queries): MRR@10 / NDCG@10 / recall | open |
| 2 | Reranker head reordering | Same MIRACL harness, rerank on/off delta | open |
| 3 | Code search (symbols, signatures) | **CodeSearchNet** (6 langs) MRR or **CoSQA**; report per-lang | open |
| 4 | Knowledge-graph accuracy (symbols, edges, fact↔doc links) | No standard bench fits; build annotated set: symbol precision/recall + link accuracy on fixed fixtures | open |
| 5 | Table/CSV retrieval (records vs summaries) | MIRACL-style slice over table corpus or custom annotated sheets | open |
| 6 | Long-context / multi-hop | **LoCoMo** (matches published mmarco-reranker reference numbers) | open |

Rule: §8 stays a regression gate; any quality claim stronger than "no worse than last run" must cite a row above.
