# Architecture Vision: Zero-Docker Local Hybrid RAG Engine for `memory_plugin`

## 1. Overview & Core Philosophy

The goal of this architectural extension is to evolve `memory_plugin` from a durable user preference notebook into a **full-fledged, local, enterprise-grade Hybrid RAG (Retrieval-Augmented Generation) knowledge engine**.

### Key Principles:
- **Zero Heavy Infrastructure**: No Docker, no Python backend, no C++ compilation dependencies (`node-gyp`).
- **Single Command NPM Distribution**: Published as `@lotargo/memory_plugin` on npm.
- **Resilient Lazy Model Downloading**: Light npm package (<3 MB). ONNX models (~130 MB) are cached locally in `~/.config/opencode/memory/models/`. Multi-mirror fallback chain (Project Git LFS Repo -> HuggingFace -> HF Mirror -> Offline CLI) prevents rate limits or outages.
- **Bilingual & Multilingual First**: SOTA semantic understanding for Russian (RU) and English (EN).
- **Content-Addressable Blob Storage**: Separation of raw files (Local S3 store) and SQLite search index.
- **Triple-Hierarchy Chunking**: Small micro-chunks for dense vector precision, Medium sections for coherent LLM prompts, Big documents for macro context.
- **Hybrid Retrieval & RRF Fusion**: Combines keyword precision (BM25 via SQLite FTS5) with dense semantic vector search via Reciprocal Rank Fusion.
- **Scale Protection**: Coarse-to-Fine two-stage filtering & thresholding to prevent retrieval degradation at 10,000+ chunks.
- **Embedded Web Admin UI (Final Phase / Stitch Driven)**: Built-in SPA Dashboard designed via StitchMCP with dynamic port resolution.

---

## 2. Document Storage Architecture (Local S3 Blob Store)

Raw original documents (Markdown, HTML, PDFs, Code) are stored outside SQLite to prevent database bloat.

```
~/.config/opencode/memory/storage/
├── blobs/                           <-- Content-Addressable Blob Store (SHA-256)
│   ├── a1/
│   │   └── a1b2c3d4e5...raw.gz      <-- Compressed raw document original
│   └── 8f/
│       └── 8fe9d0c1b2...raw.gz
└── memory.sqlite                    <-- Search Index (Metadata, Vectors, FTS5, Graph)
```

- **Deduplication**: Identical documents share blob storage.
- **Lightweight DB**: SQLite stores vectors, metadata, and chunk references without heavy raw payloads.

---

## 3. Universal Ingestion Pipeline & Formats

```
 🌐 1. Web Fetch URL ─────┐
 📄 2. Repo / Local File ─┼──> [ Format Normalizer (Clean Markdown AST) ] ──> [ 3-Tier Chunker ]
 💬 3. Direct User Text ──┘
```

- **Supported Inputs**:
  - `ingest_url`: Crawled HTML -> Clean Markdown (strips scripts, headers, navs).
  - `ingest_file`: Local `.md`, `.txt`, `.pdf`, `.docx`, code (`.ts`, `.py`, `.js`, `.json`, `.yaml`).
  - `ingest_text`: Direct prompt text saved as a virtual document.
- **Format Normalizer**: All inputs are normalized into **Structured Markdown AST** before chunking.

---

## 4. Technical Stack, Multilingual Models & Resilient Downloads

### A. Dense Embeddings & Repo-First Model Hosting
- **Runtime**: `@xenova/transformers` (Transformers.js / ONNX Runtime).
- **Primary Model**: `intfloat/multilingual-e5-small` (384-d vectors, ~130 MB ONNX q8).
- **Resilient Fallback Chain**:
  1. Local Persistent Cache: `~/.config/opencode/memory/models/` (0 network calls after 1st download).
  2. **PRIMARY DOWNLOAD**: Project Repository CDN / GitHub Releases (Git LFS) — hosted directly in project repository (`https://github.com/Lotargo/memory_pugin/releases`).
  3. FALLBACK 1: HuggingFace Hub (`https://huggingface.co`).
  4. FALLBACK 2: Public HF Mirror (`https://hf-mirror.com`).
  5. OFFLINE IMPORT: `npx @lotargo/memory_plugin setup --model-path <path>`.
- **Execution Backend**: CPU by default (100% zero-fail WASM/Node ONNX runtime). Automatic progressive enhancement to WebGPU (`device: 'webgpu'`) when supported.

### B. Re-Ranking Layer (Cross-Encoder)
- **Model**: `Xenova/bge-reranker-v2-m3` or lightweight equivalent.
- **Role**: Optional stage-2 scoring of top candidate pool.

---

## 5. Triple-Hierarchy Chunking Strategy

