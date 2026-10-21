# Dependency security and release readiness — 2026-10-21

Candidate: `@lotargo/memory_plugin@1.7.1`. This report supersedes the dependency blocker in [the earlier readiness report](RELEASE_READINESS_2026-10-21.md), which remains as historical evidence.

## Result

The remaining dependency findings have been removed. Production audits of the source tree, a fresh npm-tarball consumer installation, and a real prepared marketplace runtime report **zero known vulnerabilities**. No audit exemptions, forced dependency downgrades, registry changes, package publication, Git push or release/tag creation were used.

## Dependency changes

- Transformers.js is pinned to **4.3.1**, with **Sharp 0.35.5** and **ONNX Runtime 1.30.0** in the tested tree. The old vulnerable ONNX installation/logging chain is no longer present.
- DOCX ingestion uses **41 unchanged Mammoth 1.13.0 library modules**, with the upstream BSD-2-Clause license, official tarball integrity and per-module SHA-256 provenance. Its unused CLI and legacy `argparse` / `sprintf-js` chain are excluded. All seven external library dependencies remain explicit root dependencies and visible to npm audit. No opaque browser bundle or hidden embedded dependency tree is used.
- A published **npm-shrinkwrap.json** replaces the root package-lock. Both npm consumers and marketplace builds install the tested graph. A source-only override was insufficient for consumer installs and is not part of the solution.
- `release:check` and `prepublishOnly` now reject advisories at **low severity or higher**. Package checks validate dependency/runtime requirements against the shrinkwrap and retain the reviewed file list.

The current registry version was checked as **1.7.0**; 1.7.1 remains a local unreleased candidate. A clean audit covers known package advisories, not all defects. Vendored upstream modules also require source/security review on future updates; their hashes and reproduction command are documented with the source.

## Compatibility fixes found during validation

The supported Node range is now **`^22.16.0 || >=24.0.0`**. Older advertised 22.x versions did not provide the required combination of unflagged `node:sqlite`, built-in FTS5 and browser dependency support. Node 23 is excluded. Both boot entrypoints, preinstall messages, client diagnostics, package metadata and current documentation share this requirement.

Node 22 also exposed a real database defect: a zero-length BLOB returned by SQLite could become SQL NULL when rebound. The shared database wrapper now preserves empty binary values with fresh empty buffers, keeping actual NULL values and nonempty vectors unchanged. Tests cover real read/write round trips, positional and named parameters, and existing knowledge/snapshot behavior.

The web-command test now recognizes actual stack-trace lines rather than the English phrase “at any time” in Node's SQLite experimental warning. The warning remains visible.

The test runner also assigns each suite its own temporary-directory environment. Windows libSQL fixture cleanup can defer both EPERM and EBUSY until the child exits; the parent then removes the entire owned suite directory after native handles are released.

## Verification

| Check | Result |
| --- | --- |
| Production source dependency audit | 0 vulnerabilities at every severity |
| Node 26.1.0 release gate | All 69 regression suites passed in 295.58 seconds; package gate and audit passed |
| Node 22.16.0 release gate | All 69 regression suites passed in 335.46 seconds; package gate and audit passed |
| Real CPU models, Node 26.1.0 and 22.16.0 | Default q8 multilingual embedding: 384 finite normalized values, semantic relevance ordering, persisted dense retrieval, unload/reload stability; default multilingual reranker: finite unequal raw logits and correct relevance ordering |
| Real DOCX integration | OOXML heading, Cyrillic text, exact identifiers/dates, bold, list and table text; corrupt archive rejection; every copied library module matches provenance |
| Fresh tarball consumer, Node 22.16.0 | 0 audit findings; real DOCX, 22 MCP tools, initially empty isolated memory, synthetic Notebook read/write, empty-BLOB round trip, dashboard API/assets, runtime exit and temporary-profile cleanup passed |
| Actual prepared marketplace, Node 22.16.0 | Real npm ci using shipped shrinkwrap; 0 audit findings; native ONNX import; both Codex/Claude adapter hooks and real MCP discovery/recall with isolated storage passed |
| Package/privacy policy | 217 approved files; no personal Notebook/RAG stores, databases, credentials, connection files, internal reports, tests, benchmarks or dependency directories in the tarball |
| Release source archive | 386 files; reviewed-tree scan passed: internal evidence and local databases excluded; no matching personal identifiers |

All inference inputs and document fixtures were synthetic. Existing public embedding weights were copied into disposable storage; installed memory and client settings were not used or changed. Missing test weights downloaded only into disposable profiles. Marketplace tests exercised isolated adapter copies, without configuring native clients.

The previously tracked root `local_test.db` was also removed from Git tracking and added to the ignore rules, with its local bytes preserved. No database contents were needed for that cleanup. Together with the earlier internal-evidence exclusions, this keeps the reviewed public tree free of local database artifacts; earlier Git history remains unchanged.

Tarball measurements for the verified candidate: **573,939 bytes packed; 2,026,779 bytes unpacked; 217 files**.

```text
sha512-P/1lNVehM0hLPsflckWP6MBCKY05jf/lspzPbUii+wy+jJrO1VDCbnNo6ucUBHyfpvm23rYV9QgUECionnJWUQ==
```

## Remaining publication steps and limits

The requested local dependency/security preparation is complete, and the source/consumer/marketplace audit gates are green. Publication remains deliberately pending an explicit request: keep CHANGELOG Unreleased until the release date is set, push the reviewed screenshot assets before checking their public README URLs, and then create the release/tag and publish in the agreed order.

Live Linux/macOS, GPU execution, ordinary install/login-autostart behavior and delivery inside already running native client sessions were not newly accepted by this change. The tested installed-package path uses lifecycle scripts disabled; existing isolated lifecycle regression coverage passed. No existing memory database or vector index was migrated or reindexed automatically. Earlier private Git history was not rewritten.

Reproduction and future update procedure: [RELEASING.md](RELEASING.md).
