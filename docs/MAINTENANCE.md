# Maintenance and recovery

[Documentation](README.md) · [Project overview](../README.md)

Reviewed Notebook/settings migrations, RAG import/export/reset, isolated diagnostics and unused-file recovery. Full-memory checkpoints are described in [storage and snapshots](STORAGE_AND_CLOUD.md#full-zip-checkpoints).

## Notebook and settings maintenance

The panel's **Обслуживание** reviews title migration for one Notebook and global legacy persona classification before writing. It shows stable IDs assigned to old records, checks the Notebook and source-link versions, and verifies a pinned full local ZIP before publishing through the shared recovery journal. Knowledge-link migration must already be complete; use **Знания → Подготовить связи** if needed. Client files are synchronized separately through **Инструкции → Файлы клиентов**.

Settings reset/restore in **Обслуживание** covers search, models and source-access preferences, with a local integrity-checked backup and a fresh preview before restoration. Storage mode, cloud credentials, snapshot schedule, migration guards, port and startup remain preserved. Model owners and existing vectors require separate runtime commands or reindexing. See [reviewed client removal](INSTALLATION.md#install-one-client) for the implemented uninstall interface.

```bash
memory-cli maintenance status
memory-cli maintenance preview --operation migrate-titles --key <store>
memory-cli maintenance apply --operation migrate-titles --key <store> --preview-token <token> --confirm
memory-cli maintenance preview --operation reset-settings
memory-cli maintenance apply --operation reset-settings --preview-token <token> --confirm
memory-cli maintenance preview --operation restore-settings --backup-id <id>
```

`memory-plugin maintenance` accepts the same commands. `maintenance status` lists known stores and settings backup IDs; `maintenance help` describes all four operations. The TUI now reviews reset and title migration for one selected store. The legacy explicit title/persona CLI commands also use the shared backup and version checks; automatic prompt sync belongs only to the legacy persona command, with failures reported as partial.

## RAG export, import and reset

**Обслуживание** also exports, imports and resets **all local RAG scopes** through one service shared with CLI/TUI/MCP and both OpenCode registrations. Export saves and downloads a verified `.json.gz` containing documents/Notes, hierarchy, vectors, scopes, links, graph and deletion tombstones. It excludes Notebook files, identity registration and configuration. Browser uploads accept `.json` / `.json.gz` up to 32 MiB (128 MiB unpacked); the file is validated and frozen under a snapshot ID before review. A knowledge-link migration is required before export or mutation.

Import has two explicit modes: `merge` keeps documents absent from the input and completely replaces each affected document with its imported hierarchy and scopes; `replace` replaces all local RAG. Duplicate IDs/paths or broken relational references fail before publication. Imported source links require the exact Notebook key, unique stable fact ID and matching body; uncertain links retain a review state. Vectors are kept only when their per-document embedding provenance and dimension match the current model; otherwise imported vectors are cleared, the document becomes lexical-only and the result requests reindexing in **Модели**.

Import/reset show counts, sources/scopes and removed or uncertain Notebook links, require a fresh preview and explicit confirmation, and create a verified **pinned full local ZIP** before publication. Reset removes RAG rows, FTS, vectors, scopes, links and graph while preserving Notebook, project identities, settings, existing snapshot history and deletion tombstones. Physical unused blobs remain for separate cleanup. SQLite commits data and the operation receipt together; after a lost response, inspect recent completed operations before retrying. Restore the full ZIP through **Настройки → Снимки** if needed; full restore also restores the historical Notebook and registry, so review its own consequences.

```bash
memory-cli rag-maintenance status
memory-cli rag-maintenance export
memory-cli rag-maintenance stage --source-path <file.json.gz>
memory-cli rag-maintenance preview --operation import --snapshot-id <id> --mode merge
memory-cli rag-maintenance apply --operation import --snapshot-id <id> --mode merge --preview-token <token> --confirm
memory-cli rag-maintenance preview --operation reset
memory-cli rag-maintenance apply --operation reset --preview-token <token> --confirm
memory-cli rag-maintenance receipt --operation-id <id>
memory-cli rag-maintenance download --snapshot-id <id> --output-path <new-file.json.gz>
```

`memory-plugin rag-maintenance` accepts the same commands. `manage_knowledge_base` exposes `rag_status`, `export_snapshot`, `import_snapshot`, `reset_rag`, and `rag_receipt`. Import/reset return a preview first; apply uses its immutable `snapshotId` (import), `importMode`, `previewToken` and `confirm:true`. Explicit project/scoped fields are rejected for these whole-RAG operations. CLI output files must be new files; existing export paths are not overwritten. Custom-database low-level helpers remain compatibility primitives for isolated callers, rather than reviewed user endpoints. Maintenance runs synchronously under shared locks; background execution and cancellation are not provided for these bounded operations.

## Diagnostics and unused source files

**Диагностика и файлы RAG** runs an engine check in a separate process with a temporary home: Notebook write/readback, source links and graph projection, saved text and lexical retrieval. It does not load models, contact cloud services, inspect a client's active session or write test records to working memory. The TUI graph check uses the same isolated service.

The same section reviews unused content-addressed RAG files across **all local scopes**. It lists exact hashes and bytes; fresh reference/file/recovery checks precede removal. Referenced, foreign, linked and corrupt files are preserved. A verified local ZIP contains the unused bytes themselves, which ordinary full snapshots omit. **Active CAS reduction is not net disk space freed**: the recovery ZIP remains under `maintenance-blobs`. Notebook, SQLite/indexes, models, client files and snapshot history are preserved. Cleanup and recovery do not call cloud services.

If interrupted or if a response is lost, refresh the receipt list first. Choose the exact receipt and review **Продолжить прерванную очистку** or **Восстановить файлы из резервного ZIP**. Resume protects files that became referenced; restore only publishes missing files, never overwrites an existing different file, and can itself be retried from a fresh review after interruption. Normal status reads do not resume pending writes. Inspection is limited to 2000 eligible files, 64 MiB compressed bytes and 128 MiB unpacked bytes; unsupported inventories make no changes. These operations run synchronously; background queues/cancellation and backup expiration are not included.

```bash
memory-cli diagnostics status
memory-cli diagnostics run --operation graph-check
memory-cli diagnostics preview --operation cleanup-blobs
memory-cli diagnostics apply --operation cleanup-blobs --preview-token <token> --confirm
memory-cli diagnostics receipt --operation-id <id>
memory-cli diagnostics preview --operation restore-blobs --backup-id <receipt-id>
memory-cli diagnostics preview --operation resume-cleanup --backup-id <receipt-id>
memory-cli diagnostics apply --operation restore-blobs --backup-id <receipt-id> --preview-token <token> --confirm
```

`memory-plugin diagnostics` accepts the same commands. TUI **Diagnostics & System Actions** provides graph check, unused-file cleanup, restore and resume. Client `doctor`, setup/uninstall and hybrid/batch search remain separate operations; the isolated lexical check does not establish their acceptance.
