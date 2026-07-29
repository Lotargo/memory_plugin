<div align="center">

# @lotargo/memory_plugin

[![npm version](https://img.shields.io/npm/v/@lotargo/memory_plugin)](https://www.npmjs.com/package/@lotargo/memory_plugin)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

<br>

**Zero-Docker Local Hybrid RAG Engine & Long-Term Memory for AI Coding Agents**

Automatically remembers facts, ingests complex document repositories, and performs high-precision hybrid retrieval (BM25 + Dense Multilingual Embeddings + GraphRAG Lite).

</div>

---

## Key Features

- **Durable Key-Value Memory**: Remember user preferences, project conventions, and architectural facts across sessions.
- **Hybrid RAG Knowledge Engine**:
  - **Zero Heavy Infrastructure**: No Docker, no Python server, no binary C++ build steps (`node-gyp`). Uses Node.js native SQLite (`node:sqlite`).
  - **3-Tier Hierarchy Chunking**: Document (Big) -> Section (Medium) -> Micro-Chunk (Small).
  - **Hybrid Retrieval & RRF Fusion**: Merges SQLite FTS5 full-text keyword precision with ONNX multilingual dense vector similarity.
  - **GraphRAG Lite**: Automatically links documents and extracted code symbols (classes, functions, types).
  - **Content-Addressable Storage (CAS)**: Local S3-style blob store for raw Markdown, HTML, PDFs, and code.
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

### 1. Memory Tools (Key-Value)
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

## Storage & Privacy

- **100% Local Storage**: All SQLite indexes, ONNX models, and CAS blobs are stored locally under `~/.config/opencode/memory/`.
- **Zero External Telemetry**: No third-party network calls are required after initial model setup.

---

## License

MIT
