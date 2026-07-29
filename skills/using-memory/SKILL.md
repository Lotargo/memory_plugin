---
name: using-memory
description: Comprehensive guide for using the Memory & Hybrid RAG Knowledge Engine tools (remember, recall, forget, ingest_document, query_knowledge_base, manage_knowledge_base). Trigger whenever remembering user preferences/conventions, querying ingested documentation, indexing files/repos, or managing persistent knowledge.
---

# Using Memory & Hybrid RAG Knowledge Engine

You have access to a persistent dual-layer memory engine:
1. **Layer 1: Notebook Store (Key-Value Facts)**: Stores high-signal personal preferences, project conventions, and durable rules.
2. **Layer 2: RAG Knowledge Base**: Indexes documentation, repositories, and technical guides for hybrid semantic retrieval.

---

## 1. Tool Selection Decision Matrix

| Scenario / Intent | Target Tool | Key Parameters |
|-------------------|-------------|----------------|
| User shares identity, tech stack preference, or workflow rule | `remember` | `fact` (English), `scope` ("global" or "project") |
| User asks what you remember about them or the project | `recall` | `scope` ("all", "global", or "project") |
| User corrects/updates an old saved fact | `forget` then `remember` | `query` (text or index number) |
| User asks to index a documentation URL, file, or repository | `ingest_document` | `content` or `source_path`, `title`, `metadata` |
| User asks a complex question about indexed docs or code | `query_knowledge_base` | `query`, `top_k`, `filters` |
| User asks to view database stats, list indexed docs, or export snapshots | `manage_knowledge_base` | `action` ("stats", "list", "delete", "export") |

---

## 2. Layer 1: Notebook Store Guidelines (`remember`, `recall`, `forget`)

### What to Save (`remember`)
- **High-Signal Facts**: User name, role, language preferences, architectural constraints, framework choices, coding standards, test rules.
- **Formating**: Always translate the fact into clear, concise English before calling `remember`.
- **Scope Selection**:
  - `scope: "global"` for personal preferences, identity, tone, universal rules across projects.
  - `scope: "project"` for repository-specific constraints, dependencies, directory structure rules.

### What NOT to Save
- ❌ Do NOT save one-off chat questions, transient debugging logs, raw code snippets, temporary variables, or full conversation turns.

### Examples
- `remember(fact: "User's name is Alex and prefers concise Russian explanations", scope: "global")`
- `remember(fact: "Use Fastify instead of Express for all backend services in this project", scope: "project")`

---

## 3. Layer 2: RAG Knowledge Base (`ingest_document`, `query_knowledge_base`, `manage_knowledge_base`)

### Document Ingestion (`ingest_document`)
Use this tool when adding technical documentation, API specs, architectural documents, or code repos into the searchable knowledge base.
- **Hierarchy Chunking**: The engine automatically creates 3-tier chunks (Big Document -> Medium Section -> Small Micro-Chunk) and extracts GraphRAG code symbols.
- **Auto Vector Embeddings**: Dense ONNX vectors (`multilingual-e5-small`) are automatically computed and indexed in SQLite.

### Hybrid Retrieval (`query_knowledge_base`)
Use this tool BEFORE answering deep architectural or technical questions when indexed documents exist.
- Performs **Hybrid RRF Fusion** combining SQLite FTS5 BM25 keyword matching with dense ONNX vector semantic search.
- Returns candidate sections with breadcrumb paths and defined code symbols (classes, functions, types).

#### Query Formulation Rules (CRITICAL for retrieval quality)

The hybrid engine combines two complementary strategies. Your query MUST serve both:

**Rule 1 — Include exact code symbols for BM25 (keyword layer)**
BM25 matches lexical tokens. If the user asks about a specific function, class, API, or error, include its exact name.
- Good: `"isCancel AxiosError request cancellation"`
- Bad: `"how to cancel HTTP requests"` (lexical mismatch with source code)

**Rule 2 — Add a natural-language description for vector search (semantic layer)**
The ONNX embedding model (`multilingual-e5-small`) maps meaning across languages. Describe the CONCEPT in any language.
- Good: `"Библиотека для HTTP запросов с отменой"`
- Good: `"centralized state management single store"` → finds Redux docs

**Rule 3 — Combine both in a single query**
The RRF fusion algorithm merges results from both strategies. A single query should contain BOTH keywords AND semantic description.
- Example: `"isCancel AxiosError библиотека HTTP запросов отмена"`
- Example: `"createStore combineReducers управление состоянием приложения"`

**Rule 4 — Query in the language of the DOCUMENTS when you know it**
If indexed docs are in English, prefer English keywords. Use Russian only for the semantic/conceptual part.
- Good: `"useReducer useContext management React component state"`
- Avoid: purely Russian queries when searching English code (`"управление состоянием"` alone will miss BM25 hits)

**Rule 5 — Use short queries (10-30 words)**
The `multilingual-e5-small` model works best with concise descriptions. Long rambling queries dilute the embedding signal.

### Knowledge Base Management (`manage_knowledge_base`)
- Use `action: "stats"` to inspect stored document count and total micro-chunks.
- Use `action: "list"` to see all ingested documents.
- Use `action: "delete"` with `doc_id` to remove an outdated document and purge its CAS blob.

---

## 4. Core Directives for AI Agents

1. **Be Proactive**: When the user mentions a durable preference or constraint, save it immediately using `remember`.
2. **Check Knowledge Base First**: If a user asks how a specific module, API, or project architecture works, call `query_knowledge_base` before making assumptions.
3. **Keep Memory Clean**: If a preference changes, call `forget` on the outdated entry before saving the new one.
