---
name: using-memory
description: Comprehensive guide for using the Memory, Hybrid RAG Knowledge Engine & MCP Helper tools (remember, recall, get_fact, forget, update_fact, memory_info, link_knowledge, link_project_memory, unlink_project_memory, relink_project_memory, ingest_document, query_knowledge_base, manage_knowledge_base, list-mcp-tools, mcp-reminder). Trigger proactively whenever user preferences, project conventions, technology stack choices, or architecture decisions are introduced, or when querying ingested documentation, indexing files/repos, managing persistent knowledge, or looking up available MCP tool integrations.
---

# Using Memory, Hybrid RAG Knowledge Engine & MCP Helper Tools

You have access to a persistent dual-layer memory engine supercharged with an **Agent-Driven Knowledge Graph** and general MCP integration helpers:
1. **Layer 1: Notebook Store (Key-Value Facts)**: Stores high-signal personal preferences, project conventions, and durable rules in clean Markdown.
2. **Layer 2: RAG Knowledge Base**: Indexes documentation, repositories, and technical guides for hybrid semantic retrieval.
3. **Layer 3: Agent-Driven Knowledge Graph**: Connects Notebook facts (Layer 1) to specific Knowledge Base documents, sections, and **exact line ranges** (Layer 2).
4. **Integration Layer (General MCP Helpers)**: Quickly discovers connected MCP servers and identifies appropriate tools for specific tasks.

---

## 1. Tool Selection Decision Matrix

| Scenario / Intent | Target Tool | Key Parameters |
|-------------------|-------------|----------------|
| User shares identity, tech stack preference, or workflow rule | `remember` | `fact` (English), `scope`, optional `docId`, `startLine`, `endLine` |
| User asks what you remember about them, the project, or linked docs | `recall` | `scope` ("all", "global", "project", "list_projects"), `mode` ("full", "headers"), `offset`, `limit`, optional `query`, `tags`, `since`, `until`, `project` (at session start, MUST fetch all memories with `scope: "all"` without restrictive query filters) |
| Get a single fact's text and metadata by ID | `get_fact` | `id` (metadata id e.g. "8f3a2c"), `scope` |
| User corrects/updates an old saved fact | `update_fact` | `id` (number/id/text), `newText`, `scope` |
| Replace a fact but keep a version trail | `remember` | `fact`, `supersedes` (number/id/text) |
| Protect a fact from accidental `forget` | `remember` | `keep: true` |
| Set a time-to-live on a fact | `remember` | `ttl` ("90d", "2w", "24h", "12m") |
| Filter facts by keyword / tags / date | `recall` | `query`, `tags`, `since`, `until` |
| Show storage paths, versions, fact & RAG stats, git identity | `memory_info` | — |
| Connect a Notebook fact to a document, section, or line range | `link_knowledge` | `action` ("link", "list_links", "get_doc_links"), `factText`, `docId`, `startLine`, `endLine`, `relationType` |
| Link directory to Git project identity / migrate legacy stores | `link_project_memory` | `directory`, optional `remote` |
| Remove path alias or purge project identity | `unlink_project_memory` | `directory`, `purge` (boolean) |
| Move or merge project memories to new target identity | `relink_project_memory` | `directory`, `remote` (target remote URL) |
| User asks to index a documentation URL, file, or repository | `ingest_document` | `content` (text/file path/URL), `type` ("text", "file", "url"), `title`, `path` |
| User asks a complex question about indexed docs or code | `query_knowledge_base` | `query`, `limit`, `instruction`, `generateEmbeddings` |
| Read full raw content of an ambiguous/abstract document | `manage_knowledge_base` | `action: "read_document"`, `docId` |
| View DB stats, list indexed docs, read/delete docs, export/import snapshots | `manage_knowledge_base` | `action` ("stats", "list", "read_document", "delete", "export_snapshot", "import_snapshot"), `docId`, `snapshotPath` |
| Discover available MCP servers and their specific purposes | `list-mcp-tools` | — |
| Ask which MCP tool / server is suitable for a specific task | `mcp-reminder` | `task` (string, e.g., "db migration") |

---

## 2. Layer 1 & 3: Notebook Store & Agent-Driven Knowledge Graph (`remember`, `recall`, `update_fact`, `forget`, `memory_info`, `link_knowledge`)

### Agent-Driven Knowledge Graph Architecture
Automatic regex/heuristic algorithms alone CANNOT infer high-level semantic intent or cross-document relationships. **You (the AI Agent) are the primary architect of the Knowledge Graph.**

Whenever you ingest project documentation, web pages, or local files, you should link durable facts in the Notebook store directly to the corresponding RAG documents and exact line ranges.

