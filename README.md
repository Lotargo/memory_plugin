<div align="center">

# opencode-memory-plugin

[![npm version](https://img.shields.io/npm/v/opencode-memory-plugin)](https://www.npmjs.com/package/opencode-memory-plugin)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

<br>

**Persistent memory for your AI coding agent**

Remembers who you are, what you're working on, and how you like things done — across sessions, across platforms.

</div>

## Platforms

| Platform | Status | How it works |
|----------|--------|-------------|
| **OpenCode** | ✅ Native | Direct plugin with custom tools + memory injection |
| **Claude Code** | ✅ Plugin | `.claude-plugin/` + SessionStart hook |
| **Codex** | ✅ Plugin | `.codex-plugin/` + skills |
| **Antigravity / Gemini CLI** | ✅ Extension | `gemini-extension.json` + GEMINI.md |

## Install

### OpenCode

Add to `opencode.json`:

```json
{
  "plugin": ["opencode-memory-plugin"]
}
```

Restart OpenCode. The plugin injects memory context and registers `remember`/`recall`/`forget` tools automatically.

### Claude Code

```bash
/plugin install https://github.com/Lotargo/memory_pugin
```

Then add MCP server to `.mcp.json` or `~/.claude.json`:
   ```json
   {
     "mcpServers": {
       "memory-agent": {
         "command": "npx",
         "args": ["-y", "opencode-memory-plugin"]
       }
     }
   }
   ```

### Codex

1. Install from plugin marketplace:
   ```
   /plugins
   ```

2. Add MCP server to `~/.codex/config.toml`:
   ```toml
   [mcp_servers.memory-agent]
   command = "npx"
   args = ["-y", "opencode-memory-plugin"]
   ```

### Antigravity / Gemini CLI

```bash
agy plugin install https://github.com/Lotargo/memory_pugin
```

Or for Gemini CLI:
```bash
gemini extensions install https://github.com/Lotargo/memory_pugin
```

Configure MCP in your project's `.agents/mcp_config.json`:
```json
{
  "mcpServers": {
    "memory-agent": {
      "command": "npx",
      "args": ["-y", "opencode-memory-plugin"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `remember` | Save an important fact (proactive, English, concise) |
| `recall` | Show saved facts (`project`, `global`, or `all`) |
| `forget` | Delete a fact by number or text search |

## Storage

Facts are stored as markdown files under `$MEMORY_DIR/memory/` (defaults to `$OPENCODE_CONFIG_DIR/memory/` or `~/.config/opencode/memory/`). Each project gets its own file; global facts go to `global.md`.

## Privacy

All facts are stored **locally** on your machine. Nothing is sent to any server. Add `memory/` to your `.gitignore` if you keep your config in version control.

## License

MIT
