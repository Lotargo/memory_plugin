# @lotargo/memory_plugin

**Local-first long-term memory, hybrid RAG, and agent personalization for AI coding agents.**

[![npm version](https://img.shields.io/npm/v/@lotargo/memory_plugin)](https://www.npmjs.com/package/@lotargo/memory_plugin)
[![npm downloads](https://img.shields.io/npm/dt/@lotargo/memory_plugin)](https://www.npmjs.com/package/@lotargo/memory_plugin)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![node version](https://img.shields.io/badge/node-22.16%2B%20%2822.x%29%20or%2024%2B-brightgreen)](https://nodejs.org)
[![mcp](https://img.shields.io/badge/MCP-Supported-8A2BE2)](https://modelcontextprotocol.io)
[![storage](https://img.shields.io/badge/Storage-Local%20%2B%20Cloud%20Snapshots-success)](#storage-privacy-and-security)

[Quick Start](#quick-start) · [Web UI](#local-web-ui) · [First use](#first-use) · [Documentation](#documentation)

## Why use it?

AI coding assistants lose preferences, architectural decisions and investigation context between sessions. `memory_plugin` keeps that knowledge available across OpenCode, Codex, Claude Code, Gemini CLI, Antigravity and other MCP clients.

- **Keep useful context across sessions.** Save concise facts and working instructions in human-readable Markdown, with tags, history and explicit persona controls.
- **Retrieve the details when needed.** Search long-form Notes, PDF, DOCX, spreadsheets, web pages and code with hybrid full-text/vector retrieval, source links and a knowledge graph.
- **Follow the project across checkouts.** Git-based identity keeps project memory consistent while isolating unrelated projects and global context.
- **Manage memory in one local panel.** Browse and edit records, instructions and sources, configure models, and review backup and maintenance actions.
- **Run locally.** CPU inference and local storage need no Docker, external vector database or hosted embedding API. Full ZIP cloud checkpoints through Turso are optional; there is no telemetry.

## Quick Start

### Requirements

- Node.js **22.16+ in the 22.x branch, or 24+** (`^22.16.0 || >=24.0.0`); Node 23 is excluded.
- npm/npx and a supported coding client or another MCP-capable client.

CPU execution is the stable default. WebGPU is experimental.

### Install

Choose the client you want to configure. For Codex:

```bash
npx -y @lotargo/memory_plugin setup --codex
```

Other client flags: `--opencode`, `--claude`, `--gemini`, `--antigravity`.

Setup installs the selected integration and bundled skill, and adds managed memory instructions where supported. Existing unrelated configuration is preserved.

<details>
<summary>Configure all five client integrations</summary>

To set up OpenCode, Codex, Claude Code, Gemini CLI and Antigravity together, omit the client flag:

```bash
npx -y @lotargo/memory_plugin setup
```

</details>

Restart the configured client or open a new session to load the integration. For Codex, check the connection with:

```bash
npx -y @lotargo/memory_plugin doctor --codex
```

See [installation and client integration](https://github.com/Lotargo/memory_plugin/blob/main/docs/INSTALLATION.md) for marketplace installation, client configuration locations, headless setup and removal.

## Local Web UI

Open the shared local panel:

```bash
npx -y @lotargo/memory_plugin web
```

Browse and edit Notebook records, active instructions, history, project scopes and knowledge sources. The panel also provides source links and graphs, settings, model controls, and reviewed backup and maintenance actions.

<img src="https://raw.githubusercontent.com/Lotargo/memory_plugin/main/assets/ui/notebook.png" alt="Local Memory UI showing fictional Notebook facts, instructions, filters and record details" width="100%">

The screenshot uses fictional demo records. Current panel labels are in Russian; light, dark and system themes are supported. The panel listens on `127.0.0.1` and opens with a private connection URL. Saved-memory browsing needs no cloud account or embedding model.

See the [web UI guide](https://github.com/Lotargo/memory_plugin/blob/main/docs/WEB_UI.md) for editing, lifecycle, authentication, ports and autostart.

## First use

In a Git project, ask your connected agent to save a fact:

> Remember for this project: the API uses Fastify and Zod.

After the agent confirms it has saved the fact, **open a new session in the same project** and ask:

> What API stack have we saved for this project?

The agent reads the saved Notebook context with `recall(scope: "project")`. You can also inspect the saved record in the web panel. Global memory is available outside Git projects; pass `directory` when explicitly targeting a workspace.

<details>
<summary>Tool arguments for saving the example fact</summary>

The agent can call `remember` with:

```json
{
  "fact": "The project API uses Fastify and Zod.",
  "title": "API Stack",
  "kind": "fact",
  "scope": "project"
}
```

</details>

OpenCode initializes memory automatically. For other supported clients, restart the client or open a new session after setup to load the managed startup instructions. See [installation and client integration](https://github.com/Lotargo/memory_plugin/blob/main/docs/INSTALLATION.md) for client-specific behavior and troubleshooting.

For an instruction the agent should actively apply, use `kind: "directive"`. Save a long investigation with `remember_note`, and external source material with `ingest_document`. Notes and sources are searched on demand instead of being injected into every session.

See [memory architecture](https://github.com/Lotargo/memory_plugin/blob/main/docs/MEMORY_ARCHITECTURE.md) and [personalization](https://github.com/Lotargo/memory_plugin/blob/main/docs/PERSONALIZATION.md) for routing, source links and client behavior.

## Storage, Privacy, and Security

Working memory stays local: Markdown Notebook files, SQLite indexes and archived source text. Optional `cloud-snapshots` mode stores full ZIP checkpoints in Turso; it does not perform live synchronization. Snapshot upload is manual by default and can be scheduled explicitly.

- Agent scope `all` means **global + current project**, keeping unrelated project memory isolated.
- No telemetry or analytics are sent.
- Model weights download from Hugging Face on first use and are cached locally.
- URL ingestion and configured cloud operations use the network.
- Cloud credentials are encrypted locally and machine-bound; this is not an OS keychain.
- Removing client integrations preserves memory unless a data purge is explicitly requested.

Older `hybrid-sync` / `only-cloud` installations require the documented migration flow. See [storage, cloud snapshots and security](https://github.com/Lotargo/memory_plugin/blob/main/docs/STORAGE_AND_CLOUD.md) before migrating or restoring data.

## Documentation

The [documentation index](https://github.com/Lotargo/memory_plugin/blob/main/docs/README.md) contains the full guides and release records.

| Guide | What you will find |
| :--- | :--- |
| [Installation and clients](https://github.com/Lotargo/memory_plugin/blob/main/docs/INSTALLATION.md) | Setup flags, verification, headless setup, uninstall and recovery |
| [Memory architecture](https://github.com/Lotargo/memory_plugin/blob/main/docs/MEMORY_ARCHITECTURE.md) | Facts, Notes, sources, Git scopes, hybrid retrieval and graph |
| [Personalization](https://github.com/Lotargo/memory_plugin/blob/main/docs/PERSONALIZATION.md) | Directives, native persona, client prompts and migrations |
| [Web UI](https://github.com/Lotargo/memory_plugin/blob/main/docs/WEB_UI.md) | Notebook/projects, knowledge editing, graphs, models and panel lifecycle |
| [Maintenance and recovery](https://github.com/Lotargo/memory_plugin/blob/main/docs/MAINTENANCE.md) | Migrations, RAG import/export/reset, diagnostics and file cleanup |
| [Storage and cloud snapshots](https://github.com/Lotargo/memory_plugin/blob/main/docs/STORAGE_AND_CLOUD.md) | Checkpoints, scheduling, legacy recovery, authentication and security |
| [MCP / CLI / configuration](https://github.com/Lotargo/memory_plugin/blob/main/docs/REFERENCE.md) | Tool and command reference, defaults, model controls and troubleshooting |
| [Development and tests](https://github.com/Lotargo/memory_plugin/blob/main/docs/DEVELOPMENT.md) | Local repository linking, test commands and evaluation |
| [Benchmarks](https://github.com/Lotargo/memory_plugin/blob/main/docs/BENCHMARKS.md) | Included corpora, methodology, results and limitations |
| [Local marketplaces](https://github.com/Lotargo/memory_plugin/blob/main/MARKETPLACE.md) | Codex / Claude Code channels and migration |

Repository benchmarks describe the included datasets and configurations; they do not establish general benchmark superiority.

[Changelog](https://github.com/Lotargo/memory_plugin/blob/main/CHANGELOG.md) · [Roadmap](https://github.com/Lotargo/memory_plugin/blob/main/ROADMAP.md) · [Issues](https://github.com/Lotargo/memory_plugin/issues)

## License

[MIT](./LICENSE)
