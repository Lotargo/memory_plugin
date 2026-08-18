# PLAN: RAG Memory Notes — Cold/Episodic Memory & Semantic TOC Retrieval

> **Status:** Planned
> **Target release:** `1.7.0` (provisional; bump only after implementation and tests)
> **Branch strategy:** implement directly on `main`; release commits/tags remain the rollback checkpoints
> **Goal:** Add an agent-driven cold/episodic memory layer on top of the existing RAG engine so agents can preserve long-form decisions, research notes, investigations, handoffs, and contextual records without polluting the always-injected Notebook memory.

---

## 1. Motivation

The plugin already has two strong but intentionally different persistence layers:

1. **Notebook Memory** — small durable facts that are useful often enough to justify automatic context injection.
2. **RAG Knowledge Base** — external documents, code, URLs, office files, and other reusable sources that are retrieved only when needed.

There is currently a gap between them.

Some information is important enough to preserve, but too large, too contextual, or too episodic to belong in `global.md` / project Notebook memory:

- architecture discussions and the reasoning behind a decision;
- experiment results and rejected approaches;
- investigation notes;
- multi-step technical conclusions;
- project handoffs;
- implementation diaries;
- long user-provided context that may matter again later;
- detailed decisions where the short Notebook fact should only be an index/pointer;
- notes that should be searchable semantically but should **not** be injected into every conversation.

Today an agent has only two imperfect choices:

```text
remember(...)
  -> concise and always available
  -> but large notes pollute hot context

or

ingest_document(type="text", ...)
  -> technically works
  -> but semantically looks like document ingestion rather than agent memory
  -> agents have no clear instruction for when to use it as memory
```

The proposed feature makes this third category explicit.

---

## 2. Core Concept

Introduce **RAG Memory Notes** as an agent-controlled cold/episodic memory layer.

```text
                         MEMORY PLUGIN
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
   Notebook Memory       RAG Memory Notes     RAG Knowledge
     (hot facts)          (cold memory)        (sources)
          |                   |                   |
      remember()          remember_note()     ingest_document()
          |                   |                   |
          v                   +---------+---------+
 auto-injected context                  |
                                        v
                                Hybrid RAG engine
                             BM25 + dense vectors
                                      + graph
                                        |
                          +-------------+-------------+
                          |                           |
                          v                           v
                   compact/index search          raw expansion
                     (semantic TOC)             (full source)
```

The plugin still does **not** decide what deserves memory.

The host agent remains responsible for cognition and curation:

```text
Agent decides:
- whether something is worth preserving;
- whether it is a fact, note, or external source;
- the title and wording;
- project/global scope;
- note kind/tags;
- whether to link the note to a Notebook fact or another source.

Plugin provides:
- durable storage;
- provenance metadata;
- embeddings + BM25;
- project isolation;
- retrieval;
- raw expansion;
- graph links;
- synchronization;
- deletion/export/import.
```

This preserves the existing philosophy: **the plugin is a memory runtime, not a hidden background LLM.**

---

## 3. Memory Temperature Model

The feature formalizes a useful three-temperature model.

| Layer | Purpose | Typical size | Retrieval | Automatic injection |
|---|---|---:|---|---|
| **Hot — Notebook** | durable facts, preferences, constraints, conventions | 1–5 sentences | `recall` / `get_fact` | Yes |
| **Cold — RAG Notes** | decisions, investigations, research, episodic context | paragraph to many pages | semantic search → raw read | No |
| **Knowledge — RAG Documents** | external truth sources, codebases, docs, files, URLs | arbitrary | semantic search → source read | No |

Examples:

```text
remember(...)
"Production uses PostgreSQL 17 and migrations must remain reversible."

remember_note(...)
"Why PostgreSQL was chosen, alternatives tested, benchmark observations,
rejected SQLite approach, migration risks, and follow-up decisions..."

ingest_document(...)
PostgreSQL documentation / ADR file / benchmark report / source code
```

A Notebook fact may optionally link to the detailed note later:

```text
Notebook fact
   "OCR + Vision is the chosen extraction architecture"
          |
          | EXPLAINS / REFERENCES
          v
RAG Memory Note
   "Decision: OCR + Vision architecture — experiments, rejected variants..."
          |
          | REFERENCES
          v
RAG documents / source files / line ranges
```

