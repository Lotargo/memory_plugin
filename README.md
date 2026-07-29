<div align="center">

# @lotargo/memory_plugin

[![npm version](https://img.shields.io/npm/v/@lotargo/memory_plugin)](https://www.npmjs.com/package/@lotargo/memory_plugin)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

<br>

**Zero-Docker Local Hybrid RAG Engine & Long-Term Memory for AI Coding Agents**

Automatically remembers facts, ingests complex document repositories, and performs high-precision hybrid retrieval (BM25 + Dense Multilingual Embeddings + GraphRAG Lite).

</div>

---

## Dual-Layer Architecture

1. **Layer 1: Notebook Store (Durable Personal Facts)**
   - Managed via `remember`, `recall`, and `forget`.
   - Stores user preferences, identity, project conventions, and system rules.
   - Guaranteed 100% precision instant retrieval as persistent context without threshold filtering or vector degradation.

2. **Layer 2: RAG Knowledge Base (Documentation & Repositories)**
   - Managed via `ingest_document`, `query_knowledge_base`, and `manage_knowledge_base`.
   - Ingests raw files, Markdown, HTML, and code repositories.
   - Dynamic 3-tier hierarchy chunking (Big / Medium / Small), SQLite FTS5 BM25 search, ONNX dense vector embeddings (`multilingual-e5-small`), Reciprocal Rank Fusion (RRF), and GraphRAG Lite code symbol extraction.

---

## Key Features

- **Zero Heavy Infrastructure**: No Docker, no Python server, no binary C++ build dependencies (`node-gyp`). Uses Node.js native SQLite database.
- **Bilingual & Multilingual Support**: SOTA semantic understanding across Russian and English.
- **3-Tier Hierarchy Chunking**: Document (Big) -> Section (Medium) -> Micro-Chunk (Small).
- **Hybrid RRF Fusion**: Combines SQLite FTS5 keyword precision with ONNX dense vector similarity.
- **GraphRAG Lite**: Automatically links documents and extracted code symbols (classes, functions, types).
- **Content-Addressable Storage (CAS)**: Local S3-style compressed blob store for raw original documents.
- **Embedded Web Admin Dashboard**: Interactive single-page app served on `http://localhost:8765` with dynamic port resolution.

---

## Installation & Setup

### Install for All Detected Environments
```bash
npx @lotargo/memory_plugin setup
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

# Run rigorous benchmark suite (ONNX embeddings + real GitHub corpus)
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

- **100% Local Storage**: All SQLite indexes, ONNX models, and CAS blobs are stored locally under `~/.config/opencode/memory/`.
- **Zero External Telemetry**: No third-party network calls are required after initial model setup.

---

## License

MIT
