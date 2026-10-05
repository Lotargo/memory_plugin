# Changelog

All notable changes to `@lotargo/memory_plugin` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.1] - Unreleased

- Shared local RAM/GPU monitoring in the Models panel and `memory-cli models status --json`: automatic OS/GPU discovery, system RAM and registered-process RSS, all NVIDIA adapters, Linux AMD sysfs, unambiguous Windows GPU counters, and macOS unified/shared/dedicated memory detection. Unsupported measurements remain null; readings never load models or touch idle unload timers. The panel polls only while visible, with bounded native probes, single-flight caching and separate hardware-discovery caching.

### Added

- A4.2 RAG-only administration in **Обслуживание**, `memory-cli rag-maintenance`, TUI and shared MCP/OpenCode V1/V2 adapters: verified export/native download and immutable JSON/gzip inputs, explicit whole-document merge or full replacement, preview/confirmation/CAS and pinned full ZIP backup. Atomic SQLite publication covers hierarchy, scopes, links, graph, FTS, vectors, tombstones and a durable receipt. Exact Notebook key/ID/body checks keep uncertain imported links reviewable; per-document vector provenance prevents mislabeling old embeddings and requests reindexing when cleared. Reset preserves Notebook, identities, settings, snapshot history and physical CAS files for separate cleanup. Isolated Windows engine, actual MCP stdio, terminal and desktop/mobile browser acceptance are recorded in `dev_docs/RAG_MAINTENANCE_REPORT_2026-10-05.md`; diagnostics/cleanup and uninstall remain pending.

- A4.1 local maintenance in the panel and `memory-cli maintenance`: reviewed single-store title/persona migrations with stable legacy IDs, coherent Notebook/link versions, verified pinned ZIP backups and shared SQL/file journal recovery. Reset/restore only search, model and source-access preferences with integrity-checked local backups and fresh configuration checks; storage/cloud/schedules/migration guards/panel startup remain preserved. TUI title migration/reset use the same reviewed service. Runtime models, vectors and managed client files require separate explicit actions. RAG maintenance is covered by A4.2; isolated diagnostics and uninstall UI remain pending.

- A3 managed prompt/persona administration: per-client read-only status and current/after preview in the local panel, reviewed enable/disable/sync through one service, scoped CLI entrypoints and TUI confirmation. Preserve foreign UTF-8/BOM/CRLF, original file ownership, marketplace skip, strict stale-state checks, durable backups and guarded journal rollback/recovery. Marketplace channel migration cleans only its previously captured unchanged direct prompt. Isolated engine/CLI/TUI/HTTP, desktop/mobile and all 54 regression suites pass; active-session delivery remains unobserved.

- Reviewed single-directive transfer in the local panel and `memory-cli notebook`: exact source/target refs and versions, deterministic ID remapping, preserved metadata and moved source links, separate approval for opening linked sources to the target, and a verified pinned ZIP before publishing two Notebook files with SQL/journal recovery. Duplicate bodies, replacement-chain splits, ambiguous links and independent graph edges fail closed. Isolated engine/CLI/HTTP, process-exit recovery, desktop/mobile browser and regression checks cover the supported boundary.

- TUI Notebook update/protect/delete now use the dashboard's shared scoped service: coherent record/link versions, stable references, title/body editing with preserved metadata, explicit deletion and separate KEEP confirmation. Link writes use the engine journal once; stale edits and storage errors are shown without automatic retry, and client persona failures report partial success. Isolated integration and real Windows terminal acceptance cover this increment.

- Client-specific persona preview in the local panel: shared OpenCode V1/V2 context builders, per-directive inclusion/exclusion reasons, scoped record navigation, legacy/TTL handling, refresh and explicit partial managed-template coverage for other clients. Preview does not write client files, load models or claim active-session/agent usage. The operation matrix records remaining TUI/service and administration gaps.

- Notebook dashboard completion: cross-store browsing with exact ownership and explicit unavailable scopes, combined kind/tag/date/history filters, and reviewed record replacement with fresh IDs/TTL, preserved historical source links and optimistic conflict handling. Shared engine, MCP readback, browser desktop/mobile and isolated tests cover this increment. Agent retrieval scope remains global plus the current project.

- Local Codex/Claude marketplaces with a sanitized, locked, prepared runtime snapshot outside client caches; bundled `using-memory` and SessionStart context; native install/remove, explicit return to direct setup, configured-status and installed-adapter MCP diagnostics. Migration guards duplicate registrations, modified skills, foreign/project bindings and storage-directory mismatches while retaining shared memory and unrelated instructions. Persona/dev-link synchronization respects marketplace ownership. Direct Claude setup now uses its installed engine's Node launcher; isolated profiles honor `CODEX_HOME`/`CLAUDE_CONFIG_DIR`. Hermetic and real-client acceptance cover channel transitions, native listings, installed adapter protocol and memory retention; automatic client hook delivery still requires trust/session acceptance.

