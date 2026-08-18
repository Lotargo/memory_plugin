# PLAN: RAG Memory Notes — Cold/Episodic Memory & Semantic TOC Retrieval

> **Status:** In progress — Phases 0–6 implementation complete; Phase 7 intentionally deferred to evaluation; Phase 8 complete; Phase 9 implementation complete; Phase 10 test coverage implemented, execution pending
> **Target release:** `1.7.0` (provisional; bump only after implementation and tests)
> **Branch strategy:** implement directly on `main`; release commits/tags remain the rollback checkpoints
> **Goal:** Add an agent-driven cold/episodic memory layer on top of the existing RAG engine so agents can preserve long-form decisions, research notes, investigations, handoffs, and contextual records without polluting the always-injected Notebook memory.

---

## 1. Motivation

The plugin already has two strong but intentionally different persistence layers:

1. **Notebook Memory** — small durable facts that are useful often enough to justify automatic context injection.
2. **RAG Knowledge Base** — external documents, code, URLs, office files, and other reusable sources that are retrieved only when needed.

There is a useful category between them.

Some information is important enough to preserve, but too large, contextual, or episodic to belong in `global.md` / project Notebook memory:

- architecture discussions and the reasoning behind a decision;
- experiment results and rejected approaches;
- investigation notes;
- multi-step technical conclusions;
- project handoffs;
- implementation diaries;
- long user-provided context that may matter again later;
- detailed decisions where a short Notebook fact should only be a hot pointer;
- notes that should be searchable semantically but should **not** be injected into every conversation.

Before this feature an agent had two imperfect choices:

```text
remember(...)
  -> concise and always available
  -> but large notes pollute hot context

or

ingest_document(type="text", ...)
  -> technically works
  -> but semantically looks like document ingestion rather than agent memory
  -> agents have no explicit primitive for long-form internal memory
```

RAG Memory Notes make the third category explicit without adding a hidden background model.

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
- title and wording;
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

Design rule: **the plugin is a memory runtime, not a hidden background LLM.**

---

## 3. Memory Temperature Model

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

A Notebook fact may later point to a detailed note:

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

## 4. Existing Foundation — Reused, Not Rebuilt

The feature reuses the current architecture instead of adding a second storage/search engine.

| Capability | Status | Current implementation |
|---|:---:|---|
| Raw text ingestion | ✅ | `ingest_document(type="text")` |
| Stable document IDs | ✅ | `documents.id` (`doc_*`) |
| Raw truth storage | ✅ | content-addressed local gzip blob store via `blob_hash` |
| Portable cloud raw truth | ✅ | content-addressed `rag_blobs` transport table, gzip Base64 payload |
| Cross-device deletion propagation | ✅ | `rag_document_tombstones` |
| Document metadata | ✅ | `documents.metadata_json` |
| Project/global RAG scopes | ✅ | `document_scopes` |
| Git-based project identity | ✅ | project identities / aliases |
| Big → Medium → Small hierarchy | ✅ | `mcp-server/ingest/chunker.js` |
| Sentence-window chunking for prose | ✅ | existing prose chunker |
| SQLite FTS5 BM25 | ✅ | `micro_chunks_fts` |
| Dense embeddings | ✅ | local ONNX embedding models |
| Hybrid fusion | ✅ | RSF / RRF |
| Optional reranker | ✅ | cross-encoder reranking |
| Parent/policy deduplication | ✅ | `hybridQuery()` post-processing |
| Compact → full policy expansion | ✅ | `table_summary` / `code_signature` |
| Graph edges | ✅ | `graph_edges` |
| Notebook ↔ document links | ✅ | `knowledge_links` / `link_knowledge` |
| Full raw document read | ✅ | shared `readKnowledgeDocument()` behind `manage_knowledge_base(read_document)` |
| Metadata-aware document/note list | ✅ | shared `listKnowledgeDocuments()` |
| Delete/unlink by scope | ✅ | existing RAG management |
| Snapshot export/import including raw blobs | ✅ | existing snapshot v3 path |
| Local / cloud / hybrid DB modes | ✅ | SQLite + Turso/LibSQL modes |
| Hybrid RAG reverse-sync | ✅ | document hierarchy + scopes + graph + links + raw blob materialization |
| Legacy raw-blob cloud backfill | ✅ | content-addressed backfill on cloud/hybrid DB open |
| Tombstone-aware legacy backfill | ✅ | stale machines do not re-upload deleted raw payloads |
| MCP + native OpenCode surfaces | ✅ | shared core, separate presentation surfaces |

