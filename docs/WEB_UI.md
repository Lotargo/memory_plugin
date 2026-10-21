# Local web UI

[Documentation](README.md) · [Project overview](../README.md)

Browse and edit saved memory, inspect sources and graphs, manage models and control the shared local panel. For maintenance operations see [maintenance and recovery](MAINTENANCE.md).

## Local Web UI

Browse and edit memory in a local browser panel, shared by all connected clients:

```bash
npx -y @lotargo/memory_plugin web
```

The panel opens on `127.0.0.1` with a private connection URL. It includes searchable Notebook records, facts and active instructions, history, Git project scopes, a knowledge reader/editor, source links and graphs, settings, model controls, and reviewed backup/maintenance actions. Light, dark, and system themes and a compact mobile layout are supported.

<img src="https://raw.githubusercontent.com/Lotargo/memory_plugin/main/assets/ui/notebook.png" alt="Local Memory UI in dark mode: synthetic Notebook facts, instructions, filters and record details" width="100%">

<details>
<summary>Knowledge sources and Memory Notes</summary>

<img src="https://raw.githubusercontent.com/Lotargo/memory_plugin/main/assets/ui/knowledge.png" alt="Knowledge UI showing a synthetic Memory Note, source metadata and rendered Markdown" width="100%">

</details>

Both screenshots use a disposable demo profile with entirely fictional records and `example.test` projects. They contain no personal memory, client configuration, credentials, or private connection URLs. The current panel labels are in Russian. Browsing saved memory does not require a cloud account or load an embedding model.

