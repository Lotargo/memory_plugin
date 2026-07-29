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
- **User Profile & Communication Tone**: *"My name is Oleg. I prefer concise, direct answers without conversational filler."*
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
| **Antigravity / Gemini CLI** | ✅ Supported | MCP Server (`~/.gemini/config/mcp_config.json` & `.agents/mcp_config.json`) |
| **OpenCode** | ✅ Native | Native plugin + MCP Server (`~/.config/opencode/opencode.json`) |
| **Claude Code** | ✅ Supported | MCP Server (`~/.claude.json`) |
| **Codex** | ✅ Supported | MCP Server (`~/.codex/config.toml`) |

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
| `query_knowledge_base` | Perform hybrid BM25 + Vector RRF search to retrieve relevant candidate sections, code symbols, and context |
| `manage_knowledge_base` | List documents, delete documents (purging CAS & SQLite), view database stats, or export/import portable snapshots |

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

### Empirical Benchmark Summary

Benchmark performed over 21 real-world technical documents from GitHub with full ONNX vector embedding computation (`multilingual-e5-small`):

| Search Strategy | MRR@5 | Recall@5 | NDCG@5 | Avg Latency |
|---|---|---|---|---|
| **BM25 Text Search Only** | 0.5667 | 66.67% | 0.5929 | 0.49 ms |
| **Dense ONNX Vector Only** | 0.7022 | 80.00% | 0.7258 | 11.74 ms |
| **Hybrid RRF (BM25 + Vector)** | **0.7667** | **80.00%** | **0.7754** | **12.54 ms** |

---

## Storage & Privacy

- **100% Local Storage**: All SQLite indexes, ONNX models, CAS blobs, and Markdown notebooks are stored locally under `~/.config/opencode/memory/`.
- **Dual-Source Failover Model Fetching**: Primary model weights are fetched from HuggingFace CDN with automatic failover to GitHub Repository Mirror if rate-limited or offline.
- **Zero External Telemetry**: No third-party network calls are required after initial model setup.

---

## License

MIT
