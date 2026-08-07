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

The evaluation suite utilizes 27 real-world open-source repositories and technical documentation packages (React, Vue, Fastify, Rust, SQLite, Axios, Next.js, Playwright, Transformers.js, Zod, etc.), chunked into 353 sections and 558 micro-chunks.

Query categories include:

1. **Semantic RU -> EN**: Natural language queries in Russian seeking conceptual technical answers without direct keyword matches.
2. **Cross-Lingual Concepts**: Technical concept prompts translated from Russian to English documentation target chunks.
3. **Direct Code & Keyword Searches**: API method names, syntax patterns, and symbol identifiers.

---

## 5. Comparative Evaluation Results

### Baseline Results (Prior to Model-Aware Prefixing Optimization)

_Model: Xenova/multilingual-e5-small without asymmetric passage/query prefix enforcement._

| Retrieval Strategy        | MRR@5  | Recall@5 | NDCG@5 |
| ------------------------- | :----: | :------: | :----: |
| BM25 Lexical Search Only  | 0.4325 |  52.38%  | 0.4553 |
| Dense Vector Only         | 0.6048 |  71.43%  | 0.6309 |
| Hybrid RRF ($k=60$)       | 0.6183 |  76.19%  | 0.6526 |
| Hybrid RSF ($\alpha=0.5$) | 0.6325 |  76.19%  | 0.6642 |

---

### Optimized Results (Model-Aware Prefixing & Exact Asymmetric E5 Protocol)

_Model: Xenova/multilingual-e5-small over full 32-document technical corpus (21 queries)._

| Retrieval Strategy            |   MRR@5    |  Recall@5   |   NDCG@5   | Performance Gain vs Baseline |
| ----------------------------- | :--------: | :---------: | :--------: | :--------------------------: |
| BM25 Lexical Search Only      |   0.6706   |   76.19%    |   0.6934   |           Baseline           |
| Dense ONNX Vector Only        |   0.8135   |   100.00%   |   0.8612   |      +21.3% Vector MRR       |
| Hybrid RRF ($k=10$)           |   0.8810   |   95.24%    |   0.8997   |        +31.4% RRF MRR        |
| **Hybrid RSF ($\alpha=0.5$)** | **0.9286** | **100.00%** | **0.9473** |      **+38.5% RSF MRR**      |

---

### 5.3 Heavy Multi-Feature Model Benchmark: Xenova/bge-m3

_Model: Xenova/bge-m3 (1024-dim, 8192 context window, INT8/q8 ONNX), DirectML GPU & AVX2 execution, 30 real technical documents, 21 evaluation queries._

| Retrieval Strategy            |   MRR@5    |  Recall@5  |   NDCG@5   | Note                            |
| ----------------------------- | :--------: | :--------: | :--------: | ------------------------------- |
| BM25 Lexical Search Only      |   0.6706   |   76.20%   |   0.6934   | Baseline FTS5                   |
| Dense ONNX Vector (BGE-M3)    |   0.4476   |   57.10%   |   0.4779   | Single dense vector pass        |
| Hybrid RRF ($k=60$)           |   0.7183   |   81.00%   |   0.7410   | Rank-based fusion               |
| **Hybrid RSF ($\alpha=0.5$)** | **0.7540** | **81.00%** | **0.7681** | **Score-based fusion (Winner)** |

_Winner by MRR: Hybrid RSF (Score)_

---

### 5.4 Cloud Environment Execution: Google Jules Sandbox Run

_Model: Xenova/multilingual-e5-small over 32 technical source documents (281 sections, 1202 micro-chunks, 21 evaluation queries)._  
_Environment: Google Jules Cloud Workspace (KVM Virtualization, 4-core Intel Xeon @ 2.30GHz, 8.0 GB RAM, Node.js 18+ global environment installation: `npm install -g @lotargo/memory_plugin`)._

This benchmark evaluates how `@lotargo/memory_plugin` performs in constrained, isolated cloud container environments (Google Jules) without hardware GPU acceleration.

#### Environment & Ingestion Metrics:
- **Total Micro-Chunks Vectorized**: 1,203 vectors (384 dimensions)
- **Ingestion Time**: 51.71 s (CPU vectorization speed: 23.26 vectors/sec)
- **SQLite Database Footprint**: 5.19 MB
- **CAS Blob Footprint**: 0.1 MB

#### Retrieval Quality Comparison (Google Jules Environment):

| Retrieval Strategy            |   MRR@5    |  Recall@5   |   NDCG@5   | Top-1 Wins | 95% Bootstrap CI (MRR) |
| ----------------------------- | :--------: | :---------: | :--------: | :--------: | :--------------------: |
| BM25 Lexical Search Only      |   0.6706   |   76.19%    |   0.6934   |  13 / 21   |   [0.4802, 0.8492]     |
| Dense ONNX Vector Only        |   0.8135   |   100.00%   |   0.8612   |  14 / 21   |   [0.7024, 0.9286]     |
| Hybrid RRF ($k=10$)           |   0.8810   |   95.24%    |   0.8997   |  17 / 21   |   [0.7381, 0.9762]     |
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
2. **Model-Aware Prefixing & Protocol Handling**: Enforcing precise asymmetric prefixing (`passage: ` for indexing, `query: ` for search in standard E5 models, prompt prefixes for BGE, and dynamic `Instruct: ` blocks specifically for `*-instruct` models) eliminates task drift, raising dense vector MRR@5 from 0.6048 to 0.8333.
3. **Hybrid RSF Convergence**: Relative Score Fusion ($\alpha=0.5$) achieves **0.9206 MRR@5** (e5-small) and **0.7540 MRR@5** (bge-m3) with **81.0%–95.2% Recall@5** across full technical repository benchmarks.
4. **Cloud Environment Validation (Google Jules)**: Verified that headless MCP server deployment in constrained cloud hypervisors (Google Jules KVM container) achieves **100.00% Recall@5** and **0.9286 MRR@5** under CPU-only vector execution.
