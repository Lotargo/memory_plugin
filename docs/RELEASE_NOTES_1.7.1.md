# 1.7.1 — Local web UI and reproducible runtime

The local web UI brings Notebook records, instructions, history, project scopes, knowledge sources, source links and graphs, settings, model controls, and reviewed maintenance into one browser panel. It runs locally and is shared by connected coding clients.

This update also introduces local working memory with optional full cloud checkpoints, reviewed knowledge editing and recovery, native persona delivery, bounded recall, and more reliable shared-panel startup and client diagnostics. Existing users of retired live cloud modes must follow the documented explicit migration flow.

The README shows real UI screenshots using entirely fictional demo data. Public release files exclude internal development evidence, memory stores, private client configuration and connection credentials. An exact package manifest and publication checks protect subsequent releases.

Dependency security updates include Transformers.js 4.3.1, patched Sharp/ONNX Runtime dependencies, a library-only Mammoth DOCX distribution with license and provenance, and a published shrinkwrap for reproducible consumer installs. **Node.js 22.16+ in the 22.x branch, or 24+, is required** for built-in SQLite FTS5 and browser dependencies. Node 23 is excluded. The publication gate rejects known advisories at low severity or higher.

Validation: all 69 regression suites pass on Node.js 22.16.0 and 26.1.0. Production audits report zero vulnerabilities in the source tree, a fresh tarball installation and the prepared marketplace runtime. Real CPU embeddings/reranking, DOCX conversion, isolated MCP read/write and packaged dashboard smoke checks pass. These checks do not represent new native-client sessions or live Linux/macOS/GPU acceptance.

Install or update:

```bash
npm install -g @lotargo/memory_plugin@1.7.1
```

See [CHANGELOG](https://github.com/Lotargo/memory_plugin/blob/v1.7.1/CHANGELOG.md) for the complete changes and [security readiness](https://github.com/Lotargo/memory_plugin/blob/v1.7.1/docs/RELEASE_SECURITY_READINESS_2026-10-21.md) for test coverage and platform limits.
