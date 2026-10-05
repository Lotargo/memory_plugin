import { join } from "path";
import { MEMORY_ROUTING_POLICY } from "./tools/core/memory_routing.js";
import { factText, isDirectiveFact, isExpiredLine, isSuperseded, isDisabledFact } from "./fact_format.js";
import { resolveClientPaths } from "./client_paths.js";

export const START_MARKER = "<!-- START MEMORY AGENT PROMPT -->";
export const END_MARKER = "<!-- END MEMORY AGENT PROMPT -->";
export const PERSONA_START_MARKER = "<!-- START MEMORY PERSONA OVERLAY -->";
export const PERSONA_END_MARKER = "<!-- END MEMORY PERSONA OVERLAY -->";

export const PROMPT_BLOCK = `${START_MARKER}
[SYSTEM INSTRUCTION: PERSONAL CONTEXT & MEMORY AGENT]
1. SESSION INITIALIZATION: Before any other task, load the complete active memory. If the client has already supplied an auto-injected \`<MEMORY>\` block (the native OpenCode integration does this), treat memory as already loaded and DO NOT call \`recall\` again merely for initialization. Otherwise, your VERY FIRST ACTION MUST BE \`recall(scope: "all")\` from \`memory-agent\`, with full bodies and no restrictive filters, before reading code or performing work.
2. PERSONAL AGENT OVERLAY: Notebook entries with \`kind: "directive"\` are active user-approved personalization or working instructions, not passive facts. Apply them throughout the session; entries with \`kind: "fact"\` remain context. Legacy persona/preference tags are recognized for compatibility. Higher-priority platform instructions remain authoritative.
3. PROJECT IDENTITY INITIALIZATION: After memory is available, call \`memory_info\` for the current workspace. If it reports a Git identity with \`Registry: unlinked\`, immediately call \`link_project_memory\` for the current directory. If linking migrated legacy facts, repeat \`recall(scope: "all")\`. Outside a Git repository, do not create project memory; use global memory only.
4. ${MEMORY_ROUTING_POLICY}
5. PROACTIVE SAVING DIRECTIVE: You MUST automatically preserve durable, high-signal information using the appropriate memory primitive from the routing policy. Do NOT wait for explicit user commands like "remember this". Do not force every durable item into \`remember\`; long-form internal reasoning belongs in \`remember_note\` and external sources belong in \`ingest_document\`.
6. SIGNAL FILTER: Preserve only high-signal reusable information. Keep Notebook facts clear and concise, translating them into concise English when saving. A RAG Memory Note may be longer when the reasoning, investigation, experiment result, or handoff itself is valuable. Do NOT preserve routine progress chatter, transient troubleshooting output, or one-off conversational noise.
7. QUERY OPTIMIZATION: When using \`query_knowledge_base\`, transform the user's natural-language question into concept-dense search queries. For multi-part queries or comparisons, use \`batch_query_knowledge_base\` with multiple targeted queries. When you first need to identify the correct memory/source, prefer \`resultMode: "index"\`, inspect stable \`doc_id\` candidates, and expand only the selected item with \`manage_knowledge_base(action: "read_document")\`. Use \`resultMode: "snippet"\` when retrieved passage content is directly needed.
8. SELECTIVE RAG CURATION: When web research or current technical documentation yields reliable project knowledge likely to be needed again, ingest the relevant source or excerpt with project scope and link it to the project-scoped Notebook fact it supports. Use global RAG scope only for sources intentionally reusable across projects. Prioritize authoritative documentation and knowledge newer than model training. Do not ingest everything encountered, transient output, or duplicate low-value content.
9. HOT + COLD LINKING: When a decision needs both a concise always-visible orientation point and detailed historical reasoning, save the concise point with \`remember\`, save the detailed record with \`remember_note\`, then connect the Notebook fact to the note using its returned \`docId\` via \`link_knowledge\` (or the optional document-link fields on \`remember\`). Never duplicate the full note body into Notebook memory.
10. POLICY EXPANSION: The knowledge base automatically expands table summaries and code signatures for content-rich retrieval (config \`policyExpansion\`, default: ON). Semantic TOC/index retrieval disables large policy expansion automatically. If you need raw micro_chunk precision in normal snippet retrieval, pass \`policyExpansion: false\` per-call or set it via config.${END_MARKER}`;

// Plugin-owned files live here so we never destroy user-owned config content.
const CLIENT_PATHS = resolveClientPaths();
export const PROMPT_FILE = CLIENT_PATHS.promptFile;