The existing engine already uses the central pattern needed for cold memory:

```text
small searchable representation
          |
          v
      retrieval hit
          |
          v
expand larger truth source
```

RAG Memory Notes extend that idea from document structure to agent memory lifecycle.

---

## 5. Desired Agent UX

### 5.1 Save a hot fact

```text
remember(
  title="Metall extraction architecture",
  fact="Use OCR for text/tables and Vision for drawing/image interpretation.",
  scope="project",
  tags="architecture,ocr,vision"
)
```

Use when information is concise, durable, and useful often enough to deserve hot-context availability.

### 5.2 Save cold/episodic memory

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

The note is indexed but **not** inserted into the normal Notebook prompt.

### 5.3 Use RAG as a semantic table of contents

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

No long body should be returned in `index` mode.

### 5.4 Expand only the selected memory

```text
manage_knowledge_base(
  action="read_document",
  docId="doc_a81f32",
  scope="project"
)
```

Only then is the full raw note loaded into context together with normalized source metadata. In cloud-backed modes a missing local raw blob is materialized from the portable cloud blob and SHA-256 verified before use.

Key token-efficiency property:

```text
semantic TOC -> candidate selection -> raw expansion
```

instead of:

```text
inject every possibly useful memory -> hope attention finds the right one
```

---

## 6. Storage & Transport Design

### Decision: reuse `documents`; do not create a separate notes database/RAG

A RAG Memory Note is a specialized virtual document.

```text
documents
  id:            doc_a81f32
  path:          memory://note/<uuid>
  title:         Decision: OCR + Vision hybrid architecture
  blob_hash:     <sha256>
  metadata_json:
    {
      "source_type": "note",
      "note_kind": "decision",
      "tags": ["architecture", "ocr", "vision", "models"]
    }
```

Raw note body remains content-addressed:

```text
local filesystem
  storage/blobs/<prefix>/<sha256>.raw.gz

Turso transport/cache
  rag_blobs
    hash        PRIMARY KEY
    gzip_base64 compressed payload
    raw_size
    created_at
```

Transport properties:

- the SHA-256 remains the storage identity;
- cloud payload stays gzip-compressed;
- Base64 TEXT avoids driver-specific BLOB coercion problems;
- `saveBlobTransport()` decompresses and validates SHA-256 before materializing a file;
- duplicate documents/notes sharing raw content reuse one cloud blob hash;
- orphan cloud blobs are removed only when no document still references the hash;
- documents created before this feature are backfilled when a cloud-backed database is opened and their local raw blob still exists;
- a deletion tombstone newer than a stale local document blocks legacy backfill, preventing deleted raw payloads from being re-uploaded by another machine.

The normal RAG hierarchy remains unchanged:

```text
note body
  -> sections
  -> medium_chunks
  -> micro_chunks
  -> FTS5 + vectors
```

### Hybrid reverse-sync

Before this work, reverse-sync restored Notebook Markdown only. RAG was written to Turso but not rebuilt into the local hybrid SQLite copy on another machine.

The new path restores:

```text
Turso
  documents
  document_scopes
  sections
  medium_chunks
  micro_chunks + vectors
  graph_edges
  knowledge_links
  rag_blobs
      |
      v
hybrid reverse-sync
      |
      v
local SQLite + local gzip blob store
```

Remote documents are merged by stable document ID/path and `updated_at`. A newer local copy is not overwritten by an older cloud copy.

Deletion uses tombstones:

```text
device A delete
    -> local delete
    -> cloud delete
    -> rag_document_tombstones(doc_id, path, deleted_at)

machine B reverse-sync
    -> tombstone wins over older local document
    -> structural rows / links / graph / FTS removed
    -> orphan local blob cleaned
```