- Web **Настройки**: version-checked storage mode changes through the existing backup/migration service; manual/off/scheduled snapshots with positive fractional-hour intervals; local snapshot creation, explicit upload/list/pin, restore and protected period cleanup with fresh previews. Search/model/compute/source-access/web-port/autostart settings use a validated allowlist and shared configuration. Database URL/token login uses the encrypted credential store, with a separate read-only connection check and no secret echo. Saved schedules run in managed and foreground panels through the same persisted-deadline scheduler. Model changes flag pending reindexing. The separate **Модели** panel supports strict download/validation, cache inspection/removal preview, per-process CPU/GPU load/unload/device control with explicit acknowledgement, and transactional reindex with persisted progress. Admin jobs run outside the dashboard; failed downloads preserve the cache and never silently substitute a model. Registered owners have separate state/command/ack receipts; stale and legacy protocol states cannot claim successful control. Client setup remains a CLI action. API/regression and isolated desktop/mobile browser scenarios cover conflicts, drafts, migration failures, uploads and restore.

- Persistent local web panel: detached singleton per memory directory, saved connection address and secret, browser reconnection through an HttpOnly same-origin session cookie, verified build replacement, strict status/stop/restart/autostart commands, automatic npm/setup/MCP/OpenCode launch, and an owned hidden Windows user-login launcher. CI/explicit opt-out suppress startup; full uninstall stops the panel and removes its launcher without purging memory. Isolated tests cover racing launchers, stable restart, hidden login launch, foreign-port refusal and authentication/origin guards.

- Local dashboard branding now reuses the website's pixel mark in the sidebar and serves SVG, ICO, PNG favicons and the Apple touch icon from the packaged dashboard assets.

- Project administration in the local panel: Git inspection/registration, narrow path unlink, scoped memory moves and explicit legacy migration, with preview/conflict handling and pinned verified checkpoints in the normal restore catalog. A shared project service now backs HTTP, CLI/TUI, MCP and both OpenCode registrations. Moves preserve record metadata, remap colliding fact IDs and replacement history with their links, preserve other document scopes, and publish files/registry/RAG through the recovery journal. No-checkout, stale-preview, process-exit recovery, browser/mobile and zero-network checks are covered; the broader panel remains incomplete.

- Knowledge UI K4–K6: shared scoped unlink/full-delete previews with exact graph/FTS/link cleanup and durable blob retries; a bounded saved graph with both-endpoint visibility and K2 manual-link actions; explicit lexical/local-cached dense trial retrieval with index/snippet/policy output, actual source revisions and navigation. Foreign chunk/policy parents cannot leak through retrieval; read-only dense loading never downloads, substitutes or purges models. Isolated browser/CLI/MCP/OpenCode, installed-package, cached real ONNX and namespaced live Turso acceptance are recorded in the stage reports.

- Knowledge UI K3: stable Note editing, metadata changes and explicit file/URL/text refresh through shared durable prepare/status/apply/cancel operations in UI/CLI/MCP/OpenCode. Fresh versions and preview tokens protect shared publication; conflict rebasing preserves user edits and concurrent untouched fields. Failed embeddings preserve the previous revision, explicit lexical indexing clears old vectors, recorded provenance isolates known model/dimension spaces, missing sections become orphaned, and SQL-ledger receipts recover process-interrupted publication. Legacy shared-ingest/type-conversion bypasses are rejected; `remember_note` continues creating new Notes.

- Knowledge UI K2: stable fact/link IDs, explicit full-backup migration with an ambiguity report, scoped preview/apply link creation/editing/deletion, and shared `manage_knowledge_links`/CLI adapters. Linked Notebook edits preserve ownership; deletion removes only that fact's links. Full ZIP v2/RAG v4 preserve revisions and accept legacy formats. Journal/SQL-ledger recovery covers process exits during Notebook publication and full restore; conflicting external edits fail closed.
- Local Markdown, KaTeX and Mermaid rendering for Notebook, instruction previews, saved sources and chunks, with source toggles, sanitized output, strict diagram limits and theme updates. Select chevrons have an inner inset; pointer clicks no longer outline content blocks and keyboard focus stays visible.

