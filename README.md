<div align="center">

# @lotargo/memory_plugin

[![npm version](https://img.shields.io/npm/v/@lotargo/memory_plugin)](https://www.npmjs.com/package/@lotargo/memory_plugin)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

<br>

**Zero-Docker Local Hybrid RAG Engine & Long-Term Memory for AI Coding Agents**

Automatically remembers durable user facts, ingests complex document repositories, and performs high-precision hybrid retrieval across sessions and platforms.

</div>

---

## Why @lotargo/memory_plugin?

Standard AI coding assistants lose context as soon as a chat session closes or a conversation is reset. You end up having to repeatedly re-explain your preferences, architecture decisions, code style, or project conventions.

`@lotargo/memory_plugin` gives your AI tools durable, 100% local long-term memory and document retrieval capabilities that persist across restarts and work seamlessly across all supported coding environments.

### Practical Use Cases

#### 1. Software Development
- **Architectural Decisions**: *"In this project, we use Fastify instead of Express and strict schema validation via Zod."*
- **Coding Conventions**: *"Place all helper utilities inside `src/utils/` and always cover new functions with Vitest tests."*
- **Environment Constraints**: *"Our target deployment environment is Node.js 20 on AWS Lambda."*

#### 2. Everyday Chat & Interaction
- **User Profile & Communication Tone**: *"My name is Alex. I prefer concise, direct answers without conversational filler."*
- **Explanation Format**: *"Explain complex technical concepts using real-world code examples."*
- **Goals & Context**: *"I am currently building a multi-platform memory plugin and RAG engine."*

---

## Dual-Layer Architecture

1. **Layer 1: Notebook Store (Durable Personal & Project Facts)**
   - Managed via `remember`, `recall`, and `forget`.
   - Stores user preferences, identity, project conventions, and system rules in human-readable Markdown format.
   - Guaranteed 100% precision instant retrieval as persistent context without threshold filtering or vector degradation.

2. **Layer 2: RAG Knowledge Base (Documentation & Repositories)**
   - Managed via `ingest_document`, `query_knowledge_base`, and `manage_knowledge_base`.
   - Ingests raw files, Markdown, HTML, and code repositories.
   - Dynamic 3-tier hierarchy chunking (Big / Medium / Small), SQLite FTS5 BM25 search, ONNX dense vector embeddings (`multilingual-e5-small`), Reciprocal Rank Fusion (RRF), and GraphRAG Lite code symbol extraction.

---

## Key Features

- **Zero Heavy Infrastructure**: No Docker, no Python server, no binary C++ build dependencies (`node-gyp`). Uses Node.js native SQLite database.
- **Bilingual & Multilingual Support**: SOTA semantic understanding across Russian, English, and technical code symbols.
- **3-Tier Hierarchy Chunking**: Document (Big) -> Section (Medium) -> Micro-Chunk (Small).
- **Hybrid RRF Fusion**: Combines SQLite FTS5 keyword precision with ONNX dense vector similarity.
- **GraphRAG Lite**: Automatically links documents and extracted code symbols (classes, functions, types).
- **Content-Addressable Storage (CAS)**: Local S3-style compressed blob store for raw original documents.
- **Dual-Source Model Failover**: Automatic HuggingFace CDN model downloading with fallback to GitHub Repository Mirror in case of rate-limits or HF outages.
- **Embedded Web Admin Dashboard**: Interactive single-page app served on `http://localhost:8765` with dynamic port resolution.

---

## Supported Platforms

| Platform | Status | Mechanism |
|----------|--------|-----------|
| **Antigravity / Gemini CLI** | Supported | MCP Server (`~/.gemini/config/mcp_config.json` & `.agents/mcp_config.json`) |
| **OpenCode** | Native | Native plugin + MCP Server (`~/.config/opencode/opencode.json`) |
| **Claude Code** | Supported | MCP Server (`~/.claude.json`) |
| **Codex** | Supported | MCP Server (`~/.codex/config.toml`) |

---

## Minimum System Requirements

- **Node.js**: version `18.0.0` or higher
- **Package Manager**: `npm` / `npx` (included with Node.js)
- **Supported Environment**: OpenCode, Antigravity / Gemini CLI, Claude Code, or Codex

---

## Installation & Setup

Run this single command in your terminal to automatically configure memory for your AI tools:

### Install for All Detected Environments
```bash
npx @lotargo/memory_plugin setup
```

### Targeted Installation for a Specific Platform

- **Antigravity / Gemini CLI only**:
  ```bash
  npx @lotargo/memory_plugin setup --antigravity
  ```
- **OpenCode only**:
  ```bash
  npx @lotargo/memory_plugin setup --opencode
  ```
- **Claude Code only**:
  ```bash
  npx @lotargo/memory_plugin setup --claude
  ```
- **Codex only**:
  ```bash
  npx @lotargo/memory_plugin setup --codex
  ```

### Launch Web Admin Dashboard
```bash
npx @lotargo/memory_plugin admin
```

---

## Available MCP Tools

### 1. Memory Tools (Key-Value Notebook)
| Tool | Description |
|------|-------------|
| `remember` | Save an important durable fact (`global` or `project` scope) |
| `recall` | Display saved facts (`project`, `global`, or `all`) |
| `forget` | Remove a saved fact by number or query |

### 2. Hybrid RAG Knowledge Base Tools
| Tool | Description |
|------|-------------|
| `ingest_document` | Ingest local files, web URLs, or raw text into 3-tier hierarchy index with ONNX vector embeddings and symbol extraction |
| `query_knowledge_base` | Perform hybrid RSF/RRF search (BM25 + Vector) to retrieve relevant candidate sections, code symbols, and context |
| `manage_knowledge_base` | List documents, delete documents (purging CAS & SQLite), view database stats, or export/import portable snapshots |

---

## Interactive CLI & Engine Tuning

Launch the interactive CLI terminal interface to configure fusion algorithm (RSF / RRF), alpha weights, embedding models, and reranker options:

```bash
# From local repository folder:
node mcp-server/index.js cli
# or
npx . cli

# If installed / linked globally via npm link:
memory_plugin cli
# or
memory-cli
```

### CLI Menu Structure

The interactive menu exposes the same runtime knobs that `hybridQuery` honours, so you can change search behaviour without editing code or restarting the MCP server. Keys: **↑ / ↓** to navigate, **ENTER** to select, **BACKSPACE** to go back.

| Block | Item | What it does |
|---|---|---|
| **Engine Settings** | Fusion Algorithm | Switch between `rsf`, `rrf`, `semantic_only`, `lexical_only`. Affects every `query_knowledge_base` call until changed. |
| | RSF Alpha Balance | Weight of semantic over lexical in `rsf` fusion (`α ∈ [0,1]`). Default `0.5`; best-in-class tuning is reported by the benchmark (see §Testing). |
| | Embedding Model | Pick any HF `Xenova/...` ONNX model. First query after switching downloads weights and pays a one-time memory cost. |
| | Reranker Model | Enable a cross-encoder (e.g. `bge-reranker-base`) on top of hybrid results, or disable for zero-latency fusion. |
| **Notebook** | Layer 1 Facts | Browse / delete `global` and per-project `.md` fact stores. Hooks `remember` / `recall` / `forget`. |
| **RAG Docs** | Layer 2 RAG Base | List ingested documents, inspect micro-chunk/section counts, and purge a document from FTS5 + vector index + CAS blobs. |
| **Diagnostics** | Run Search Quality Benchmark | Executes the full benchmark suite in-process and prints the winner table (see §Testing). Surfaces `winner` + RRF-vs-RSF significance so you can decide before flipping the algorithm. |
| | Run Search Verification Query | Issue a one-off `hybridQuery` against the live index to sanity-check retrieval with current settings. |
| | Clear Benchmark Corpus Cache | Delete the cached GitHub README corpus used by the benchmark (frees disk for re-fetch from scratch). |
| | Reset Config to Factory Defaults | Restore `config_defaults.json` to disk. |

### Why use the CLI?

- **Iterative tuning**: change `alpha` and re-run the benchmark in <60 s to see if MRR/Recall move — no model reload, corpus is cached.
- **Reproducible diagnostics**: the benchmark tabulates MRR/Recall/NDCG per mode and per category, so you can attribute a regression to a specific query or fusion knob.
- **Zero config drift**: settings persist to `~/.config/opencode/memory/config.json` and are picked up by the MCP server on next `query_knowledge_base` / `hybridQuery` call.

---

## Testing & Benchmarking

To run the automated test suite and benchmarks locally:

```bash
cd mcp-server

# Run unit and integration tests
npm test

# Run benchmark suite (ONNX embeddings + real technical corpus)
npm run benchmark
```

### Benchmark Methodology

The benchmark suite (`mcp-server/benchmarks/`) is the canonical way to evaluate retrieval quality changes. It runs three phases end-to-end:

1. **Dual-layer verification** — asserts Notebook and RAG layers are isolated (zero crosstalk, 100% precision on `recall`).
2. **Ingestion benchmark** — fetches 27 real GitHub README documents, ingests them with ONNX `multilingual-e5-small` embeddings, and reports throughput, DB size, blob footprint, and heap delta.
3. **Search quality benchmark** — evaluates 21 challenging Russian→English / cross-lingual / code-keyword queries against 4 retrieval strategies with per-category breakdown, bootstrap 95% CIs, paired t-tests, and grid searches over RSF `α` and RRF `k`.

**Strict matching policy**: a query is counted as hit iff the returned chunk belongs to one of the query's predefined `expectedDocIds` (derived from corpus source-id, e.g. `axios_readme`). This avoids false positives from substring overlap (e.g. query "next" against any doc mentioning "next").

**Outputs**: In addition to the human-readable markdown report at `dev_docs/benchmark_results.md`, each run also writes a machine-readable JSON sidecar `dev_docs/benchmark_<timestamp>.json` and archives a copy under `dev_docs/benchmark_history/` for regression tracking across runs.

> **Note**: The runner auto-respawns with `--expose-gc` so heap deltas can be measured post-GC. Pass `--no-respawn` to disable.

### Empirical Search Quality & Benchmark Summary

The search quality of `@lotargo/memory_plugin` is evaluated across real-world multi-document technical repositories using Mean Reciprocal Rank (MRR@5), Recall@5, and Normalized Discounted Cumulative Gain (NDCG@5).

#### Current Benchmark Performance (Instruction-Tuned Paradigm)
*Model: Xenova/multilingual-e5-small over full 32-document technical corpus (21 queries).*

| Retrieval Strategy | MRR@5 | Recall@5 | NDCG@5 |
|---|:---:|:---:|:---:|
| BM25 Lexical Search Only | 0.5873 | 66.67% | 0.6077 |
| Dense ONNX Vector Only | 0.8333 | 85.71% | 0.8396 |
| Hybrid RRF ($k=60$) | 0.9048 | 90.48% | 0.9048 |
| **Hybrid RSF ($\alpha=0.5$)** | **0.9206** | **95.24%** | **0.9286** |

For complete benchmark methodology, baseline comparisons, mathematical formulations, and category breakdowns, refer to [BENCHMARKS.md](./BENCHMARKS.md).

---

## Storage & Privacy

- **100% Local Storage**: All SQLite indexes, ONNX models, CAS blobs, and Markdown notebooks are stored locally under `~/.config/opencode/memory/`.
- **Dual-Source Failover Model Fetching**: Primary model weights are fetched from HuggingFace CDN with automatic failover to GitHub Repository Mirror if rate-limited or offline.
- **Zero External Telemetry**: No third-party network calls are required after initial model setup.

---

## License

MIT
