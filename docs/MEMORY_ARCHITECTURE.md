# Memory architecture and retrieval

[Documentation](README.md) · [Project overview](../README.md)

How Notebook facts, cold Memory Notes, external sources, Git scopes and retrieval fit together.

## Why This Project Exists

AI coding assistants forget user preferences, architectural decisions, investigations, and project context when a session ends. They also tend to mix very different kinds of information into one oversized prompt.

`@lotargo/memory_plugin` separates persistent knowledge into the right storage class:

| What you want to preserve | Tool | Storage behavior |
| :--- | :--- | :--- |
| Concise facts, preferences, constraints, conventions, and persona settings | `remember` | **Hot Notebook memory**; available during session initialization |
| Detailed decisions, research, investigations, experiments, and handoffs | `remember_note` | **Cold RAG Memory Note**; searchable but not injected into every session |
| Files, URLs, documentation, reports, specifications, and code | `ingest_document` | **Curated external knowledge** in the RAG index |

The same engine adds Git-based project isolation, semantic search, full raw-source expansion, explicit fact-to-document links, optional Turso synchronization, and native OpenCode auto-injection.

### Architecture at a Glance

<img src="https://raw.githubusercontent.com/Lotargo/memory_plugin/main/assets/02_project_evolution.png" alt="Evolution of memory_plugin from notebook memory through RAG, persona and cross-client agent state" width="100%">

### Highlights

- Human-readable Markdown Notebook facts with stable IDs, TTL, protection, tags, superseding, and explicit `fact` / `directive` semantics.
- Agent-authored long-form RAG Memory Notes for cold or episodic context.
- Hybrid SQLite FTS5 BM25 + local ONNX vector retrieval with RSF/RRF fusion.
- Compact semantic TOC discovery through `resultMode: "index"`, followed by deliberate full-source expansion.
- PDF, DOCX, XLSX/XLS/CSV, Markdown, text, HTML/URL, and source-code ingestion.
- Three-tier document hierarchy, retrieval-policy expansion for tables/code, and GraphRAG Lite symbol extraction.
- Git-identity project scopes that follow a repository across directories, machines, and operating systems.
- Active persona overlays shared across OpenCode, Codex, Claude Code, Gemini CLI, and Antigravity.
- Local-only working storage and full ZIP cloud checkpoints.
- Local web UI for Notebook records, instructions, project scopes, knowledge sources, settings, and reviewed maintenance.
- No Docker, external vector database, hosted embedding API, or telemetry.

> This is a practical agent-memory system, not a claim of generalized benchmark superiority. Repository benchmark results describe the included evaluation corpus and configuration.

## Memory Architecture

<img src="https://raw.githubusercontent.com/Lotargo/memory_plugin/main/assets/03_hot_memory_vs_cold_rag.png" alt="Hot persistent memory versus cold RAG retrieval architecture in memory_plugin" width="100%">

The architecture deliberately separates **small, always-useful context** from **large, on-demand knowledge**. This keeps session initialization useful without turning persistent memory into an ever-growing prompt.

### 1. Hot Notebook Memory

Notebook memory stores concise, high-signal context in Markdown:

```text
- [2026-08-22 10:00] **API Convention** — Use Fastify and Zod for new services <!-- id:a1b2c3, keep:1, tags:arch, kind:fact -->
```

Supported metadata includes:

- `id`: stable short identifier used by `get_fact`, `update_fact`, and `forget`.
- `kind`: `fact` for descriptive context or `directive` for active personalization/working instructions.
- `ttl`: `90d`, `2w`, `24h`, `12m`, or a bare day count. Expired entries are retained and marked `[EXPIRED]`.
- `keep`: protects an entry from ordinary deletion.
- `tags`: recall filters and legacy classification metadata.
- `supersedes` / `supersededBy`: preserves version history while excluding obsolete facts from active recall.

`recall(scope: "all")` returns global facts plus only the current Git-linked project's facts. Full bodies are the default and should be used for session initialization; `mode: "headers"` is only for compact inventories.

The result is bounded so it always fits a client's tool output: global facts and active directives are always complete, while project facts are a window of the 10 newest, newest first. Each truncated block ends with how many older entries are not shown. Agents ask for history themselves: `offset` skips the newest N, `limit` sets the page size (`0` returns everything; an explicit `limit` also applies to global facts), and `query`/`tags`/`since`/`until` narrow the search. Entry numbers stay the storage numbers used by `forget`, `update_fact` and `get_fact`.

### 2. Cold RAG Memory Notes

