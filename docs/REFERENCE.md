# MCP, CLI and configuration reference

[Documentation](README.md) · [Project overview](../README.md)

Tool and command inventories, configuration defaults, model controls and troubleshooting. Detailed workflows live in the [documentation index](README.md).

## Tool Reference

The MCP server exposes **22 tools**. The native OpenCode plugin exposes the same 22 plus two OpenCode-specific helpers, for **24 total**.

### Notebook and Cold Memory

| Tool | Important parameters | Purpose |
| :--- | :--- | :--- |
| `remember` | `fact`, `title`, `kind`, `scope`, `directory`, `ttl`, `keep`, `tags`, `supersedes`, optional link fields | Save a concise hot fact or directive. |
| `recall` | `scope`, `directory`, `query`, `tags`, `since`, `until`, `mode`, `offset`, `limit`, `includeSuperseded` | Load/filter Notebook facts and linked-document references. |
| `get_fact` | `id`, `scope`, `directory` | Read one fact and all metadata by stable ID. |
| `update_fact` | `id`, `newText`, `title`, `kind`, `scope`, `directory` | Update/reclassify a fact while preserving date, metadata, and links. |
| `forget` | `query`, `scope`, `directory`, `force` | Delete by index, range, ID, or text; `force` overrides `[KEEP]`. |
| `memory_info` | `directory` | Show version, storage paths/counts, Git identity/registry state, and RAG statistics. |
| `remember_note` | `title`, `content`, `kind`, `tags`, `scope`, `directory`, `generateEmbeddings` | Save a detailed cold/episodic note into RAG. |

### Identity and Knowledge Graph

| Tool | Important parameters | Purpose |
| :--- | :--- | :--- |
| `link_project_memory` | `directory`, `remote` | Register Git identity and migrate compatible legacy data. |
| `unlink_project_memory` | `directory`, `purge` | Remove an alias or purge its registry identity. |
| `relink_project_memory` | `directory`, `remote` | Move/merge memory into a new normalized remote identity. |
| `manage_project_memory` | `action`, `operation`, `directory`, `sourceKey`, `targetKey`, `remote`, `previewToken`, `confirm` | List/inspect and preview/apply Git identity registration, path unlink, project moves or explicit legacy migration. |
| `link_knowledge` | `action`, `factText`, `docId`, `scope`, `startLine`, `endLine`, `relationType` | Link facts to documents/notes or inspect graph links. |
| `manage_knowledge_links` | `action`, `scopeKey`, `operation`, `factRef`, `docId`, `linkId`, `fieldsJson`, `previewToken` | Explicit migration/status, scoped stable-link list and preview/apply create/update/delete. |

### RAG Knowledge Base

| Tool | Important parameters | Purpose |
| :--- | :--- | :--- |
| `ingest_document` | `content`, `type`, `title`, `path`, `scope`, `directory`, `generateEmbeddings` | Ingest raw text, a local file, or a URL. |
| `query_knowledge_base` | `query`, `scope`, `limit`, `instruction`, `resultMode`, `generateEmbeddings`, `directory` | Run one hybrid query in snippet or compact index mode. |
| `batch_query_knowledge_base` | `queries`, `scope`, `limit`, `instruction`, `resultMode`, `generateEmbeddings`, `directory` | Run several queries with one embedding batch. |
| `manage_knowledge_base` | `action`, `scope`, `docId`, `snapshotPath`, `directory` | Stats, list, full raw read, scoped delete/unlink, snapshot export/import. |
| `reindex_knowledge_base` | `model`, `dimension` | Rebuild vectors after changing model/dimension while preserving source and graph data. |
| `manage_knowledge_removal` | `action`, `scopeKey`, `operation`, `docId`, `previewToken`, `confirm`, `confirmShared` | Preview/apply scoped unlink or full deletion; retry committed blob cleanup. |
| `manage_knowledge_content` | `action`, `scopeKey`, `operation`, `docId`, `expectedVersion`, `fieldsJson`, `operationId`, `previewToken`, `confirmShared` | Read the editor, prepare/create/update Notes or sources, review impact, apply, inspect progress or cancel preparation. |

