# Knowledge engine contract — K0–K6

Status: K0–K6 implemented and accepted on isolated stores, including an installed
npm package, a real cached CPU model and namespaced live Turso checkpoints.
Power-loss durability is unverified. Reviewed 2026-10-03.
against the existing dirty working tree, including the prior dashboard changes.

## Implemented read contract (K1)

`knowledge_service.js` owns all new reads. `inspectKnowledge` dispatches
`targets`, `list`, `read`, `hierarchy`, `chunk`, `links`, `graph`, `search`,
`search-status`. HTTP uses authenticated
GET `/api/knowledge?action=...`; CLI uses `memory-cli knowledge ...` (JSON);
MCP and both OpenCode tool registration surfaces expose `inspect_knowledge`.
HTTP/UI contain no database queries. K1 reads require no migration; K2 activation
is explicit and never runs on dashboard open.

Every action except targets requires an explicit existing `scopeKey`. Targets
are the union of global, Notebook stores, registered identities and persisted
document scopes, including scopes with no Notebook or local checkout. No read
registers a project identity. A RAG-only unregistered scope is Notebook read-only.
`includeGlobal=false` selects exactly that scope; true adds global. Existing
RAG tools retain their original meaning of `all` (current project plus global).
There is no new implicit installation-wide content view.

`docId`, `chunkId` and `parentId` are exact IDs. Titles/paths are list search
fields, never alternative addresses in this contract. Visibility is checked at
the document and again at each child/parent; foreign or broken parent IDs are
suppressed and diagnosed. Shared document descriptions show visible scope keys
and the count of other scopes, without their identities or private links.
Reverse links are limited to context fact keys and to documents visible to that
fact's scope. Legacy facts match exact body/formatted text; ambiguous text or
duplicate fact IDs produce no clickable fact reference. All legacy links carry
`needs_review`, unconfirmed requested lines, and no asserted source revision.

List ordering is `created_at DESC, docId ASC`. Hierarchy ordering is stable ID
order, **not source order**: original source positions were not stored.
Pagination uses offset/limit, default 30, maximum 100, nextOffset=null at the end.
Raw and chunk pages return at most 20,000 characters. Chunk offsets use Unicode
code points (SQLite substr); raw offsets use UTF-16 units. Raw line numbers are
one-based after CRLF/CR normalization to LF. A startLine is a requested position,
not evidence that a legacy link is current. Raw blobs are integrity-checked,
limited to 16 MiB decompressed and report available/missing/corrupt/too_large.
Lists only test local blob presence (`present_unverified` is not integrity PASS).
Long metadata fields/tags are capped and carry metadataTruncated; link bodies
carry textTruncated. Stored metadata itself is not modified by these projections.
Raw means saved normalized text, not the original file/binary or a URL refresh.

Vector bytes never leave the service. Presence, byte count and float32 dimension
are read from actual stored vectors. Chunk model provenance is reported only
when the recorded document dimension matches the stored vector; legacy or
mismatched vectors remain UNKNOWN. Browsing
does not call ingestion/retrieval, download/load models or query cloud storage.
The current storage engine has only-local/cloud-snapshots local working databases.

Short synchronous SQL read transactions protect a response from partial SQL
publication. An older async write on the same connection yields BUSY. Blob IO
is outside SQL; the document fingerprint and scopes are rechecked afterward.
`version` is an opaque SHA-256 read fingerprint of document fields, index counts
and coverage; `scopeVersion` fingerprints membership. They are **not mutation
tokens**: K1 does not accept expectedVersion. K2 link tokens include explicit
document/content/index revisions, scope generations and current Notebook/link
state. Rendering uses the sanitized Markdown/KaTeX/Mermaid contract below.

Expected errors: INVALID, NOT_FOUND, CONFLICT, BUSY, UNSUPPORTED,
MIGRATION_REQUIRED; adapters sanitize unexpected failures to STORAGE_UNAVAILABLE.
Reads have no save/partial result. Historical exportDocumentData and whole-memory
snapshots remain privileged full-data exports; the inspector never proxies them
to the browser. In K1 the projected service results are the bounded scoped export.

