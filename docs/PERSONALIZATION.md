# Persona and agent personalization

[Documentation](README.md) · [Project overview](../README.md)

Configure active directives and their native projections, synchronize client files, and migrate or restore existing installations.

## Persona and Agent Personalization

<img src="https://raw.githubusercontent.com/Lotargo/memory_plugin/main/assets/04_fact_vs_directive.png" alt="Fact versus directive semantics in memory_plugin" width="100%">

Notebook entries have explicit semantics:

```text
kind: "fact"       # descriptive context — what the agent knows
kind: "directive"  # active configuration — how the agent should behave
```

Use `kind: "directive"` for personality, behavior, tone, communication style, preferences, or working conventions the agent should actively apply. Explicit `kind` is authoritative; persuasive wording alone does not turn a fact into an instruction.

<img src="https://raw.githubusercontent.com/Lotargo/memory_plugin/main/assets/05_persona_as_runtime_state.png" alt="The same model with neutral, coding-focused and personalized runtime state" width="100%">

### OpenCode

The native plugin performs complete session initialization automatically:

- Global and current-project descriptive entries are injected into `<MEMORY_FACTS>`.
- Active global directives are separated into `<PERSONAL_AGENT_OVERLAY>`.
- Directives are promoted through OpenCode's system-prompt transform.
- Agents are instructed not to perform a redundant startup `recall`; manual or filtered recall remains available.

### Codex, Claude Code, Gemini CLI, and Antigravity

The global Notebook remains the source of truth. A single derived `persona` field combines active directives, retaining their original Notebook records, IDs, metadata and writing tools. Disabled, expired and superseded directives are excluded. The panel shows this read-only field in **Инструкции → Предпросмотр**; edit the source records as before.

Native adapters project the same field into each client's supported format:

- OpenCode: native system context, plus separately scoped project working directives.
- Codex: managed personality in `~/.codex/AGENTS.md`, including with the marketplace MCP channel. The limited `personality` preset remains the user's choice.
- Claude Code: `~/.claude/output-styles/memory-persona.md`, with `keep-coding-instructions: true` and an owned `outputStyle` selection in user settings. A user's existing custom style is preserved; personality is then appended to `CLAUDE.md` instead.
- Gemini CLI and Antigravity: one personality block in `~/.gemini/GEMINI.md`. Migration removes the duplicate personality from `.gemini/config/AGENTS.md` while preserving its memory instructions and user text.

`~/.config/memory-agent/persona.md` (or the configured XDG directory) is a generated mirror, not another writable source. Setup and `dev:link` initialize native delivery. Existing installations can migrate programmatically:

```bash
memory-cli persona migrate --dry-run
memory-cli persona migrate --preview-token <token-from-preview> --confirm
memory-cli persona status
```

Preview reviews exact paths, hashes, source IDs and counts. Apply checks the current Notebook/client versions, verifies a private backup and publishes through a recovery journal. Migration never rewrites Notebook records. Repeat execution is idempotent. Global directive changes keep selected client projections synchronized through the existing memory-writing mechanism. Active sessions may need a restart to load a new style or refreshed instructions.

For reviewed synchronization, disable or recovery:

```bash
memory-cli persona sync --dry-run
memory-cli persona sync --preview-token <token> --confirm
memory-cli persona disable --client claude --dry-run
memory-cli persona disable --client claude --preview-token <token> --confirm
memory-cli persona restore --backup-id <id> --dry-run
memory-cli persona restore --backup-id <id> --preview-token <token> --confirm
memory-cli persona recover --confirm
```

Disable manages generated files, preserving a user's selected style; it does not disable Notebook directives or remove MCP. OpenCode uses native context, so change its Notebook directives or remove its plugin to stop that delivery. Restore verifies the backup checksum and refuses to overwrite files edited after the backup. Client uninstall includes owned personality projections and restores an owned Claude selector; marketplace-managed channels remain with the client's plugin manager.

Manual synchronization:

```bash
memory-cli sync-persona
npm run persona:sync             # from the repository
```

The local panel's **Инструкции → Файлы клиентов** reviews legacy memory-prompt files. Marketplace-owned memory-prompt channels are skipped. After personality migration, those operations preserve the separate personality lifecycle; use `memory-cli persona` for native personality files. The panel shows the common field and client format templates without claiming active-session delivery. Removing memory-prompt blocks does not disable MCP or the plugin.

The same reviewed contract is available from both `memory-cli` and `memory-plugin`:

```bash
memory-cli prompts status
memory-cli prompts preview --client codex --operation enable
memory-cli prompts apply --client codex --operation enable --preview-token <token> --confirm
```

Clients: `codex`, `claude`, `gemini`, `antigravity`; operations: `enable`, `disable`, `sync`. Claude/Gemini previews also show any shared include change and its effect on other referencing clients. An interrupted file transaction blocks further writes; inspect the retained journal and files before `memory-cli prompts recover --confirm`. Recovery refuses to overwrite externally changed files. `prompts help` lists the contract; legacy all-client commands remain available through `memory-cli`.

Legacy entries using `persona`, `behavior`, `speech`, `style`, `tone`, `preference(s)`, `instruction(s)`, `directive`, or `inject:1` metadata remain compatible. Permanently classify them as explicit directives with the idempotent migration:

```bash
memory-cli migrate-persona --dry-run
memory-cli migrate-persona
npm run persona:migrate          # from the repository
```

Higher-priority platform and safety instructions remain authoritative.
