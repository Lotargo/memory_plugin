---
name: using-memory
description: Comprehensive guide for using the Memory, Hybrid RAG Knowledge Engine & MCP Helper tools (remember, recall, get_fact, forget, update_fact, memory_info, link_knowledge, link_project_memory, unlink_project_memory, relink_project_memory, ingest_document, query_knowledge_base, manage_knowledge_base, reindex_knowledge_base, list-mcp-tools, mcp-reminder). Trigger proactively whenever user preferences, project conventions, technology stack choices, or architecture decisions are introduced, or when querying ingested documentation, indexing files/repos, managing persistent knowledge, or looking up available MCP tool integrations.
---

# Using Memory, Hybrid RAG Knowledge Engine & MCP Helper Tools

You have access to a persistent dual-layer memory engine supercharged with an **Agent-Driven Knowledge Graph** and general MCP integration helpers:
1. **Layer 1: Notebook Store (Key-Value Facts)**: Stores high-signal personal preferences, project conventions, and durable rules in clean Markdown.
2. **Layer 2: Curated RAG Knowledge Base**: Preserves selected external findings, documentation, repositories, and technical guides that are likely to matter again.
3. **Layer 3: Agent-Driven Knowledge Graph**: Connects Notebook facts (Layer 1) to specific Knowledge Base documents, sections, and **exact line ranges** (Layer 2).
4. **Integration Layer (General MCP Helpers)**: Quickly discovers connected MCP servers and identifies appropriate tools for specific tasks.

---

## 1. Tool Selection Decision Matrix

| Scenario / Intent | Target Tool | Key Parameters |
|-------------------|-------------|----------------|
| User shares identity, tech stack preference, or workflow rule | `remember` | `fact` (English), `title` (concise 2-5 word headline), `kind` (`fact` context or `directive` active instruction), `scope`, optional `directory` (workspace path), `docId`, `startLine`, `endLine` |
| User asks what you remember about them, the project, or linked docs | `recall` | `scope` ("all", "global", "project", "list_projects"), `mode` ("full", "headers"), `offset`, `limit`, optional `query`, `tags`, `since`, `until`, `directory` / `project` (at session start in clients without auto-injection, MUST fetch all memories with `scope: "all"` without restrictive query filters) |
| Get a single fact's text and metadata by ID | `get_fact` | `id` (metadata id e.g. "8f3a2c"), `scope`, optional `directory` |
| User corrects/updates or reclassifies an old saved fact | `update_fact` | `id` (number/id/text), `newText`, optional `kind`, `scope`, optional `directory` |
| Replace a fact but keep a version trail | `remember` | `fact`, `supersedes` (number/id/text), optional `directory` |
| Protect a fact from accidental `forget` | `remember` | `keep: true` |
| Set a time-to-live on a fact | `remember` | `ttl` ("90d", "2w", "24h", "12m") |
| Filter facts by keyword / tags / date | `recall` | `query`, `tags`, `since`, `until`, optional `directory` |
| Show storage paths, versions, fact & RAG stats, git identity | `memory_info` | optional `directory` |
| Connect a Notebook fact to a document, section, or line range | `link_knowledge` | `action` ("link", "list_links", "get_doc_links"), `factText`, `docId`, `startLine`, `endLine`, `relationType`, optional `directory` |
| Register current Git project identity / migrate legacy stores | `memory_info` then `link_project_memory` when `Registry: unlinked` | `directory`, optional `remote` |
| Remove path alias or purge project identity | `unlink_project_memory` | `directory`, `purge` (boolean) |
| Move or merge project memories to new target identity | `relink_project_memory` | `directory`, `remote` (target remote URL) |
| User asks to index a documentation URL, file, or repository | `ingest_document` | `content` (text/file path/URL), `type` ("text", "file", "url"), `title`, `path`, `scope` (project default), optional `directory` |
| User asks a complex question about indexed docs or code | `query_knowledge_base` | `query`, `scope` (all default), `limit`, `instruction`, `generateEmbeddings`, optional `directory` |
| User needs multiple queries executed in batch (comparisons, multi-topic) | `batch_query_knowledge_base` | `queries` (array), `scope` (all default), `limit`, `instruction`, `generateEmbeddings`, optional `directory` |
| Read full raw content of an ambiguous/abstract document | `manage_knowledge_base` | `action: "read_document"`, `docId` |
| View DB stats, list indexed docs, read/delete docs, export/import snapshots | `manage_knowledge_base` | `action` ("stats", "list", "read_document", "delete", "export_snapshot", "import_snapshot"), `docId`, `snapshotPath`, optional `directory` |
| Re-embed all documents after switching embedding model / dimension | `reindex_knowledge_base` | `model`, `dimension` (optional; defaults to active config) |
| Discover available MCP servers and their specific purposes | `list-mcp-tools` | — |
| Ask which MCP tool / server is suitable for a specific task | `mcp-reminder` | `task` (string, e.g., "db migration") |