Re-ingesting a newer document clears its tombstone.

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

Initial `note_kind` values:

| Kind | Intended content |
|---|---|
| `decision` | decision + rationale + rejected alternatives |
| `research` | experiments, comparisons, benchmark/investigation notes |
| `context` | durable context that is too large for a concise fact |
| `handoff` | state required to resume work in another session/agent |
| `note` | generic fallback |

The enum stays intentionally small. Tags provide flexible classification without turning metadata into an ontology project.

Future metadata candidates — explicitly not required for the first release:

- `supersedes_doc_id`;
- `related_doc_ids`;
- `source_conversation_id`;
- confidence;
- author/agent identity;
- pinned/protected note;
- note TTL;
- external provenance URI.

---

## 8. Tool Contract

### `remember_note`

Implemented core arguments:

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

Expected result shape:

```json
{
  "status": "success",
  "docId": "doc_a81f32...",
  "path": "memory://note/...",
  "title": "Decision: ...",
  "sourceType": "note",
  "kind": "decision",
  "tags": ["architecture", "ocr"],
  "scope": "git:github.com/...",
  "sectionsCount": 3,
  "microChunksCount": 9
}
```

Tool routing rule:

```text
remember()
  concise durable fact -> hot memory

remember_note()
  long-form internal decision/research/context -> cold RAG memory

ingest_document()
  external reusable truth source -> RAG knowledge
```

This routing distinction is part of the feature contract, not documentation polish.

---

## 9. Retrieval Contract

### 9.1 Stable `doc_id`

Retrieval output exposes the parent document ID:

```text
doc_id: doc_a81f32
```

This creates a deterministic chain:

```text
query -> doc_id -> raw read
```

The agent no longer needs to guess a title/path to expand a result.

### 9.2 `resultMode`

Implemented modes:

| Mode | Behavior | Compatibility |
|---|---|---|
| `snippet` | ranked result + retrieved content | default; preserves callers |
| `index` | metadata/TOC only; no long body in tool output | opt-in |

`index` returns rank, `doc_id`, title, source type, note kind/tags, heading/breadcrumb, relevance score, timestamps, and retrieval policy. It does not format raw note body, paragraph context, full section content, or expanded table/code bodies.

For `index`, GraphRAG symbol lookup and table/code policy expansion are disabled before result formatting. Ranking still uses the same hybrid retrieval engine.

In `hybrid-sync`, query/list/read paths trigger the throttled reverse-sync before reading local RAG so another machine can discover cloud memories without requiring a separate manual sync command.

---

## 10. Optional Source-Type Filtering

Potential follow-up:

```text
source: all | notes | documents
```

Possible semantics:

- `all` — notes + external documents (default);
- `notes` — only `source_type = note`;
- `documents` — exclude RAG Memory Notes.

Do not add this until retrieval quality demonstrates a real need. If added, it must apply identically to BM25, vectors, batch retrieval, scope isolation, MCP, and OpenCode.

---

## 11. Graph Integration

No background graph-building model is required.

Existing agent-driven linkage remains sufficient for the first release:

```text
Notebook fact
    |
    | EXPLAINS
    v
RAG Memory Note
```

Because notes have normal `docId`s, existing `link_knowledge` can point Notebook facts at them.

Future explicit note graph relations may include:

```text
note A --REFERENCES--> document B
note A --SUPERSEDES--> note C
note A --IMPLEMENTS--> source file D
```

Automatic semantic graph generation stays out of scope.

---

## 12. Prompt / Agent Policy Changes

A single shared policy is now the source of truth:

```text
mcp-server/tools/core/memory_routing.js
```

It is used by both instruction paths:

```text
Codex / Claude / Antigravity
    -> prompt_manager.js
    -> MEMORY_ROUTING_POLICY

OpenCode
    -> injected <MEMORY>
    -> MEMORY_ROUTING_POLICY
```

Core policy:

