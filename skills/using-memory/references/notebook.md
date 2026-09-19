# Notebook Store Reference

Detailed reference for Layer 1 (Notebook Store) tools: `remember`, `recall`, `get_fact`, `update_fact`, `forget`, `memory_info`, `link_project_memory`, `unlink_project_memory`, `relink_project_memory`.

## What to Save

- **High-Signal Facts**: User name, role, language preferences, architectural constraints, framework choices, coding standards, test rules.

## Semantic Kind (MANDATORY)

- Use `kind: "fact"` for descriptive context such as identity, project architecture, versions, locations, and historical observations.
- Use `kind: "directive"` only for user-approved active personality, behavior, tone, communication style, preference, or working-convention instructions.
- Do not infer directive semantics from persuasive wording alone. Explicit `kind` is authoritative. Legacy stores without `kind` recognize persona/preference tags and `inject:1` only for backward compatibility.

## Formatting & Fact Titles

- Always translate the fact into clear, concise English before calling `remember`.
- **Always specify a descriptive `title` parameter** (a 2-5 word headline, e.g., `title: "Backend Framework Preference"`).
- Facts are stored in `**Title** — body` format. Initial session recall and auto-injected `<MEMORY>` blocks MUST include full fact bodies. Header-only recall was tested and rejected because it loses essential context. Use `mode: "headers"` only when the user explicitly asks for a compact inventory, never for session initialization.

## Targeting Project Directory (`directory`)

- Pass `directory: "<project directory path>"` (or `project`) when calling `remember` or `recall` to ensure the call routes to the target project store even when the MCP server runs in an external folder or outside Git.
- Example: `remember(title: "Backend Framework Preference", fact: "Use Fastify instead of Express for backend services", scope: "project", directory: "F:/projects/my-app")`

## Linking to Knowledge Base Documents

- Pass `docId` (or document title/path) and optional `startLine` / `endLine` when calling `remember` or `link_knowledge`.
- Example: `remember(title: "Backend Framework Preference", fact: "Use Fastify instead of Express for backend services", scope: "project", docId: "arch_specs.md", startLine: 5, endLine: 7)`
- Example: `link_knowledge(factText: "Use PostgreSQL 16 for primary persistence", docId: "database_guide.md", startLine: 20, endLine: 35, relationType: "IMPLEMENTS")`

## How Linked Memory Appears (`recall`)

When `recall` is invoked, the engine returns saved facts along with their Agent-linked Knowledge Base documents and exact line ranges:

```
--- memory_plugin ---
1. Use Fastify instead of Express for backend services 🔗 [Linked Docs: Project Architecture Specs:L5-7]
2. PostgreSQL 16 is primary database 🔗 [Linked Docs: database_guide.md:L20-35]
```

## Fact Line Format & Metadata

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

## Remember Options (`remember`)

- `kind`: `"fact"` (default descriptive context) or `"directive"` (active user-approved personalization/working instruction).
- `directory` / `project`: optional workspace/project directory path to target when saving project facts from outside cwd.
- `ttl`: "90d", "2w", "24h", "12m" — mark the fact for expiry; it will show `[EXPIRED]` once past.
- `keep: true`: protect the fact from `forget` (unless `force: true`).
- `tags`: comma-separated tags for later filtering, e.g. `"pref,arch"`.
- `supersedes`: number (as listed by `recall`), metadata `id`, or text of the fact this one replaces.

## Filtering & Viewing Facts (`recall` & `get_fact`)

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

## Scope Isolation and Conflicts

- `scope: "all"` returns the complete global store plus only the current Git project's store.
- Outside a Git repository, `scope: "all"` returns global memory only. It must not create a `null` project store.
- Memories from unrelated projects are never included in normal session initialization. Use the explicit `project` parameter only when the user asks to inspect another project.
- Global and project facts are both context sources. Neither store automatically overrides the other; if facts conflict, the agent evaluates the available context and decides how to proceed.

## Updating Facts (`update_fact`)

When the user corrects an old fact, prefer `update_fact` over `forget`+`remember` — it rewrites the text while preserving the original date and all metadata (`ttl`, `keep`, `tags`, `supersedes`), and re-points any linked Knowledge Base documents.

- `id`: recall index number, metadata `id`, or text of the fact.
- `newText`: replacement text.
- `kind`: optional reclassification to `"fact"` or `"directive"`; changing a global directive automatically resynchronizes managed client persona blocks.
- `scope`: "project" (default) or "global".

## Protecting Facts (`forget` with `keep`)

`forget` refuses to delete facts saved with `keep: true`; pass `force: true` to override. It still supports deleting by index number, range ("3-30"), or text.

## Project Memory Identity Management (`link_project_memory`, `unlink_project_memory`, `relink_project_memory`)

Project stores are bound to Git-based project identities (`git:<normalized remote>` or `git:local:<repo basename>`). Normal recall resolves the current identity automatically from Git and never scans unrelated project stores.

Use the identity tools as follows:

- `link_project_memory(directory, remote)`: Links a working directory to a Git identity, registers path/remote aliases, and automatically merges any legacy path-based stores.
- `unlink_project_memory(directory, purge)`: Removes the path alias link for a directory; set `purge: true` to purge the identity from SQLite.
- `relink_project_memory(directory, remote)`: Moves and merges memories from the current project identity to a new target remote URL identity.

## Storage Diagnostics (`memory_info`)

`memory_info` returns the package version, `MEMORY_DIR`, SQLite DB path, store-file locations, fact counts per store, current Git identity, its registry status (`linked`, `unlinked`, or `not-applicable`), and RAG stats (documents, sections, chunks, graph edges, links).