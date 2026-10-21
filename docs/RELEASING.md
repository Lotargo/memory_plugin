# Preparing a public release

The pending version is **1.7.1**. Preparation does not publish the package, push Git changes, or create a tag.

## Checks

Run from a source checkout:

```bash
npm run check:package
npm test
npm audit --omit=dev
npm run release:check
```

`release:check` and npm's `prepublishOnly` stop on high/critical dependency advisories. Do not use `npm audit fix --force` as a release shortcut: a major model-engine upgrade or an old DOCX-parser downgrade needs its own compatibility review.

`scripts/package-files.json` is the reviewed npm file list. Add a file only after reviewing its contents and purpose. The check rejects missing runtime files, extra files, common credential formats, local profile/workspace paths, and private/development artifacts. Pattern scans cannot prove that arbitrary private text is absent; manually review documentation, screenshots and every manifest change as well.

Build the real tarball outside the checkout with `npm pack --ignore-scripts --pack-destination <absolute-output-directory>`, then run:

```bash
npm run smoke:package -- /absolute/path/lotargo-memory_plugin-1.7.1.tgz
```

This installs the archive with lifecycle scripts disabled into a temporary directory, verifies real MCP discovery and isolated Notebook writes/reads, and starts its packaged dashboard to check API and browser assets. It never runs native client setup or uses installed memory. Normal installation hooks, native client sessions, model execution, and other operating systems require separate acceptance.

## Public and private files

- `dev_docs/` is private local development evidence. Keep it ignored and untracked. Release source archives also exclude it through `.gitattributes`.
- Do not attach local marketplace builds: their manifests deliberately contain machine-specific runtime and memory paths.
- Never attach memory databases, Notebook stores, snapshots, encrypted auth files, `connection.json`, raw runtime logs, or installed client configuration.
- Removing files from the current tree does not remove earlier Git commits or previously published artifacts. History cleanup is a separate operation.
- README images use public repository URLs. Publish the reviewed screenshot assets to the repository before publishing the corresponding README to npm, then verify that the image URLs load.

## Reproducing the UI screenshots

Install Playwright in a separate development environment. Set `MEMORY_BROWSER_DEPS` to its `node_modules` directory and run `node scripts/readme-screenshots.mjs`. The script creates a new isolated memory/client profile, seeds fictional records, runs the real UI, rejects external browser requests, captures `assets/ui/notebook.png` and `assets/ui/knowledge.png`, and removes the temporary profile. Review both images visually before publishing. Do not capture an installed profile and blur it afterward.

## Final publication

After the checks and dependency review pass, set the release date in CHANGELOG, commit the reviewed tree, verify the source archive, push the reviewed commit/assets, and verify npm README image URLs. Create the release/tag and publish only when explicitly requested. Keep the version aligned in package.json and package-lock.json; never reuse an already published version.
