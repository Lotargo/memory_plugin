<div align="center">

<img src="./assets/hero.jpg" alt="@lotargo/memory_plugin" width="800" style="max-width: 100%; border-radius: 12px; margin-bottom: 16px;">

<br>

<img src="./assets/title.svg" alt="@lotargo/memory_plugin" width="520" style="max-width: 100%; margin-bottom: 12px;">

<br>

[![npm version](https://img.shields.io/npm/v/@lotargo/memory_plugin)](https://www.npmjs.com/package/@lotargo/memory_plugin)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![node version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![mcp](https://img.shields.io/badge/MCP-Supported-8A2BE2)](https://modelcontextprotocol.io)
[![storage](https://img.shields.io/badge/Storage-100%25%20Local-success)](#storage--privacy)

<br>

**Zero-Docker Local Hybrid RAG Engine & Long-Term Memory for AI Coding Agents**

Automatically remembers durable user facts, ingests complex document repositories, and performs high-precision hybrid retrieval across sessions and platforms.

</div>

---

## Overview

Standard AI coding assistants lose context as soon as a chat session closes or a conversation is reset. You end up repeatedly re-explaining your preferences, architectural decisions, coding style, or project conventions.

`@lotargo/memory_plugin` gives your AI tools durable, 100% local long-term memory and document retrieval capabilities that persist across restarts and work seamlessly across all supported coding environments.

> **Project Scope & Runtime Notes**:
> `@lotargo/memory_plugin` is designed primarily as a practical plugin to expand capabilities and streamline daily interaction with AI coding tools. Benchmark scores in this repository represent internal synthetic evaluation runs and are not intended as generalized RAG benchmarks.
>
> **Hardware Acceleration**: GPU execution mode is an experimental feature and may vary in stability across different operating systems or models. For optimal stability and consistent runtime performance, using standard CPU mode with `multilingual-e5-small` or `multilingual-e5-base` is recommended.

### Practical Use Cases

- **Architectural Decisions**: _"In this project, we use Fastify instead of Express and strict schema validation via Zod."_
- **Coding Conventions**: _"Place all helper utilities inside `src/utils/` and cover new functions with Vitest tests."_
- **Environment Constraints**: _"Our target deployment environment is Node.js 20 on AWS Lambda."_
- **User Profile & Tone**: _"My name is Alex. I prefer concise, direct answers without conversational filler."_

---

## Quick Start

### Minimum System Requirements

- **Node.js**: `18.0.0` or higher
- **Package Manager**: `npm` / `npx` (included with Node.js)
- **Supported Environment**: OpenCode, Antigravity / Gemini CLI, Claude Code, or Codex

### Installation

Run the unified setup command to configure all detected AI environments automatically:

```bash
npx @lotargo/memory_plugin setup
```

To target a specific environment:

```bash
# Antigravity / Gemini CLI
npx @lotargo/memory_plugin setup --antigravity

# OpenCode
npx @lotargo/memory_plugin setup --opencode

# Claude Code
npx @lotargo/memory_plugin setup --claude

# Codex
npx @lotargo/memory_plugin setup --codex
```

---

## Dual-Layer Architecture

1. **Layer 1: Notebook Store (Durable Facts)**
   - **Tools**: `remember`, `recall`, `forget`
   - **Scope**: User preferences, identity, project conventions, system rules.
   - **Storage**: Human-readable Markdown format (`global` and per-project stores).
   - **Performance**: Guaranteed 100% precision instant lookup without vector degradation or threshold filtering.

2. **Layer 2: RAG Knowledge Base (Technical Documents & Codebases)**
   - **Tools**: `ingest_document`, `query_knowledge_base`, `manage_knowledge_base`
   - **Capabilities**: Ingests raw text files, Markdown, HTML, and full code repositories.
   - **Engine Components**: 3-tier hierarchy chunking (Big / Medium / Small), SQLite FTS5 BM25 search, ONNX dense vector embeddings (`multilingual-e5-small`), Reciprocal Rank Fusion (RRF / RSF), and GraphRAG Lite code symbol extraction.

---

## Key Features

- **Zero Heavy Infrastructure**: No Docker, no Python server, no C++ compilation (`node-gyp`). Uses Node.js native SQLite database.
- **Bilingual & Multilingual Support**: State-of-the-art semantic precision across Russian, English, and technical code symbols.
- **3-Tier Hierarchy Chunking**: Document (Big) -> Section (Medium) -> Micro-Chunk (Small).
- **Hybrid RRF/RSF Fusion**: Combines SQLite FTS5 keyword precision with ONNX dense vector similarity.
- **GraphRAG Lite**: Automatically links documents and extracted code symbols (classes, functions, types).
- **Content-Addressable Storage (CAS)**: Local S3-style compressed blob store for raw original documents.
- **Dual-Source Model Failover**: Automatic HuggingFace CDN model downloading with GitHub Repository Mirror fallback.
- **Interactive CLI Management**: Terminal GUI interface for runtime engine tuning, database maintenance, and diagnostics.

---

## Supported Platforms

| Platform                     | Status       | Configuration Mechanism                                                     |
| :--------------------------- | :----------- | :-------------------------------------------------------------------------- |
| **Antigravity / Gemini CLI** | Supported    | MCP Server (`~/.gemini/config/mcp_config.json` & `.agents/mcp_config.json`) |
| **OpenCode**                 | Native       | Native plugin + MCP Server (`~/.config/opencode/opencode.json`)             |
| **Claude Code**              | Supported    | MCP Server (`~/.claude.json`)                                               |
| **Codex**                    | Supported    | MCP Server (`~/.codex/config.toml`)                                         |
| **Google Jules**             | Experimental | MCP Server via global install (`npm install -g @lotargo/memory_plugin`)     |

### Google Jules Integration (Experimental)

The plugin has been verified inside the **Google Jules** cloud workspace environment.

- **Setup Method**: Global pre-installation:
  ```bash
  npm install -g @lotargo/memory_plugin
  ```
- **Verification**: Google Jules automatically discovers the registered MCP server upon workspace initialization and seamlessly interacts with memory & RAG tools (`remember`, `recall`, `ingest_document`, `query_knowledge_base`).
- **Current Limitation**: All memory stores and vector indexes operate locally within the workspace environment. Cross-session cloud synchronization across different Jules runs is planned for upcoming releases.

---

## Available MCP Tools

### 1. Memory Tools (Key-Value Notebook)

| Tool       | Scope / Target                | Description                                  |
| :--------- | :---------------------------- | :------------------------------------------- |
| `remember` | `global` or `project`         | Save an important durable fact or preference |
| `recall`   | `project`, `global`, or `all` | Display saved facts                          |
| `forget`   | Index ID or query             | Remove a saved fact                          |

### 2. Hybrid RAG Knowledge Base Tools

| Tool                    | Target                          | Description                                                                  |
| :---------------------- | :------------------------------ | :--------------------------------------------------------------------------- |
| `ingest_document`       | Local files, Web URLs, Raw text | Ingest into 3-tier index with ONNX vector embeddings & symbol extraction     |
| `query_knowledge_base`  | Text / Code query               | Perform hybrid RSF/RRF search (BM25 + Vector) to retrieve candidate sections |
| `manage_knowledge_base` | Actions / Documents             | List documents, delete entries, view DB stats, or export/import snapshots    |

---

## Interactive CLI & Engine Tuning

Launch the interactive CLI terminal interface to manage engine settings, inspect databases, and tune retrieval parameters:

```bash
# From local repository folder:
node mcp-server/index.js cli
# or
npx . cli

# If installed / linked globally:
memory_plugin cli
# or
memory-cli
```

### CLI Menu Overview

The interactive menu exposes runtime parameters that `hybridQuery` honors, allowing search behavior modifications without restarting the MCP server. Use **Up / Down** arrows to navigate, **ENTER** to select, and **BACKSPACE** to go back.

| Block               | Menu Item                    | Functionality                                                                  |
| :------------------ | :--------------------------- | :----------------------------------------------------------------------------- |
| **Engine Settings** | Fusion Algorithm             | Switch between `rsf`, `rrf`, `semantic_only`, `lexical_only`.                  |
|                     | RSF Alpha Balance            | Weight of semantic over lexical in `rsf` fusion (`α ∈ [0,1]`). Default: `0.5`. |
|                     | Embedding Model              | Select ONNX model (e.g. `Xenova/multilingual-e5-small`).                       |
|                     | Reranker Model               | Enable Cross-Encoder reranking or disable for zero-latency fusion.             |
| **Notebook**        | Layer 1 Facts                | Browse and manage `global` and per-project `.md` fact stores.                  |
| **RAG Docs**        | Layer 2 RAG Base             | List ingested documents, inspect chunk counts, and purge entries.              |
| **Diagnostics**     | Run Search Quality Benchmark | Execute in-process search evaluation across benchmark query set.               |
|                     | Verification Query           | Run a test `hybridQuery` against the active index.                             |
|                     | Clear Cache & Reset          | Clear cached benchmark corpus or restore factory default config.               |

Settings persist to `~/.config/opencode/memory/config.json` and are immediately loaded by the MCP server.

---

## Testing & Benchmarking

To run the automated test suite and benchmarks locally:

```bash
cd mcp-server

# Run unit and integration tests
npm test

# Run search quality & ingestion benchmarks
npm run benchmark
```

### Benchmark Methodology

The benchmark suite (`mcp-server/benchmarks/`) evaluates retrieval quality across three phases:

1. **Dual-Layer Verification**: Asserts Notebook and RAG layers are isolated (zero crosstalk, 100% precision on `recall`).
2. **Ingestion Benchmark**: Ingests test documents with ONNX `multilingual-e5-small` embeddings, reporting throughput, DB size, CAS blob footprint, and heap delta.
3. **Search Quality Benchmark**: Evaluates cross-lingual and code-keyword queries against 4 retrieval strategies with bootstrap 95% CIs, paired t-tests, and hyperparameter sweeps over RSF $\alpha$ and RRF $k$.

### Search Quality Results (Smoke Test)

_Note: The following metrics reflect a quick smoke-test evaluation run performed on a reduced subset of documents to verify retrieval logic precision._

Evaluated across a reduced document subset using Mean Reciprocal Rank (MRR@5), Recall@5, and Normalized Discounted Cumulative Gain (NDCG@5):

| Retrieval Strategy            |   MRR@5    |  Recall@5   |   NDCG@5   |
| :---------------------------- | :--------: | :---------: | :--------: |
| BM25 Lexical Search Only      |   0.6706   |   76.19%    |   0.6934   |
| Dense ONNX Vector Only        |   0.8135   |   100.00%   |   0.8612   |
| Hybrid RRF ($k=10$)           |   0.8810   |   95.24%    |   0.8997   |
| **Hybrid RSF ($\alpha=0.5$)** | **0.9286** | **100.00%** | **0.9473** |

For complete methodology details, see [`docs/BENCHMARKS.md`](./docs/BENCHMARKS.md).

---

## Documentation & Reports

Detailed technical documentation and architectural specifications are available in the [`docs/`](./docs) directory:

- [**Verification Report (`MEMORY_PLUGIN_REPORT.md`)**](./docs/MEMORY_PLUGIN_REPORT.md): Summary report covering MCP Tool Registry, JSON-RPC integration testing, layer isolation validation, and search precision.
- [**Comprehensive Technical Report (`MEMORY_PLUGIN_COMPREHENSIVE_REPORT.md`)**](./docs/MEMORY_PLUGIN_COMPREHENSIVE_REPORT.md): Scientific analysis of system architecture, dual-layer model, hardware environment specifications, mathematical search formulations, and event-loop profiling.
- [**Benchmark Methodology & Guide (`BENCHMARKS.md`)**](./docs/BENCHMARKS.md): Guide to automated benchmark execution, hyperparameter sweeps (RSF $\alpha$, RRF $k$), search quality metrics, and performance tracking across releases.

---

## Storage & Privacy

- **100% Local Storage**: All SQLite indexes, ONNX models, CAS blobs, and Markdown notebooks are stored locally under `~/.config/opencode/memory/`.
- **Dual-Source Failover Model Fetching**: Primary model weights are fetched from HuggingFace CDN with automatic failover to GitHub Repository Mirror.
- **Zero External Telemetry**: No third-party network calls are required after initial model setup.

---

## License

[MIT](./LICENSE)
