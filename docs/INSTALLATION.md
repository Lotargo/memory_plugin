# Installation and client integration

[Documentation](README.md) · [Project overview](../README.md)

Choose direct setup or a local marketplace channel. This guide covers client-specific setup, verification, removal and recovery.

## Requirements and client setup

### Requirements

- Node.js **22.16+ in the 22.x branch, or 24+** (`^22.16.0 || >=24.0.0`), with built-in SQLite FTS5 and the required browser-dependency support. Node 23 is excluded.
- npm/npx.
- OpenCode, Codex, Claude Code, Gemini CLI, Antigravity, Google Jules, or another MCP-capable client.

CPU execution with `Xenova/multilingual-e5-small` is the recommended stable default. WebGPU execution is experimental.

### Install / Uninstall All Clients

The normal installation path is one command. It configures every supported client directly, so there is no separate package-only installation step:

```bash
npx -y @lotargo/memory_plugin setup
```

This registers memory_plugin in OpenCode, Codex, Claude Code, Gemini CLI, and Antigravity, installs the bundled `using-memory` skill, and adds managed memory instructions where supported. Existing unrelated configuration is preserved.

Remove the integration from all clients while keeping Notebook/RAG data:

```bash
npx -y @lotargo/memory_plugin uninstall
```

Remove the integrations and delete local memory data:

```bash
npx -y @lotargo/memory_plugin uninstall --purge --yes
```

Preview the uninstall without changing anything:

```bash
npx -y @lotargo/memory_plugin uninstall --dry-run
```

What `uninstall` removes by default (without `--purge`):

- `~/.config/opencode/opencode.json` - plugin entry, including `file://` dev links.
- `~/.claude.json` - `mcpServers.memory-agent`.
- `~/.gemini/settings.json` - Gemini CLI `mcpServers.memory-agent`.
- `~/.gemini/config/mcp_config.json` and `.agents/mcp_config.json` - Antigravity `mcpServers.memory-agent`.
- `~/.codex/config.toml` - `[mcp_servers.memory-agent]` only when owned by this plugin.
- Managed prompt blocks from Codex, Claude Code, Gemini CLI, and Antigravity instruction files.
- The bundled `using-memory` skill from each client's managed `skills/` directory.

Existing user content outside plugin-owned markers is preserved. Foreign `memory-agent` registrations, modified/non-owned skills, unrelated file plugins, and other packages in the `@lotargo` OpenCode cache namespace are left untouched.

Normal uninstall keeps OpenCode's package cache. `--purge-cache` removes only exact cache directories owned by this package. With `--purge`, the plugin also deletes `MEMORY_DIR` and its prompt state after resolving and validating every target, rejecting dangerous roots and broad parent paths, and displaying the targets before confirmation.

