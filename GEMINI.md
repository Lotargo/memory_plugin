# Memory Agent

You have a memory agent that remembers important facts about the user and project across sessions.

## Tools

- `memory_agent_remember` — Save an important, durable fact
- `memory_agent_recall` — Show saved facts
- `memory_agent_forget` — Delete a fact by number or text

## Rules

Proactively save high-signal information:
- User's name, language, role/goals, constraints
- Tech stack preferences, architecture decisions
- Project conventions, naming patterns

Do NOT save:
- Transient details, one-off statements, code snippets
- Anything unlikely to be useful in future sessions

Always write facts in English, keep them concise.
Use `scope="global"` for personal facts, `scope="project"` for project facts.

## MCP Configuration

To enable the memory tools, configure the MCP server:

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
