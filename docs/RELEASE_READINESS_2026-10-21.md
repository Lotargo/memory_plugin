# Release readiness — 2026-10-21

Candidate: `@lotargo/memory_plugin@1.7.1`.

**Decision: package/privacy preparation is complete; publication is blocked by the unresolved dependency audit.** Nothing was pushed, tagged or published. CHANGELOG remains Unreleased.

## Public presentation and privacy

- README introduces the web UI near the beginning with two real dashboard screenshots: Notebook and knowledge reader. Both were visually inspected. The screenshot generator uses a new temporary profile, fictional records and `example.test` Git identities; browser requests outside the temporary loopback server are rejected. There were no browser JavaScript errors. Personal Notebook/RAG data, client configuration, connection tokens and model caches are not used.
- Public path examples are portable. README image URLs point to repository-hosted assets, allowing npm rendering without bundling large marketing images. The new assets must be pushed before these URLs can be verified publicly.
- All 135 tracked files under `dev_docs/` were removed from Git tracking and **preserved locally**. This includes internal reports, raw test logs, machine-specific manifests and browser evidence. Ignore/export rules protect future package/source releases. No installed user memory was deleted.
- A pattern scan of the remaining tracked tree found no matching local profile path or known personal name/location identifiers. This is a bounded scan and manual review, not a proof that every possible form of personal text is absent.
- Historical commits and any previous public artifacts retain their earlier contents. No history rewrite, force-push, remote cleanup or credential rotation was performed. Removing current files does not erase history.

## Package and runtime checks

| Check | Result |
| --- | --- |
| Approved npm manifest | 171 files; 1,736,646 unpacked bytes |
| Actual npm tarball | 498,782 bytes; its file list matches the approved manifest exactly |
| Private/development payloads | No Notebook stores, databases, credentials, connection files, local marketplaces, logs, test harnesses, benchmarks, internal evidence or node_modules in the archive |
| Negative packaging test | An unexpected JavaScript file in the runtime directory was rejected; the canary was removed |
| Policy regression | Covers extra/missing files, private artifacts, credentials/private connection URLs and redacted error messages |
| Installed tarball smoke | Fresh install with lifecycle scripts disabled; 22 real MCP tools; initially empty memory; synthetic Notebook write/read; dashboard API and packaged browser assets |
| Regression suite | All 67 suites passed after dependency updates, in 358.94 seconds |
| Release source archive | Verified from the reviewed tree: no internal evidence directory or matching personal identifiers |
| Publication gate | `release:check` exits nonzero at the high-severity dependency audit, as intended |

Tarball integrity:

```text
sha512-+XUUz5C6jlmAvGTiiw5Cdk1kHCRkMoyhoSZc6+wQQiaOp5CqXOktlaJwvMZ+Se3s5rhjLs+Rm604JXTAuwCJ+w==
```

The package check also verifies package/lock version agreement and presence of declared entrypoints. It runs before publication through `prepublishOnly`. All listed archive measurements refer to this preparation, before publication.

## Dependency decision still required

The production audit decreased from **17 affected packages (including 1 critical)** to **8 affected packages: 2 high and 6 moderate; 0 critical and 0 low**. Compatible updates include MCP SDK 1.32.1, Mermaid 12.2.0 and patched transitive dependencies. Both the dependency tree and lockfile were updated.

- High: `sharp` and `@huggingface/transformers`. The current text embedding path sets `env.sharp = false`; this narrows runtime exposure but does not clear the dependency advisory. The suggested Transformers 4 upgrade changes the major version and has not been validated here. See the [Sharp/libvips advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj).
- Moderate: `sprintf-js` and its affected parent packages (`argparse`, `mammoth`, `roarr`, `global-agent`, `onnxruntime-node`). The [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) reports no patched version. npm's suggested forced DOCX-parser downgrade is not an accepted fix.

Required follow-up: review replacement/upgrade options, verify real model loading/embedding and DOCX ingestion with the chosen dependency changes, rerun the dependency audit and affected/full regressions, and resolve any remaining exception explicitly before publication. The default publication gate remains closed.

## Acceptance limits and final release steps

Tests here run on Windows with Node.js 26.1.0. This is not fresh acceptance of the minimum supported Node version, Linux/macOS, normal installation hooks, native client setup/session delivery or real model execution. The isolated tarball smoke deliberately disables install hooks and does not download/load models.

After the dependency decision: finish the release date/notes, verify the committed source archive, push the reviewed files and screenshot assets, verify public README images, then tag/release/publish only on an explicit request. See [RELEASING.md](RELEASING.md) and the [release notes draft](RELEASE_NOTES_1.7.1.md).