---

## 2. Layer 1 & 3: Notebook Store & Agent-Driven Knowledge Graph (`remember`, `recall`, `update_fact`, `forget`, `memory_info`, `link_knowledge`)

### Agent-Driven Knowledge Graph Architecture
Automatic regex/heuristic algorithms alone CANNOT infer high-level semantic intent or cross-document relationships. **You (the AI Agent) are the primary architect of the Knowledge Graph.**

When an ingested source supports a durable project decision or rule, link the corresponding Notebook fact directly to the RAG document and, when useful, its exact line range. The Notebook fact is the concise orientation point; the linked RAG source is its detailed evidence and technical context.

### What to Save and Link (`remember` & `link_knowledge`)
- **High-Signal Facts**: User name, role, language preferences, architectural constraints, framework choices, coding standards, test rules.
- **Semantic Kind (MANDATORY)**:
  - Use `kind: "fact"` for descriptive context such as identity, project architecture, versions, locations, and historical observations.
  - Use `kind: "directive"` only for user-approved active personality, behavior, tone, communication style, preference, or working-convention instructions.
  - Do not infer directive semantics from persuasive wording alone. Explicit `kind` is authoritative. Legacy stores without `kind` recognize persona/preference tags and `inject:1` only for backward compatibility.
- **Formatting & Fact Titles**:
  - Always translate the fact into clear, concise English before calling `remember`.
  - **Always specify a descriptive `title` parameter** (a 2-5 word headline, e.g., `title: "Backend Framework Preference"`).
  - Facts are stored in `**Title** — body` format. Initial session recall and auto-injected `<MEMORY>` blocks MUST include full fact bodies. Header-only recall was tested and rejected because it loses essential context. Use `mode: "headers"` only when the user explicitly asks for a compact inventory, never for session initialization.
- **Targeting Project Directory (`directory`)**:
  - Pass `directory: "<project directory path>"` (or `project`) when calling `remember` or `recall` to ensure the call routes to the target project store even when the MCP server runs in an external folder or outside Git.
  - Example: `remember(title: "Backend Framework Preference", fact: "Use Fastify instead of Express for backend services", scope: "project", directory: "F:/projects/my-app")`
- **Linking to Knowledge Base Documents**:
  - Pass `docId` (or document title/path) and optional `startLine` / `endLine` when calling `remember` or `link_knowledge`.
  - Example: `remember(title: "Backend Framework Preference", fact: "Use Fastify instead of Express for backend services", scope: "project", docId: "arch_specs.md", startLine: 5, endLine: 7)`
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
- `kind` — `fact` for contextual memory or `directive` for active personalization/working instructions. Directive entries appear with `[DIRECTIVE]` and are synchronized into managed client persona blocks.

### Remember Options (`remember`)
- `kind`: `"fact"` (default descriptive context) or `"directive"` (active user-approved personalization/working instruction).
- `directory` / `project`: optional workspace/project directory path to target when saving project facts from outside cwd.
- `ttl`: "90d", "2w", "24h", "12m" — mark the fact for expiry; it will show `[EXPIRED]` once past.
- `keep: true`: protect the fact from `forget` (unless `force: true`).
- `tags`: comma-separated tags for later filtering, e.g. `"pref,arch"`.
- `supersedes`: number (as listed by `recall`), metadata `id`, or text of the fact this one replaces.

### Filtering & Viewing Facts (`recall` & `get_fact`)
- `scope`: `"all"` (default), `"global"`, `"project"`, or `"list_projects"` (lists all project stores, total facts, file paths, and git identity bindings).
- `directory` / `project`: read a specific project's store from any working directory.
- `query`: all space-separated terms must match (case-insensitive); searches text, id, tags, and date.
- `tags`: comma-separated; returns facts with ANY matching tag.
- `since` / `until`: "YYYY-MM-DD" (inclusive) to filter by fact date.
- `mode`: `"full"` (default) or `"headers"` (returns title and badges only, omitting full text body).
- `includeSuperseded`: `false` by default so obsolete history does not enter active context; set `true` only to inspect version history.
- `offset` / `limit`: optional numeric pagination parameters.
- `get_fact`: fetch exact text and full metadata of a single fact by its metadata id (e.g. `get_fact(id: "8f3a2c")`).
- Output shows `[EXPIRED]`, `[KEEP]`, `[SUPERSEDED]`, `[INJECT]` badges and the `Store file:` path.

