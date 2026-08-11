# Changelog

All notable changes to `@lotargo/memory_plugin` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.6.1]: https://github.com/Lotargo/memory_pugin/releases/tag/v1.6.1
[1.6.0]: https://github.com/Lotargo/memory_pugin/releases/tag/v1.6.0
