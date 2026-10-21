# Preparing a public release

This procedure applies to **1.7.2**. Run preparation checks before the explicitly authorized publication steps below.

## Checks

Run from a source checkout:

```bash
npm run check:package
npm test
npm audit --omit=dev
npm run release:check
```

`release:check` and npm's `prepublishOnly` stop on dependency advisories at low severity or higher. Do not use `npm audit fix --force` as a release shortcut. Source and consumer installations use `npm-shrinkwrap.json`, which replaces the root package-lock and ships in the tarball; use `npm ci` to reproduce that tree. Dependency/runtime changes require actual DOCX/model tests as well as the audit.

`scripts/package-files.json` is the reviewed npm file list. Add a file only after reviewing its contents and purpose. The check rejects missing runtime files, extra files, common credential formats, local profile/workspace paths, and private/development artifacts. Pattern scans cannot prove that arbitrary private text is absent; manually review documentation, screenshots and every manifest change as well.

Build the real tarball outside the checkout with `npm pack --ignore-scripts --pack-destination <absolute-output-directory>`, then run:

```bash
npm run smoke:package -- /absolute/path/lotargo-memory_plugin-1.7.2.tgz
```

Run `npm run smoke:marketplace` to build a real disposable prepared runtime, audit its installed dependencies and verify both adapters' hooks, native ONNX import and MCP readback. It uses no native client registrations or installed memory.

This installs the archive with lifecycle scripts disabled into a temporary directory, audits the actual consumer dependency tree, verifies real DOCX conversion, MCP discovery and isolated Notebook writes/reads in a child process, and starts its packaged dashboard to check API and browser assets. The parent removes the temporary installation after the child exits, so Windows can release native SQLite libraries. It never runs native client setup or uses installed memory. Normal installation hooks, native client sessions and other operating systems require separate acceptance.

Run `npm run smoke:models` for real CPU embedding, saved dense retrieval, unload/reload and default multilingual reranker acceptance. `MEMORY_MODEL_CACHE` can point to an existing public-model cache: selected weights are copied into the temporary profile rather than edited in place. Missing test models download only into that profile. This opt-in test is separate from the offline regression suite. Repeat it on the minimum supported Node version when changing the model runtime.

DOCX library source, license and module hashes are recorded in `mcp-server/vendor/mammoth/`. Reproduce them with `npm run vendor:docx`, review upstream changes and external dependency versions, run the real DOCX test, and explicitly review the approved package-file manifest. Do not replace this with an opaque browser bundle or an out-of-range override that disappears in consumer installations.

## Public and private files

- `dev_docs/` is private local development evidence. Keep it ignored and untracked. Release source archives also exclude it through `.gitattributes`.
- Do not attach local marketplace builds: their manifests deliberately contain machine-specific runtime and memory paths.
- Never attach memory databases, Notebook stores, snapshots, encrypted auth files, `connection.json`, raw runtime logs, or installed client configuration.
- Removing files from the current tree does not remove earlier Git commits or previously published artifacts. History cleanup is a separate operation.
- README images use public repository URLs. Publish the reviewed screenshot assets to the repository before publishing the corresponding README to npm, then verify that the image URLs load.
- The short npm README links to user guides in the repository's `docs/` directory, which is intentionally excluded from the npm tarball. Publish new guide files before updating the npm README and verify those public links. `docs/README.md` is the documentation index.

## Reproducing the UI screenshots

Install Playwright in a separate development environment. Set `MEMORY_BROWSER_DEPS` to its `node_modules` directory and run `node scripts/readme-screenshots.mjs`. The script creates a new isolated memory/client profile, seeds fictional records, runs the real UI, rejects external browser requests, captures `assets/ui/notebook.png` and `assets/ui/knowledge.png`, and removes the temporary profile. Review both images visually before publishing. Do not capture an installed profile and blur it afterward.

## Final publication

After the checks and dependency review pass, set the release date in CHANGELOG, commit the reviewed tree, verify the source archive, push the reviewed commit/assets, and verify npm README image URLs. Create the release/tag and publish only when explicitly requested. Keep the version aligned in package.json and npm-shrinkwrap.json; never reuse an already published version. The supported range is `^22.16.0 || >=24.0.0`; test both the minimum and the current runtime when changing it.
