<div align="center">

# opencode-memory-plugin

[![npm version](https://img.shields.io/npm/v/opencode-memory-plugin)](https://www.npmjs.com/package/opencode-memory-plugin)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

<br>

**Persistent memory for your OpenCode agent**

The agent remembers who you are, what you're working on, and how you like things done — across sessions, automatically.

</div>

## Features

- **Proactive memory** — the agent saves important facts on its own, no need to ask
- **Session injection** — saved facts are injected into context at the start of every session
- **Scoped storage** — `global` facts follow you everywhere, `project` facts stay local
- **Deduplication** — same fact won't be saved twice
- **Compact toast** — a quiet "Memory updated" notification in the TUI when something is saved
- **Cross-platform** — Windows, macOS, Linux

## Install

```bash
npm install opencode-memory-plugin
```

Then add to `opencode.json` (or `opencode.jsonc`):

```json
{
  "plugin": ["opencode-memory-plugin"]
}
```

Restart OpenCode — the plugin will be loaded automatically.

## How it works

At the top of each session, the agent receives a `<MEMORY>` block with saved facts and an instruction to remember new things. The agent decides what's worth saving.

```
<MEMORY>
Use `remember` only for important, durable facts.
Save high-signal things like: name, language, role/goals, constraints,
tech stack preferences, architecture decisions, project conventions.
DO NOT save: transient details, one-off statements.
When saving, translate the fact into English and keep it concise.

## Global
1. [2026-07-29] User's name is Alex
2. [2026-07-29] Prefers TypeScript over JavaScript

## Project: my-app
1. [2026-07-29] Uses React + Vite + Tailwind
</MEMORY>
```

## Tools

| Tool | Description |
|------|-------------|
| `remember` | Save an important fact to memory |
| `recall` | Show saved facts (`project`, `global`, or `all`) |
| `forget` | Delete a fact by number or text search |
| `list-mcp-tools` | List available MCP servers |
| `mcp-reminder` | Suggest which MCP tools to use for a task |

## Storage

Facts are stored as markdown files under `$OPENCODE_CONFIG_DIR/memory/` (defaults to `~/.config/opencode/memory/`). Each project gets its own file; global facts go to `global.md`.

## License

MIT