---

## 4. Existing Foundation — Already Implemented

The feature should reuse the current architecture instead of adding a second storage/search engine.

| Capability | Status | Current implementation |
|---|:---:|---|
| Raw text ingestion | ✅ | `ingest_document(type="text")` |
| Stable document IDs | ✅ | `documents.id` (`doc_*`) |
| Raw truth storage | ✅ | content-addressed blob store via `blob_hash` |
| Document metadata | ✅ | `documents.metadata_json` |
| Project/global RAG scopes | ✅ | `document_scopes` |
| Git-based project identity | ✅ | `project_identities` / aliases |
| Big → Medium → Small hierarchy | ✅ | `mcp-server/ingest/chunker.js` |
| Sentence-window chunking for prose | ✅ | ~150 token windows + sentence overlap |
| SQLite FTS5 BM25 | ✅ | `micro_chunks_fts` |
| Dense embeddings | ✅ | local ONNX embedding models |
| Hybrid fusion | ✅ | RSF / RRF |
| Optional reranker | ✅ | cross-encoder reranking |
| Parent/policy deduplication | ✅ | `hybridQuery()` post-processing |
| Policy-based compact → full expansion | ✅ | `table_summary` / `code_signature` → `medium_chunks` |
| Graph edges | ✅ | `graph_edges` |
| Notebook ↔ document links | ✅ | `knowledge_links` / `link_knowledge` |
| Full raw document read | ✅ | `manage_knowledge_base(action="read_document")` |
| Delete/unlink by scope | ✅ | `manage_knowledge_base(action="delete")` |
| Snapshot export/import | ✅ | existing RAG snapshot system |
| Local / cloud / hybrid sync | ✅ | SQLite + Turso/LibSQL modes |
| MCP + native OpenCode surfaces | ✅ | shared architecture, separate tool surfaces |

### Important observation

The current code already contains the central retrieval pattern required by cold memory:

```text
small searchable representation
          |
          v
      retrieval hit
          |
          v
expand larger truth source
```

It is currently used for `table_summary` and `code_signature` policies.

RAG Memory Notes extend the same philosophy from **document structure** to **agent memory lifecycle**.

---

## 5. Desired Agent UX

### 5.1. Save a hot fact

```text
remember(
  title="Metall extraction architecture",
  fact="Use OCR for text/tables and Vision for drawing/image interpretation.",
  scope="project",
  tags="architecture,ocr,vision"
)
```

Use when the information is concise, durable, and useful often enough to deserve automatic injection.

### 5.2. Save cold/episodic memory

```text
remember_note(
  title="Decision: OCR + Vision hybrid architecture",
  content="""
  We tested Vision-only, OCR-only, and OCR + non-Vision LLM variants...
  [full reasoning, measurements, rejected paths, constraints, next steps]
  """,
  kind="decision",
  tags="architecture,ocr,vision,models",
  scope="project"
)
```

The note is indexed but is **not** inserted into the normal Notebook prompt.

### 5.3. Use RAG as a semantic table of contents

```text
query_knowledge_base(
  query="why did we reject vision-only extraction",
  resultMode="index",
  scope="project"
)
```

Expected compact result:

```text
[1]
doc_id: doc_a81f32
title: Decision: OCR + Vision hybrid architecture
source_type: note
kind: decision
tags: architecture, ocr, vision, models
score: 0.8462
updated_at: 2026-08-19T...

[2]
doc_id: doc_92c140
title: OCR benchmark notes
source_type: note
kind: research
score: 0.7211
```

No long body is returned in `index` mode.

### 5.4. Expand only the selected memory

```text
manage_knowledge_base(
  action="read_document",
  docId="doc_a81f32",
  scope="project"
)
```

Only then is the full raw note loaded into context.

This is the key token-efficiency property:

```text
semantic TOC -> candidate selection -> raw expansion
```

instead of:

```text
inject every possibly useful memory -> hope attention finds the right one
```

---

## 6. Storage Design

### Decision: reuse `documents`; do not create a separate `notes` RAG

A RAG Memory Note is a specialized virtual document.

Proposed representation:

```text
documents
  id:            doc_a81f32
  path:          memory://note/<uuid>
  title:         Decision: OCR + Vision hybrid architecture
  blob_hash:     <content hash>
  metadata_json:
    {
      "source_type": "note",
      "note_kind": "decision",
      "tags": ["architecture", "ocr", "vision", "models"]
    }
```

Raw note body remains in the existing blob store.

The normal RAG hierarchy remains unchanged:

```text
note body
  -> sections
  -> medium_chunks
  -> micro_chunks
  -> FTS5 + vectors
```

### Why reuse `documents`

- no duplicate vector index;
- no duplicate FTS implementation;
- scopes work automatically;
- snapshots work naturally;
- Turso synchronization can reuse existing document payloads;
- deletion/unlink semantics already exist;
- graph infrastructure already points at document IDs;
- long notes automatically benefit from current chunking;
- raw content already has a content-addressed truth store;
- external docs and internal notes can participate in one retrieval query when useful.

---

## 7. Metadata Contract

Minimum note metadata:

```json
{
  "source_type": "note",
  "note_kind": "decision",
  "tags": ["architecture", "ocr"]
}
```

### Initial `note_kind` values

| Kind | Intended content |
|---|---|
| `decision` | decision + rationale + rejected alternatives |
| `research` | experiments, comparisons, benchmark/investigation notes |
| `context` | long-lived contextual information that is not a concise fact |
| `handoff` | state required to resume work in another session/agent |
| `note` | generic fallback |

Keep the enum intentionally small. Tags provide flexible classification without turning metadata into an ontology project.

### Future metadata candidates — not required for MVP

- `supersedes_doc_id`
- `related_doc_ids`
- `source_conversation_id`
- explicit confidence
- author/agent identity
- pinned/protected note
- note TTL
- external provenance URI

These should be added only when a concrete use case requires them.

---

## 8. Tool Contract

### 8.1. New tool: `remember_note`

Proposed arguments:

```text
remember_note
  title: string                 required
  content: string               required
  scope: project | global       default project
  kind: decision | research | context | handoff | note
                                default note
  tags: string                  optional comma-separated tags
  directory: string             optional explicit project target
  project: string               alias for directory
  generateEmbeddings: boolean   default true
```

Expected result:

```json
{
  "status": "success",
  "docId": "doc_a81f32...",
  "title": "Decision: ...",
  "sourceType": "note",
  "kind": "decision",
  "tags": ["architecture", "ocr"],
  "scope": "git:github.com/...",
  "sectionsCount": 3,
  "microChunksCount": 9
}
```

### Tool-description rule

The description must teach the agent the routing policy:

```text
Use remember() for concise durable facts that should be available in hot memory.
Use remember_note() for important long-form or episodic context that should be
retrievable later but should not be injected into every session.
Use ingest_document() for external/reusable truth sources such as files, URLs,
documentation, and codebases.
```

This routing instruction is part of the feature, not documentation polish.

---

## 9. Retrieval Contract

### 9.1. Add stable `doc_id` to retrieval results

Current retrieval output contains `chunk_id`, title/path, heading, breadcrumbs, snippets, scores, etc.

The result must additionally expose the parent document ID:

```text
doc_id: doc_a81f32
```

This creates a deterministic retrieval chain:

```text
query -> doc_id -> raw read
```

The agent should never need to guess a title or path to expand a result.

### 9.2. Add `resultMode`

Initial modes:

| Mode | Behavior | Compatibility |
|---|---|---|
| `snippet` | current behavior: ranked result + useful retrieved content | default, preserves existing callers |
| `index` | metadata/TOC only; no long body | new |

Do **not** change the default behavior in the first release.

### `index` mode should return

- rank;
- `doc_id`;
- title;
- source type (`note`, `file`, `url`, `text`, etc.);
- note kind when applicable;
- tags when available;
- heading/breadcrumb when useful;
- relevance score;
- created/updated timestamps when available;
- retrieval policy if relevant.

### `index` mode should not return

- full section content;
- paragraph context;
- expanded tables/functions;
- raw note body;
- large snippets.

### Why `resultMode`, not a separate search tool

The ranking operation is identical. A second search implementation would create drift.

One retrieval engine should choose candidates; presentation controls how much context is returned.

---

## 10. Optional Source-Type Filtering

A useful but non-blocking follow-up is a retrieval filter:

```text
source: all | notes | documents
```

Possible semantics:

- `all` — notes + external documents (default);
- `notes` — only `source_type = note`;
- `documents` — exclude RAG Memory Notes.

This can prevent large document corpora from drowning episodic notes for queries such as:

```text
"what did we decide about database migration?"
```

### Implementation warning

Do not introduce source filtering until it is implemented identically for:

- BM25 search;
- vector search;
- batch search;
- project/global scope isolation;
- MCP and OpenCode surfaces.

A filter that affects only one retrieval branch would silently corrupt hybrid ranking.

---

## 11. Graph Integration

No background graph-building model is required.

### Existing model remains agent-driven

The agent may create:

```text
Notebook fact
    |
    | EXPLAINS
    v
RAG Memory Note
```

using the existing `link_knowledge` document-link mechanism because notes have normal `docId`s.

A note may also contain references to external sources that are independently indexed.

### Phase-2 graph possibilities

Only after the basic note layer is stable, consider explicit note ↔ document/note edges:

```text
note A --REFERENCES--> document B
note A --SUPERSEDES--> note C
note A --IMPLEMENTS--> source file D
```

Avoid automatic semantic graph generation in the first implementation.

The main agent already has the intelligence required to decide relations; duplicating it with a hidden background LLM would increase cost, latency, and disagreement risk.

---

## 12. Prompt / Agent Policy Changes

The current memory instruction correctly says not to store full turns or transient details in Notebook memory.

It should be extended with a routing section similar to:

```text
MEMORY ROUTING DIRECTIVE:
- Use remember for concise durable facts that should remain hot and frequently visible.
- Use remember_note for high-value long-form decisions, investigations, research,
  handoffs, or episodic context that may be needed later but should not be auto-injected.
- Use ingest_document for external source material such as files, documentation,
  codebases, URLs, reports, or specifications.
- Do not duplicate the same long body into Notebook memory and RAG Notes.
- When useful, keep a concise Notebook fact and link it to the detailed RAG Note.
```

This is required on every supported integration surface that carries plugin instructions.

---

## 13. Implementation Plan

### Phase 0 — Design & Compatibility Baseline

- [x] Confirm raw text can already be ingested into the RAG pipeline
- [x] Confirm raw RAG content is stored separately and can be read by document ID/title/path
- [x] Confirm project-scoped RAG already uses Git identity
- [x] Confirm long prose already receives sentence-window chunking
- [x] Confirm graph links target normal RAG document IDs
- [x] Confirm snapshot/export payloads already include document metadata, chunks, graph edges, and scopes
- [ ] Capture baseline tool counts and relevant tests before implementation
- [ ] Decide final feature name (`RAG Memory Notes` / `Cold Memory Notes`)

### Phase 1 — Note Ingestion Core

- [ ] Add a reusable note-ingestion helper instead of duplicating `ingestDocument()` logic
- [ ] Generate a unique `memory://note/<uuid>` virtual path
- [ ] Allow ingestion metadata overrides/extension without changing existing document behavior
- [ ] Store `source_type = note`
- [ ] Store `note_kind`
- [ ] Normalize comma-separated tags into a stable metadata representation
- [ ] Preserve normal project/global scope behavior
- [ ] Ensure re-ingestion/dedup behavior cannot accidentally overwrite another note
- [ ] Return stable `docId` and note metadata

### Phase 2 — `remember_note` Tool

- [ ] Register `remember_note` on the MCP server
- [ ] Register `remember_note` in native OpenCode plugin
- [ ] Keep argument semantics identical on both surfaces
- [ ] Add clear routing guidance to tool descriptions
- [ ] Add input validation for empty title/content
- [ ] Add `kind` enum with safe fallback
- [ ] Add `generateEmbeddings` compatibility for offline/tests
- [ ] Verify global note creation outside a Git repository
- [ ] Verify project note creation rejects/handles missing project identity consistently with existing RAG behavior

### Phase 3 — Retrieval Identity (`doc_id`)

- [ ] Add parent `doc_id` to `hybridQuery()` result objects
- [ ] Carry `doc_id` through snippet-mode formatting
- [ ] Carry `doc_id` through batch-query results
- [ ] Add document metadata (`metadata_json`) to retrieval detail lookup
- [ ] Parse metadata defensively (invalid/legacy JSON must not break retrieval)
- [ ] Expose source type / note kind / tags in normalized result objects