```text
- remember: concise durable hot facts.
- remember_note: high-value long-form internal decisions, research, investigations,
  implementation context and handoffs that should stay retrieval-only.
- ingest_document: external reusable source material.
- do not persist transient chatter or disposable intermediate output.
- do not duplicate a full cold note into Notebook memory.
- when both hot + cold are useful, keep a concise Notebook fact, a detailed note,
  and link them.
- for navigation, prefer query(resultMode="index") -> doc_id -> read_document.
```

This avoids maintaining four subtly different agent policies.

---

## 13. Implementation Plan

### Phase 0 — Design & Compatibility Baseline

- [x] Confirm raw text can already be ingested into the RAG pipeline
- [x] Confirm raw RAG content is stored separately and can be read by document ID/title/path
- [x] Confirm project-scoped RAG already uses Git identity
- [x] Confirm long prose already receives sentence-window chunking
- [x] Confirm graph links target normal RAG document IDs
- [x] Confirm snapshot/export payloads already include document metadata, chunks, graph edges, and scopes
- [x] Capture baseline tool counts and relevant tests before implementation — **15 MCP / 17 native OpenCode / 18 suites**
- [x] Decide final feature name — **RAG Memory Notes**

### Phase 1 — Note Ingestion Core

- [x] Add reusable note-ingestion helper
- [x] Generate unique `memory://note/<uuid>` path
- [x] Support metadata extension without changing normal documents
- [x] Store `source_type = note`
- [x] Store `note_kind`
- [x] Normalize tags
- [x] Preserve project/global scopes
- [x] Prevent identical note bodies from overwriting separate notes
- [x] Return stable `docId` and note metadata

### Phase 2 — `remember_note` Tool

- [x] MCP registration
- [x] Native OpenCode registration
- [x] Identical argument semantics
- [x] Routing guidance
- [x] Empty title/content validation
- [x] `kind` enum/fallback
- [x] `generateEmbeddings` compatibility
- [x] Global note creation outside Git
- [x] Existing project-scope error outside Git preserved
- [x] Shared `rememberNote()` core

**Expected counts after Phase 2:** 16 MCP / 18 native OpenCode. README counts remain unchanged until Phase 12.

### Phase 3 — Retrieval Identity (`doc_id`)

- [x] Parent `doc_id` in normalized results
- [x] `doc_id` in snippet single-query output
- [x] `doc_id` in batch output
- [x] `metadata_json` in detail lookup
- [x] Defensive metadata parsing
- [x] Source type / note kind / tags
- [x] Document timestamps
- [x] Ranking logic left unchanged

### Phase 4 — Semantic TOC / `resultMode="index"`

- [x] MCP single-query support
- [x] OpenCode single-query support
- [x] `snippet` remains default
- [x] Compact index formatter
- [x] No large body formatting
- [x] Stable `doc_id`
- [x] Note metadata without note body
- [x] Batch support
- [x] Shared batch/single semantics
- [x] No table/code policy body expansion in index mode
- [x] No unnecessary GraphRAG symbol expansion in index mode

### Phase 5 — Raw Expansion Workflow

- [x] Shared MCP/OpenCode `read_document` implementation
- [x] Return note metadata + raw content
- [x] Scope checks
- [x] Cloud fallback materializes a missing local blob with hash verification
- [x] Hybrid query/list/read requests trigger throttled reverse-sync
- [x] Add automated cross-device/fresh-store raw restoration coverage in Phase 10
- [x] Add automated `only-cloud` missing-local-cache restoration coverage in Phase 10
- [ ] Verify these tests pass in the user's final local run
- [x] No redundant `get_note` alias yet

### Phase 6 — Note Management

- [x] Metadata-aware list
- [x] Existing scope unlink semantics reused
- [x] Final deletion cleans FTS / links / graph / structures
- [x] Orphan-aware local blob deletion
- [x] Notebook facts survive linked-note deletion by design
- [x] `link_knowledge` supports notes by normal document ID
- [x] Stable unique note IDs/paths protect unrelated links
- [x] Cross-device delete transport implemented with tombstones
- [x] Add automated deletion/link/project-isolation coverage in Phase 10
- [ ] Verify management regressions pass in the user's final local run