Use `remember_note` when the reusable value is in the detailed record itself:

```text
remember_note(
  title: "Authentication Investigation",
  content: "Detailed symptoms, experiments, rejected explanations, and final cause...",
  kind: "research",
  tags: "auth,incident",
  scope: "project"
)
```

Supported note kinds are `decision`, `research`, `context`, `handoff`, and `note`. Notes are represented as virtual RAG documents with stable `docId` and content-addressed `blobHash`. They are searchable with the same engine as external sources but are not injected into every session.

Recommended discovery flow:

```text
query_knowledge_base(query: "authentication token decryption investigation", resultMode: "index")
    -> inspect compact candidates and stable doc_id values
manage_knowledge_base(action: "read_document", docId: "selected-id")
    -> expand the complete raw note only when needed
```

Use `resultMode: "snippet"` when retrieved passages are immediately useful. Use `resultMode: "index"` when first identifying the correct source; index mode intentionally omits bodies and disables large policy expansion.

### 3. Curated External Knowledge

`ingest_document` accepts:

- Raw text or Markdown (`type: "text"`).
- Local files (`type: "file"`), including PDF, DOCX, XLSX, XLS, CSV, text, Markdown, and source code.
- Web pages (`type: "url"`), which are fetched and normalized instead of indexing the URL string.

RAG is a curated library, not an automatic archive. Ingest reliable sources likely to matter again, particularly current documentation or project specifications. Project scope is the default; use global scope only for intentionally reusable cross-project knowledge.

### Hot + Cold Linking

When a decision needs both quick orientation and detailed history:

1. Save the concise conclusion with `remember`.
2. Save the rationale or investigation with `remember_note`.
3. Connect them with `link_knowledge`, using the note's returned `docId`.

This keeps startup context small while preserving the complete reasoning trail without duplicating the note body into Notebook memory.

## Project Identity and Scope Isolation

Project memory is Git-first:

- Repositories with a remote use `git:<normalized-host-and-path>`, for example `git:github.com/owner/repo`.
- Repositories without a remote use `git:local:<repository-name>`.
- Every subdirectory of the same repository resolves to the same identity.
- Outside Git, project memory is not created; global memory remains available.

The SQLite identity registry stores remote, path, and basename aliases. It supports moving a repository between directories or operating systems without changing its logical memory identity.

| Tool | Purpose |
| :--- | :--- |
| `link_project_memory` | Register the detected Git identity and migrate compatible memory of this exact legacy directory path through the shared project service. |
| `unlink_project_memory` | Remove a path alias; optionally purge the identity record. |
| `relink_project_memory` | Move/merge facts and RAG scope data to a new normalized remote identity. |

For both Notebook and RAG retrieval, `all` means **global + current project**, never all known projects. Unrelated project memories and documents are isolated.

---

## Retrieval and Knowledge Graph

### Hybrid Retrieval

The local retrieval pipeline combines:

- SQLite FTS5 BM25 lexical search.
- Local ONNX dense embeddings (`Xenova/multilingual-e5-small` by default).
- RSF (default), RRF, semantic-only, or lexical-only ranking.
- Optional cross-encoder reranking.
- Batched query embeddings through `batch_query_knowledge_base`.
- Optional fixed vector dimensions and an experimental WebGPU execution mode.

Queries should be short, concept-dense phrases. For multi-part research or comparisons, use `batch_query_knowledge_base`; all query embeddings are computed in one ONNX pass.

### Three-Tier Chunking and Policy Expansion

Each document is partitioned into three retrieval levels: section-level big chunks, medium blocks, and micro chunks. Tables receive compact summaries and code blocks receive signature chunks. With `policyExpansion: true` (default), matching summaries/signatures expand to their full source blocks for content-rich retrieval. Set the configuration to `false` when pure micro-chunk precision is preferred.

Re-ingesting an updated path/URL preserves its stable document ID and knowledge links while rebuilding chunks, vectors, policies, and structural edges. Ingesting the same source in another scope adds a scope association without duplicating the document.

### GraphRAG Lite

The SQLite graph layer requires no external graph database or ingestion-time LLM:

| Relation | Meaning |
| :--- | :--- |
| `CONTAINS` | Document -> Section -> Micro Chunk graph hierarchy |
| `DEFINES_SYMBOL` | A document section defines an extracted code symbol |
| `LINKS_TO` and custom relations | A Notebook fact points to a document, note, section, or line range |

Code-symbol extraction covers JavaScript/TypeScript, Python, Go, Rust, C++, Java/Kotlin, C#, PHP, and Ruby patterns.