### Phase 4 — Semantic TOC / `resultMode="index"`

- [ ] Add `resultMode` schema to MCP `query_knowledge_base`
- [ ] Add identical `resultMode` support to OpenCode `query_knowledge_base`
- [ ] Preserve `snippet` as the default
- [ ] Implement compact index formatter
- [ ] Ensure `index` mode does not perform unnecessary large content formatting
- [ ] Ensure `index` results always expose `doc_id`
- [ ] Include note metadata without returning note body
- [ ] Add `resultMode` support to `batch_query_knowledge_base`
- [ ] Keep batch and single-query output semantics aligned
- [ ] Verify table/code policy expansion does not leak large bodies in `index` mode

### Phase 5 — Raw Expansion Workflow

- [ ] Verify `manage_knowledge_base(read_document)` works with `memory://note/*`
- [ ] Return note metadata from `read_document` in addition to raw content
- [ ] Verify raw read respects project/global visibility
- [ ] Verify raw read works after local restart
- [ ] Verify raw read works in cloud-only mode
- [ ] Verify raw read works after hybrid reverse-sync
- [ ] Decide whether an ergonomic `read_knowledge` / `get_note` alias is actually necessary; do not add one unless agent UX proves awkward

### Phase 6 — Note Management

- [ ] Make `manage_knowledge_base(list)` expose source type and note metadata
- [ ] Verify scope unlink/delete works for notes shared across scopes
- [ ] Verify deleting a note removes chunks, FTS rows, graph edges, and orphaned blob when appropriate
- [ ] Verify no Notebook fact is deleted when a linked note is deleted
- [ ] Verify `link_knowledge` can link a Notebook fact to a RAG Memory Note
- [ ] Verify re-ingesting unrelated documents does not invalidate note links

### Phase 7 — Optional Source Filtering

- [ ] Decide from tests whether source filtering is required for v1.7.0
- [ ] If required, define `source: all | notes | documents`
- [ ] Apply the filter identically to BM25 search
- [ ] Apply the filter identically to vector search
- [ ] Apply the filter to batch retrieval
- [ ] Preserve existing scope behavior
- [ ] Test mixed note/document corpora for ranking regressions

> If filtering is not required by observed retrieval quality, defer this entire phase rather than adding speculative complexity.

### Phase 8 — Agent Memory Routing Instructions

- [ ] Update shared/installed memory instructions with Notebook vs Note vs Document routing
- [ ] Keep `remember` guidance strict: concise durable facts only
- [ ] Add `remember_note` examples for decisions/research/handoffs
- [ ] Warn against saving transient conversational noise
- [ ] Warn against duplicating a full note into Notebook memory
- [ ] Recommend concise Notebook fact + linked detailed note when both hot and cold memory are useful
- [ ] Verify instructions are consistent across OpenCode, Codex, Claude Code, and Antigravity setup surfaces

### Phase 9 — Sync / Export / Import

- [ ] Verify note metadata survives document export
- [ ] Verify note metadata survives snapshot export/import
- [ ] Verify raw note blob survives snapshot export/import
- [ ] Verify note scopes survive snapshot export/import
- [ ] Verify note graph links survive snapshot export/import
- [ ] Verify `only-local`
- [ ] Verify `only-cloud`
- [ ] Verify `hybrid-sync`
- [ ] Verify reverse-sync restores notes without duplicate document IDs
- [ ] Add migration only if implementation requires schema changes; prefer metadata-only design if possible

### Phase 10 — Tests