### Phase 7 — Optional Source Filtering

- [ ] Decide from evaluation whether filtering is required for v1.7.0
- [ ] If required, define `source: all | notes | documents`
- [ ] Apply to BM25
- [ ] Apply to vector search
- [ ] Apply to batch retrieval
- [ ] Preserve scope behavior
- [ ] Test mixed note/document ranking

> **Intentional defer:** do not implement speculative filtering before Phase 11 demonstrates a retrieval problem.

### Phase 8 — Agent Memory Routing Instructions

- [x] Add shared Notebook vs Note vs Document routing policy
- [x] Keep `remember` strict: concise durable facts
- [x] Add `remember_note` guidance for decisions/research/investigations/handoffs
- [x] Warn against transient conversational noise
- [x] Warn against duplicating full cold bodies into Notebook
- [x] Recommend concise Notebook fact + linked detailed note when both layers help
- [x] Add semantic TOC navigation guidance (`index -> doc_id -> read_document`)
- [x] Use the exact same `MEMORY_ROUTING_POLICY` in OpenCode, Codex, Claude Code, and Antigravity

### Phase 9 — Sync / Export / Import

- [x] Confirm note metadata is already included in document export (`metadata_json`)
- [x] Confirm snapshot v3 already exports/imports raw blobs in addition to normalized RAG rows
- [x] Confirm snapshot path preserves document scopes / graph edges / knowledge links
- [x] Add migration 7: content-addressed `rag_blobs`
- [x] Add gzip/Base64 cloud transport with SHA-256 integrity validation
- [x] Upload raw blob before publishing a new cloud document version
- [x] Support `only-cloud` raw blob upload without the hybrid queue
- [x] Backfill legacy local blobs missing from `rag_blobs`
- [x] Prevent tombstoned stale documents from re-uploading orphan raw blobs during backfill
- [x] Materialize missing raw blob from Turso before `read_document`
- [x] Implement hybrid reverse-sync for documents, scopes, sections, medium/micro chunks, vectors, FTS, graph edges, and knowledge links
- [x] Rebuild FTS breadcrumbs during reverse-sync
- [x] Preserve breadcrumbs in forward cloud export/sync
- [x] Merge by stable ID/path and protect a newer local document from an older remote copy
- [x] Add migration 8: `rag_document_tombstones`
- [x] Propagate deletes across devices and clear tombstones on newer re-ingestion
- [x] Remove cloud blob only when no remote document references its hash
- [x] Add deterministic file-backed LibSQL tests for hybrid forward sync, fresh-store reverse sync, raw restoration, stale-machine tombstones, and `only-cloud` materialization
- [ ] Runtime verify `only-local` by running full suite
- [ ] Runtime verify `only-cloud` by running new portability suite
- [ ] Runtime verify `hybrid-sync` by running new portability suite
- [ ] Runtime verify fresh-machine reverse-sync restores a note without duplicate document IDs
- [ ] Runtime verify cross-device delete tombstone removes stale local note
- [ ] Runtime verify snapshot round trip with RAG Memory Notes

Implementation checkpoint:

```text
FORWARD
local/hybrid ingest
  -> local gzip blob
  -> queue
  -> rag_blobs[sha256]
  -> normalized RAG rows in Turso

only-cloud ingest
  -> local gzip cache
  -> rag_blobs[sha256]
  -> normalized RAG rows in Turso

REVERSE
query/list/read/recall
  -> throttled syncFromCloud()
  -> Notebook merge
  -> apply RAG tombstones
  -> merge newer cloud RAG documents
  -> rebuild local FTS/vector hierarchy
  -> materialize missing gzip blob

DELETE
local delete
  -> remove local structure
  -> cloud delete
  -> tombstone
  -> other machines delete older copies on reverse-sync
```

### Phase 10 — Tests

> **Coverage status:** the four new suites below are registered in `tests/run_all.js`. The unified runner now contains **22 suites** (12 unit, 9 integration, 1 cloud). These checkboxes mean the coverage/code exists; they do **not** claim that the suite has been executed successfully yet.

New suites:

