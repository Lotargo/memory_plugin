# Storage, cloud snapshots and security

[Documentation](README.md) · [Project overview](../README.md)

Local working memory, optional Turso checkpoints, authentication, legacy-mode migration, data locations and dependency security.

## Cloud Synchronization

Cloud support uses Turso / LibSQL and is optional.

| Mode | Behavior |
| :--- | :--- |
| `only-local` (default) | Markdown notebooks, SQLite index, CAS blobs, and models remain local. |
| `cloud-snapshots` (recommended for cloud backup) | Local working state; immutable full ZIP checkpoints in Turso. Manual by default, optionally scheduled in hours. |

`hybrid-sync` and `only-cloud` have been removed, including live push/pull, direct cloud working operations, conflict settings and failover. Ordinary reads, search and edits use local storage. Cloud access is limited to explicit snapshot operations and configured checkpoint uploads.

An existing `hybrid-sync` configuration serves local memory without live synchronization. Run `memory-cli snapshots enable` to save separate pinned local/legacy-cloud backups and switch to `cloud-snapshots`.

An existing `only-cloud` configuration reports `MIGRATION_REQUIRED` for ordinary reads/writes because its local cache may be incomplete. Run `memory-cli snapshots enable` to download, validate and save a full legacy-cloud archive alongside a separate pinned local backup. The result is `restore-required`, with a `cloudBackupId` and local restore command. Downloading does not apply the archive or enable uploads. Run the displayed `snapshots restore <cloudBackupId> --location local` command, inspect the preview, then repeat with its `--confirm <token>` (or explicit CLI automation `--yes`). Successful restoration enables manual `cloud-snapshots`. Recovery journals also finish this transition after interruption around the SQLite/config commit.

`snapshots status` reports `legacyCloudBackupRequired`, `legacyCloudRestoreRequired` and the prepared backup IDs. Failed downloads, corrupt archives and interrupted restores retain the pending state; uploads remain blocked. A repeated `enable` reuses a verified download, or re-downloads a missing/corrupt archive. Settings resets preserve migration flags. Old cloud tables are read without migrations or writes and remain intact. New selections of either removed mode fail before setup side effects.

### Full ZIP checkpoints

```bash
memory-cli snapshots enable
memory-cli snapshots upload
memory-cli snapshots configure scheduled 168  # weekly; 0.5, 24 etc. also work
memory-cli snapshots configure manual        # upload only on request
memory-cli snapshots configure off           # disable automatic uploads
memory-cli snapshots create                  # local backup without cloud access
memory-cli snapshots list --location cloud
memory-cli snapshots restore <id> --location cloud   # preview only
memory-cli snapshots restore <id> --location cloud --confirm <token>
memory-cli snapshots delete --older-than 3m --location both   # preview only
memory-cli snapshots delete --from 2026-01-01 --to 2026-07-01 --location cloud --yes
memory-cli snapshots pin <id> --location cloud
memory-cli snapshots help
```

`enable` saves separate pinned local and legacy-cloud backups before switching modes. It leaves old cloud tables intact and aborts if a legacy cloud backup cannot be read completely. It never merges old cloud data into the local working state. Former cloud-only installations additionally require an explicit restore of the downloaded archive. On a fresh installation, choose a checkpoint explicitly with `list` and `restore`; even empty local memory is never automatically repopulated. Existing supported modes remain selected. Close other memory clients before switching/restoring so their in-flight operations cannot write stale results afterward.

Every checkpoint is independent: one ZIP with DEFLATE level 9, containing Notebook stores for **all projects**, Git identity/alias registry, RAG documents and raw text, sections/chunks, vectors, scopes, graph/fact links and deletion tombstones. Embedding model/dimension settings travel with it. Authentication, machine secrets, original multimedia files, model caches and legacy synchronization queues do not. ZIP/state/blob hashes are checked on restore, with a bounded decompression limit. Compression reduces text size; embedding vectors can compress less.

The cloud stores metadata and the complete binary ZIP in **one `memory_snapshots` row** per checkpoint. Ordinary memory writes have no cloud side effects in this mode. An unchanged content hash causes **zero cloud calls**. Metadata lists omit BLOBs; fetching a selected ID reads only that archive. After schema creation, a changed-state upload issues one INSERT, independent of the number of facts or RAG chunks inside. A batch cleanup issues one DELETE for the selected period; billing still counts deleted rows, rather than counting the SQL command as one write.

