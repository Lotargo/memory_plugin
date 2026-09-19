---
name: using-memory
description: Persistent dual-layer memory engine with Notebook facts, curated RAG knowledge base, agent-driven knowledge graph, and general MCP helpers. Trigger proactively whenever user preferences, project conventions, technology stack choices, or architecture decisions are introduced, or when querying ingested documentation, indexing files/repos, managing persistent knowledge, looking up available MCP tool integrations, or handling ML model memory requests (CPU/RAM ↔ GPU/VRAM, idle auto-unload).
---

# Using Memory, Hybrid RAG Knowledge Engine & MCP Helper Tools

You have access to a persistent dual-layer memory engine supercharged with an **Agent-Driven Knowledge Graph** and general MCP integration helpers:
1. **Layer 1: Notebook Store (Key-Value Facts)**: Stores high-signal personal preferences, project conventions, and durable rules in clean Markdown.
2. **Layer 2: Curated RAG Knowledge Base**: Preserves selected external findings, documentation, repositories, and technical guides that are likely to matter again.
3. **Layer 3: Agent-Driven Knowledge Graph**: Connects Notebook facts (Layer 1) to specific Knowledge Base documents, sections, and **exact line ranges** (Layer 2).
4. **Integration Layer (General MCP Helpers)**: Quickly discovers connected MCP servers and identifies appropriate tools for specific tasks.

---

## Session Initialization (MANDATORY)

Follow this exact sequence at the start of every session:

1. If the client has already supplied an auto-injected `<MEMORY>` block (native OpenCode), treat the complete active memory as loaded and do **not** call `recall` again merely for initialization. In clients without auto-injection, your very first step MUST be `recall(scope: "all")` with full bodies and no restrictive filters — never `mode: "headers"`.
2. Apply entries marked `kind: "directive"` as active user-selected personalization or working instructions. Treat `kind: "fact"` entries as descriptive context.
3. Call `memory_info` for the current workspace.
4. If it reports `Identity: git` and `Registry: unlinked`, immediately call `link_project_memory` for the current directory.
5. If the link result reports `migrated: true`, call `recall(scope: "all")` again so the migrated facts enter the active context.
6. If it reports `Identity: no-git`, do not create project memory and do not invent a remote; continue with global memory only.

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

## Detailed References

Load the relevant reference file only when the task requires details beyond the matrix above:

| Reference | Contents |
|-----------|----------|
| `references/notebook.md` | What to save, `kind` semantics, formatting, targeting project directory, linking to KB documents, fact line format & metadata, `remember` options, filtering & viewing, scope isolation & conflicts, `update_fact`, `forget`/`keep`, project identity management (`link_project_memory`, `unlink_project_memory`, `relink_project_memory`), `memory_info` diagnostics |
| `references/rag.md` | `ingest_document` parameters & examples, scope isolation, shared sources, stable updates, hierarchy chunking, hybrid retrieval (`query_knowledge_base`), batch retrieval (`batch_query_knowledge_base`), query formulation rules (CRITICAL), reading ambiguous/abstract documents, `manage_knowledge_base` actions, `reindex_knowledge_base` |
| `references/knowledge-graph.md` | Agent-Driven Knowledge Graph architecture, how linked memory appears, linking strategies, relation types |
| `references/mcp-helpers.md` | `list-mcp-tools` for discovering connected MCP servers, `mcp-reminder` for contextual tool reminders |
| `references/models.md` | ML model memory management via `memory-cli models` — moving/unloading embedding & reranker models between CPU/RAM and GPU/VRAM, checking VRAM usage, configuring idle auto-unload |

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