- Knowledge inspector (K1) in the local dashboard: scoped Notes/sources, normalized raw text pages, section/medium/micro inspection and Notebook source/back links. Shared read contracts are available through `memory-cli knowledge`, HTTP and MCP/native OpenCode `inspect_knowledge`, including projects without a checkout. Legacy links remain `needs_review`; missing vector provenance and source coordinates remain UNKNOWN. Mutations, saved graph and retrieval preview are covered by the K2–K6 changes.
- `memory-plugin web` binary/command alias, preserving `memory_plugin` and `dashboard`. Persistent `webPort` via `memory-cli web port [N]` and the TUI's WEB INTERFACE category; `--port N` overrides one run, and `0` automatically selects a free port. Invalid arguments and occupied ports report nonzero exits without dispatching other commands.
- Local-authoritative `cloud-snapshots` mode: standalone full-memory ZIP archives (DEFLATE level 9) stored as one Turso BLOB row each. Includes all Notebook projects, Git identities, RAG raw text/vectors/scopes/links; excludes secrets, multimedia and caches. Explicit transition saves both local and legacy-cloud backups; no automatic merge or bootstrap restore.
- Manual/off or arbitrary-hour checkpoint scheduling, persisted deadlines, unchanged-state skipping, one current upload after downtime, local ZIP fallback on quota/network failure, latest-only pending pointer and bounded backoff. BLOCKED/429/402 suspend automatic cloud attempts until a successful manual upload.
- `memory-cli snapshots` and MCP/OpenCode `manage_snapshots`: metadata listing, local backup, upload, exact restore with preview/pre-restore backup/recovery journal, pinning and period/age cleanup with default latest/pinned protection. RAG-only export/import remain available separately.
- Local Notebook dashboard through `memory_plugin dashboard` and `memory-cli dashboard`: global/project browsing, project and record search, structured editing, protected deletion, directive enable/disable, persona preview, responsive navigation, and system/light/dark themes. The loopback server uses a per-run connection token and the shared Notebook service without cloud polling or model loading. This is the first panel increment; RAG editing, settings, cloud administration and the full panel plan remain incomplete.
- Isolated integration coverage for the dashboard, concurrent Notebook edits, full snapshot restoration, quotas, scheduling, corruption, interruption recovery, local RAG deletion, and both retired storage-mode migrations.

### Removed

- Removed `hybrid-sync` and `only-cloud`, the live Notebook/RAG push/pull worker, direct cloud working operations, mutation queue, conflict settings and failover from storage, setup, CLI and the local panel. The supported modes are `only-local` and `cloud-snapshots`.
- Existing `hybrid-sync` configurations serve local memory without cloud traffic until an explicit `memory-cli snapshots enable` transition. Separate pinned local/legacy-cloud backups are preserved before switching; a failed backup retains the migration flag and blocks uploads. New selections of the removed mode fail before setup side effects. Legacy cloud tables and local backlogs are not purged by the upgrade.
- Existing `only-cloud` configurations report `MIGRATION_REQUIRED` until an explicit two-step transition downloads a checked full cloud archive and restores it locally with a preview/confirmation. Failed downloads or restores retain migration flags and block uploads; verified downloads are reusable, and restoration journals recover configuration after interruption. Ordinary memory and RAG operations no longer initialize cloud clients or retry remote SQL.

### Fixed

- Dashboard migration contracts: incomplete former `only-cloud` caches report `MIGRATION_REQUIRED` as HTTP 409 and an unavailable/read-only overview with actionable recovery instructions. Tests cover UI edits in snapshot capture/upload, zero implicit cloud calls, restored links and stale drafts after restoration, command routing, port overrides/persistence and signal cleanup.
- Snapshot CLI rejects unknown/duplicate flags, extra arguments and incomplete deletion periods before touching history. ISO dates without a zone consistently use UTC; invalid calendar dates fail. All CLI entrypoints preserve failure exit codes and route snapshot help correctly.
- OpenCode plugin entrypoint (`opencode-plugin/main.js`) now exports a V2 plugin definition (`default` object with `id` and `setup`) instead of a V1 plugin function. Newer OpenCode loaders reject the old shape with `Plugin must export a default definition with an id and an effect or setup function`, which left the plugin inactive. All 19 tools are registered via `ctx.tool.transform` and Notebook/RAG memory injection runs via `ctx.session.hook("context")`. The legacy V1 named export is kept for existing tests.
- Notebook reads and mutations now share project targeting: explicit directories override the current worktree, and existing canonical/legacy store keys target the same store for recall, remember, update, and forget. Unknown targets no longer fall back to a different project. Invalid mutation scopes, empty forget queries, and non-boolean force flags are rejected; deletion replies identify the actual store and removed count.
- Notebook writes check the version observed by CLI/MCP or supplied by the dashboard under a shared reentrant storage lock, rejecting stale edits instead of overwriting another client's changes. Disabled directives remain visible in storage and recall but are excluded from persona/context injection. Linked-text edits and deletion are explicitly blocked in the first dashboard increment until link migration is supported.
- Local RAG deletion cleans scopes, links, graph edges and unreferenced blobs transactionally without a live cloud queue. Document mutations use the selected local database and update its document version.
- The unified test runner now isolates memory and client configuration before module imports, preventing tests from using installed memory or cloud settings. Added regressions for Notebook targeting, destructive argument validation, local RAG deletion, recovery, migration guards, and custom database isolation. Aligned the root lockfile version with 1.7.1.

