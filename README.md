<div align="center">

# @lotargo/memory_plugin

[![npm version](https://img.shields.io/npm/v/@lotargo/memory_plugin)](https://www.npmjs.com/package/@lotargo/memory_plugin)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

<br>

**Persistent long-term memory for your AI coding agents and assistants**

Automatically remembers and recalls important facts about you, your preferences, and your projects across sessions and across platforms.

</div>

---

## Why @lotargo/memory_plugin?

Standard AI assistants lose all context as soon as a chat window is closed or a session is reset. You end up having to repeatedly re-explain how you prefer your code formatted, which libraries you use, or how you like to be addressed.

`@lotargo/memory_plugin` gives your AI assistants durable, local long-term memory that persists across restarts and works seamlessly across all supported coding environments.

### Practical Use Cases

#### 1. Software Development
- **Architectural Decisions**: *"In this project, we use Fastify instead of Express and strict schema validation via Zod."*
- **Coding Conventions**: *"Place all helper utilities inside `src/utils/` and always cover new functions with Vitest tests."*
- **Environment Constraints**: *"Our target deployment environment is Node.js 20 on AWS Lambda."*

#### 2. Everyday Chat & Interaction
- **User Profile & Communication Tone**: *"My name is Alex. I prefer concise, direct answers without conversational filler."*
- **Explanation Format**: *"Explain complex technical concepts using real-world analogies."*
- **Context & Goals**: *"I am currently preparing for a Senior Backend Developer technical interview."*

---

## Supported Platforms

| Platform | Status | Mechanism |
|----------|--------|-----------|
| **Antigravity / Gemini CLI** | ✅ Supported | `.antigravity-plugin/` + skills + MCP |
| **Claude Code** | ✅ Supported | `.claude-plugin/` + skills + MCP |
| **Codex** | ✅ Supported | `.codex-plugin/` + skills + MCP |
| **OpenCode** | ✅ Native | Native memory injection + custom tools |

---

## Minimum System Requirements

- **Node.js**: version `18.0.0` or higher
- **Package Manager**: `npm` / `npx` (included with Node.js)
- **Supported Environment**: Any supported AI environment (Antigravity, Claude Code, Codex, OpenCode)

---

## Installation (Single Command)

Run this single command in your terminal to automatically configure memory for your AI tools without cloning the repository:

### Install for All Detected Environments
```bash
npx @lotargo/memory_plugin setup
```

### Targeted Installation for a Specific Platform

- **Antigravity / Gemini CLI only**:
  ```bash
  npx @lotargo/memory_plugin setup --antigravity
  ```
- **OpenCode only**:
  ```bash
  npx @lotargo/memory_plugin setup --opencode
  ```
- **Claude Code only**:
  ```bash
  npx @lotargo/memory_plugin setup --claude
  ```
- **Codex only**:
  ```bash
  npx @lotargo/memory_plugin setup --codex
  ```

---

## Available Tools

| Tool | Description |
|------|-------------|
| `remember` | Save an important fact (`global` or `project` scope) |
| `recall` | Display saved facts (`project`, `global`, or `all`) |
| `forget` | Remove a fact by number or text query |

---

## Storage & Privacy

- **Local Storage**: All facts are stored strictly locally on your machine in Markdown format under `$MEMORY_DIR/memory/` (defaults to `~/.config/opencode/memory/`).
- **Privacy**: Your data is never sent to external servers or third-party services.

---

## License

MIT