```text
tests/unit/rag_memory_notes.test.js
  -> note schema/normalization
  -> metadata safety
  -> index-vs-snippet presentation
  -> blob transport integrity
  -> routing policy contract

tests/integration/rag_memory_notes.test.js
  -> remember_note -> index -> raw expansion
  -> same-body/different-note identity
  -> Notebook fact -> note linking
  -> delete without deleting Notebook fact
  -> project-scope isolation
  -> native OpenCode surface

tests/integration/rag_memory_notes_mcp.test.js
  -> real stdio MCP tools/list
  -> remember_note
  -> resultMode=index
  -> read/list/delete via manage_knowledge_base

tests/integration/rag_cloud_portability.test.js
  -> hybrid forward sync
  -> fresh local-store reverse sync
  -> raw blob restoration
  -> deletion tombstone propagation
  -> stale-machine resurrection prevention
  -> only-cloud raw materialization
```

Coverage checklist:

- [x] Unit: note metadata normalization
- [x] Unit: unique virtual note path
- [x] Unit: invalid/empty note validation
- [x] Unit: retrieval identity/output contains `doc_id`
- [x] Unit: malformed/null/non-object metadata is safe
- [x] Unit: index formatter excludes snippet/paragraph/full-section/GraphRAG bodies
- [x] Unit: snippet formatter remains content-rich/backward compatible
- [x] Unit: batch index parity is covered in integration flow
- [x] Unit: read/list metadata normalization
- [x] Unit: transported blob rejects wrong SHA-256 payload and corrupt gzip
- [ ] Unit: isolated tombstone timestamp conflict test for a newer local rewrite (integration path already covers stale-tombstone deletion)
- [x] Integration: create short note → lexical retrieve → index → raw read
- [ ] Integration: deliberately large multi-chunk note → retrieve an interior passage → raw-read entire note
- [x] Integration: project note does not leak into unrelated project scope
- [ ] Integration: global note visible from a real Git project under `scope=all`
- [ ] Integration: external document and RAG Memory Note compete in the same mixed corpus
- [x] Integration: deletion removes note from retrieval while preserving another note sharing the same raw blob
- [x] Integration: Notebook fact links to note and survives note deletion as an unlinked hot fact
- [x] Integration: MCP `remember_note` / index / raw read / list / delete surface
- [x] Integration: native OpenCode package exposes and executes new note/query primitives
- [x] Integration: hybrid reverse RAG restore from a clean local store
- [x] Integration: cloud raw blob materialization
- [x] Integration: deletion tombstone propagation to a stale local store
- [x] Integration: stale-machine startup does not backfill tombstoned raw content
- [x] Regression suite already exists for current document ingestion/RAG tools
- [x] Regression suite already exists for table/code policy retrieval
- [x] Regression suite already exists for Notebook/OpenCode injected memory context
- [ ] Snapshot round-trip specifically containing a RAG Memory Note
- [ ] Smoke: real ONNX embeddings retrieve a semantically phrased note
- [ ] Run all 22 suites locally

### Phase 11 — Retrieval Quality Evaluation

Synthetic corpus:

```text
- Decision: switch from Vision-only to OCR + Vision
- Research: OCR provider comparison
- Context: CAD parsing investigation
- Decision: keep SQLite local-first storage
- Handoff: remaining sync bug investigation
```

Queries should test paraphrase, cross-lingual retrieval, related-research-vs-final-decision distinction, project isolation, note/document competition, compact index ranking, and raw expansion correctness.

- [ ] Add dedicated RAG-note evaluation fixture
- [ ] At least 10 semantic queries
- [ ] Measure Top-1 / Top-3
- [ ] Record false-positive patterns
- [ ] Measure context reduction from index mode
- [ ] Confirm no document benchmark regression
- [ ] Decide Phase 7 source filtering from evidence, not speculation

### Phase 12 — Documentation

