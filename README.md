<div align="center">

<img src="./assets/hero.jpg" alt="@lotargo/memory_plugin" width="800" style="max-width: 100%; border-radius: 12px; margin-bottom: 16px;">

<br>

<img src="./assets/title.svg" alt="@lotargo/memory_plugin" width="520" style="max-width: 100%; margin-bottom: 12px;">

<br>

[![npm version](https://img.shields.io/npm/v/@lotargo/memory_plugin)](https://www.npmjs.com/package/@lotargo/memory_plugin)
[![npm downloads](https://img.shields.io/npm/dt/@lotargo/memory_plugin)](https://www.npmjs.com/package/@lotargo/memory_plugin)
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

`@lotargo/memory_plugin` gives your AI tools durable, **persistent**, 100% local long-term memory and document retrieval capabilities that persist across restarts and work seamlessly across all supported coding environments. Any LLM-based coding agent (OpenCode, Claude Code, Codex, Antigravity) can query its own memory and hybrid knowledge base via the **Model Context Protocol (MCP)**.

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

Run the setup command to configure all detected AI environments automatically:

```bash
# Recommended: Global installation & setup (works across local CLI, Docker, and CI)
npm install -g @lotargo/memory_plugin && memory_plugin setup

# Or via npx
npx @lotargo/memory_plugin setup
```

To target a specific environment:

```bash
# Antigravity / Gemini CLI
npm install -g @lotargo/memory_plugin && memory_plugin setup --antigravity

# OpenCode
npm install -g @lotargo/memory_plugin && memory_plugin setup --opencode

# Claude Code
npm install -g @lotargo/memory_plugin && memory_plugin setup --claude

# Codex
npm install -g @lotargo/memory_plugin && memory_plugin setup --codex
```

`setup` also accepts `--gemini` (alias for Antigravity) and `--local` (also registers the MCP server in the project-local `.agents/` directory for Antigravity). Without a specific flag, all detected environments are configured.

---

## Dual-Layer Architecture

1. **Layer 1: Notebook Store (Durable Facts)**
   - **Tools**: `remember`, `recall`, `forget`, `update_fact`, `memory_info`
   - **Scope**: User preferences, identity, project conventions, system rules.
   - **Storage**: Human-readable Markdown format (`global` and per-project stores).
   - **Performance**: Guaranteed 100% precision instant lookup without vector degradation or threshold filtering.
   - **Project Scoping**: Project stores are bound to a **Git-based project identity** — the normalized remote URL (`git:github.com/owner/repo`) or, without a remote, `git:local:<repo basename>` — never to a directory path. The same repository yields the same store on any machine/OS and from any subdirectory (git toplevel resolution). Outside a Git repository there is no project memory (only `global`). Legacy path/basename stores are migrated via `link_project_memory` with a collision guard.

2. **Layer 2: RAG Knowledge Base (Technical Documents & Codebases)**
   - **Tools**: `ingest_document`, `query_knowledge_base`, `manage_knowledge_base`, `link_knowledge`
   - **Capabilities**: Ingests raw text files, Markdown, HTML, Web URLs, and full code repositories.
   - **Engine Components**: 3-tier hierarchy chunking (Big / Medium / Small), SQLite FTS5 BM25 search, ONNX dense vector embeddings (`multilingual-e5-small`), Reciprocal Rank Fusion (RRF / RSF), cross-encoder reranking (optional), and GraphRAG Lite code symbol extraction.

---

## Fact Schema, Injection & Project Identity

### Fact schema: title + body
- Every fact is a Markdown line `**Title** — body`.
- `remember` requires a `title` parameter (for both `global` and `project` scopes); the title is stored as the `**Title**` prefix. Legacy lines without a `**Title**` prefix are read as legacy facts (title = first phrase of the body, text untouched) and can be bulk-migrated via `migrate_titles` (CLI/`withTitle()`).
- Line metadata badges: `[inject]`, `[archive]`, `[keep]`, date, tags. `inject:1` marks a fact for full-text injection (the only fact type that gets injected in full).

### Injection: mode + limit
- The injected `<MEMORY>` block format is controlled by `injectMode` in config (`"full"` by default, or `"headers"`). In `"full"` mode, complete fact text is injected. In `"headers"` mode, only titles (plus ids/badges) are injected to keep the system prompt lean.
- A fact marked `inject:1` is always injected in full text regardless of `injectMode`. `injectLimit` (default `10`) caps the number of injected entries; when more facts exist, a counter (`... and N more`) is shown.
- Both `injectMode` (`full` / `headers`) and `injectLimit` can be configured interactively via CLI (`memory-cli`).
- Ordering: `inject:1` facts first, then regular facts, newest-first.
- Full records or ranges can also be fetched on demand via `recall` (`mode: "full"|"headers"`, optional `offset`/`limit`) and `get_fact({ id })`.
- Outside a Git repository the injected block contains only the `## Global` section.

### Project identity
- Project memory is keyed by **Git identity**, never by directory path: normalized remote URL (`git:github.com/owner/repo`) when a remote exists, otherwise `git:local:<repo basename>`.
- The same repository yields the same store on any machine/OS and from any subdirectory (git toplevel resolution unifies the key). Outside a Git repository there is no project memory — only `global`.
- Tools: `link_project_memory` (bind the current directory to a git identity, register aliases, optionally merge legacy path/basename stores with dedup), `unlink_project_memory`, `relink_project_memory`. CLI equivalents: `memory-cli link|unlink|relink|identity` and the interactive `[PROJECT]` menu.
- The identity/alias registry lives in SQLite (`project_identities`, `project_aliases`) and is multi-user/cloud-friendly.

---

## Key Features

- **Zero Heavy Infrastructure**: No Docker, no Python server, no C++ compilation (`node-gyp`). Uses Node.js native SQLite database.
- **Bilingual & Multilingual Support**: State-of-the-art semantic precision across Russian, English, and technical code symbols.
- **Multilingual Code Symbol Parsing**: High-performance extraction of code entities across 10 programming languages (Python, Go, Rust, C++, Java, Kotlin, C#, PHP, Ruby, JS/TS).
- **Office Document Ingestion**: Native, pure-JS parsing of PDF, DOCX, XLSX, and CSV documents, removing the need for external CLI converters.
- **Hybrid Spreadsheet RAG Representation**: XLSX/CSV tables are converted to Markdown tables for raw document viewing, while row records are transformed into semantic key-value text lines to prevent vector database noise and boost search quality.
- **3-Tier Hierarchy Chunking**: Document (Big) -> Section (Medium) -> Micro-Chunk (Small).
- **Hybrid RRF/RSF Fusion**: Combines SQLite FTS5 keyword precision with ONNX dense vector similarity; lexical-only fallback when embeddings are disabled.
- **Semantic Search**: Cosine-similarity vector retrieval with multilingual ONNX embeddings (E5 / BGE model families).
- **Git-Based Project Identity**: Per-project stores keyed by normalized Git remote URL (or repo basename), so memories follow the repository across machines, OSes, and subdirectories; legacy path/basename stores are migrated via `link_project_memory` with fact-text dedup and a collision guard.
- **GraphRAG Lite**: Automatically links documents and extracted code symbols (classes, functions, types).
- **Memory-to-Knowledge Linking**: Associate notebook facts with specific documents or line ranges in the RAG base.
- **Content-Addressable Storage (CAS)**: Local S3-style compressed blob store for raw original documents.
- **Dual-Source Model Failover**: Automatic HuggingFace CDN model downloading with GitHub Repository Mirror fallback.
- **Interactive TUI**: Terminal GUI (CLI menu) for runtime engine tuning, snapshot export/import, model cache management, and diagnostics.

---

## Supported Platforms

| Platform                     | Status       | Configuration Mechanism                                                     |
| :--------------------------- | :----------- | :-------------------------------------------------------------------------- |
| **Antigravity / Gemini CLI** | Supported    | MCP Server (`~/.gemini/config/mcp_config.json` & `.agents/mcp_config.json`) |
| **OpenCode**                 | Native       | Native plugin + MCP Server (`~/.config/opencode/opencode.json`)             |
| **Claude Code**              | Supported    | MCP Server (`~/.claude.json`)                                               |
| **Codex**                    | Supported    | MCP Server (`~/.codex/config.toml`)                                         |
| **Google Jules**             | Experimental | MCP Server via global install + setup (`npm install -g @lotargo/memory_plugin && memory_plugin setup`) |

### Google Jules Integration (Experimental)

The plugin has been verified inside the **Google Jules** cloud workspace environment. This feature is **experimental**.

- **Setup Method**: Global pre-installation with auto-setup:
  ```bash
  npm install -g @lotargo/memory_plugin && memory_plugin setup
  ```
- **Verification**: All current tools and capabilities have been verified inside the Google Jules cloud workspace. Google Jules automatically discovers the registered MCP server upon workspace initialization and seamlessly interacts with the full set of memory & RAG tools — `remember`, `recall`, `forget`, `update_fact`, `memory_info`, `link_knowledge`, `ingest_document`, `query_knowledge_base`, and `manage_knowledge_base` — including project-scoped memory, knowledge linking, and snapshot export/import.
- **Current Limitation**: All memory stores and vector indexes operate locally within the workspace environment. For cross-session cloud synchronization (Turso `only-cloud` / `hybrid-sync`) inside headless environments like Jules, authenticate without a browser using the token/env methods below.

### Headless Turso Authentication (Docker, Google Jules, VPS/VDS)

Browser OAuth requires a desktop session, so headless deployments use token- or env-based login. The **Turso account API token is the primary source of truth**: it resolves an org/database and mints a per-database token via the Platform API, exactly like the browser flow, and the resulting session is stored encrypted. In priority order, secrets resolve as **env `TURSO_API_TOKEN` → stored API-token session → env `TURSO_DB_URL`/`TURSO_DB_TOKEN` → stored browser/database session**:

| Method | Command | Notes |
| :----- | :------ | :---- |
| Account API token | `memory_plugin login --api-key <TOKEN> [--org <ORG>] [--database <DB>]` | Preferred. Validates the token, resolves org/db, mints and stores a per-database token |
| Direct endpoint | `memory_plugin login --db-url libsql://<db>-<org>.turso.io --db-token <TOKEN>` | No Platform API calls; org/db derived from the URL |
| Environment | `memory_plugin login --from-env` | Imports `TURSO_DB_URL`+`TURSO_DB_TOKEN` (preferred) or `TURSO_API_TOKEN` |
| Remove API key | `memory_plugin logout --api-key` | Removes only the API token; the resolved database session is kept |
| Status | `memory_plugin auth-status` | Shows source (env / api-key / store), authorized flag, API-key flag, endpoint, org, database and mode |

One-shot headless setup (no browser, no interactive `login`):

```bash
memory_plugin setup --api-key <TURSO_API_TOKEN> --mode hybrid-sync   # auth + set sync mode in one step
memory_plugin setup --mode only-cloud                                # mode only, if already authorized
```

Supported environment variables (usable without any `login` step — `loadSecrets()` picks them up automatically):

- `TURSO_API_TOKEN` — account API token (requires Platform API access). On first use the plugin mints a per-database JWT on the fly without touching the encrypted store; optional `TURSO_ORG`, `TURSO_DATABASE` / `TURSO_DB_NAME`, `TURSO_USERNAME`
- `TURSO_DB_URL` / `TURSO_URL` + `TURSO_DB_TOKEN` / `TURSO_TOKEN` — direct database credentials

The interactive TUI (`memory_plugin cli` → `[CLOUD] ...`) offers a method chooser: Browser OAuth, account API token, database URL + token, or import from environment — plus `[API KEY] Set / Replace Account API Token` and `[API KEY] Remove Account API Token` menu entries. For example, to run a Google Jules workspace with cloud sync:

```bash
export TURSO_API_TOKEN="eyJhbGciOi..."
memory_plugin setup --api-key "$TURSO_API_TOKEN" --mode hybrid-sync   # or rely on env auto-detection
memory_plugin auth-status
```

---

## Available MCP Tools

### 1. Memory Tools (Key-Value Notebook)

| Tool            | Scope / Target                          | Description                                                       |
| :-------------- | :-------------------------------------- | :---------------------------------------------------------------- |
| `remember`      | `global` or `project`                   | Save an important durable fact or preference                       |
| `recall`        | `project`, `global`, `all`, `list_projects` | Display saved facts; read another project's store via `project: '<path>'` |
| `forget`        | Index ID, range, or query               | Remove a saved fact (e.g. `"3-30"` ranges; `force` for protected) |
| `update_fact`   | Index ID, metadata id, or text          | Rewrite a fact while preserving its original date and links       |
| `memory_info`   | -                                       | Show storage paths, fact counts, RAG stats, and package version   |

### 2. Hybrid RAG Knowledge Base Tools

| Tool                    | Target                          | Description                                                                  |
| :---------------------- | :------------------------------ | :--------------------------------------------------------------------------- |
| `ingest_document`       | Local files, Web URLs, Raw text | Ingest into 3-tier index with ONNX vector embeddings & symbol extraction     |
| `query_knowledge_base`  | Text / Code query               | Perform hybrid RSF/RRF search (BM25 + Vector) to retrieve candidate sections |
| `manage_knowledge_base` | Actions / Documents             | Stats, list, read, delete documents, or export/import snapshots              |
| `link_knowledge`        | Facts + Document ranges         | Explicitly link a memory fact to a KB document or line range                 |

### 3. Native OpenCode Plugin

When installed as an OpenCode plugin, all MCP tools above plus `list-mcp-tools` and `mcp-reminder` are exposed. A chat hook (`experimental.chat.messages.transform`) automatically injects your saved memory into every conversation as a `<MEMORY>` block, so your agent starts each session already knowing your preferences and project context.

---

## GraphRAG Lite

The RAG engine includes a lightweight graph layer built on the same SQLite database. It combines code symbol extraction, hierarchy edges, and explicit memory-to-document links without requiring a separate graph store or an LLM at ingest time.

**Code Symbol Extraction** — during `ingest_document`, code symbols are extracted from the chunk content using fast, highly-optimized regex heuristics (maintaining 100% portability and avoiding heavy binary parsers):

- **JavaScript / TypeScript**: `function`, `class`, `interface`, `type`, `enum`, `const`, `let`, `var`
- **Python**: `def`, `class`
- **Go**: `struct`, `interface`, `func` (including methods with receivers)
- **Rust**: `struct`, `enum`, `trait`, `fn` (including async/pub)
- **C++**: `class`, `struct`, `namespace`, functions and methods
- **Java & Kotlin**: `class`, `interface`, `record`, `enum`, `fun` and synchronized methods
- **C#**: `class`, `interface`, `struct`, `record`, methods and properties
- **PHP**: `class`, `interface`, `trait`, functions
- **Ruby**: `module`, `class`, methods
- Standard language keywords and symbols shorter than 3 characters are automatically filtered out using a comprehensive, cross-language ignored keyword list to prevent graph clutter.

**Graph Edges** — three built-in relation types are created automatically, and custom relation types are supported for explicit linking:

| Relation Type       | Direction / Example                                          |
| :------------------ | :----------------------------------------------------------- |
| `CONTAINS`          | Document -> Section -> Micro-Chunk (3-tier hierarchy)        |
| `DEFINES_SYMBOL`    | Section -> `symbol:<name>` (extracted code symbol)           |
| `LINKS_TO` (default) | Memory fact -> Document or line range (via `link_knowledge`) |

**Memory-to-Knowledge Linking** — the `link_knowledge` tool connects a notebook fact to a specific document or line range (`RULES_FOR`, `IMPLEMENTS`, `EXPLAINS`, `REFERENCES`, ...):

- `link` — create the link and its graph edge
- `list_links` — list all links, optionally filtered by fact key
- `get_doc_links` — list all links pointing to a given document

Linked facts are surfaced automatically in `recall` results as `🔗 [Linked Docs: ...]`, and `remember` accepts an optional `docId` to link immediately.

**Retrieval Integration** — `query_knowledge_base` augments each retrieved section with `defined_symbols`: the code symbols defined in that same section (a single-hop lookup along `DEFINES_SYMBOL` edges). Symbol extraction also improves BM25 scoring, since symbol names become searchable tokens.

**Lifecycle** — edges are rebuilt transactionally on re-ingest of the same document, and `manage_knowledge_base` delete operations clean up all graph edges and knowledge links owned by the document (including `GLOB`-matched section/micro-chunk suffixes).

---

## Interactive TUI (CLI Menu)

Launch the interactive terminal UI to manage engine settings, inspect databases, tune retrieval parameters, and run diagnostics:

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

### TUI Menu Overview

The interactive menu exposes runtime parameters that `hybridQuery` honors, allowing search behavior modifications without restarting the MCP server. Use **Up / Down** arrows to navigate, **ENTER** to select, and **BACKSPACE** to go back.

| Block                                   | Menu Item                       | Functionality                                                                  |
| :-------------------------------------- | :------------------------------ | :----------------------------------------------------------------------------- |
| **Engine & Hybrid Search Settings**     | Fusion Algorithm                | Switch between `rsf`, `rrf`, `semantic_only`, `lexical_only`.                  |
|                                         | RSF Alpha Balance               | Weight of semantic over lexical in `rsf` fusion (`α ∈ [0,1]`). Default: `0.5`.  |
|                                         | Embedding Model                 | Select ONNX model (e.g. `Xenova/multilingual-e5-small`, custom HF models).     |
|                                         | Reranker Model                  | Enable Cross-Encoder reranking or disable for zero-latency fusion.             |
|                                         | Vector Batch Size               | Ingestion vector batch size `[1 - 256]` (default `12`).                        |
|                                         | GPU Attention Budget            | GPU micro-batch attention budget `[1M - 16M]` (default `2.0M`, ~1.5 GB VRAM).  |
|                                         | CPU WASM Threads                | ONNX WASM threads: `0` auto-detect or `1-16`.                                  |
|                                         | Execution Hardware              | `cpu` or `webgpu` (experimental).                                              |
| **Knowledge Base & Storage Management** | Notebook (Layer 1 Facts)        | Browse and manage `global` and per-project `.md` fact stores.                  |
|                                         | RAG Docs (Layer 2 Base)         | List ingested documents, inspect chunk counts, and purge entries.              |
|                                         | Snapshot Export / Import        | Export or restore the full RAG base + blob store as a JSON snapshot.           |
|                                         | Manage & Purge ML Model Cache   | Inspect or purge downloaded ONNX model weights.                                |
|                                         | Hard Reset                      | Purge RAG base, blob storage, and graph edges.                                 |
| **Global Prompt & Integration**         | Enable / Disable Global Prompt  | Inject memory instructions into `~/.gemini/config/AGENTS.md`, `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`. |
| **Diagnostics & System Actions**        | Search Quality Benchmark        | Execute in-process search evaluation across the benchmark query set.           |
|                                         | Verification Query              | Run a test `hybridQuery` against the active index.                             |
|                                         | Clear Benchmark Corpus Cache    | Clear cached benchmark corpus.                                                 |
|                                         | Reset Config to Factory Defaults| Restore default engine configuration.                                          |

Settings persist to `<memory-dir>/config.json` and are immediately loaded by the MCP server.

---

## Configuration

The engine is configured through `<memory-dir>/config.json` (created with defaults on first run):

| Key                   | Default                            | Description                                                     |
| :-------------------- | :--------------------------------- | :-------------------------------------------------------------- |
| `fusionAlgorithm`     | `rsf`                              | `rsf`, `rrf`, `semantic_only`, or `lexical_only`                |
| `alpha`               | `0.5`                              | Vector vs BM25 weight in RSF `[0.0 - 1.0]`                      |
| `embeddingModel`      | `Xenova/multilingual-e5-small`     | ONNX dense embedding model (E5 / BGE families supported)        |
| `rerankerModel`       | `none`                             | Cross-encoder reranker, or `Xenova/bge-reranker-base`           |
| `rerankerEnabled`     | `false`                            | Enable cross-encoder re-ranking                                 |
| `batchSize`           | `12`                               | Ingestion vector batch size `[1 - 256]`                         |
| `gpuAttentionBudget`  | `2000000`                          | GPU micro-batch attention budget `[1M - 16M]`                   |
| `onnxThreads`         | `0`                                | ONNX WASM threads: `0` auto-detect, or `1-16`                   |
| `executionDevice`     | `cpu`                              | `cpu` or `webgpu` (experimental)                                |

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

- **100% Local Storage**: All SQLite indexes, ONNX models, CAS blobs, and Markdown notebooks are stored locally in the memory directory. The location resolves to, in order of priority: `$MEMORY_DIR`, `$OPENCODE_CONFIG_DIR/memory`, the legacy `~/.config/opencode/memory` (on Windows: `%LOCALAPPDATA%\opencode\memory`), or `$XDG_CONFIG_HOME/opencode/memory`.
- **Dual-Source Failover Model Fetching**: Primary model weights are fetched from HuggingFace CDN with automatic failover to GitHub Repository Mirror.
- **Zero External Telemetry**: No third-party network calls are required after initial model setup.

---

## License

[MIT](./LICENSE)
