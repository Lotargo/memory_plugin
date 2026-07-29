# opencode-memory-plugin

Persistent memory plugin for [OpenCode](https://opencode.ai). Gives your AI agent a long-term memory — it remembers user preferences, project context, and important facts across sessions.

## Features

- **Proactive memory** — the agent saves important facts automatically (like ChatGPT)
- **Session injection** — saved facts are injected into the conversation context at the start of each session
- **Global & project-scoped memory** — personal facts follow you everywhere; project facts stay in their project
- **Deduplication** — avoids saving the same fact twice
- **Toast notifications** — compact "Memory updated" notification in TUI when a fact is saved
- **Cross-platform** — works on Windows, macOS, and Linux

## Install

Add to your `opencode.json` (or `opencode.jsonc`):

```json
{
  "plugin": ["opencode-memory-plugin"]
}
```

OpenCode will install the package automatically via Bun on next startup.

### Manual install (local plugin)

Copy `.opencode/plugins/memory-plugin.js` to:

- **Global**: `~/.config/opencode/plugins/`
- **Project**: `.opencode/plugins/` in your project root

## How it works

### Memory injection

At the start of each session, the plugin reads saved facts and injects them into the first user message as a `<MEMORY>` block. The agent sees something like:

```
<MEMORY>
Use `remember` only for important, durable facts about the user and project.
...

## Global
1. [2026-07-29] The user's name is Oleg
2. [2026-07-29] The user prefers TypeScript over JavaScript

## Project: my-app
1. [2026-07-29] This project uses React + Vite + Tailwind
</MEMORY>
```

### Proactive saving

The injected context tells the agent to use the `remember` tool when it learns high-signal information. The agent decides what to save — you don't need to ask explicitly.

### Tools

| Tool | Description |
|------|-------------|
| `remember` | Save a fact to memory (agent uses this proactively) |
| `recall` | Show saved facts (scope: `project`, `global`, or `all`) |
| `forget` | Delete a fact by number or text search |
| `list-mcp-tools` | List available MCP servers |
| `mcp-reminder` | Suggest which MCP tools to use for a task |

### Where memory is stored

Facts are stored as markdown files in:

| Platform | Path |
|----------|------|
| Default | `~/.config/opencode/memory/` |
| Custom  | `$OPENCODE_CONFIG_DIR/memory/` |

Each project gets its own file (named after the project directory). Global facts go to `global.md`.

## Configuration

The plugin respects the `OPENCODE_CONFIG_DIR` environment variable. If set, memory files are stored under that directory instead of the default.

## Example

```
You: My name is Oleg and I prefer dark mode
Agent: Nice to meet you, Oleg! I'll remember that.
       [toast: Memory updated]

You: What's my name?
Agent: Your name is Oleg.
```

## License

MIT