## [1.7.0] - 2026-09-20

### Added

- ML model lifecycle control: new `memory-cli models` command family — `status [--json]` (where models live: CPU/RAM vs GPU/VRAM, VRAM usage, timer state), `unload` (instantly drops embedding + reranker ONNX sessions from the running MCP server and reports freed RAM/VRAM), `load [--device cpu|gpu]` (preload into the server, optionally switching device), `device cpu|gpu` (move models between RAM and VRAM), `timer off|<minutes>` (idle auto-unload). Commands reach the long-lived MCP server through a file-based control channel (`<memory>/control/`), so agents can drive them via the CLI.
- Idle auto-unload: new `modelUnloadTimeoutMinutes` config (default `0` = off); the MCP server drops both models after the configured inactivity period and reloads them lazily on next use.
- Interactive CLI: "Model Auto-Unload Timer" and "Unload Models Now" entries under ENGINE & HYBRID SEARCH SETTINGS; switching "Execution Hardware" now also unloads model sessions held by the CLI process itself.
- Agent skill (`using-memory`) documents how to answer user requests like "load models into the GPU" or "unload models and verify memory is freed" using `memory-cli models ...`.

### Changed

- Restructured the `using-memory` agent skill to follow the canonical Agent Skills layout with progressive disclosure: `SKILL.md` is now a compact router (frontmatter, layer overview, mandatory session-initialization sequence, tool decision matrix, and core directives), while detailed tool documentation moved into on-demand reference files under `references/` — `notebook.md`, `rag.md`, `knowledge-graph.md`, `mcp-helpers.md`, and `models.md`. Agents now load only the references relevant to the current task instead of the full monolithic instruction.
- Made `hybrid-sync` strictly local-first for normal memory, RAG, knowledge-base, and CLI statistic reads. Turso initialization, remote migrations, reverse sync, and legacy blob backfill now run only on the background or explicit sync path.
- Added persistent local sync state with a 30-second Notebook pull cadence and a 5-minute RAG pull cadence across short-lived CLI processes.
- Made RAG reverse sync incremental: unchanged or locally newer documents are rejected from the expensive remote bundle fetch before sections, chunks, scopes, links, and graph edges are queried.
- Raw RAG blobs are now materialized lazily only when `read_document` needs missing local content instead of during every reverse sync.
- Added opt-in `MEMORY_SYNC_TRACE=1` timing diagnostics for cloud initialization, Notebook pull, RAG pull, and total sync duration.

### Fixed

- The reranker ONNX session now tracks its execution device and is reloaded when `executionDevice` changes (previously it silently stayed on the first device it was loaded on).
- Skill uninstall ownership check (`isOwnedSkillDir`) now recursively compares the whole installed skill directory against the packaged one, so the new `references/` subfolder no longer marks the plugin-owned skill as user-modified; customized skills remain protected from deletion.
- RAG scope, knowledge-link, graph-link, and embedding reindex mutations now advance the parent document version before sync so incremental reverse sync cannot mistake changed bundles for unchanged documents.
- Updated reverse-sync and cloud-portability integration coverage for local-first reads and lazy raw-blob restoration.

## [1.6.10] - 2026-09-08

### Fixed

- Fixed OAuth callback rejecting every real Turso login: Turso redirects to `/?jwt=<JWT>&username=<USERNAME>` without echoing `state`, so a missing state is now accepted with a warning (the token is still validated against the Turso API); only a present-but-mismatched state is rejected as CSRF.

## [1.6.9] - 2026-09-08

### Fixed

- Fixed Turso browser OAuth on Windows: URLs no longer go through `cmd.exe` (which truncated the query string at `&`), browser launch now uses `rundll32.exe url.dll,FileProtocolHandler`. The OAuth loopback server now binds an ephemeral port before the login URL is built, eliminating the listen race and `EADDRINUSE` on the fixed port.
- Made the `policy_retrieval` unit test offline-deterministic: ingestion now runs with `generateEmbeddings: false` (BM25/policy path only) and DB/temp cleanup is guaranteed via `try/finally`, so a corrupted ONNX model cache no longer fails the suite and blocks the runner.

