# General MCP Helpers Reference

Detailed reference for Integration Layer tools: `list-mcp-tools`, `mcp-reminder`.

## Discovering Connected MCP Servers (`list-mcp-tools`)

When working in multi-server environments (e.g., OpenCode, Claude Code), you might have several auxiliary servers installed (for database, UI design, browser automation, etc.).

- Use `list-mcp-tools` to immediately view all registered servers and their descriptions. This avoids guessing what other capabilities are available in the current workspace.

## Contextual Tool Reminders (`mcp-reminder`)

- If you are unsure which tool/server is best suited for the task at hand (e.g., how to do browser testing, or run a database migration), run `mcp-reminder(task: "your current task definition")`.
- It analyzes your task and suggests appropriate servers (like `playwright` for testing, `supabase` for DB, or `stitch` for UI design).