- [ ] README multi-layer architecture
- [ ] Add `remember_note` to tool tables
- [ ] Update tool counts (expected 16 MCP / 18 OpenCode)
- [ ] Document hot fact vs cold note vs external document
- [ ] Semantic TOC/raw expansion example
- [ ] `resultMode=index`
- [ ] Note kinds/tags
- [ ] Local-first/privacy behavior
- [ ] Cloud raw blob transport + integrity verification
- [ ] Hybrid reverse RAG sync + tombstone semantics
- [ ] Update skills/prompts that enumerate tools

### Phase 13 — Release Preparation

- [ ] New tests pass
- [ ] Existing suite passes
- [ ] MCP/OpenCode parity checked
- [ ] `memory_plugin doctor --codex` passes
- [ ] Manual real-agent test
- [ ] Save → restart → index search → raw expand
- [ ] Git project + outside Git
- [ ] Cloud/hybrid second-environment test
- [ ] Review diff for unrelated changes
- [ ] Mark final plan state
- [ ] Bump expected version to `1.7.0`
- [ ] Add CHANGELOG entry including migrations 7/8 and compatibility notes
- [ ] Update README counts/version-sensitive text
- [ ] Commit release checkpoint to `main`
- [ ] User performs final local validation
- [ ] User publishes GitHub release
- [ ] User publishes npm package

---

## 14. Current Code Touchpoints

```text
mcp-server/
  ingest/
    pipeline.js                 ingestNote, metadata, cloud blob/tombstone lifecycle
    exporter.js                 forward sync payload + FTS breadcrumbs
  retrieval/
    retriever.js                doc_id + defensive metadata normalization
  storage/
    blob_store.js               local gzip store + portable integrity-checked transport helpers
  db/
    migrations.js               migrations 7/8: rag_blobs + tombstones
    database.js                 cloud schema + legacy blob backfill
    rag_blob_transport.js       content-addressed Turso blob transport + tombstone-aware backfill
    rag_sync.js                 hybrid RAG reverse-sync + tombstones
    sync_queue.js               forward sync + reverse Notebook/RAG orchestration
  tools/
    core/
      note_core.js              shared rememberNote
      rag_query_core.js         shared snippet/index queries + hybrid freshness
      knowledge_read_core.js    list/raw read + cloud materialization
      memory_routing.js         shared agent routing policy
    note_tools.js               MCP remember_note
    rag_tools.js                MCP query/manage surface
    index.js                    MCP registry
  prompt_manager.js             shared policy for Codex/Claude/Antigravity

opencode-plugin/
  index.js                      existing native plugin preserved
  main.js                       package wrapper: notes/query/read/list/routing parity

tests/
  unit/rag_memory_notes.test.js
  integration/rag_memory_notes.test.js
  integration/rag_memory_notes_mcp.test.js
  integration/rag_cloud_portability.test.js
  run_all.js                    22 registered suites

package.json                    version still 1.6.6 during development
docs/PLAN_RAG_MEMORY_NOTES.md   this plan
README.md                       Phase 12
CHANGELOG.md                    Phase 13
```

Schema changes are justified transport primitives rather than note-specific duplication:

```text
migration 7: rag_blobs
  -> exact raw source transport across devices

migration 8: rag_document_tombstones
  -> cross-device deletion/forget propagation
```

The note classification itself still uses ordinary `documents.metadata_json`; there is no `notes` table and no second vector/FTS engine.

---

## 15. Backward Compatibility Rules

- `remember` behavior remains intact; only agent routing guidance changes which primitive should be selected for new long-form memory.
- Notebook files remain human-readable Markdown.
- Existing `ingest_document` API remains valid.
- Existing RAG documents do not require re-indexing merely because notes exist.
- Existing `query_knowledge_base` callers keep `snippet` by default.
- `resultMode=index` is opt-in.
- `manage_knowledge_base` actions remain valid; list/read only gain additive metadata.
- Existing document IDs and graph links remain valid.
- Snapshot format already contains raw blobs and remains the explicit full-backup path.
- Existing cloud documents are compatible; migration/backfill adds portable raw content when the source blob is still available locally.
- No external LLM/API dependency is introduced for classification or memory creation.
- Version stays `1.6.6` until release preparation.

---

## 16. Failure Modes to Guard Against

### 16.1 Turning notes into a second `global.md`