## [1.6.8] - 2026-08-25

### Changed

- Refreshed npm package positioning around local-first memory, hybrid RAG, agent personalization, and coding-agent integrations.
- Expanded package keywords for agent memory, coding agents, personalization, context engineering, local-first workflows, and Google Jules discovery.
- Updated package repository, homepage, and issue metadata to the canonical `Lotargo/memory_plugin` repository after the GitHub rename.
- Updated README hero asset URLs to the canonical repository and added a text H1 covering memory, hybrid RAG, and agent personalization.
- Updated the spreadsheet parser import to the ESM-compatible SheetJS namespace form.

### Security

- Replaced the stale public-npm `xlsx@0.18.5` dependency with SheetJS CE `0.20.3` from the official SheetJS CDN, moving spreadsheet ingestion outside the affected ranges for the known prototype-pollution and ReDoS advisories.
- Updated dependency-security documentation to distinguish the fixed direct SheetJS exposure from the remaining transitive `sharp` / libvips warning in `@huggingface/transformers`; the project disables the Transformers image-decoding path with `env.sharp = false`.

## [1.6.7] - 2026-08-24

### Changed

- OpenCode's native auto-injection now explicitly suppresses redundant startup `recall` calls while preserving manual recall for inspection, filtering, history, and explicit scopes.
- Added an OpenCode system-prompt overlay policy that treats user-approved personality, behavior, tone, style, preference, and working-convention memories as active personalization instructions rather than passive facts.
- Updated shared prompts and the bundled memory skill to distinguish auto-injected clients from integrations that must initialize with `recall(scope: "all")`.
- OpenCode now separates active `<PERSONAL_AGENT_OVERLAY>` entries from descriptive `<MEMORY_FACTS>` and injects the actual active directives into `experimental.chat.system.transform`.
- `dev:link` now synchronizes managed prompts and bundled skills for non-OpenCode clients in addition to linking the OpenCode source and system CLI.
- Claude Code, Gemini CLI, and Codex setup/uninstall now use each client's native MCP lifecycle command first, verify the resulting registration, and fall back to ownership-checked JSON/TOML editing only when the client CLI is missing, fails, or leaves the expected entry unchanged.
- Gemini CLI is now a separate integration using `~/.gemini/settings.json`, `~/.gemini/GEMINI.md`, and `~/.gemini/skills`; Antigravity keeps its distinct `~/.gemini/config` and optional workspace `.agents` layout.
- Normal OpenCode uninstall now preserves the host package cache. Cache cleanup is explicit through `--purge-cache` and removes only exact package-owned directories, including versioned cache entries.

### Added