## Initial write-path audit and owners (K0, historical baseline)

| Current path | Adapters | Current protection / next owner |
| --- | --- | --- |
| memory.js writeMemory / raw file writes | core memory tools, CLI/TUI, OpenCode, notebook_service | snapshot lock + atomic file replacement; Notebook version checks in structured service |
| ingest/pipeline.js ingestDocument / ingestMemoryNote | rag_tools, note_core, both OpenCode surfaces | URL/file normalization and model calls before SQL; BEGIN IMMEDIATE publication; **no shared snapshot lock in pipeline** |
| pipeline.js deleteDocument / reindexEmbeddings | MCP/OpenCode, storage_actions TUI | SQL transactions; blob cleanup after commit; snapshot exclusion still pending |
| rag_scope.js add/removeDocumentScopes | ingest/delete adapters | direct SQL, removal can precede purge; K4 owns shared removal service |
| graph/knowledge_linker.js linkFactToDocument | identity tools / OpenCode | snapshot lock, multiple SQL writes; no stable fact identity/journal yet |
| knowledge_linker moveKnowledgeScope / deleteLinksForFacts | project link/relink, memory tools, CLI/TUI | direct SQL; K2/K4 must route through the common mutation gate |
| admin/snapshot.js importSnapshot / hardResetDatabase | manage_knowledge_base, storage_actions | SQL transactions; old RAG snapshot API; include in K2/K4 lock audit |
| admin/full_snapshot.js captureLocal / applyLocal | cloud_snapshots and snapshot tools/CLI | full snapshot wrapper uses snapshot lock; capture/restore SQL transactions |

The table records the pre-K2 audit. K2 now gates Notebook writes, link reads and
writes, ingestion/deletion/reindex publication, scope changes, RAG import/export/
reset, and full snapshots through the shared lock/recovery path. Models and
normalization run before the publication lock; ingestion/reindex recheck their
prepared inputs. K4 implements scope/deletion consequence previews. Project
identity merge is serialized, but its whole multi-file workflow has not been
accepted as one journaled operation.

## Implemented K2 migration, links and recovery

`knowledge_links_service.js` owns `migration-status`, `migrate`, `list`, `preview`
and `apply`. HTTP exposes `/api/knowledge-links`; CLI exposes `knowledge migrate`
and `knowledge link <action>`; MCP and both OpenCode surfaces expose
`manage_knowledge_links`. Preview/apply operations are create/update/delete,
addressed by explicit scope, stable factRef/docId and linkId. Apply requires the
exact previewToken; old tokens cannot authorize changed payloads or restored/
imported state. The UI retains its draft after CONFLICT.

Migration creates and verifies a full local ZIP backup in `.knowledge-backups`
before changing schema/files, and publishes a JSON report through the same
journal. It adds document/content/index revisions, scope generations, link
fact_id/revision/status/source_revision and an operation ledger. IDs already in
Notebook and existing link IDs are preserved; ID-less entries receive UUID-based
IDs. Only unique exact legacy body/formatted-text matches are bound. Duplicates,
unresolved links and unknown source revisions stay `needs_review`. Explicit
reruns can reconcile old snapshots without regenerating stable existing IDs.
K3 index state/provenance and staged editing are implemented below.

Canonical graph fact nodes encode (fact_key, fact_id). Projection edges carry
their owning linkIds, including multiple links sharing the same endpoints and
relation. Rebuilding removes only marked projections; migration removes only
legacy projections with the matching linkId. Independent/structural edges are
preserved; structural relation types cannot be manually created, and collisions
with independently authored canonical edges fail with CONFLICT.

Once migrated, all Notebook writers use `persistNotebookKnowledge`: text edits
update links by stable ID; fact deletion removes only its owned links. Ambiguous
legacy bindings fail closed. Notebook versions include ordered links so a
link-only concurrent change also invalidates an edit/delete draft. The original
linked-body/delete guard still applies before explicit migration.