See the [dashboard commands and behavior](#panel-lifecycle-authentication-and-ports) for lifecycle and authentication, and [maintenance and recovery](MAINTENANCE.md) for maintenance details.

## Notebook and projects

In Notebook, **Все хранилища** lists global and all known project stores together, with the exact owning scope on every row. It is a browsing view: **Открыть хранилище записи** selects the concrete store before editing, so repeated record IDs in other projects are safe. Unavailable or conflicting stores are reported as omissions. This administrative view does not change agent retrieval: `scope: all` still means global plus the current project.

**Дополнительные фильтры** combines record kind, exact tags (any comma-separated tag), inclusive creation dates and text search. State filters include expired and superseded records; **Сбросить фильтры** clears the search and returns to current records. **Заменить новой записью** reviews changes before creating a fresh ID/date with `supersedes`/`supersededBy`. The original keeps its metadata and source links in history; evidence is not copied to the replacement. A stale version or already superseded target blocks publication and preserves the draft. Replacement uses the same local Notebook journal as other edits.

**Управление проектами** opens shared project administration: detected Git registration, exact path-alias unlink, memory relink/merge into a known Git scope, and explicit legacy migration. Stored projects remain selectable without a checkout. Preview shows counts, aliases, duplicates, conflicts and consequences. Same text with different record metadata blocks a move; colliding IDs and imported replacement-history references are remapped together with source links. Ordinary unlink keeps memory and Git auto-detection. The existing explicit `unlink --purge` removes only registry identity/aliases, retaining memory.

Memory moves, including registration that migrates a legacy store, create a pinned, validated full local checkpoint in the regular snapshot catalog, usable through `memory-cli snapshots list --location local` and `memory-cli snapshots restore <backupId> --location local` (restore first returns its own preview). Ordinary Git registration, path-alias unlink and registry-only purge use an atomic SQL transaction without reading RAG blobs or activating the knowledge schema; a missing archived source in another project does not block them. Preview exposes `backupRequired`; registry-only results return null backup/restore fields. No cloud upload, remote Git modification, model loading or network access is performed. Memory moves use the shared SQL ledger/Notebook journal; stale previews fail closed. Conflicting store headers, ambiguous fact links and incompatible duplicate history require explicit repair before moving.

Moving a checkout to another directory and linking it again preserves its Git-scoped memory when its remote is unchanged. Registration adds the new path alias to the same identity; previous aliases remain available for other clones or historical paths. Facts, document scopes and archived sources stay in shared memory storage, independently of the checkout path. Remote-backed repositories can also change their folder name. Repositories without remotes keep their `git:local:<repository-name>` identity when their basename is unchanged; renaming such a repository still requires an explicit memory relink. A relative/absolute source path is provenance, while archived document reads use the stored content hash.

The same structured contract is exposed through MCP and both OpenCode surfaces, and CLI:

```bash
memory-cli projects list
memory-cli projects inspect --dir <absolute-git-path>
memory-cli projects preview --operation relink --source <sourceKey> --target <targetKey>
memory-cli projects apply --operation relink --source <sourceKey> --target <targetKey> --token <previewToken> --confirm
```

The old `link`, `unlink`, `relink` commands and TUI project operations call this service too. Existing explicit mutation commands apply with a backup when moving memory; `projects preview/apply` supports separate review and confirmation. New Git registration outside a repository is rejected even with an explicit remote. Explicit legacy migration accepts a known target or an existing Git directory. A memory move leaves repository Git settings unchanged: opening a repository with the old remote still resolves the old Git identity.


## Instructions, settings and models

The dashboard supports global/project Notebook browsing, search, record editing, metadata, protected deletion, and directive enable/disable with a preview from the shared persona builder. It runs against the same local storage as CLI/MCP in `only-local` and `cloud-snapshots` modes. In **Инструкции → Предпросмотр**, select a client to inspect inclusion/exclusion reasons and open a record in its exact store. OpenCode shows the actual shared system/session builders, including V1/V2 routing policy differences; its expired directives remain marked facts in session memory. Codex, Claude Code, Gemini CLI and Antigravity show a **partial global persona template**: installed client files, plugin-owned instructions, recall and active sessions are not inspected. Refresh reads current memory; preview never writes prompts or proves agent usage.

Open **Настройки** in the sidebar (or inside **Область** on mobile) to change storage, snapshot schedules, search/model/compute parameters, source access, web port and autostart. Changes are validated and version-checked against other clients. Cloud settings support database URL/token credentials in the shared encrypted store, explicit connection checks and logout. Local snapshots, manual upload, metadata lists, pin/unpin, restore and protected date-range cleanup use the existing snapshot engine and fresh confirmation previews. Saving model/dimension changes flags a required separate reindex; it never downloads models or rebuilds vectors. Open **Модели** to download and validate an embedding/reranker, inspect disk cache and registered client processes, load/unload RAM/VRAM sessions or apply CPU/GPU, and preview a transactional rebuild of all local knowledge vectors. Long operations run in isolated processes with persisted progress and results; closing the dialog does not cancel them. Runtime commands target one fresh registered client supporting control protocol 2. Legacy or unregistered process coverage remains unknown. Cache deletion requires a fresh preview and closed registered clients. Model administration never substitutes the requested model or purges a failed download; reindex uses only the exact locally cached model. Other authorization methods and client setup remain available through CLI/TUI.

## Knowledge sources and source links

The **Знания** section adds local browsing of Notes and sources, metadata filters, saved normalized text pages, section → medium → micro inspection, navigation between Notebook facts and documents, and previewed link editing. Select a registered project or persisted RAG scope even when its original checkout is unavailable. The **Включить глобальные источники** option explicitly adds global sources. Browsing does not load models, refresh files/URLs or access the cloud. Unrecorded source coordinates and legacy embedding provenance stay UNKNOWN; recorded model/dimension is shown when it matches the stored chunk vector. Legacy links show `needs_review`. Missing/corrupt raw blobs are diagnosed. Raw viewing is limited to 16 MiB with 20,000-character pages; vectors are represented by metadata only.

Notebook, instruction previews, saved source pages and chunks render Markdown, KaTeX formulas and fenced Mermaid diagrams using local pinned assets. Notebook/source/chunk views retain an exact source toggle. Raw HTML and unsafe links are suppressed, diagrams run in strict mode, and invalid or oversized diagrams preserve their code with a visible explanation. Pagination renders each saved-text page independently. Dropdown arrows reserve space inside the control; clicking content no longer draws a focus frame, while keyboard focus remains visible.

The same service is exposed by MCP and native OpenCode `inspect_knowledge` and `memory-cli knowledge`:

```bash
memory-cli knowledge targets
memory-cli knowledge list --scope-key global --source-type note
memory-cli knowledge read <docId> --scope-key <registered-key> --start-line 3
memory-cli knowledge hierarchy <docId> --scope-key <registered-key> --level micro
memory-cli knowledge chunk <docId> --scope-key <registered-key> --level micro --chunk-id <chunkId>
```

New inspection calls use exact IDs and explicit scope keys; existing `manage_knowledge_base` calls retain their previous defaults. K2 link management uses stable fact IDs and linkId, fresh preview tokens, source revision checks and a shared recovery journal. Open **Добавить связь → Подготовить связи** or the knowledge editor's **Подготовить хранилище** to explicitly activate it: migration first creates and verifies a full local backup, then writes a report. Opening the panel never migrates memory. Ambiguous legacy links remain `needs_review`; changed sources require renewed manual binding. Scoped deletion previews, saved graph and trial retrieval use the same engine contracts described below. The [knowledge service contract](../mcp-server/services/KNOWLEDGE_CONTRACT.md) records these boundaries.

## Editing Notes and sources

The editor adds **Новая Note**, **Добавить источник**, **Редактировать Note**, **Обновить источник**, and **Метаданные**. Note editing preserves docId, virtual path, omitted kind/tags and scopes. Source refresh explicitly reads its stored file/URL or accepts new text and preserves source type. Preparation produces a rendered preview, actual indexing progress and affected links. Publication requires a fresh version/token; shared changes require confirmation for every owning scope, with private links represented only by counts. Tags/kind alone keep the index; title/content changes rebuild it. Failed embeddings keep the saved revision. Explicit lexical indexing clears previous vectors. Missing section targets become `orphaned`; exact unchanged bindings can remain valid. After a conflict, the editor retains changed fields and refreshes untouched fields from the other client's revision.

**Убрать из области** removes one ownership scope and links that lose visibility, retaining the document/index in other scopes and links still visible through global. **Удалить полностью** previews all-scope impact and exact hierarchy/FTS/vector/link/edge cleanup; shared full deletion requires separate confirmation. Notebook facts remain. Common blobs survive until their last document; post-commit cleanup failure reports `saved` with `cleanupPending`, and `knowledge remove cleanup` retries it. Historical snapshots remain available for explicit restore. MCP/OpenCode `manage_knowledge_removal` and CLI `knowledge remove preview|apply` use fresh tokens and explicit `--confirm` (also `--confirm-shared` for shared full deletion).

## Graph and trial search

**Граф области / Граф источника** reads the saved graph with document/node/relation filters, checks both endpoints, and offers primary-entity navigation. An SVG overview and directed edge list show the same bounded page. Own manual links are edited/deleted through K2; structural edges are rebuilt from the source. Symbols remain name-only/nonunique, legacy structural origin is unrecorded, arbitrary edge provenance remains UNKNOWN. Limits: 5000 context documents, 10000 Notebook entries per scope, 5000 edge candidates; API pages up to 100, UI 40 and diagram up to 36 nodes. Truncation/completeness are explicit. No bulk edge deletion is introduced.

**Пробный поиск** explicitly selects lexical or dense and index or snippet output. Lexical never loads embeddings/reranker. Dense uses the exact locally cached model without download, model substitution or cache purge; an unavailable model disables that choice. Snippets can expand verified table/code policy parents in the same document/section; index mode returns identity/metadata without text expansion. Results include saved revision, actual returned fragment, policy, available scores and source/chunk navigation. Missing scores are null, legacy model provenance is UNKNOWN; results do not prove injection or agent use. Limits: 1000 query characters, 20 API hits (UI 5), 20000 text characters per hit, and dense scan bounded to at most 50000 micro-chunks (or a smaller configured limit).

```bash
memory-cli knowledge remove preview --scope-key <key> --operation unlink-scope --doc-id <docId>
memory-cli knowledge remove apply --scope-key <key> --operation unlink-scope --doc-id <docId> --preview-token <token> --confirm
memory-cli knowledge graph --scope-key <key> --doc-id <docId> --node-type fact
memory-cli knowledge search-status --scope-key <key>
memory-cli knowledge search --scope-key <key> --query "material decision" --search-mode lexical --result-mode snippet --policy-expansion true
```

These graph/search actions extend MCP/OpenCode `inspect_knowledge`, without requiring a running panel. After adding backend routes, restart an existing dashboard.

The same service works without the panel through MCP/OpenCode `manage_knowledge_content` and CLI:

```bash
memory-cli knowledge content read --scope-key <key> --doc-id <docId>
memory-cli knowledge content prepare --scope-key <key> --operation update-note --doc-id <docId> --expected-version <version-from-read> --fields-json '{"title":"Revised note","content":"New Markdown text","indexMode":"lexical"}'
memory-cli knowledge content apply --scope-key <key> --operation-id <operationId> --preview-token <token-from-preview>
memory-cli knowledge content status --scope-key <key> --operation-id <operationId>
```

Use `--confirm-shared` only after reviewing the prepared shared-document effects. `prepare` waits in CLI; MCP/HTTP `start` returns an operationId for polling. Preparations survive separate CLI invocations for 30 minutes in transient local staging (50 retained operations, 64 MiB each) and are excluded from snapshots. Cancellation discards preparation; a started network/model call may finish, and committed publication cannot be cancelled. Text editing is limited to 2 MiB normalized content, 32 MiB file/URL input, 5000 micro-chunks and 5000 affected links. Recorded model/dimension provenance travels with the saved metadata; vector search excludes known incompatible spaces. Legacy unknown provenance remains unverified. Older ingest calls reject unconfirmed shared updates and implicit type conversion; `remember_note` still creates a new Note.

CLI and MCP/OpenCode use the same mutation service:

```bash
memory-cli knowledge migrate
memory-cli knowledge link list --scope-key <registered-key>
memory-cli knowledge link preview --operation create --scope-key <registered-key> --fact-ref id:<factId> --doc-id <docId> --fields-json '{"relationType":"SUPPORTS","startLine":3,"endLine":5}'
memory-cli knowledge link apply --operation create --scope-key <registered-key> --fact-ref id:<factId> --doc-id <docId> --fields-json '{"relationType":"SUPPORTS","startLine":3,"endLine":5}' --preview-token <token-from-preview>
```

Full ZIP v2 and RAG v4 preserve K2 revisions and bindings; older formats remain readable and require explicit reconciliation for unknown legacy identities. Notebook writes and full restores recover pending publication after a process exit; an unexpected external file edit produces `RECOVERY_REQUIRED` instead of an overwrite. Process-interruption recovery is tested locally; power-loss durability is unverified. RAG-only import does not restore Notebook files.

## Panel lifecycle, authentication and ports

From this checkout, run:

```bash
node mcp-server/boot.js web
```

With this checkout installed or linked, use `memory-plugin web` (also `memory_plugin web` or `memory-cli web`). The existing `dashboard` command remains an alias. This command starts or reuses a detached local panel and exits; closing the terminal or an MCP client leaves the panel running. Installation, setup and MCP/OpenCode startup ensure the panel is available when `webAutoStart` is enabled (the default). Windows installs an owned, hidden per-user Startup launcher so the same panel returns at the next login. Other platforms currently ensure startup on installation/client launch, without installing an OS login service. CI and `MEMORY_DISABLE_WEB_AUTOSTART=1` suppress automatic launch and Startup registration.

The server listens only on `127.0.0.1`. Open the private connection URL printed by the command once; an HttpOnly, SameSite=Strict cookie reconnects the browser after a reload or panel restart. The browser removes the token from the address. The managed port and secret are retained in `<MEMORY_DIR>/web/connection.json`, outside full-memory snapshots; keep this private file locally. Concurrent clients share one verified panel per data directory. Automatic launches adopt a verified running panel even when it belongs to another build; `web status` and a page notice indicate when `web restart` is needed. Explicit `web start` or `web restart` replaces the running build. Only an explicitly saved cloud-snapshots / scheduled configuration enables the shared snapshot scheduler in the managed or foreground panel; its persisted deadline prevents duplicate sends from other clients. Ordinary reads never poll the cloud. Persona synchronization and model loading remain disabled in the panel process. No frontend build or cloud login is required.

```bash
memory-plugin web status          # running version, process and connection URL
memory-cli web open               # open the panel in the system browser
memory-plugin web restart         # reload the installed build at the saved address
memory-plugin web stop            # stop this instance; keep its saved connection
memory-plugin web autostart off   # disable install/client/login auto-launch
memory-plugin web autostart on    # re-enable and start the panel
memory-plugin web --foreground    # temporary panel until Ctrl+C
```

`autostart off` leaves an already running instance available; use `web stop` to stop it too. Full plugin uninstall removes its owned Startup entry and stops the managed panel, retaining memory and connection files unless an explicit data purge was requested. Removing just one client keeps the shared panel. After updating an already linked checkout, rerun `npm link --ignore-scripts` to register binary aliases if necessary.

The Windows login entry is stable per memory directory, independent of the package version or build path. Repeated launches leave an unchanged entry untouched; an update replaces its command in the same file. A profile redirected through `MEMORY_DIR` or `OPENCODE_CONFIG_DIR` gets no new Windows login entry automatically: enable it explicitly with `web autostart on` or the UI setting. Existing owned entries for custom profiles continue to be refreshed. Diagnostic probes (`MEMORY_CLIENT_PROBE=1`), CI, and `MEMORY_WEB_AUTOSTART=0` suppress automatic launch and registration. Tests that exercise login startup must set `MEMORY_WEB_STARTUP_DIR` to a sandbox directory.

The interactive CLI offers **WEB INTERFACE → Open Panel in Browser** as its first item. Opening the panel reuses the same managed server and saved address. The URL is also printed for manual access if the system browser cannot be launched.

By default, port `0` lets the OS choose a free port on the first managed launch; subsequent launches reuse that address. Set a preferred port through the TUI's **WEB INTERFACE → Web Interface Port**, or use:

```bash
memory-cli web port 8765        # save the port for subsequent starts
memory-cli web port             # show the saved port
memory-plugin web               # use the saved port
memory-plugin web --port 8766    # override for one run
memory-plugin web --port 0       # temporary foreground instance on a free port
memory-cli web port 0            # clear preferred port; managed saved address remains
```

A busy fixed port causes a clear error and a nonzero exit; the command does not change the saved setting. Ports accept integers from `0` to `65535`. Changing the setting affects future starts; restart an already running panel to use it.

## Editing conflicts and storage modes

Panel edits remain local in both supported storage modes and appear in subsequent full snapshots through the shared engine. Snapshot restoration invalidates drafts whose Notebook version changed. Former `only-cloud` installations show `MIGRATION_REQUIRED`, disable editing, and require the existing explicit backup/restore flow; viewing the panel never migrates, merges, or restores memory automatically.

The sidebar includes project search and a **Theme** selector with system, light, and dark options. On smaller screens, open **Область** to access them. Only the appearance choice is saved in a local browser cookie; it persists across dashboard ports. Project labels are shortened for display without changing their storage identities.

Saving shows a field comparison and checks the store version. If another client changes the store or its links, the draft stays open; **Обновить и сравнить** loads fresh data and preserves only your edited fields for a new review. Legacy records cannot be automatically matched after a conflict. Before explicit link migration, linked text/deletion remains guarded. After migration, editing text keeps the same fact/link ownership; deletion previews and removes only that fact's links. Unresolved legacy ownership still fails closed.