The scheduler runs while an MCP/OpenCode host or the web panel is active, checks the persisted deadline locally every 30 seconds, and accepts any positive finite hour interval. After downtime it sends one current checkpoint, without replaying missed intervals. Each attempt first saves a local ZIP under `<memory>/storage/snapshots/`. A 429, quota `BLOCKED`/402 or network failure leaves that ZIP intact; there is only a latest-pending pointer, not a queue of uploads. Network failures use persisted exponential backoff (2–24 hours). Quota errors suspend automatic cloud attempts until a successful manual `upload`; scheduled local captures continue. `status` shows deadlines, pending ID and the last error. Manual upload bypasses the backoff and sends the current state.

Restore previews current/replacement counts and returns a token tied to the current state. Applying a fresh token creates a pinned pre-restore local backup, then **replaces** local Notebook/RAG/registry state and rebuilds FTS. Extra current entries are removed. A filesystem recovery journal handles interruption around the SQLite transaction. Restore does not upload automatically; the next upload creates a new checkpoint of the restored state. Global persona prompts are refreshed after a successful restore.

Cleanup supports local, cloud or both locations, with a half-open date range `[from,to)` or `--older-than Nd|Nm|Ny` (calendar months/years). Preview shows count and compressed bytes; use its token or explicit `--yes` to apply. Pinned checkpoints and the latest successful/local pending checkpoint are protected by default. `pin --unpin` removes a pin; `--include-protected` explicitly overrides protection. Full archives have no dependency chain, so deleting older checkpoints cannot break newer ones. Local ZIP history is retained until cleanup; no silent retention policy is imposed.

CLI dates use ISO format: `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm[:ss[.sss]][Z|±HH:mm]`; values without a zone use UTC. Period deletion requires both `--from` and `--to`, or a single `--older-than` age. Unknown/duplicate flags and extra arguments fail before any operation.

Agents can use the same actions through MCP and native OpenCode `manage_snapshots`. Restore/delete require the preview token after user approval. `--yes` is available for explicit CLI automation. The older RAG-only `export_snapshot` / `import_snapshot` still export/merge RAG data; they are separate from full checkpoint replacement.

### Authentication

```bash
memory-cli login
memory-cli login --api-token          # hidden prompt if value omitted
memory-cli login --from-env
memory-cli login --db-url <URL>       # token from prompt or TURSO_DB_TOKEN
memory-cli auth-status
memory-cli logout
```

Stored tokens live in `auth_secrets.enc`, not `config.json`. They are encrypted with AES-256-GCM using PBKDF2-HMAC-SHA256 (600,000 iterations) over a stable machine fingerprint and written with owner-only permissions where supported.

This is not an OS keychain. It protects against casual inspection/file-only exfiltration, not a compromised local user account. Encrypted secrets are machine-bound. The headless `.env` fallback stores credentials in plaintext by design.

## Storage, Privacy, and Security

The data-directory resolution order is:

1. `MEMORY_DIR`.
2. `$OPENCODE_CONFIG_DIR/memory`.
3. Existing legacy `~/.config/opencode/memory`.
4. `%LOCALAPPDATA%/opencode/memory` on Windows.
5. `$XDG_CONFIG_HOME/opencode/memory` or `~/.config/opencode/memory` elsewhere.

Important paths inside it:

```text
global.md                         global Notebook facts/directives
git_<identity>.md                 per-project Notebook facts
config.json                       non-secret configuration
auth_secrets.enc                  encrypted cloud credentials
storage/memory.sqlite             RAG, graph, identity registry, sync state
storage/blobs/                    content-addressed compressed raw sources
storage/models/                   cached ONNX models
exports/                          snapshots/exports
```

- No telemetry or analytics are sent.
- Model weights download from Hugging Face on first use and remain cached afterward.
- Network access is otherwise limited to explicit URL ingestion and configured Turso cloud modes.
- Snapshot path validation and local ingestion allowlists restrict arbitrary filesystem access.
- SQLite uses foreign keys, migrations, transactions, and a busy timeout for concurrent access.

### Dependency Advisories

Spreadsheet ingestion uses SheetJS CE `0.20.3` from the official SheetJS CDN rather than the stale `xlsx@0.18.5` package in the public npm registry. This version is outside the affected ranges for the known [prototype pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) and [ReDoS](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) advisories.

The 2026-10-21 production dependency audit reports **zero known vulnerabilities**. Transformers.js `4.3.1` uses patched Sharp `0.35.5` and ONNX Runtime `1.30.0`. DOCX ingestion retains the unmodified Mammoth `1.13.0` library API as [reviewed source modules](../mcp-server/vendor/mammoth/README.md), excluding its unused CLI and legacy argument-parser dependency. All external parser libraries remain explicit, audited dependencies; copied modules retain their BSD license and verified upstream hashes.

The published `npm-shrinkwrap.json` locks the tested dependency tree for consumer installations. `npm run release:check` and `prepublishOnly` fail on dependency advisories at low severity or higher. A clean audit covers known advisories, not every possible defect; vendored source updates also require upstream/security review.
