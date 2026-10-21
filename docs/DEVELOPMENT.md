# Development, tests and benchmarks

[Documentation](README.md) · [Project overview](../README.md)

Work from a source checkout to link clients and run repository tests. See [release preparation](RELEASING.md) for packaging and publication checks.

### Local Repository Development

```bash
npm install
npm run dev:link
```

`dev:link` performs an npm global link for the `memory_plugin`, `memory-agent`, and `memory-cli` binaries; rewrites only this plugin's OpenCode entry to an absolute `file://` URL for `opencode-plugin/main.js`; creates `opencode.json.memory-dev-backup` on first use; synchronizes managed prompts; and copies the current skill to all client skill locations.

After code changes, restart OpenCode to reload the module. Codex, Claude Code, Gemini CLI, and Antigravity load prompt and skill files at session start, so open a new task/session after synchronization. Publishing to npm is not required for local testing.

## Repository Testing and Benchmarks

> These commands are intended for a **source checkout of the repository**. Test suites and benchmark harnesses are intentionally excluded from the published npm tarball.

```bash
npm test                   # unified unit, integration, and simulated-cloud suites
npm run smoke              # real ONNX vectors and end-to-end memory journey
npm run test:rag           # retrieval quality evaluation
npm run benchmark          # full search benchmark report
npm run benchmark:table-code
```

The fast suites use `generateEmbeddings: false` in retrieval paths for deterministic offline coverage. `npm run smoke` covers the dense-vector path with real cached/downloaded model weights and checks multilingual semantic retrieval. Both modes are needed: lexical-only tests cannot catch a broken vector serialization or ONNX execution path.

The unified suites cover fact formatting, typed directives, persona migration/synchronization, client prompt safety, Codex launcher compatibility, Git identity isolation, RAG scopes, policy expansion, RAG Memory Notes, semantic index output, full legacy-cloud migration and explicit restoration, retired-mode rejection, snapshots, MCP contracts, spreadsheet parsing, and cloud authentication workflows.

See [`docs/BENCHMARKS.md`](BENCHMARKS.md) for methodology and detailed reports.

### Included Search Evaluation

The stored 32-document / 21-query technical corpus produced:

| Strategy | MRR@5 | Recall@5 | NDCG@5 |
| :--- | :---: | :---: | :---: |
| BM25 lexical only | 0.6706 | 76.19% | 0.6934 |
| Dense ONNX only | 0.8135 | 100.00% | 0.8612 |
| Hybrid RRF (`k=60`) | 0.8810 | 95.24% | 0.8997 |
| **Hybrid RSF (`alpha=0.5`)** | **0.9286** | **100.00%** | **0.9473** |