### What to Save and Link (`remember` & `link_knowledge`)
- **High-Signal Facts**: User name, role, language preferences, architectural constraints, framework choices, coding standards, test rules.
- **Formating**: Always translate the fact into clear, concise English before calling `remember`.
- **Linking to Knowledge Base Documents**:
  - Pass `docId` (or document title/path) and optional `startLine` / `endLine` when calling `remember` or `link_knowledge`.
  - Example: `remember(fact: "Use Fastify instead of Express for backend services", scope: "project", docId: "arch_specs.md", startLine: 5, endLine: 7)`
  - Example: `link_knowledge(factText: "Use PostgreSQL 16 for primary persistence", docId: "database_guide.md", startLine: 20, endLine: 35, relationType: "IMPLEMENTS")`

### How Linked Memory Appears (`recall`)
When `recall` is invoked, the engine returns saved facts along with their Agent-linked Knowledge Base documents and exact line ranges:
```
--- memory_plugin ---
1. Use Fastify instead of Express for backend services 🔗 [Linked Docs: Project Architecture Specs:L5-7]
2. PostgreSQL 16 is primary database 🔗 [Linked Docs: database_guide.md:L20-35]
```

### Fact Line Format & Metadata
Each fact is stored as a single Markdown line with an optional invisible HTML comment carrying metadata:
```
- [2026-08-02 06:08] user prefers TypeScript <!-- id:8f3a2c, ttl:90d, keep:1, tags:pref,arch -->
```
Supported metadata keys (set via `remember`, rendered as badges by `recall`):
- `id` — auto-generated short id; stable reference for `update_fact` / `forget` / `supersedes`.
- `ttl` — time-to-live ("90d", "2w", "24h", "12m", bare number = days). Expired facts are marked `[EXPIRED]` but never auto-deleted.
- `keep` — protection flag; `forget` skips it unless `force: true`.
- `tags` — comma-separated free-form tags for filtering.
- `supersedes` / `supersededBy` — versioning: the old fact gets `[SUPERSEDED]` and is excluded from the injected memory block while staying in the store for history.

### Remember Options (`remember`)
- `ttl`: "90d", "2w", "24h", "12m" — mark the fact for expiry; it will show `[EXPIRED]` once past.
- `keep: true`: protect the fact from `forget` (unless `force: true`).
- `tags`: comma-separated tags for later filtering, e.g. `"pref,arch"`.
- `supersedes`: number (as listed by `recall`), metadata `id`, or text of the fact this one replaces.

### Filtering & Viewing Facts (`recall` & `get_fact`)
- `scope`: `"all"` (default), `"global"`, `"project"`, or `"list_projects"` (lists all project stores, total facts, file paths, and git identity bindings).
- `query`: all space-separated terms must match (case-insensitive); searches text, id, tags, and date.
- `tags`: comma-separated; returns facts with ANY matching tag.
- `since` / `until`: "YYYY-MM-DD" (inclusive) to filter by fact date.
- `project`: read a specific project's store from any working directory.
- `mode`: `"full"` (default) or `"headers"` (returns title and badges only, omitting full text body).
- `offset` / `limit`: optional numeric pagination parameters.
- `get_fact`: fetch exact text and full metadata of a single fact by its metadata id (e.g. `get_fact(id: "8f3a2c")`).
- Output shows `[EXPIRED]`, `[KEEP]`, `[SUPERSEDED]`, `[INJECT]` badges and the `Store file:` path.

### Updating Facts (`update_fact`)
When the user corrects an old fact, prefer `update_fact` over `forget`+`remember` — it rewrites the text while preserving the original date and all metadata (`ttl`, `keep`, `tags`, `supersedes`), and re-points any linked Knowledge Base documents.
- `id`: recall index number, metadata `id`, or text of the fact.
- `newText`: replacement text.
- `scope`: "project" (default) or "global".

### Protecting Facts (`forget` with `keep`)
`forget` refuses to delete facts saved with `keep: true`; pass `force: true` to override. It still supports deleting by index number, range ("3-30"), or text.

### Project Memory Identity Management (`link_project_memory`, `unlink_project_memory`, `relink_project_memory`)
Project stores are bound to Git-based project identities (`git:remote` or `git:local:<repo basename>`). Use these tools to manage bindings:
- `link_project_memory(directory, remote)`: Links a working directory to a Git identity, registers path/remote aliases, and automatically merges any legacy path-based stores.
- `unlink_project_memory(directory, purge)`: Removes the path alias link for a directory; set `purge: true` to purge the identity from SQLite.
- `relink_project_memory(directory, remote)`: Moves and merges memories from the current project identity to a new target remote URL identity.

