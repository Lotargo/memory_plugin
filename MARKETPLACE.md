# Local marketplaces for Codex and Claude Code

The marketplace is an alternative installation channel for the same memory engine. A client uses either a direct `memory-agent` MCP registration or `memory@lotargo-memory-local`. Other clients can use their own channel while sharing the existing Notebook/RAG storage.

## Build a prepared local catalog

Run from the checkout with Node.js >= 22.5 and npm installed:

```powershell
$catalog = Join-Path (Get-Location).Path ".local-marketplace/build-demo"
node mcp-server/boot.js marketplace build --output $catalog
```

Choose a new absolute output directory for every build. `--memory-dir <path>` explicitly selects the shared storage; it defaults to the engine's normal `MEMORY_DIR` resolution. Installation refuses a migration if the direct registration uses another data directory. User data must stay outside the output directory.

The builder copies only npm-packaged source files plus the dependency lockfile, computes a source digest, and prepares locked production dependencies with lifecycle scripts disabled. It does not register clients, start the web panel, ingest memories, fetch models, or publish anything. `--source-only` creates a catalog for inspection without preparing dependencies; installation rejects such a build.

The output contains:

- `runtime/`: a fixed source/dependency snapshot, shared by both adapters.
- `codex/`: an `.agents/plugins/marketplace.json` catalog and a Codex plugin.
- `claude/`: a `.claude-plugin/marketplace.json` catalog and a Claude Code plugin.
- `local-marketplace.json`: preparation state, version, digest, Node path and data directory.

This artifact is local to the computer on which it was built: its adapters record absolute runtime, Node and data paths. Keep the output directory while either marketplace or direct registration refers to it. It is not a portable installer or a public marketplace submission. The host's plugin cache contains the small adapter, skill and SessionStart hook; it does not contain the shared memory database or dependency tree.

Codex's MCP command pins the adapter inside that build as an absolute path: its compatibility loader does not expand `${PLUGIN_ROOT}` in `.mcp.json`. Hooks retain client-relative discovery. On Windows the Codex hook uses `commandWindows` with PowerShell's call operator and reads `PLUGIN_ROOT` as an environment value, preserving spaces and literal `$` in paths. Claude's launcher and hook remain in their existing format.

## Install and migrate

```powershell
node mcp-server/boot.js marketplace install --client codex --path $catalog
node mcp-server/boot.js marketplace install --client claude --path $catalog
```

Each command validates the runtime and the existing registration before using the client's native marketplace/plugin commands. Once the new plugin is enabled, it removes the owned direct MCP registration, managed instruction blocks and unchanged global skill copies for that client. It preserves unrelated configuration, user-authored instructions, the shared web panel and all memory data. Foreign/project-scoped registrations and modified skills stop migration before client writes. Failed native installation leaves the direct integration intact. If later legacy cleanup fails, the new plugin is removed and the command reports failure; inspect `marketplace status` and run direct setup to recover any partially removed legacy connection.

Repeated installation from the same catalog is idempotent. A catalog name already pointing to another source is a conflict in both clients. Explicitly remove the old catalog with `codex plugin marketplace remove lotargo-memory-local` or `claude plugin marketplace remove lotargo-memory-local` before installing a new build. Claude's native command also uninstalls its adapter. Keep the old runtime until you have switched every registration that uses it. Codex can replace its cached adapter with the same package version when the new catalog is installed; the native regression test below verifies this upgrade.

Direct installation through the native plugin UI is also possible, but it does not migrate a pre-existing direct setup. The adapter refuses to start a second MCP server while a direct `memory-agent` registration remains. Use the installation command above to complete the transition.

## Instructions, scope and disabling

The plugin bundles `using-memory` and a SessionStart hook. The hook returns the same managed memory instructions to the conversation instead of writing global `AGENTS.md`/`CLAUDE.md` files. It tells the agent to perform full recall through the exposed plugin MCP namespace and to pass the hook's workspace directory explicitly to project tools. Active personalization comes from that recall. Resume does not require another initialization if full active memory is already present.