### OpenCode-Only Helpers

| Tool | Purpose |
| :--- | :--- |
| `list-mcp-tools` | Show connected MCP servers and their intended roles. |
| `mcp-reminder` | Suggest a connected MCP/tool family for a described task. |

---

## CLI Reference

`memory_plugin` and `memory-agent` are MCP stdio entry points. The [Quick Start](../README.md#quick-start) uses `npx -y @lotargo/memory_plugin ...`, so a separate global npm installation is not required. If the package is installed globally for development or administration, `memory_plugin setup` performs client installation, while `memory_plugin cli` or `memory-cli` opens the interactive control panel. Direct administration commands should use `memory-cli`.

| Command | Purpose |
| :--- | :--- |
| `memory_plugin setup [client flags] [--mode <mode>]` | Configure clients, skills, prompts, and optional cloud mode/auth. |
| `memory_plugin doctor --codex` | Validate Codex configuration and live MCP behavior. |
| `memory-cli` | Open the interactive TUI. |
| `memory-cli notebook targets` / `notebook read --key <key>` | Inspect exact Notebook stores, scoped refs and versions as JSON. |
| `memory-cli notebook transfer preview\|apply ...` | Review/apply a single directive move through the shared panel service; `notebook help` lists both-version and confirmation flags. |
| `memory_plugin dashboard [--port <0..65535>]` | Open the local Notebook dashboard; prints a private browser connection URL. |
| `memory-plugin web [--port <0..65535>]` | Start the same web interface; `0` chooses a free port. |
| `memory-cli knowledge help` | Inspect local Notes/sources, raw text, hierarchy, chunks, scoped links, graph and explicit trial retrieval as JSON, using an explicit scope key. |
| `memory-cli web port [<0..65535>]` | Show or persist the default web port; takes effect on the next start. |
| `memory-cli web open` | Start or reuse the local panel and open its saved address in the system browser. |
| `memory-cli login ...` / `logout` / `auth-status` | Manage Turso authentication. |
| `memory-cli link --dir <path> [--remote <url>]` | Link a Git project identity. |
| `memory-cli unlink --dir <path> [--purge]` | Remove an alias or registry identity. |
| `memory-cli relink --dir <path> --remote <url>` | Move/merge into a new remote identity. |
| `memory-cli identity --dir <path>` | Inspect resolved Git identity. |
| `memory-cli migrate_titles [--key <key>]` | Add titles to legacy Notebook entries. |
| `memory-cli enable-prompt` / `disable-prompt` | Add/remove only plugin-owned memory instruction blocks. |
| `memory-cli sync-persona` | Regenerate managed persona blocks from global directives. |
| `memory-cli migrate-persona [--dry-run]` | Convert legacy persona metadata to explicit `kind:directive`. |
| `memory-cli dev-link` | Link the installed binaries/OpenCode plugin to the working repository. |
| `memory-cli uninstall [--purge] [--purge-cache] [--dry-run] [--yes] [client flags]` | Remove plugin, MCP entries, prompts and skills; `--purge` deletes local data, while `--purge-cache` explicitly removes only this plugin's OpenCode cache. |

The TUI provides retrieval configuration, model management, Notebook/RAG browsing, reindexing, snapshots, cloud settings, prompt integration, diagnostics, and reset actions. Use Up/Down, Enter, and Backspace to navigate.

TUI Notebook edits use the same scoped service as the web panel. Enter a new title (or keep it with Enter), then a new body; an empty body cancels. Changes preserve date, metadata and source identity. Deletion reviews the selected store and source links, requires confirmation, and asks separately before removing a KEEP-protected record. If another client changes the record or its links, reload and review instead of overwriting it. A persona synchronization failure is reported as partial success after the Notebook is saved; existing agent sessions may need a context refresh.

To move one directive, open its concrete Notebook store and choose **Перенести инструкцию**. Select the destination, review both stores, the ID change and source links, then confirm. If a linked document is unavailable in the destination, opening it to that scope requires a separate reviewed confirmation; adding global scope makes that source visible across projects. Existing document scopes remain. The service saves a verified pinned local ZIP and publishes both Notebook files and links through the recovery journal. Date, TTL, KEEP, disabled state and metadata travel with the record. Prepare knowledge links first (`memory-cli knowledge migrate`); preview never migrates automatically. Duplicate bodies, replacement-history chains, unresolved links and independent graph edges block the move with an explanation. Existing client sessions may require refreshed context.

### Client status and explicit diagnostics

Open **Клиентские интеграции** in the local panel or **Diagnostics → Integration Status / Run Explicit Probe** in the TUI. Status inventories the five supported clients from local configuration and PATH, including disabled, foreign, duplicate, marketplace and project bindings. Configured does not mean installed or loaded in a session. Missing/malformed/linked files remain explicit and do not hide other clients.

```bash
memory-cli clients status
memory-plugin clients status --client codex
memory-cli clients probe --client codex --operation version --expected-version <version-from-status>
memory-cli clients probe --client codex --operation doctor --expected-version <version-from-status>
```

Status starts no client process. Each probe is explicit, has a 20-second deadline and 256 KiB output budget, returns only a checked summary, and reports changed configurations as stale. Failed requests are not retried automatically. Doctor accepts one owned direct Node/boot launcher or a verified Codex/Claude marketplace adapter with probe-mode support; npx, arbitrary commands, changed adapters and project overrides are unavailable. The diagnostic runtime disables persona/background sync, panel autostart and model command consumption; explicit MCP reads can initialize the local storage schema. Original CLI output, recalled bodies, environment credentials and raw errors are not returned. Results observe that diagnostic process, while active sessions, automatic hook delivery and agent usage remain UNVERIFIED. The latest result is kept only in the current panel process. Existing `doctor --codex` and `marketplace doctor` use this same service.

## Models

### Model runtime and resource monitoring

Embedding and reranker models run inside the long-lived MCP server process and load on **CPU/RAM by default** (`executionDevice: "cpu"`). The CLI can inspect, move, and unload them without restarting the server:

```bash
memory-cli models status [--json]          # where models live (CPU/RAM vs GPU/VRAM), VRAM usage, timer
memory-cli models load --device gpu        # switch to GPU (DirectML/CUDA) and preload models into the server
memory-cli models load --device cpu        # move models back to RAM
memory-cli models unload                   # instantly free model RAM/VRAM, prints before/after usage
memory-cli models timer 10                 # auto-unload after 10 min idle (off = never)
```

Commands reach the running MCP server through a file-based control channel (`<memory-dir>/control/`); AI agents use the same CLI, e.g. "unload the models and check memory is freed" → `memory-cli models unload`. When no server is running, `device`/`timer` changes simply persist and apply on next start.

The **Модели → RAM и память GPU** panel and `memory-cli models status` use one local resource-monitoring service. It detects the server's OS/architecture and GPUs, shows system RAM, per-process RSS for the observer and registered clients, and reports each GPU separately. Windows uses native RAM statistics, NVIDIA measurements and unambiguous single-adapter GPU counters; Linux uses `/proc/meminfo`, NVIDIA and AMD sysfs; macOS discovers unified/shared/dedicated GPU memory with `system_profiler`. Apple Silicon RAM is never counted twice as VRAM. Unavailable values remain `null` in JSON; Intel/shared GPU allocation, macOS GPU usage, multi-adapter Windows counter attribution and unavailable driver metrics are explicitly unsupported rather than estimated. Linux RAM usage uses `MemAvailable`; macOS free-page accounting includes reclaimable cache and does not claim an available-memory estimate. Windows swap usage is currently unavailable.

The panel refreshes every three seconds while its dialog and browser tab are visible. Native probes have timeouts and output limits, concurrent requests share cached readings, and hardware discovery is cached for one minute. Monitoring does not download/load models, reset idle unload timers, or access cloud services. Process RSS is not a model allocation measurement and process totals are not added together. JSON preserves the legacy `gpuMemory` field for the first measurable NVIDIA GPU and adds complete readings under `resources`. Windows native measurements are verified locally; Linux/macOS adapters have deterministic fixture coverage, with native Linux and macOS acceptance still required.

## Configuration

Configuration is stored in `<memory-dir>/config.json`.

| Key | Default | Meaning |
| :--- | :--- | :--- |
| `mode` | `only-local` | `only-local` or `cloud-snapshots` |
| `webPort` | `0` | Loopback web port (`0` automatically selects a free port); CLI `--port` overrides for one run |
| `webAutoStart` | `true` | Ensure background UI on install/client launch; restore it at Windows user login |
| `snapshotSyncMode` | `manual` | `manual`, `scheduled`, `off`; automatic uploads only in `cloud-snapshots` |
| `snapshotIntervalHours` | `24` | Arbitrary positive hours, including fractional values and `168` (weekly) |
| `fusionAlgorithm` | `rsf` | `rsf`, `rrf`, `semantic_only`, or `lexical_only` |
| `alpha` | `0.5` | Dense-vector weight for RSF |
| `embeddingModel` | `Xenova/multilingual-e5-small` | Local Hugging Face/ONNX embedding model |
| `vectorDimension` | `0` | Fixed vector size; `0` auto-detects model output |
| `vectorScanLimit` | `50000` | Maximum vector candidates; `0` is unlimited |
| `rerankerModel` | `none` | Optional cross-encoder; recommended multilingual: `SugoLabs/mmarco-mMiniLMv2-L12-H384-v1` |
| `rerankerEnabled` | `false` | Enable cross-encoder reranking |
| `rerankerTopN` | `20` | Fused-list head rescored per query (one batched ONNX pass) |
| `batchSize` | `12` | Ingestion embedding batch size |
| `policyExpansion` | `true` | Expand matched table summaries/code signatures |
| `executionDevice` | `cpu` | `cpu` (RAM, default) or experimental `webgpu` (GPU/VRAM) |
| `modelUnloadTimeoutMinutes` | `0` | Idle auto-unload of ML models; `0` keeps them loaded |
| `gpuAttentionBudget` | `2000000` | Experimental GPU micro-batch budget |
| `onnxThreads` | `0` | WASM thread count; `0` auto-detects |
| `tursoUrl` | `""` | Primary LibSQL endpoint populated by login |
| `authorized` | `false` | Whether cloud authorization completed |
| `username` | `""` | Authenticated Turso username |
| `ingestAllowedPaths` | `[]` | Additional directories allowed for local-file ingestion |
| `ingestAllowAnyPath` | `false` | Unsafe escape hatch allowing arbitrary file reads |

`ingest_document(type: "file")` is restricted to the current working directory, the plugin data directory, and explicitly allowed paths. This prevents a prompt-injected agent from silently indexing unrelated secrets such as SSH keys or `.env` files.

## Troubleshooting

- **`No such built-in module: node:sqlite` / `no such module: fts5`**: use Node.js 22.16+ in the 22.x branch, or 24+.
- **Codex tools are missing**: run `npx -y @lotargo/memory_plugin setup --codex`, then `npx -y @lotargo/memory_plugin doctor --codex`, and open a new Codex task.
- **OpenCode still runs old code**: restart OpenCode. For repository development, confirm `npm run dev:link` points its plugin entry to `opencode-plugin/main.js`.
- **Persona changes are not visible**: run `memory-cli sync-persona`, then start a new CLI session/task. Use `memory-cli migrate-persona --dry-run` for legacy entries.
- **Project recall is empty**: call `memory_info`; if a Git identity is `Registry: unlinked`, run `link_project_memory` or `memory-cli link --dir <repo>`.
- **A raw note/document exists only in cloud**: `manage_knowledge_base(action: "read_document")` automatically materializes and verifies its CAS blob locally when cloud credentials are available.
- **Embedding model changed**: run `reindex_knowledge_base` or use the TUI `[REINDEX]` action.
- **Models are sitting in VRAM**: run `memory-cli models device cpu` to move them to RAM, `memory-cli models unload` to free memory immediately, or `memory-cli models timer 10` for automatic idle unload.
