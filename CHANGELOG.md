# Changelog

All notable changes to `@lotargo/memory_plugin` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[1.6.8]: https://github.com/Lotargo/memory_plugin/releases/tag/v1.6.8
[1.6.7]: https://github.com/Lotargo/memory_plugin/releases/tag/v1.6.7
[1.6.1]: https://github.com/Lotargo/memory_plugin/releases/tag/v1.6.1
[1.6.0]: https://github.com/Lotargo/memory_plugin/releases/tag/v1.6.0