Codex requires review and trust of a plugin's current hook definition before running it. Installing the plugin alone does not prove automatic initialization. Review/trust SessionStart in the client, start a new session, and verify context delivery and tool availability. Existing conversations may retain instructions already in their context; use a new session after disabling or changing channels. Neither `enable-prompt`, persona synchronization nor `dev-link` reinstalls global instructions/skills for a client with this marketplace plugin enabled.

Native plugin disable/uninstall controls the adapter's MCP server, skill and hook together. It does not delete shared memory. Direct `uninstall --codex`/`--claude` only removes direct artifacts. An explicit `uninstall --purge` still means deleting shared data and affects every client that uses that data directory.

## Diagnose, switch back, remove

```powershell
node mcp-server/boot.js marketplace status
node mcp-server/boot.js marketplace doctor --client codex
node mcp-server/boot.js marketplace doctor --client claude
node mcp-server/boot.js marketplace direct --client codex
node mcp-server/boot.js marketplace direct --client claude
node mcp-server/boot.js marketplace uninstall --client codex
```

`status` reports configured state and duplicate registrations. `doctor` uses the shared client diagnostic service to verify the native listing and supported adapter, then performs real MCP initialize, tool discovery, `memory_info` and full `recall`; it verifies runtime version and storage location. This checks the adapter process. Native host command expansion, hook execution, automatic SessionStart delivery and agent behavior remain separate. `doctor --codex` uses the same service.

`direct` removes the marketplace adapter and runs targeted direct setup from the current installed engine. Codex and Claude direct setup both use Node plus that engine's `boot.js`, avoiding an implicit change to the npm registry's latest release. It does not unregister the catalog or delete its runtime/data. `marketplace uninstall` removes only the native adapter and preserves direct artifacts, runtime, catalog and memory. `CODEX_HOME` and `CLAUDE_CONFIG_DIR` are supported for isolated client profiles.

## Acceptance

`npm test` includes hermetic packaging, channel transitions, duplicate-launch refusal, modified-skill protection, data-directory mismatch, hook output, stored-memory retention and real adapter MCP protocol tests. Native operations are simulated in that suite.

For installed client binaries, run the separate isolated acceptance test:

```powershell
$env:MEMORY_MARKETPLACE_LIVE = '1'
node tests/smoke/marketplace_clients_live.test.js
```

It creates temporary client homes, validates Claude manifests, installs using both native CLIs, checks native listings, executes the resolved installed adapter and marketplace doctor, repeats installation and switches back to direct setup. Its fixture runtime reuses existing checkout dependencies; it does not make model requests or copy authentication. A production build separately prepares dependencies with npm. Desktop rendering, client hook trust/delivery and actual agent use require acceptance in a new real client session.

For the actual Codex app-server launch and first-turn hook path, also run:

```powershell
$env:MEMORY_MARKETPLACE_LIVE = '1'
# Optional: select the same codex.exe used by the desktop app.
$env:MEMORY_NATIVE_CODEX_BINARY = '<absolute path to codex.exe>'
node tests/smoke/codex_marketplace_runtime.test.js
```

This test reproduces the old literal-macro failure, upgrades its installed adapter without changing the package version, and checks native MCP tool discovery. It trusts only the temporary profile's hook and checks `hook/completed`, the actual workspace and context in the first request to a loopback HTTP stub. Outbound catalog requests are rejected by a local proxy; no login is copied, no real model is called, and fixture memory is retained. Repeated installation is checked through the host again. The test fails if Codex merely installs/lists the plugin but cannot load its tools or run its hook. User-profile trust and normal desktop-session acceptance remain separate.

Format references: [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [Claude marketplaces](https://code.claude.com/docs/en/plugin-marketplaces), [Claude MCP lifecycle](https://code.claude.com/docs/en/mcp).