### Scope Isolation and Conflicts
- `scope: "all"` returns the complete global store plus only the current Git project's store.
- Outside a Git repository, `scope: "all"` returns global memory only. It must not create a `null` project store.
- Memories from unrelated projects are never included in normal session initialization. Use the explicit `project` parameter only when the user asks to inspect another project.
- Global and project facts are both context sources. Neither store automatically overrides the other; if facts conflict, the agent evaluates the available context and decides how to proceed.

### Updating Facts (`update_fact`)
When the user corrects an old fact, prefer `update_fact` over `forget`+`remember` — it rewrites the text while preserving the original date and all metadata (`ttl`, `keep`, `tags`, `supersedes`), and re-points any linked Knowledge Base documents.
- `id`: recall index number, metadata `id`, or text of the fact.
- `newText`: replacement text.
- `kind`: optional reclassification to `"fact"` or `"directive"`; changing a global directive automatically resynchronizes managed client persona blocks.
- `scope`: "project" (default) or "global".

### Protecting Facts (`forget` with `keep`)
`forget` refuses to delete facts saved with `keep: true`; pass `force: true` to override. It still supports deleting by index number, range ("3-30"), or text.

### Project Memory Identity Management (`link_project_memory`, `unlink_project_memory`, `relink_project_memory`)
Project stores are bound to Git-based project identities (`git:<normalized remote>` or `git:local:<repo basename>`). Normal recall resolves the current identity automatically from Git and never scans unrelated project stores.

Session initialization sequence:
1. If the client has already supplied an auto-injected `<MEMORY>` block (the native OpenCode integration does this), treat the complete active memory as loaded and do not call `recall` again merely for initialization. Otherwise, call `recall(scope: "all")` first, with full bodies and no filters.
2. Apply entries marked `kind: "directive"` as active user-selected personalization or working instructions. Treat `kind: "fact"` entries as descriptive context. Legacy persona/preference tags remain a compatibility fallback only.
3. Call `memory_info` for the current workspace.
4. If it reports `Identity: git` and `Registry: unlinked`, immediately call `link_project_memory` for the current directory. This registers the identity and aliases and migrates any matching legacy path store.
5. If the link result reports `migrated: true`, call `recall(scope: "all")` again so the migrated facts enter the active context.
6. If it reports `Identity: no-git`, do not create project memory and do not invent a remote; continue with global memory only.

Use the identity tools as follows:
- `link_project_memory(directory, remote)`: Links a working directory to a Git identity, registers path/remote aliases, and automatically merges any legacy path-based stores.
- `unlink_project_memory(directory, purge)`: Removes the path alias link for a directory; set `purge: true` to purge the identity from SQLite.
- `relink_project_memory(directory, remote)`: Moves and merges memories from the current project identity to a new target remote URL identity.

### Storage Diagnostics (`memory_info`)
`memory_info` returns the package version, `MEMORY_DIR`, SQLite DB path, store-file locations, fact counts per store, current Git identity, its registry status (`linked`, `unlinked`, or `not-applicable`), and RAG stats (documents, sections, chunks, graph edges, links).

---

## 3. Layer 2: RAG Knowledge Base (`ingest_document`, `query_knowledge_base`, `manage_knowledge_base`, `reindex_knowledge_base`)

### Document Ingestion (`ingest_document`)
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
- **CRITICAL Schema Usage & Parameters**:
  - `content` (required, string): For `type: "text"`, pass actual raw text or Markdown. For `type: "file"`, pass either an allowed local file path or already-read file content. For `type: "url"`, pass the page URL; the page is fetched and its content is indexed.
  - `type` (optional, enum: `"text"`, `"file"`, `"url"`): `"text"` (default), `"file"` (safe local-path read or supplied content), or `"url"` (fetches page content).
  - `path` (optional, string): Original/deduplication path. With `type: "file"`, the server reads `path` when supplied; otherwise it treats `content` as the path when applicable. File reads are restricted by the built-in cwd/MEMORY_DIR allowlist and `ingestAllowedPaths`.
  - `title` (optional, string): Provide document title (e.g. `README.md`). If omitted for a URL, the page `<title>` is used.
  - **Correct Example (URL)**: `ingest_document(content: "https://docs.example.com/guide", type: "url", title: "Example Guide")`
  - **Correct Example (local file path)**: `ingest_document(content: "f:/project/docs/guide.md", type: "file", title: "guide.md")`
  - **Correct Example (already-read content)**: `ingest_document(content: "<full text content>", path: "f:/project/docs/guide.md", title: "guide.md", type: "file")`
  - ❌ **Common Error**: passing a file path with the default `type: "text"`; that indexes the path string instead of reading the file.