- [ ] Unit: note metadata normalization
- [ ] Unit: unique virtual note path generation
- [ ] Unit: empty/invalid note validation
- [ ] Unit: retrieval result contains `doc_id`
- [ ] Unit: metadata parser handles legacy/null/malformed values safely
- [ ] Unit: `index` formatting excludes large body fields
- [ ] Unit: `snippet` mode remains backward compatible
- [ ] Unit: batch index mode mirrors single-query semantics
- [ ] Integration: create short note → retrieve → raw read
- [ ] Integration: create long note → chunk → retrieve relevant interior passage → raw read entire note
- [ ] Integration: project note does not leak to unrelated project
- [ ] Integration: global note is visible from project `scope=all`
- [ ] Integration: note and external document can coexist in one result set
- [ ] Integration: delete note cleans index and blob references correctly
- [ ] Integration: Notebook fact links to note and survives retrieval
- [ ] Integration: MCP tool surface
- [ ] Integration: native OpenCode tool surface
- [ ] Regression: current document ingestion unchanged
- [ ] Regression: table/code policy retrieval unchanged
- [ ] Regression: existing Notebook injection unchanged
- [ ] Smoke: real ONNX embeddings retrieve a semantically phrased note
- [ ] Run complete existing test suite

### Phase 11 — Retrieval Quality Evaluation

Create a small synthetic episodic-memory corpus with deliberately similar topics.

Example notes:

```text
- Decision: switch from Vision-only to OCR + Vision
- Research: OCR provider comparison
- Context: CAD parsing investigation
- Decision: keep SQLite local-first storage
- Handoff: remaining sync bug investigation
```

Queries should test:

- paraphrased decision recall;
- cross-lingual retrieval where applicable;
- distinction between related research and final decision;
- project isolation;
- notes vs external source competition;
- compact index ranking;
- raw expansion correctness.

Checklist:

- [ ] Add a dedicated RAG-note evaluation fixture
- [ ] Add at least 10 semantic note-retrieval queries
- [ ] Measure Top-1 / Top-3 hit rate
- [ ] Record false-positive patterns
- [ ] Confirm index mode materially reduces returned context size
- [ ] Confirm no regression in existing document benchmark categories

### Phase 12 — Documentation

- [ ] Update README architecture from 3 layers to include RAG Memory Notes explicitly (without misleadingly inventing an extra storage engine)
- [ ] Add `remember_note` to tool tables
- [ ] Update MCP/OpenCode tool counts
- [ ] Document Notebook vs RAG Note vs RAG Document routing
- [ ] Add semantic TOC / raw expansion example
- [ ] Document `resultMode=index`
- [ ] Document note kinds/tags
- [ ] Document privacy/local-first behavior for notes
- [ ] Update any skills/prompts that enumerate available tools

### Phase 13 — Release Preparation

- [ ] All new tests pass
- [ ] Existing suite passes
- [ ] No unexpected tool-surface mismatch
- [ ] `memory_plugin doctor --codex` still passes
- [ ] Manual local test in at least one real coding agent
- [ ] Manual test of save → restart → search → raw expand
- [ ] Manual test in a Git project and outside Git
- [ ] Review Git diff for accidental unrelated changes
- [ ] Mark completed tasks in this plan
- [ ] Bump package version (expected `1.7.0` for the new user-facing feature)
- [ ] Add CHANGELOG entry with migration/compatibility notes
- [ ] Update README version-sensitive counts/text
- [ ] Commit release checkpoint to `main`
- [ ] User performs final local validation
- [ ] User publishes GitHub release
- [ ] User publishes npm package

---

## 14. Proposed Code Touchpoints

Expected primary files:

```text
mcp-server/
  ingest/
    pipeline.js                note metadata / reusable ingestion path
  retrieval/
    retriever.js               doc_id + metadata in normalized hits
  tools/
    rag_tools.js               remember_note + resultMode
  graph/
    knowledge_linker.js        likely no structural change; verify compatibility

opencode-plugin/
  index.js                     native remember_note + resultMode + prompt routing

tests/
  unit/
  integration/
  smoke/

docs/
  PLAN_RAG_MEMORY_NOTES.md     this plan

README.md                      final documentation / tool counts
CHANGELOG.md                   release notes after implementation
package.json                   version bump only after tests
```

Potentially affected depending on implementation details:

```text
mcp-server/admin/snapshot.js
mcp-server/ingest/exporter.js
mcp-server/db/sync_queue.js
skills/*
setup/prompt installation code
```

Avoid touching DB migrations unless a real schema requirement appears. `metadata_json` should be sufficient for the first implementation.

---

## 15. Backward Compatibility Rules

The feature must be additive.

