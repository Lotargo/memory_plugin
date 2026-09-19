# RAG Knowledge Base Reference

Detailed reference for Layer 2 (RAG Knowledge Base) tools: `ingest_document`, `query_knowledge_base`, `batch_query_knowledge_base`, `manage_knowledge_base`, `reindex_knowledge_base`.

## Document Ingestion (`ingest_document`)

RAG is a curated project reference library, not an automatic archive of everything the agent reads. Ingest content only when the agent judges that it is reliable, relevant to the current project, and likely to be needed in future work.

Good ingestion candidates:

- Important information found through web research that should remain available after the current session.
- Official or otherwise authoritative documentation for a library, framework, API, or tool used by the project.
- New-version features, changed behavior, migration guidance, or APIs that may be newer than the model's training knowledge.
- A complete document when most of it is relevant, or only the useful excerpt when the rest would add retrieval noise.

Do not ingest search-result dumps, incidental pages, duplicate explanations, transient troubleshooting output, or documentation with no expected future project value. After ingestion, create or update a concise project-scoped Notebook fact when the source supports a durable choice, constraint, or discovery, and link that fact to the document with `remember(docId, ...)` or `link_knowledge`.

- **RAG Scope Isolation**: `scope: "project"` is the ingestion default and associates the source with the current Git identity. Query scope `"all"` searches global RAG plus only the current project; outside Git it searches global only. Use global ingestion only for sources intentionally reusable across projects.
- **Shared Sources**: Re-ingesting the same path or URL from another project adds that project association without duplicating the document. Removing it from one scope leaves it available to other linked scopes; the underlying document is deleted only after its last scope is removed.
- **Stable Updates**: Re-ingesting an updated source preserves its `docId` and Notebook links while replacing chunks, vectors, policies, and structural graph edges.
- **Hierarchy Chunking**: The engine automatically creates 3-tier chunks (Big Document -> Medium Section -> Small Micro-Chunk) and extracts GraphRAG code symbols.
- **Auto Vector Embeddings**: Dense ONNX vectors (`multilingual-e5-small`) are automatically computed and indexed in SQLite.

### CRITICAL Schema Usage & Parameters

- `content` (required, string): For `type: "text"`, pass actual raw text or Markdown. For `type: "file"`, pass either an allowed local file path or already-read file content. For `type: "url"`, pass the page URL; the page is fetched and its content is indexed.
- `type` (optional, enum: `"text"`, `"file"`, `"url"`): `"text"` (default), `"file"` (safe local-path read or supplied content), or `"url"` (fetches page content).
- `path` (optional, string): Original/deduplication path. With `type: "file"`, the server reads `path` when supplied; otherwise it treats `content` as the path when applicable. File reads are restricted by the built-in cwd/MEMORY_DIR allowlist and `ingestAllowedPaths`.
- `title` (optional, string): Provide document title (e.g. `README.md`). If omitted for a URL, the page `<title>` is used.
- **Correct Example (URL)**: `ingest_document(content: "https://docs.example.com/guide", type: "url", title: "Example Guide")`
- **Correct Example (local file path)**: `ingest_document(content: "f:/project/docs/guide.md", type: "file", title: "guide.md")`
- **Correct Example (already-read content)**: `ingest_document(content: "<full text content>", path: "f:/project/docs/guide.md", title: "guide.md", type: "file")`
- ❌ **Common Error**: passing a file path with the default `type: "text"`; that indexes the path string instead of reading the file.

- **CLI/Script Execution Note**: When writing batch node scripts to call `ingestDocument`, remember that `@lotargo/memory_plugin` uses ES Modules (`"type": "module"`). Use `import` syntax instead of `require()`.

## Hybrid Retrieval (`query_knowledge_base`)

Use this tool BEFORE answering deep architectural or technical questions when indexed documents exist.

- Performs **Hybrid RRF/RSF Fusion** combining SQLite FTS5 BM25 keyword matching with dense ONNX vector semantic search.
- Returns candidate sections with breadcrumb paths and defined code symbols (classes, functions, types).
- **Policy Expansion** (default: ON): Table summaries and code signatures are automatically expanded to full content for better recall. Disable via config `policyExpansion: false` if pure micro_chunk precision is needed.

## Batch Retrieval (`batch_query_knowledge_base`)

Use when the user needs multiple related queries executed efficiently (comparisons, multi-topic analysis, cross-period reporting).

- **Single API call** — all queries executed in parallel with one ONNX embedding pass.
- Returns one result set per query, in the same order as input.
- **Example use cases**: "Compare Q1 vs Q2 vs Q3 revenue", "Find data for category A and category B".
- **Efficiency**: ~N× faster than N separate `query_knowledge_base` calls for N queries (shared ONNX inference).

## Query Formulation Rules (CRITICAL for retrieval quality)

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

## Reading Ambiguous or Abstract Documents ("Ода о единороге" Scenario)

When documents have abstract, non-descriptive, or unpredictable titles/contents (e.g. *"Ода о единороге"*, *"Заметки_2026"*, *"Планы_проекта"*), searching via `query_knowledge_base` may fail if the user or agent cannot guess what terms are inside.

In such cases, use the **Full Raw Document Reading** mechanism:

1. **Discover Ingested Documents**: Call `manage_knowledge_base(action: "list")` to see all ingested document IDs, titles, and paths.
2. **Read Full Raw Document Content**: Call `manage_knowledge_base(action: "read_document", docId: "<doc_id_or_title>")`.
3. **Analyze Content**: The server retrieves and decompresses the complete raw text document from CAS blob storage, allowing you to read and understand the entire document regardless of its title.

## Knowledge Base Management (`manage_knowledge_base`)

- Use `action: "stats"` to inspect stored document count and total micro-chunks.
- Use `action: "list"` to see all ingested documents.
- Use `action: "read_document"` with `docId` to read the complete raw text content of any document.
- Use `action: "delete"` with `docId` to unlink a source from the current project by default (or global outside Git). Pass `scope: "global"` or `scope: "all"` only when broader removal is intentional. The document and CAS blob are purged only when no scopes remain.
- Use `action: "export_snapshot"` with `snapshotPath` to export a complete RAG backup, including scopes, vectors, retrieval policies, graph edges, and Notebook links.
- Use `action: "import_snapshot"` with `snapshotPath` to import and merge a complete backup. Older unscoped snapshots remain globally visible for compatibility.

## Re-Indexing Embeddings (`reindex_knowledge_base`)

Use this tool AFTER changing the embedding model or vector dimension so previously ingested documents remain vector-searchable.

- Both `model` and `dimension` are optional and default to the active configuration; vectors are recomputed in batches while documents, sections, FTS index, graph edges, and fact links are preserved.