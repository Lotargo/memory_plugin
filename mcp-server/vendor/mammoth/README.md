# Mammoth library runtime

This directory contains the **unmodified library modules** reachable from Mammoth 1.13.0's `lib/index.js`. It retains the upstream BSD-2-Clause license. `provenance.json` records the official npm tarball integrity, the SHA-256 hash of every copied module, and all external dependencies.

Upstream: https://github.com/mwilliamson/mammoth.js

The upstream npm package also includes a command-line program whose legacy argument parser pulls in the unpatched `sprintf-js` dependency. memory_plugin uses only the DOCX library API. Its CLI, browser bundles, tests, and unused modules are excluded here. No parser implementation was rewritten or bundled opaquely. All external library dependencies are declared in the root package.json and remain visible to npm audit and the published shrinkwrap.

To reproduce this directory, run `npm run vendor:docx` in a source checkout, review the upstream version/license/dependencies and changed hashes, then review the approved package manifest. DOCX integration tests verify real OOXML conversion and the copied module hashes. Updating this source requires reviewing upstream security fixes as well as dependency advisories; npm audit alone does not inspect these copied modules.