On Linux/macOS, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` are respected. `OPENCODE_CONFIG_DIR` and `MEMORY_DIR` remain explicit overrides on every platform.

### Install One Client

Use the same one-shot setup command with a client flag when you only want one integration:

```bash
npx -y @lotargo/memory_plugin setup --opencode
npx -y @lotargo/memory_plugin setup --codex
npx -y @lotargo/memory_plugin setup --claude
npx -y @lotargo/memory_plugin setup --antigravity
npx -y @lotargo/memory_plugin setup --gemini
```

Use `--local` with Antigravity to create the workspace-local `.agents/mcp_config.json` even when `.agents/` does not yet exist:

```bash
npx -y @lotargo/memory_plugin setup --antigravity --local
```

The same client flags can be used for targeted removal, for example:

```bash
npx -y @lotargo/memory_plugin uninstall --opencode
npx -y @lotargo/memory_plugin uninstall --codex
```

Claude Code, Gemini CLI, and Codex setup/uninstall use their native MCP lifecycle commands when available. An ownership-checked config edit is retained as a compatibility fallback for missing, older, or non-functional client CLIs. Antigravity remains a separate integration because it uses a different config layout.

For reviewed removal of one client's global integration, open **Удаление интеграции** in the local panel, or use the shared service from CLI/TUI:

```bash
memory-cli uninstall status
memory-cli uninstall preview --client gemini --operation uninstall
memory-cli uninstall apply --client gemini --operation uninstall --preview-token <token> --confirm
memory-cli uninstall preview --client gemini --operation restore --backup-id <uninstall-receipt-id>
memory-cli uninstall apply --client gemini --operation restore --backup-id <uninstall-receipt-id> --preview-token <token> --confirm
memory-cli uninstall receipt --operation-id <id>
```

Supported fixed clients are `opencode`, `codex`, `claude`, `gemini` and `antigravity`. Preview lists exact paths, byte counts, hashes and preserved components; configuration contents and secrets stay private. Apply verifies the current files/channel and saves a checked local backup before changing owned registrations, managed prompt/persona blocks and unmodified skill files. Recovery refuses changed files. After a lost response, inspect the receipt before retrying; interrupted removal requires explicit reviewed restoration. The panel reports marketplace ownership and leaves that channel to the client's plugin manager. Memory, models, package/cache, project registrations and the running panel are preserved. Empty skill directories may remain. Active client sessions require their own reconnect/restart.

The original flag-based `uninstall --codex`, `--purge` and `--purge-cache` flows remain terminal compatibility commands with their existing native lifecycle behavior. They are separate from this reviewed global-file operation and are not browser endpoints.

### Local Marketplaces (Codex / Claude Code)

Build a separate local catalog from this checkout, then install it with migration from direct setup:

```powershell
$catalog = Join-Path (Get-Location).Path ".local-marketplace/build-demo"
node mcp-server/boot.js marketplace build --output $catalog
node mcp-server/boot.js marketplace install --client codex --path $catalog
node mcp-server/boot.js marketplace install --client claude --path $catalog
```

Use one active installation channel per client. Both channels share the engine and existing storage; marketplace removal retains memory. Builds use a fixed prepared runtime outside the client cache and are local to the computer. The installer detects duplicate registrations, changed skills and mismatched data directories. Codex requires review/trust of the bundled SessionStart hook for automatic initialization. See [MARKETPLACE.md](../MARKETPLACE.md) for diagnosis, switching back, removal, updates and acceptance boundaries.

### Verify Codex

Codex and Claude Code use a direct executable chain (`node` -> the installed engine's `mcp-server/boot.js`) instead of an `npx`/`.cmd` launcher, avoiding Windows stdio handshake failures and unintended registry-version changes. Setup safely migrates legacy owned registrations.

```bash
npx -y @lotargo/memory_plugin doctor --codex
```

The doctor validates the configured Node runtime, MCP initialization, tool discovery, and real `memory_info` and `recall(scope: "all")` calls.

### Headless / CI Setup

```bash
# Authenticate with a Turso account token and enable cloud snapshots
# (--api-token and --token are accepted as aliases for --api-key)
npx -y @lotargo/memory_plugin setup --api-key <TURSO_API_TOKEN> --mode cloud-snapshots

# Or change mode when credentials already exist
npx -y @lotargo/memory_plugin setup --mode cloud-snapshots
```

Prefer `TURSO_API_TOKEN`, `TURSO_DB_URL`, and `TURSO_DB_TOKEN` environment variables over command-line secrets because shell arguments may appear in process lists and history.

## Client Integration

| Client | Integration | Session initialization |
| :--- | :--- | :--- |
| OpenCode | Native plugin in `~/.config/opencode/opencode.json` | Full memory auto-injection + system persona transform |
| Codex | MCP server in `~/.codex/config.toml` | Managed prompt requires a startup `recall(scope: "all")` (newest 10 project facts) |
| Claude Code | MCP server in `~/.claude.json` | Managed prompt requires a startup `recall(scope: "all")` (newest 10 project facts) |
| Gemini CLI | MCP server in `~/.gemini/settings.json` | Managed `~/.gemini/GEMINI.md` prompt requires a startup `recall(scope: "all")` (newest 10 project facts) |
| Antigravity | MCP server in `~/.gemini/config/mcp_config.json` and optional `.agents/mcp_config.json` | Managed prompt requires a startup `recall(scope: "all")` (newest 10 project facts) |
| Google Jules / generic MCP | MCP stdio server | Client instructions should initialize with full recall |

The bundled [`using-memory` skill](../skills/using-memory/SKILL.md) teaches agents to:

1. Avoid duplicate recall when OpenCode already auto-injected memory.
2. Perform full unfiltered recall first in clients without auto-injection.
3. Apply `kind:directive` entries as active configuration.
4. Register unlinked Git identities with `link_project_memory`.
5. Route concise facts, long internal notes, and external sources to the correct store.
6. Use semantic index discovery before expanding a full note/document.
7. Save high-signal knowledge proactively and avoid transient noise.