Link preview checks fact uniqueness, source visibility and any exact section or
saved-text line range, then includes a source excerpt. Section+line bindings are
rejected because legacy section source coordinates are unknown. Tokens bind both
old/new targets, current Notebook bytes, link/document revisions and scope
generations. `valid` means a manual binding against that saved revision; it is
not semantic verification of the fact. Changed/unknown source revisions, missing
sections or lost visibility derive `needs_review`. No other project's links or
unavailable document descriptions are exposed.

Publication acquires `.snapshot.lock`, recovers any pending journal, prepares
old/new file bytes and hashes, then commits SQL effects and the operation ledger
in a short synchronous BEGIN IMMEDIATE transaction. File replacement uses a
flushed temporary file and rename. Before SQL commit, failure discards staging;
after commit, the next gated reader/writer completes file publication. Recovery
checks every affected file hash before writing any file and returns
RECOVERY_REQUIRED on an unexpected external edit. A dead process lock can be
recovered; a live owner's lock is not stolen by timeout. Actual child-process
exits after Notebook and full-restore SQL commits are covered. Directory fsync,
power-loss durability and arbitrary OS-kill timing remain unverified.

Activated stores export full ZIP v2 and RAG v4, including the new fields. Both
old and new formats are accepted. Full restores journal Notebook replacement/
creation/deletion after SQL commit; the temporary recovery-ledger row is pruned
only after file verification so exact state round-trips remain possible. Old
payloads retain unknown IDs/source revisions and needs_review state until an
explicit reconciliation. RAG-only import does not restore Notebook files;
stable references are checked against current Notebook. Restore/import epochs
invalidate previous link preview tokens even if restored data is identical.

## Implemented K3 content publication

`knowledge_content_service.js` owns read/start/prepare/status/apply/cancel for
create-note/update-note/ingest-source/refresh-source/metadata. HTTP uses
`/api/knowledge-content`; CLI uses `knowledge content`; MCP and both OpenCode
registrations expose `manage_knowledge_content`. Existing `remember_note` still
creates a new virtual Note. Existing shared-source ingest updates now reject
CONFIRMATION without the managed preview path; implicit source-type conversion
is rejected as INVALID. Adding an unchanged source to another scope remains supported.

Editing requires the explicit owning scope and the editor's expectedVersion.
Global sources visible in a project's inspector cannot be edited through that
project key. Preparation captures document, scopes, links and restore/import
epochs, normalizes file/URL/text, builds hierarchy/FTS inputs and optional vectors
without publishing SQL/blob state, then rechecks the captured revision. Apply
rechecks again under the common lock and publishes raw/hash, metadata, hierarchy,
FTS, vectors, structural/link projections and an operation-ledger receipt in one
SQL transaction. The common ingestion pipeline owns publication, including older
adapters. Title changes rebuild embeddings context even when raw text is unchanged;
tags/Note kind alone keep the index. Existing docId/path/scopes and omitted kind/
tags are preserved. File/URL refresh preserves provenance and reads the fixed
stored locator explicitly; Notes edit their saved raw text.

Prepared operations are bounded local files in `.knowledge-staging` (30-minute
lifetime, 50 retained preparations, maximum 64 MiB each), independent of any panel
process. CLI `prepare` waits and a later CLI process can apply it. HTTP/MCP `start`
returns operationId immediately; status reports reading/normalizing/embedding/
indexing/preview/publication and completed/total chunks, not a fabricated percent.
Cancellation discards preparation before publication; a running model/network call
may finish before cancellation is observed. Publication is not cancellable.
Staging files are transient and excluded from full/RAG snapshots. A process exit
after SQL commit but before writing the receipt is resolved by the SQL ledger;
it is never inferred solely from matching text. Altered staging data invalidates
the caller's preview token. Power-loss durability remains unverified.