### Storage Diagnostics (`memory_info`)
`memory_info` returns the package version, `MEMORY_DIR`, SQLite DB path, store-file locations, fact counts per store, Git identity info, and RAG stats (documents, sections, chunks, graph edges, links).

---

## 3. Layer 2: RAG Knowledge Base (`ingest_document`, `query_knowledge_base`, `manage_knowledge_base`)

### Document Ingestion (`ingest_document`)
Use this tool when adding technical documentation, API specs, architectural documents, or code repos into the searchable knowledge base.
- **Hierarchy Chunking**: The engine automatically creates 3-tier chunks (Big Document -> Medium Section -> Small Micro-Chunk) and extracts GraphRAG code symbols.
- **Auto Vector Embeddings**: Dense ONNX vectors (`multilingual-e5-small`) are automatically computed and indexed in SQLite.
- **CRITICAL Schema Usage & Parameters**:
  - `content` (required, string): For `type: "text"`/`"file"` it must be the **actual raw text or markdown content** of the document, NOT just a file path! For `type: "url"` it must be the **page URL** — the page is fetched automatically and its content is indexed (not just the URL).
  - `type` (optional, enum: `"text"`, `"file"`, `"url"`): `"text"` (default), `"file"`, or `"url"` (fetches the web page and indexes its content).
  - `path` (optional, string): Provide the absolute file path (e.g. `f:\projects\plugins\memory\README.md`). For URLs the final URL is used for deduplication.
  - `title` (optional, string): Provide document title (e.g. `README.md`). If omitted for a URL, the page `<title>` is used.
  - **Correct Example (URL)**: `ingest_document(content: "https://docs.example.com/guide", type: "url", title: "Example Guide")`
  - **Correct Example (text)**: `ingest_document(content: "<full text content>", path: "f:/path/to/file.md", title: "file.md", type: "file")`
  - ❌ **Common Error**: `ingest_document(content: "f:/path/to/file.md")` — this causes validation failures because `content` is missing the text content.

- **CLI/Script Execution Note**: When writing batch node scripts to call `ingestDocument`, remember that `@lotargo/memory_plugin` uses ES Modules (`"type": "module"`). Use `import` syntax instead of `require()`.

### Hybrid Retrieval (`query_knowledge_base`)
Use this tool BEFORE answering deep architectural or technical questions when indexed documents exist.
- Performs **Hybrid RRF/RSF Fusion** combining SQLite FTS5 BM25 keyword matching with dense ONNX vector semantic search.
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
- Use `action: "export_snapshot"` with `snapshotPath` to export a JSON backup of the RAG base.
- Use `action: "import_snapshot"` with `snapshotPath` to import and merge a JSON backup into the current database.

---

## 4. General MCP Helpers (`list-mcp-tools`, `mcp-reminder`)

### Discovering Connected MCP Servers (`list-mcp-tools`)
When working in multi-server environments (e.g., OpenCode, Claude Code), you might have several auxiliary servers installed (for database, UI design, browser automation, etc.).
- Use `list-mcp-tools` to immediately view all registered servers and their descriptions. This avoids guessing what other capabilities are available in the current workspace.

### Contextual Tool Reminders (`mcp-reminder`)
- If you are unsure which tool/server is best suited for the task at hand (e.g., how to do browser testing, or run a database migration), run `mcp-reminder(task: "your current task definition")`.
- It analyzes your task and suggests appropriate servers (like `playwright` for testing, `supabase` for DB, or `stitch` for UI design).

---

## 5. Core Directives for AI Agents

1. **Read Memories First (MANDATORY)**: At the very start of any session or conversation, your VERY FIRST STEP MUST BE to execute `recall` with `scope: "all"` (and without restrictive query filters) to load ALL saved global facts, user context, and project guidelines BEFORE performing any other task or code analysis. Do NOT filter or restrict the initial `recall` call with specific query keywords.
2. **Be Proactive**: When the user mentions a durable preference, personal fact, or constraint, save it immediately using `remember`. Do not wait for explicit user commands.
3. **Check Knowledge Base First**: If a query is related to specialized documentation, APIs, or project architectures, call `query_knowledge_base` using concept-dense search phrases.
4. **Inspect Ambiguous Docs Directly**: If querying produces low relevance scores on abstractly-named documents, call `manage_knowledge_base(action: "read_document")` to inspect the full text directly.
5. **Keep Memory Clean**: If a preference changes, call `update_fact` to edit it in place, or `remember` with `supersedes` to keep a version trail. Use `keep: true` for facts that must survive an accidental `forget`, and give ephemeral facts a `ttl` so stale ones surface as `[EXPIRED]`.
6. **Leverage MCP Servers**: Proactively list available tools using `list-mcp-tools` and query `mcp-reminder` if unsure of which platform tool can help you automate tasks.