- **CLI/Script Execution Note**: When writing batch node scripts to call `ingestDocument`, remember that `@lotargo/memory_plugin` uses ES Modules (`"type": "module"`). Use `import` syntax instead of `require()`.

### Hybrid Retrieval (`query_knowledge_base`)
Use this tool BEFORE answering deep architectural or technical questions when indexed documents exist.
- Performs **Hybrid RRF/RSF Fusion** combining SQLite FTS5 BM25 keyword matching with dense ONNX vector semantic search.
- Returns candidate sections with breadcrumb paths and defined code symbols (classes, functions, types).
- **Policy Expansion** (default: ON): Table summaries and code signatures are automatically expanded to full content for better recall. Disable via config `policyExpansion: false` if pure micro_chunk precision is needed.

### Batch Retrieval (`batch_query_knowledge_base`)
Use when the user needs multiple related queries executed efficiently (comparisons, multi-topic analysis, cross-period reporting).
- **Single API call** — all queries executed in parallel with one ONNX embedding pass.
- Returns one result set per query, in the same order as input.
- **Example use cases**: "Compare Q1 vs Q2 vs Q3 revenue", "Find data for category A and category B".
- **Efficiency**: ~N× faster than N separate `query_knowledge_base` calls for N queries (shared ONNX inference).

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
- Use `action: "delete"` with `docId` to unlink a source from the current project by default (or global outside Git). Pass `scope: "global"` or `scope: "all"` only when broader removal is intentional. The document and CAS blob are purged only when no scopes remain.
- Use `action: "export_snapshot"` with `snapshotPath` to export a complete RAG backup, including scopes, vectors, retrieval policies, graph edges, and Notebook links.
- Use `action: "import_snapshot"` with `snapshotPath` to import and merge a complete backup. Older unscoped snapshots remain globally visible for compatibility.

### Re-Indexing Embeddings (`reindex_knowledge_base`)
Use this tool AFTER changing the embedding model or vector dimension so previously ingested documents remain vector-searchable.
- Both `model` and `dimension` are optional and default to the active configuration; vectors are recomputed in batches while documents, sections, FTS index, graph edges, and fact links are preserved.

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

1. **Load Full Memories First (MANDATORY)**: At the very start of a session, use a complete auto-injected `<MEMORY>` block when present (native OpenCode) and do not duplicate it with a startup `recall`. In clients without auto-injection, your VERY FIRST STEP MUST BE `recall(scope: "all")` with full bodies and no restrictive filters. Do not use `mode: "headers"` for initialization.
2. **Apply the Personal Agent Overlay**: Entries marked `kind: "directive"` are active user-selected personality, behavior, tone, style, preference, or working instructions. `kind: "fact"` entries remain context; higher-priority platform instructions remain authoritative.
3. **Ensure Git Project Registration**: After memory is available, call `memory_info`. If the current Git identity is `Registry: unlinked`, call `link_project_memory` automatically. Re-run full recall only when legacy facts were migrated. Outside Git, stay global-only.
4. **Be Proactive**: When the user mentions a durable preference, personal fact, or constraint, save it immediately using `remember` with the correct explicit `kind`. Do not wait for explicit user commands.
5. **Curate RAG Selectively**: Preserve important web findings and current technical documentation that the project is likely to need again, especially knowledge newer than model training. Ingest the relevant whole source or excerpt with project scope, not everything encountered, and link it to the project fact it supports. Use global scope only for intentionally cross-project sources.
6. **Check Knowledge Base First**: If a query depends on ingested specialized documentation, APIs, code, or project architecture, call `query_knowledge_base` using a concept-dense phrase. Do not use RAG for ordinary conversation or facts already present in Notebook memory. For multi-part queries, prefer `batch_query_knowledge_base`.
7. **Optimize Search Queries**: Transform the user's natural language question into targeted search queries. "Compare revenue in Q1 vs Q3" → `["Выручка план факт Q1 2025", "Выручка план факт Q3 2025"]`. Avoid raw conversational questions in RAG queries.
8. **Inspect Ambiguous Docs Directly**: If querying produces low relevance scores on abstractly named documents, call `manage_knowledge_base(action: "list")`, then `manage_knowledge_base(action: "read_document")` to inspect the full text.
9. **Keep Memory Clean**: If a preference changes, call `update_fact` to edit it in place, or `remember` with `supersedes` to keep a version trail. Use `keep: true` for facts that must survive accidental deletion, and give ephemeral facts a `ttl`.
10. **Resolve Context, Do Not Enforce Store Precedence**: Global and current-project facts are both evidence. If they conflict, reason over both; do not apply an automatic global-wins or project-wins rule.
11. **Leverage MCP Servers**: Use `list-mcp-tools` and `mcp-reminder` when unsure which connected platform tool fits the task.