Preview enumerates affected own linkIds and statuses, scope/link totals and
private-scope/link counts; private identities/text are not exposed. Shared apply
requires confirmShared=true plus the exact preview token. Exact retained line
text at the same normalized coordinates or identical section ID/content/heading/
breadcrumbs can keep an already valid binding; unresolved old bindings are never
promoted automatically. Changed/unproven bindings become needs_review; absent
section targets become orphaned. Both snapshot validators accept orphaned.

Content reindex requires explicit indexMode lexical|dense. Failed normalization,
embeddings, stale preparation or SQL failure leaves the old published revision.
Lexical mode clears old vectors. Dense mode pins model/dimension for every batch,
rejects incomplete/nonfinite/mixed vectors, and records actual provenance in
metadata_json. Global reindex records the same provenance. Vector retrieval
filters known model/dimension mismatches against the actual query model, including
explicit query-model overrides; legacy unknown vectors remain legacy/unverified.
Inspection reports stored index state/provenance without attributing old vectors
to current configuration. Metadata travels in full v2/RAG v4 without extra DDL.

Limits: 2 MiB normalized editor text, 32 MiB file/URL input, 5000 micro-chunks,
5000 affected links; HTTP content JSON is capped at 3 MiB. File roots and URL/
redirect SSRF guards remain active. The UI supports rendered preparation preview,
Note/source creation, existing edits and metadata, explicit shared confirmation,
conflict draft retention and selective field rebase: untouched fields adopt the
other client's values, changed fields remain in the draft alongside saved text/
metadata for comparison. Installed-package, live-model/Turso and final retrieval
acceptance are recorded in K6. `knowledge_content.test.js` and the K3 report contain evidence.

## Implemented content rendering and interaction