```
 📜 BIG LEVEL (Document)       [2000–4000+ tokens] ── Metadata, SHA-256 Checksum, TOC Tree
     └── 📑 MEDIUM LEVEL (Section) [500–1000 tokens]    ── Coherent Block returned to LLM Prompt
           └── 🧩 SMALL LEVEL (Micro)  [100–250 tokens]     ── High-density Vectors (E5) & BM25 Index
```

1. **SMALL (Level 2: 100–250 tokens)**: High density micro-chunks for Vector & BM25 match.
2. **MEDIUM (Level 1: 500–1000 tokens)**: Logical section/function block returned to LLM context.
3. **BIG (Level 0: Full Document)**: File metadata, path, SHA-256 checksum, hierarchical TOC tree.

---

## 6. Scale Protection & Retrieval Pipeline

```
User Query ──┬──> BM25 Search (SQLite FTS5) ───────> Top 30 Candidates ──┬──> RRF Fusion ──> Threshold Filter ──> Top LLM Context
             └──> Vector Search (Float32 / HNSW) ──> Top 30 Candidates ──┘
```

### Degradation Protection (Scale to 10,000+ Chunks):
1. **Coarse-to-Fine Search**: Stage 1 filters candidate sections by document metadata/tags. Stage 2 executes vector search within candidate sections.
2. **Adaptive Score Thresholding**: Prunes low-confidence hits (Cosine $< 0.60$ or low RRF score).
3. **Scope Partitioning**: Isolate searches by `project_id` and `tags`.

---

## 7. GraphRAG Lite (Document-Symbol Graph)

SQLite `graph_edges` table models relationships:
- **Node Types**: `DOCUMENT`, `SECTION`, `CODE_SYMBOL`, `TAG`.
- **Edge Types**: `CONTAINS`, `REFERENCES`, `DEFINES_SYMBOL`.
- *Benefit*: Automatically connects function calls to their source definitions.

---

## 8. Embedded Web Admin UI & Port Conflict Resolution (Final Phase)

- **Design Phase**: Mockups created using StitchMCP / user drafts.
- **Server**: Built-in Node.js HTTP server serving single-file SPA (`mcp-server/admin/index.html`).
- **Dynamic Port Resolver**: Scans ports starting at `8765`...`8785` if occupied. Writes URL to `admin_status.json`.
- **Features**: Knowledge Explorer, GraphRAG Visualizer, Search Sandbox, Snapshot Manager.

---

## 9. Database Schema (`memory.sqlite`)

```sql
-- 1. Documents (BIG Level)
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    blob_hash TEXT NOT NULL, -- SHA-256 reference to Local S3 blob store
    title TEXT,
    checksum TEXT NOT NULL,
    toc_json TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 2. Sections (MEDIUM Level)
CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    heading TEXT,
    breadcrumbs TEXT,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL
);

-- 3. Micro-Chunks (SMALL Level)
CREATE TABLE IF NOT EXISTS micro_chunks (
    id TEXT PRIMARY KEY,
    section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    vector BLOB NOT NULL, -- Float32Array serialized
    token_count INTEGER NOT NULL
);

-- 4. Full-Text Search (BM25 Index)
CREATE VIRTUAL TABLE IF NOT EXISTS micro_chunks_fts USING fts5(
    id UNINDEXED,
    content,
    breadcrumbs
);

-- 5. GraphRAG Lite Edges
CREATE TABLE IF NOT EXISTS graph_edges (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relation_type TEXT NOT NULL, -- 'CONTAINS', 'REFERENCES', 'DEFINES_SYMBOL'
    PRIMARY KEY (source_id, target_id, relation_type)
);
```

---

## 10. Development Roadmap

- [ ] **Phase 1: Storage & Database Foundation**
  - SQLite schema & `PRAGMA user_version` migrations engine.
  - Local S3 Blob Store manager (`blobs/` SHA-256 storage).
- [ ] **Phase 2: ML Engine & Ingestion Pipeline**
  - ONNX Model Manager (`@xenova/transformers` with Project Repo Git LFS / GitHub Release primary downloads + HF fallbacks).
  - Universal Normalizer (HTML / File / Text -> Clean Markdown AST).
  - Triple-Hierarchy Chunker (Big / Medium / Small).
- [ ] **Phase 3: Hybrid Retrieval & GraphRAG Lite**
  - RRF Hybrid Retriever (BM25 FTS5 + Vector + Thresholding).
  - GraphRAG Lite edge extractor during ingestion.
- [ ] **Phase 4: MCP Tools & Administrative Suite**
  - Register MCP tools (`ingest_document`, `query_knowledge_base`, `manage_knowledge_base`).
  - Snapshots, import/export, and quality evaluation benchmark suite.
- [ ] **Phase 5: Stitch-Designed Web Admin UI & NPM Packaging (Final)**
  - Prototype UI design with StitchMCP.
  - Package embedded Web Admin SPA with dynamic port resolution (`8765`+).
  - Publish `@lotargo/memory_plugin` to npm with `npx` setup command.