- Added `npm run dev:link` / `memory-cli dev-link` for local development. It globally links the repository CLI and points OpenCode at the working tree through a `file://` plugin entry, eliminating npm publication and reinstall cycles during testing.
- Added explicit Notebook `kind: "fact" | "directive"` semantics across MCP and OpenCode `remember` / `update_fact` tools, with `[DIRECTIVE]` recall badges and compatibility for legacy persona/preference tags.
- Added managed persona prompt synchronization for Codex, Claude Code, and Antigravity through `memory-cli sync-persona` / `npm run persona:sync`, including automatic refresh after global directive mutations and cloud pulls.
- Added idempotent `memory-cli migrate-persona [--dry-run]` / `npm run persona:migrate` to permanently classify legacy global personalization entries as `kind:directive` and regenerate managed client prompts.
- Added `memory_plugin uninstall` / `memory-cli uninstall` and the `memory_plugin setup --uninstall` alias with per-client targeting, `--dry-run`, data-preserving defaults, guarded `--purge`, and explicit `--purge-cache` support.
- Added a shared cross-platform client path and CLI execution layer with Windows npm-shim support plus `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `OPENCODE_CONFIG_DIR`, and `MEMORY_DIR` handling.

### Fixed

- Fixed `remember_note` omitting the ingestion `blobHash` from its public result, which broke cross-device raw-blob portability consumers and was previously masked by Windows temp-cleanup errors.
- Fixed concurrent `triggerBackgroundSync()` callers returning before the active queue drain completed; callers now join one active promise that includes requested follow-up passes.
- Fixed uninstall ownership checks so foreign `memory-agent` registrations, unrelated OpenCode plugins/cache packages, modified skills, and user-authored content outside managed prompt/persona markers are never removed.
- Fixed Codex TOML cleanup to remove only plugin-owned `memory-agent` tables while preserving unrelated formatting and child sections, and made malformed client configuration fail closed instead of being overwritten.
- Fixed uninstall failure reporting to return a non-zero exit status when any requested cleanup step fails.

## [1.6.6] - 2026-08-17

### Fixed

- Fixed npm package distribution files list to include `mcp-server/rag_scope.js` and all server modules.

## [1.6.5] - 2026-08-17

### Added

- Added explicit `directory` (and `project` alias) parameter support to Notebook/Memory tools (`remember`, `recall`, `get_fact`, `forget`, `update_fact`, `memory_info`, `link_knowledge`) and RAG tools (`ingest_document`, `query_knowledge_base`, `batch_query_knowledge_base`, `manage_knowledge_base`) across both the MCP server and native OpenCode plugin.

### Fixed

- Fixed cross-directory workspace routing and isolation so operations targeting external project paths work reliably without directory mismatch or leaking npm process `INIT_CWD`.
- Fixed `batch_query_knowledge_base` query execution and result formatting in the MCP server.

## [1.6.4] - 2026-08-13

### Added

- `memory_info` now reports whether the current Git identity is `Registry: linked`
  or `Registry: unlinked`, enabling agents to register new repositories automatically.
- RAG documents now have explicit global/project scope associations. The default
  project scope follows the current linked Git identity, while `scope: "all"`
  retrieves only global knowledge plus the current project's knowledge. A source
  shared by several scopes is stored once and associated with each scope.
- The native OpenCode plugin now exposes `batch_query_knowledge_base`, bringing it
  to all 15 shared tools plus its two OpenCode-only helpers.

### Changed

- OpenCode auto-injected memory now includes complete fact bodies for both global and
  current-project stores without the previous ten-fact truncation and instructs the
  agent to register an unlinked Git identity. Header-only initialization was removed
  because it loses essential context.
- The bundled memory skill now defines full-body session recall, strict project
  isolation, agent-resolved conflicts, automatic Git project registration, and
  selective RAG curation for important web findings and current technical
  documentation, including links from project facts to supporting sources.
- `recall` hides superseded facts by default and exposes history through
  `includeSuperseded: true`. Filtered output keeps physical storage indices stable,
  so a displayed number always targets the same fact in `forget`.

### Fixed

- Re-ingesting an existing path or URL now preserves its document ID, scope
  associations, and fact links while rebuilding chunks, vectors, FTS rows, and
  structural graph edges for changed content.
- Snapshot export/import and hybrid cloud synchronization now preserve vectors,
  retrieval policies, policy provenance, document scopes, knowledge links, and
  structural graph metadata. The hybrid sync worker also drains tasks queued during
  an active flush instead of leaving them pending.
- Relinking a Git project now moves its RAG scope associations and fact-to-document
  links together with Notebook facts.
- Environment-specific setup flags now update only their requested integration.
  Codex setup also synchronizes the skill to both `~/.codex/skills` and the shared
  `~/.agents/skills` location.
- Shared documents no longer expose fact-link metadata belonging to another project.
  Document deletion now defaults to unlinking only the current project (or global
  outside Git); broader `global` / `all` removal must be requested explicitly.
- Updating or forgetting a linked Notebook fact now keeps its knowledge-graph
  projection and cloud payload consistent. Line-range graph edges are included in
  per-document cloud sync, and superseding legacy facts without IDs assigns distinct
  IDs to the old and new versions.
- README tool counts now match the implementations: 15 MCP tools, 17 native
  OpenCode tools, and 17 unique tool names across both surfaces. The OpenCode tool
  list documents all shared and OpenCode-only helpers explicitly.

## [1.6.3] - 2026-08-13

### Added

- `memory_plugin doctor --codex` validates the configured executable and Node.js
  version, performs direct MCP `initialize` / `tools/list`, and calls both
  `memory_info` and `recall(scope="all")`.
- Codex regression coverage for Windows paths with spaces, legacy config migration,
  duplicate removal, standalone MCP protocol smoke testing, two-repository project
  isolation, global-only recall outside Git, and prompt idempotency.

### Fixed

- Codex setup no longer launches the memory MCP through `npx` or a Windows `.cmd`
  shim. It writes absolute paths for the active Node executable and packaged
  `mcp-server/boot.js` entry point after validating Node.js >= 22.5.0.
- Existing plugin-owned `[mcp_servers.memory-agent]` sections, including the legacy
  `opencode-memory-plugin` entry, are migrated in place without modifying unrelated
  TOML sections or creating duplicates.
- Repeated prompt setup now collapses duplicate plugin-owned blocks while preserving
  user-authored AGENTS.md / CLAUDE.md content.
- README tool counts match the v1.6.3 implementations: 15 MCP tools, 16 native
  OpenCode tools, and 17 unique tool names across both surfaces. The OpenCode tool
  list and the MCP-only status of `batch_query_knowledge_base` are documented explicitly.

## [1.6.2] - 2026-08-12

### Added

- **Batch retrieval API** (`batch_query_knowledge_base`): execute multiple search queries in a single MCP call. All query embeddings computed in one ONNX pass, queries run in parallel via `Promise.all`. Ideal for cross-document comparisons and multi-part analysis — significantly reduces API overhead vs N separate `query_knowledge_base` calls.
- **Policy expansion toggle** (`config.policyExpansion`, default: `true`): table summaries and code signatures are automatically expanded to full content for better recall (~+5-10% recall, slight MRR trade-off). Disable per-call or via config for pure micro_chunk precision.
- **RAG evaluation test** (`tests/unit/rag_evaluation.test.js`): 10 analytical queries with expected-fact verification (100% pass rate on financial reports). Includes raw-question vs optimized-query comparison demonstrating +33% fact retrieval improvement.

### Changed

- `hybridQuery()` accepts `_precomputedVector` internal parameter for batch embedding reuse.
- `PROMPT_BLOCK` (injected into AGENTS.md/CLAUDE.md) updated with query optimization and batch usage directives.
- SKILL.md updated with batch query tool and query formulation guidance.

## [1.6.1] - 2026-08-10

### Fixed

- **Cryptic crash on Node.js < 22.5.0** (`No such built-in module: node:sqlite`).
  ESM static imports are hoisted, so the `node:sqlite` import in `database.js`
  crashed before any user code could run.  Three layers of protection are now in
  place:
  1. **Boot guard** (`boot.js` / `cli_boot.js`): new lightweight entry points
     that check `process.versions.node` *before* loading the ESM module graph.
     On incompatible versions they print a clear boxed error with upgrade
     instructions (`nvm install 22` / `brew install node@22`) and exit.
  2. **`engine-strict`** (`.npmrc`): `npm install` now **fails** instead of
     merely warning when `engines.node >= 22.5.0` is not satisfied.
  3. **Preinstall warning** (`preinstall.js`): a prominent `stderr` message is
     printed during installation on unsupported Node versions, explaining that
     the server will not start.
- Process-kill patterns in `preinstall.js` now match the new `boot.js` entry
  point in addition to `index.js`, so global updates correctly terminate running
  server instances.

### Changed

- All `bin` entry points (`memory_plugin`, `memory-agent`, `memory-cli`) now
  route through `boot.js` / `cli_boot.js` instead of directly to `index.js` /
  `cli.js`.
- `.npmrc` is no longer git-ignored; it contains only the project-level
  `engine-strict=true` setting (npm never publishes `.npmrc` to the tarball).

## [1.6.0] - 2026-08-10

This release is the outcome of a full five-part audit (publishing, security, code
quality, tests, documentation): 92 checklist items across 8 stages. It also fixes
a critical retrieval regression introduced after `v1.5.3`.

### Breaking

- **Node.js 22.5.0 or newer is now required.** The engine is built on the built-in
  `node:sqlite` module, which only exists from Node 22.5.0. Previously `engines`
  was absent and the README claimed `>=18.0.0`, so installs on Node 18/20/21 failed
  at runtime with `ERR_UNKNOWN_BUILTIN_MODULE` instead of at install time.
- **`ingest_document({ type: "file" })` no longer reads arbitrary paths.** Reads are
  restricted to the current working directory and the plugin data directory. Widen
  the allowlist with `ingestAllowedPaths`, or set `ingestAllowAnyPath: true` to
  restore the old behaviour.

### Fixed

- **Vector search returned zero results (critical).** A `Buffer.isBuffer()` guard
  added after `v1.5.3` discarded every stored vector, because `node:sqlite` returns
  BLOB columns as `Uint8Array`, not `Buffer`. Vector and hybrid retrieval silently
  degraded to BM25-only. The same bug pushed **empty** vectors to the cloud in
  `hybrid-sync` and wrote empty vectors into exported snapshots.
- `update_fact` in the OpenCode plugin never parsed `**Title** body`: its regex was
  double-escaped. The title was stored verbatim as part of the body.
- `SQLITE_BUSY` ("database is locked") under concurrency — `PRAGMA busy_timeout`
  is now set to 5000 ms (it defaulted to 0).
- Switching storage mode leaked the previous SQLite handle and Turso client; the
  old connection is now closed before it is replaced.
- A database-init failure no longer blocks reopening the **local** database: the
  retry cooldown applies to cloud modes only.
- `runWithRetry` leaked an `abort` listener on every attempt.
- Optional numeric tool arguments (`offset`, `limit`, `startLine`, `endLine`,
  `dimension`) rejected empty strings with "Expected number"; they are now coerced.
- `link`, `unlink`, `relink`, `identity`, `migrate_titles`, `enable-prompt` and
  `disable-prompt` were unreachable through the `memory_plugin` binary — the process
  started an MCP server and blocked on stdin instead of running the command.
- GPU trace reports were written to stdout, which is the MCP JSON-RPC channel.

### Security

- Secrets are encrypted with PBKDF2 raised from 10,000 to **600,000** iterations
  (OWASP guidance); existing files are transparently re-encrypted on first read.
- `auth_secrets.enc` is written with owner-only permissions (`0600`).
- The machine fingerprint no longer includes the volatile hostname and username,
  which could permanently lock a user out of their own secrets after a rename.
- SSRF filtering rewritten: IPv6 literals are unwrapped from their brackets,
  IPv4-mapped forms (`::ffff:127.0.0.1`, `::ffff:7f00:1`), link-local, unique-local,
  multicast and CGNAT ranges are blocked, and the resolved address is re-checked
  before the request to defend against DNS rebinding — on the initial request and
  on every redirect hop.
- Cloud tokens are no longer taken from `argv` by default: environment variables
  are preferred, then a hidden stdin prompt. Passing a token as a flag now warns.
- Snapshot paths are resolved with `realpath`, so a symlink or junction can no
  longer escape the allowlisted directories.
- Snapshot and blob decompression is capped at 512 MB to prevent zip bombs.

### Added

- `CHANGELOG.md` (this file).
- `--help` and `--version` for both `memory_plugin` and `memory-cli`.
- Config keys `ingestAllowedPaths` and `ingestAllowAnyPath`.
- `mcp-server/logger.js`: a central logger with levels (`MEMORY_LOG_LEVEL`), an
  stderr sink and a swappable transport.
- Two regression test suites — vector BLOB round-trip and benchmark report
  labelling. The suite is now 12 files, all green.

### Changed

- The six Notebook tools live in a single implementation
  (`mcp-server/tools/core/memory_core.js`) shared by the MCP server and the
  OpenCode plugin. They previously carried separate copies, so fixes reached only
  one surface. `opencode-plugin/index.js` shrank from 1161 to 825 lines and
  `memory_tools.js` from 516 to 124.
- The OpenCode plugin uses static ESM imports instead of top-level
  `await import(...)`, and registers its `exit` hook once per instance rather than
  on every module import.
- Importing `run_benchmarks.js` no longer launches a full benchmark run; the report
  renderer is exported as the pure function `buildMarkdownReport()`.
- `npm audit`: 5 advisories (1 moderate, 4 high) down to 3. The remaining
  unfixable ones (`xlsx`, `sharp` via `@huggingface/transformers`) are documented
  in the README with their reachability.
- Removed the stale nested `mcp-server/package.json`, a version-drift source.

### Documentation

- Corrected claims that did not match the code: the "DPAPI / OS Secret Store"
  credential storage, the circuit breaker failing over to a "local database cache",
  a non-existent GitHub mirror for model weights, the tool count, the TUI
  diagnostics menu, and the GraphRAG language coverage.
- Documented the `MEMORY_DIR` → `OPENCODE_CONFIG_DIR` → legacy `~/.config` →
  `%LOCALAPPDATA%` resolution order, the previously undocumented config keys, and
  the `update_fact` `title` parameter.
- Benchmark reports labelled the headline RRF/RSF rows with the grid-search winner
  (`k=10`) while the numbers were computed with the runtime default (`k=60`). The
  generator and every published table now state the parameters actually used.
- `BENCHMARKS.md` tables were re-derived from the stored JSON artifacts; the
  bge-m3 section had carried e5-small numbers shifted by a column.

[1.6.10]: https://github.com/Lotargo/memory_plugin/releases/tag/v1.6.10
[1.6.9]: https://github.com/Lotargo/memory_plugin/releases/tag/v1.6.9
[1.6.8]: https://github.com/Lotargo/memory_plugin/releases/tag/v1.6.8
[1.6.7]: https://github.com/Lotargo/memory_plugin/releases/tag/v1.6.7
[1.6.1]: https://github.com/Lotargo/memory_plugin/releases/tag/v1.6.1
[1.6.0]: https://github.com/Lotargo/memory_plugin/releases/tag/v1.6.0