Notebook, persona preview, saved raw-text pages and chunk pages can render GFM
Markdown, KaTeX (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`) and fenced Mermaid.
Code spans/fences keep math delimiters literal. Notebook/raw/chunk views retain
an exact source toggle; paginated rendering applies to the current page.

Pinned local browser distributions are served through a containment-checked
vendor route. No CDN or model/network call is required for rendering. Raw HTML
is escaped; images become alt text; unsafe link schemes are omitted. DOMPurify
sanitizes generated HTML/SVG; KaTeX uses trust=false and bounded expansion;
Mermaid uses strict security, disables interactive/configurable source features
and never binds link callbacks. Source directives, raw HTML/URLs and advanced
shape definitions are rejected. Errors remain visible beside the original code.
Limits: 100,000 text characters, 12 diagrams per document, 12,000 characters and
200 edges per diagram. Theme changes rerender current diagrams. These deliberate
limits do not constitute full support for every Mermaid extension.

Select arrows sit 12px from the edge with reserved text padding (native fallback
in forced-colors). Pointer navigation no longer outlines focused content headings;
keyboard focus remains visibly outlined. Text selection itself remains enabled.

## Fixtures and acceptance evidence

`tests/fixtures/knowledge_fixture.js`: global, A/B with identical fact IDs/text,
shared document/private links, internal Note, RAG-only project without directory,
ambiguous legacy facts. `knowledge_service.test.js` covers explicit access,
metadata filters and pagination, child/parent spoofing, absent/corrupt blobs,
BUSY, unchanged-timestamp fingerprint change, lexical/offline zero-network and
unloaded model status, CLI, MCP schema/stdio, OpenCode and HTTP authorization.
`knowledge_preview.js` provides the same isolated store for browser acceptance.
The default fixtures are local/lexical. K6 records separate real-model,
namespaced live Turso and installed-package smoke tests.

`knowledge_links.test.js` covers migration/backup/report, prefix and duplicate
projection ownership, scoped access, stale Notebook/link previews, rollback,
external-edit recovery refusal, real process-exit recovery, full v2/RAG v4 and
legacy round-trips, CLI/MCP/OpenCode/HTTP/vendor protections and zero network
calls in the engine flow. Browser evidence and remaining boundaries are recorded
in `dev_docs/KNOWLEDGE_UI_K2_REPORT.md`.

## Implemented K4 removal

knowledge_removal_service owns explicit preview/apply unlink-scope|delete and
cleanup. HTTP, CLI, MCP and both OpenCode use this contract. Tokens cover rows,
scopes, links, exact owned IDs/edges and restore/import epochs. Shared full
delete requires separate all-scope confirmation. Previews expose own link IDs
and foreign counts only. Global visibility preserves links; lost visibility
removes links and only their projections. Notebook facts and historical snapshots
remain. The final scope removal purges hierarchy, FTS, vectors and exact edges
in the same transaction. Legacy adapters use the same storage publication.
Blob reference counts are checked after commit under the common lock; cleanup
failures return saved + cleanupPending and durable sync_state retry entries.
cleanup or the next removal retries up to 100 pending hashes. Restores clear
sync_state and do not transport old cleanup queues. Limits: 5000 links, 100000
owned IDs. K4 report and knowledge_removal.test.js record acceptance.

## Implemented K5 graph

inspect_knowledge(action=graph), knowledge graph and inspection HTTP expose a
bounded saved graph. Both endpoints must resolve in the explicit context;
known fact IDs are matched against unique Notebook identities. Foreign IDs,
unknown endpoints and falsely marked projection linkIds are never mutation
targets. Symbols are name-only/nonunique. Own verified manual links route to
K2 preview/apply; structural edges cannot be deleted directly. No bulk operation
was introduced. Legacy structural origin remains unrecorded; arbitrary edges
remain UNKNOWN. Limits and completeness/scanTruncated are explicit. Graph data
is read under the common lock and synchronous SQLite read transaction, without
model/cloud calls. UI offers an SVG overview and equivalent directed edge list,
filters and primary-entity navigation. K5 report records acceptance.

## Implemented K6 trial retrieval and acceptance

`inspect_knowledge(action=search|search-status)`, CLI `knowledge search` /
`search-status` and authenticated GET inspection share knowledge_search_service.
UI selects lexical|dense and index|snippet explicitly. Status inspects cache and
runtime without loading models. Lexical uses existing FTS/BM25, no embeddings,
reranker or graph expansion. Dense loads the exact cached model with
local_files_only and fails without download, fallback or cache purge. Query
model/dimension and stored document provenance are distinct; legacy provenance
is UNKNOWN. Known incompatible vector spaces remain excluded by the retriever.

Read transactions and the common lock protect results; dense captures the
context version before embedding and rejects concurrent source changes before
retrieval. Child/parent joins and policy expansion require the same document
and section. Returned fragment IDs/level describe the actual snippet; index
returns metadata with no text/expansion. Results include source identity,
content/index revisions, policy, available scores and source/chunk navigation.
FTS rank, reciprocal BM25 rank and cosine have distinct meanings. Missing scores
are null and reranking is not claimed. No retrieval result proves injection or
agent use. Limits: 1000 query characters, 20 hits (UI 5), 20000 text characters
per hit, 5000 context documents and at most 50000 dense candidates, further
restricted by vectorScanLimit. No ad-hoc vector/chunk mutation is introduced.

knowledge_search.test.js covers the full mutation/retrieval chain, isolation,
policy/foreign-parent protection, concurrent dense query rejection, historical
versus current snapshots, CLI, real MCP stdio, both OpenCode registrations,
HTTP authorization and zero lexical model/network calls. Separate smoke tests
knowledge_ui_live, knowledge_cloud_live and knowledge_installed cover cached
CPU ONNX, two live Turso checkpoints in a disposable namespace, and actual npm
installation/interfaces/UI assets. Browser acceptance covers the full chain,
rendering, graph navigation, source/chunk provenance, focus and narrow layout.
K6 report records commands and evidence. User data/configuration were not
migrated; the test Turso table was removed. Arbitrary OS termination and power
failure durability remain outside this acceptance.
