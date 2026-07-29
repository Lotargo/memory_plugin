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

The hybrid engine combines BM25 full-text keyword matching with dense ONNX vector search (`multilingual-e5-small`). Formulate queries according to these rules:

**Rule 1 — Use Concept-Dense Declarative Phrases (POSITIVE EXAMPLES)**
Formulate queries as concise, factual concept statements.
- ✅ `"Библиотека для выполнения HTTP запросов и отмены отправки данных"`
- ✅ `"Автоматизация сценариев пользователя в браузере и проверка веб-страниц"`
- ✅ `"createStore combineReducers управление состоянием приложения Redux"`

**Rule 2 — DO NOT Use Conversational Questions (NEGATIVE EXAMPLES)**
- ❌ **DO NOT** ask conversational questions: *"Что такое Next.js и как его настроить?"*, *"Как мне сделать отмену запроса в axios?"*, *"Подскажи пожалуйста где про базу данных?"*. Conversational filler words (*"как"*, *"что такое"*, *"где"*, *"подскажи"*) pollute BM25 lexical tokens and add noise to vector embeddings!
- ❌ **DO NOT** copy raw code signatures with exact dots verbatim (`browser.newPage page.goto expect.toBeVisible`) unless searching specifically for an exact symbol name.
- ❌ **DO NOT** use long rambling conversational turns. Keep queries concise (10-30 words).

**Rule 3 — Combine Exact Code Symbols + Semantic Intent**
- Good: `"isCancel AxiosError библиотека HTTP запросов отмена"`
- Good: `"useReducer useContext React component state management"`

---

### Reading Ambiguous or Abstract Documents ("Ода о единороге" Scenario)

When documents have abstract, non-descriptive, or unpredictable titles/contents (e.g. *"Ода о единороге"*, *"Заметки_2026"*, *"Планы_проекта"*), searching via `query_knowledge_base` may fail if the user or agent cannot guess what terms are inside.

In such cases, use the **Full Raw Document Reading** mechanism:

1. **Discover Ingested Documents**: Call `manage_knowledge_base(action: "list")` to see all ingested document IDs, titles, and paths.
2. **Read Full Raw Document Content**: Call `manage_knowledge_base(action: "read_document", docId: "<doc_id_or_title>")`.
3. **Analyze Content**: The server retrieves and decompresses the complete raw text document from CAS blob storage, allowing you to read and understand the entire document regardless of its title.

---

### Knowledge Base Management (`manage_knowledge_base`)
- Use `action: "stats"` to inspect stored document count and total micro-chunks.
- Use `action: "list"` to see all ingested documents.
- Use `action: "read_document"` with `docId` to read the complete raw text content of any document.
- Use `action: "delete"` with `docId` to remove an outdated document and purge its CAS blob.

---

## 4. Core Directives for AI Agents

1. **Be Proactive**: When the user mentions a durable preference or constraint, save it immediately using `remember`.
2. **Check Knowledge Base First**: If a user asks how a specific module, API, or project architecture works, call `query_knowledge_base` using concept-dense search phrases.
3. **Inspect Ambiguous Docs Directly**: If querying produces low relevance scores on abstractly-named documents, call `manage_knowledge_base(action: "read_document")` to inspect the full text directly.
4. **Keep Memory Clean**: If a preference changes, call `forget` on the outdated entry before saving the new one.
