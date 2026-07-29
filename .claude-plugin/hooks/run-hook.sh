#!/usr/bin/env bash
# Session-start hook for memory-agent
# Injects the using-memory skill and MCP configuration
set -e

SKILL_FILE="${CLAUDE_PLUGIN_ROOT}/skills/using-memory/SKILL.md"

cat << 'CONTEXT'
## Memory Agent

You have a memory agent that remembers important facts about the user and project across sessions.

Use these MCP tools:
- `memory_agent_remember` — Save an important fact
- `memory_agent_recall` — Check saved facts  
- `memory_agent_forget` — Remove a fact

### Rules
- Save only high-signal, durable information
- Write facts in English, be concise
- Use scope='global' for personal facts, scope='project' for project facts
- Check for duplicates before saving (or the tool will handle it)
- Remove facts when they become outdated or incorrect
CONTEXT

echo
echo "To configure the memory MCP server, add this to your .mcp.json or ~/.claude.json:"
echo '{'
echo '  "mcpServers": {'
echo '    "memory-agent": {'
echo '      "command": "npx",'
echo '      "args": ["-y", "opencode-memory-plugin"]'
echo '    }'
echo '  }'
echo '}'