Do not save every turn. Cold memory is still curated high-signal memory.

### 16.2 Duplicate hot + cold memory

Preferred:

```text
remember("OCR + Vision is the chosen architecture")
       |
       +-- EXPLAINS --> remember_note(full decision record)
```

not the same long body twice.

### 16.3 Index mode leaking large bodies

`resultMode=index` disables policy expansion/GraphRAG expansion and never formats snippets/full sections.

### 16.4 Losing retrieval identity

Every normalized result carries stable `doc_id`; raw expansion should use it.

### 16.5 Scope leaks

Project-only retrieval remains filtered by `document_scopes`. Global remains intentionally cross-project.

### 16.6 Corrupt cloud raw content

A cloud payload is not trusted merely because its key looks like a SHA-256. It is decompressed and hashed before being written into the local blob store.

### 16.7 Half-synchronized cloud document

Raw blob is uploaded before publishing a new cloud document structure. A failed blob upload leaves the hybrid task queued rather than publishing an unreadable new version.

### 16.8 Stale deleted memory resurrecting on another machine

Deletion tombstones carry `deleted_at`. An older local document is removed; a genuinely newer local rewrite wins and can later clear the tombstone when synchronized. Legacy backfill also checks tombstones before uploading a local raw blob, preventing orphan raw data from being resurrected by stale startup state.

### 16.9 Flaky synchronization tests hiding race conditions

Cloud portability tests poll observable LibSQL state with a deadline instead of relying on fixed sleeps for forward/delete synchronization completion.

### 16.10 Hidden background intelligence

No hidden summarizer/classifier LLM. Sync, storage, routing and retrieval remain deterministic infrastructure controlled by the host agent.

### 16.11 Surface drift

MCP and native OpenCode share note creation, query formatting, list/raw read, and routing policy cores.

---

## 17. Success Criteria

- [ ] Agent can save a long decision without Notebook auto-injection — runtime test pending.
- [ ] Note survives restart with correct scope — runtime test pending.
- [ ] Paraphrased semantic query discovers the note — evaluation pending.
- [x] `resultMode=index` has stable `doc_id` and compact metadata output.
- [x] Selected local/cloud candidate has a deliberate raw expansion path.
- [x] Cross-device raw transport and hybrid restore are implemented.
- [x] Cross-device deletion propagation is implemented.
- [x] Automated tests for core flow, MCP/OpenCode surfaces, hybrid restore, cloud materialization, and stale-machine tombstones are implemented.
- [ ] New automated suites pass in the final local run.
- [ ] Existing document RAG passes regressions.
- [ ] Existing Notebook behavior passes regressions.
- [x] Notes participate in existing graph/document-link architecture.
- [ ] Snapshot/cloud modes pass all end-to-end tests.
- [x] MCP/OpenCode share new query/list/read/routing semantics.
- [ ] Project-isolation test passes at runtime.
- [ ] User-facing documentation is complete.

Context-efficiency target remains:

```text
search cheaply
    -> inspect candidates
        -> expand deliberately
```

---

## 18. Future Extensions — Out of Scope for First Release

- background LLM note summarization;
- automatic conversation compaction;
- automatic semantic graph generation;
- autonomous conflict/supersession detection;
- temporal graph reasoning;
- note TTL / temperature transitions;
- automatic Notebook promotion/demotion;
- inferred note-to-note backlinks;
- default full transcript ingestion;
- hidden provider inference calls.

The first release should prove that **agent-authored cold memory + semantic TOC + deliberate raw expansion + portable deterministic storage** is useful on its own.

---

## 19. Design Principle

The plugin should not become a magical creature that secretly decides what the agent remembers.

It should give the agent better memory primitives.

```text
remember        = hot durable fact
remember_note   = cold durable episode / reasoning record
ingest_document = external knowledge source
query(index)    = semantic table of contents
read_document   = deliberate raw expansion
link_knowledge  = provenance / explanation bridge
```

The intelligence remains in the agent.

The plugin makes that intelligence **persistent, searchable, scoped, inspectable, synchronized, and portable across agents and machines**.