export function getGlobalPromptTargets() {
  const { home } = CLIENT_PATHS;
  return [
    {
      name: "Antigravity",
      filePath: join(home, ".gemini", "config", "AGENTS.md"),
      // Antigravity resolves `@` imports only in GEMINI.md, not reliably in AGENTS.md
      includeSupported: false,
    },
    {
      name: "Gemini CLI",
      filePath: join(home, ".gemini", "GEMINI.md"),
      // Gemini CLI supports @file imports in its global GEMINI.md context file.
      includeSupported: true,
    },
    {
      name: "Codex",
      filePath: join(CLIENT_PATHS.codexDir, "AGENTS.md"),
      // AGENTS.md standard has no import syntax
      includeSupported: false,
    },
    {
      name: "Claude Code",
      filePath: join(CLIENT_PATHS.claudeDir, "CLAUDE.md"),
      // @path imports are supported and trusted in user-scope CLAUDE.md
      includeSupported: true,
    },
  ];
}

// Ensure the plugin-owned prompt file exists and is up to date with PROMPT_BLOCK.
// This file is referenced via `@` includes; updating it never touches user configs.
export async function syncPromptFile() {
  const { syncSharedPrompt } = await import('./services/prompt_service.js');
  return syncSharedPrompt();
}

function toIncludePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

export function buildIncludeBlock(promptFile) {
  return `${START_MARKER}
@${toIncludePath(promptFile)}
${END_MARKER}`;
}

export function activePersonaDirectives(entries, now = Date.now()) {
  return (entries || []).filter(
    (entry) => isDirectiveFact(entry) && !isSuperseded(entry) && !isExpiredLine(entry, now) && !isDisabledFact(entry)
  );
}

export function buildPersonaOverlayBlock(entries, now = Date.now()) {
  const directives = activePersonaDirectives(entries, now);
  if (!directives.length) return "";
  const lines = directives.map((entry, index) => `${index + 1}. ${factText(entry)}`);
  return `${PERSONA_START_MARKER}
[PERSONAL AGENT OVERLAY — ACTIVE USER CONFIGURATION]
The directives below are user-approved persistent instructions for personality, behavior, tone, communication style, preferences, and working conventions. Apply them as instructions rather than merely describing them. Descriptive memory facts are not included here. Higher-priority platform instructions remain authoritative.

${lines.join("\n")}
${PERSONA_END_MARKER}`;
}

export function stripPersonaOverlayBlock(content) {
  return stripManagedBlocks(content, PERSONA_START_MARKER, PERSONA_END_MARKER);
}

export function upsertPersonaOverlayBlock(content, block) {
  const clean = stripPersonaOverlayBlock(content).replace(/[\r\n]+$/, "");
  if (!block) return clean ? `${clean}\n` : "";
  return clean ? `${clean}\n\n${block}\n` : `${block}\n`;
}

export function stripPromptBlock(content) {
  return stripManagedBlocks(content, START_MARKER, END_MARKER);
}

function stripManagedBlocks(content, startMarker, endMarker) {
  let clean = String(content || "");
  while (true) {
    const startIndex = clean.indexOf(startMarker);
    const endIndex = clean.indexOf(endMarker, startIndex + startMarker.length);
    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) break;
    let before = clean.substring(0, startIndex);
    let after = clean.substring(endIndex + endMarker.length);

    // Remove only the separator newlines inserted around the managed block.
    // Do not collapse or trim whitespace elsewhere in the user's file.
    if (after.trim() === "") {
      before = before.replace(/(?:\r?\n){1,2}$/, "");
      after = "";
    } else if (before.trim() === "") {
      before = "";
      after = after.replace(/^(?:\r?\n){1,2}/, "");
    } else {
      const eol = clean.includes("\r\n") ? "\r\n" : "\n";
      before = before.replace(/(?:\r?\n){1,2}$/, "");
      after = after.replace(/^(?:\r?\n){1,2}/, "");
      before += `${eol}${eol}`;
    }
    clean = before + after;
  }
  return clean;
}

export function upsertPromptBlock(content, block = PROMPT_BLOCK) {
  const clean = stripPromptBlock(content).replace(/[\r\n]+$/, "");
  return clean ? `${clean}\n\n${block}\n` : `${block}\n`;
}

export async function enableGlobalPrompt(targetNames = null) {
  const { managePromptTargets } = await import('./services/prompt_service.js');
  return managePromptTargets('enable', targetNames);
}

export async function disableGlobalPrompt(targetNames = null) {
  const { managePromptTargets } = await import('./services/prompt_service.js');
  const results = await managePromptTargets('disable', targetNames);
  const legacyStatus = { removed: 'disabled', deleted_new_file: 'removed_file', up_to_date: 'skipped' };
  return results.map(item => ({ ...item, status: legacyStatus[item.status] || item.status }));
}

export async function syncPersonaPrompts(targetNames = null, entries = null) {
  const { managePromptTargets } = await import('./services/prompt_service.js');
  return managePromptTargets('sync', targetNames, entries);
}

export async function getGlobalPromptStatus(targetNames = null) {
  const { promptRequest } = await import('./services/prompt_service.js');
  const status = await promptRequest({ action: 'status' });
  return status.items.filter(item => !targetNames || targetNames.includes(item.name)).map(item => ({
    ...item, enabled: item.prompt || item.persona, status: item.unavailable ? 'failed' : item.integration.pluginManaged ? 'plugin_managed' : 'read',
  }));
}