- `remember` behavior remains unchanged.
- Notebook files remain human-readable Markdown.
- Existing Notebook injection remains unchanged except for new routing instructions.
- Existing `ingest_document` behavior remains unchanged.
- Existing RAG documents require no re-indexing solely because notes exist.
- Existing `query_knowledge_base` callers receive current snippet behavior by default.
- `resultMode=index` is opt-in.
- Existing `manage_knowledge_base` actions remain valid.
- Existing document IDs and graph links remain valid.
- Existing snapshots should import successfully.
- New snapshots should degrade predictably on older versions where possible; release notes must state any one-way compatibility limitation if discovered.
- No external LLM/API dependency may be introduced for note creation or classification.

---

## 16. Failure Modes to Guard Against

### 16.1. Turning RAG Notes into a second `global.md`

Bad behavior:

```text
agent saves every turn as a note
```

Result: noisy retrieval corpus and degraded ranking.

Mitigation: tool descriptions and prompts must explicitly require **high-signal reusable context**.

### 16.2. Duplicate hot + cold memory

Bad behavior:

```text
remember(full 2,000-token explanation)
remember_note(the same 2,000-token explanation)
```

Preferred behavior:

```text
remember("OCR + Vision is the chosen architecture")
       |
       +-- EXPLAINS --> remember_note(full decision record)
```

### 16.3. `index` mode accidentally returning expanded policy bodies

Table/code policy expansion currently intentionally returns full source context.

`resultMode=index` must bypass presentation of that expanded body even when the winning hit is a `table_summary` or `code_signature`.

### 16.4. Losing retrieval identity

If a result does not expose `doc_id`, the agent may have to re-search by title/path and can expand the wrong object.

`doc_id` is therefore a correctness requirement, not a convenience field.

### 16.5. Scope leaks

A note created inside repository A must never appear in repository B under project-only retrieval.

Global notes remain intentionally cross-project.

### 16.6. Hidden background intelligence

Do not add an implicit summarizer/classifier LLM.

The feature must remain:

- local-first;
- deterministic at the storage layer;
- provider-neutral;
- agent-driven;
- usable offline with lexical retrieval when embeddings are disabled/cached constraints apply.

---

## 17. Success Criteria

The feature is complete when all of the following are true:

- [ ] An agent can save a long decision without adding it to Notebook auto-injection.
- [ ] The note survives restart and remains project/global scoped correctly.
- [ ] A paraphrased semantic query can discover the note.
- [ ] `resultMode=index` returns a compact candidate list with stable `doc_id` values.
- [ ] The agent can expand exactly one selected candidate into its full raw content.
- [ ] Existing document RAG still behaves as before in default mode.
- [ ] Existing Notebook memory still behaves as before.
- [ ] Notes participate in existing graph/document-link workflows.
- [ ] Notes survive supported sync/export/import modes.
- [ ] MCP and OpenCode expose equivalent core behavior.
- [ ] Tests demonstrate project isolation and no accidental hot-context injection.
- [ ] Documentation clearly teaches agents/users which memory layer to use.

### Context-efficiency target

For a corpus containing multiple long notes, a navigation query in `index` mode should return enough metadata to choose the right memory **without returning the raw note bodies**.

The intended sequence is always:

```text
search cheaply
    -> inspect candidates
        -> expand deliberately
```

---

## 18. Future Extensions — Explicitly Out of Scope for First Release

These ideas fit the architecture but should not delay the first useful version:

- automatic note summarization by a background LLM;
- automatic conversation compaction into notes;
- automatic semantic graph generation;
- autonomous conflict/supersession detection;
- temporal graph reasoning;
- note TTL / archival temperature transitions;
- automatic Notebook promotion/demotion;
- note-to-note backlinks inferred by embeddings;
- full conversation transcript ingestion by default;
- hidden provider API calls.

The first release should prove that **agent-authored cold memory + semantic TOC + deliberate raw expansion** is useful on its own.

---

## 19. Design Principle

The plugin should not attempt to become a magical creature that secretly decides what the agent remembers.

It should give the agent better memory primitives.

```text
remember       = hot durable fact
remember_note  = cold durable episode / reasoning record
ingest_document = external knowledge source
query(index)   = semantic table of contents
read_document  = deliberate raw expansion
link_knowledge = provenance / explanation bridge
```

The intelligence remains in the agent.

The plugin makes that intelligence **persistent, searchable, scoped, inspectable, and portable across agents**.
