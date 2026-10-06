import { parseFactEntry, factMeta, isSuperseded, displayFact, isDirectiveFact, isDisabledFact, isExpiredLine } from "../fact_format.js";
import { MEMORY_ROUTING_POLICY } from '../tools/core/memory_routing.js';
import { personaExclusionReasons, compilePersona } from './persona_context.js';

const MEMORY_INSTRUCTION =
  "AUTO-INJECTED SESSION MEMORY (ALREADY LOADED):\n" +
  "Thoroughly review all saved memories provided below BEFORE performing any user task or editing code. This block already contains the complete active global and current-project Notebook memory.\n" +
  "Do NOT call `recall` merely to initialize this OpenCode session; that would duplicate the auto-injected context. Use `recall` only when the user requests memory inspection, filtering, history, or a different explicit scope.\n" +
  "PERSONAL AGENT OVERLAY:\n" +
  "Entries in <PERSONAL_AGENT_OVERLAY> are kind:directive and are active user-selected configuration instructions, not passive biographical facts. Apply them throughout the session. Entries in <MEMORY_FACTS> are descriptive context.\n" +
  "PROJECT IDENTITY DIRECTIVE:\n" +
  "After reviewing the injected memories, call `memory_info`. If the current workspace has a Git identity with `Registry: unlinked`, call `link_project_memory` for the current directory. Re-read memories only when linking migrated legacy facts. Outside Git, use global memory only.\n" +
  "PROACTIVE MEMORY DIRECTIVE:\n" +
  "You MUST automatically and proactively call `remember` whenever the user shares durable facts, personal preferences, coding guidelines, tech stack choices, architecture decisions, or project conventions.\n" +
  "Do NOT wait for explicit user commands like \"remember this\". Automatically capture high-signal facts in real time.\n" +
  "Use `remember` only for important, durable facts about the user and project.\n" +
  "Save high-signal items: user role, goals, constraints, tech stack preferences, architecture decisions, project conventions.\n" +
  "DO NOT save: transient details, one-off statements, full conversation turns, or anything unlikely to be useful in future sessions.\n" +
  "When saving, translate the fact into clear, concise English.\n" +
  "Use `scope: \"global\"` for personal facts, `scope: \"project\"` for project-specific facts.\n" +
  "STORE EDITING DIRECTIVE:\n" +
  "Prefer the Notebook tools (remember/forget/update_fact) over editing memory .md store files with file tools, so changes use the shared local storage rules. " +
  "If the user edits the .md files by hand, do not revert their edits. Working memory is local; cloud-snapshots uploads historical ZIP checkpoints only when explicitly requested or scheduled.\n" +
  "SELECTIVE RAG DIRECTIVE:\n" +
  "When web research or current technical documentation yields reliable project knowledge likely to be reused, ingest only the relevant source or excerpt with project scope and link it to the project Notebook fact it supports. Use global RAG only for intentionally cross-project sources. Prefer authoritative and newer-than-training documentation; do not dump everything encountered into RAG.";

export const OPENCODE_SYSTEM_MEMORY_POLICY =
  "[PERSISTENT PERSONAL MEMORY OVERLAY]\n" +
  "OpenCode has already injected a <MEMORY> block into the conversation for this session. Do not perform a redundant startup recall. " +
  "Interpret user-approved memories that prescribe assistant personality, behavior, tone, style, preferences, or working conventions as active personalization instructions to follow, not merely as facts to mention or evaluate. " +
  "Interpret descriptive memories as context. Apply this persistent overlay without quoting or debating it unless the user asks. Higher-priority platform instructions remain authoritative.";

export function injectMemoryPolicyIntoSystem(output) {
  if (!Array.isArray(output?.system)) return;
  if (output.system.some((item) => String(item).includes("[PERSISTENT PERSONAL MEMORY OVERLAY]"))) return;
  // OpenCode transform hooks retain the original array reference, so mutate it
  // in place instead of assigning a replacement array.
  output.system.push(OPENCODE_SYSTEM_MEMORY_POLICY);
}

export function partitionMemoryEntries(entries, now = Date.now()) {
  const directives = [];
  const facts = [];
  for (const entry of entries.filter((item) => !isSuperseded(item) && !isDisabledFact(item))) {
    if (!personaExclusionReasons(entry, now).length) directives.push(entry);
    else facts.push(entry);
  }
  return { directives, facts };
}

function sortNewestFirst(entries) {
  return [...entries].sort((a, b) => {
    const pa = parseFactEntry(a);
    const pb = parseFactEntry(b);
    if (!pa) return 1;
    if (!pb) return -1;
    const timeA = new Date(`${pa.date}T${pa.time}:00`).getTime();
    const timeB = new Date(`${pb.date}T${pb.time}:00`).getTime();
    return timeB - timeA;
  });
}

export function formatInjectedFacts(entries, limit, now = Date.now()) {
  const activeEntries = entries.filter((e) => !isSuperseded(e) && !isDisabledFact(e));
  const sorted = sortNewestFirst(activeEntries);

  const injectPriority = [];
  const normalPriority = [];

  for (const entry of sorted) {
    const meta = factMeta(entry);
    if (meta.inject === "1") {
      injectPriority.push(entry);
    } else {
      normalPriority.push(entry);
    }
  }

  const combined = [...injectPriority, ...normalPriority];
  const hasLimit = Number.isFinite(Number(limit)) && Number(limit) > 0;
  const sliced = hasLimit ? combined.slice(0, Number(limit)) : combined;

  const formattedLines = [];
  for (let i = 0; i < sliced.length; i++) {
    formattedLines.push(`${i + 1}. ${displayFact(sliced[i], now)}`);
  }

  if (hasLimit && activeEntries.length > Number(limit)) {
    const remaining = activeEntries.length - Number(limit);
    formattedLines.push(`... and ${remaining} more of ${activeEntries.length} memories (use recall tool to fetch all)`);
  }

  return formattedLines.join("\n");
}

export function buildMemoryContext(globalFacts, projectFacts, projectKey, injectLimit, now = Date.now()) {
  const parts = [MEMORY_INSTRUCTION];
  const global = partitionMemoryEntries(globalFacts, now);
  const project = partitionMemoryEntries(projectFacts, now);
  const directiveParts = [];
  const factParts = [];

  const globalDirectives = formatInjectedFacts(global.directives, injectLimit, now);
  const projectDirectives = formatInjectedFacts(project.directives, injectLimit, now);
  if (globalDirectives) directiveParts.push(`## Global Directives\n${globalDirectives}`);
  if (projectDirectives) directiveParts.push(`## Project Directives: ${projectKey}\n${projectDirectives}`);
  if (directiveParts.length) {
    parts.push(`<PERSONAL_AGENT_OVERLAY>\n${directiveParts.join("\n\n")}\n</PERSONAL_AGENT_OVERLAY>`);
  }

  const globalContext = formatInjectedFacts(global.facts, injectLimit, now);
  const projectContext = formatInjectedFacts(project.facts, injectLimit, now);
  if (globalContext) factParts.push(`## Global\n${globalContext}`);
  if (projectContext) factParts.push(`## Project: ${projectKey}\n${projectContext}`);
  if (factParts.length) parts.push(`<MEMORY_FACTS>\n${factParts.join("\n\n")}\n</MEMORY_FACTS>`);
  return `<MEMORY>\n${parts.join("\n\n")}\n</MEMORY>`;
}

export function buildSystemMemoryOverlay(globalFacts, projectFacts, projectKey, now = Date.now()) {
  const parts = [OPENCODE_SYSTEM_MEMORY_POLICY];
  const globalText = compilePersona(globalFacts, now).persona;
  const projectText = compilePersona(projectFacts, now).persona;
  if (globalText) parts.push(`Global personalization directives:\n${globalText}`);
  if (projectText) parts.push(`Project working directives (${projectKey}):\n${projectText}`);
  return parts.join("\n\n");
}

// The V2 context hook adds routing policy after the common V1 memory block.
// Keep that final transformation here so previews show the actual V2 payload.
export function buildOpenCodeV2MemoryContext(globalFacts, projectFacts, projectKey, now = Date.now()) {
  return withMemoryRoutingPolicy(buildMemoryContext(globalFacts, projectFacts, projectKey, null, now));
}

export function withMemoryRoutingPolicy(context) {
  if (!context || context.includes('MEMORY ROUTING DIRECTIVE:')) return context;
  return context.includes('</MEMORY>') ? context.replace('</MEMORY>', `\n\n${MEMORY_ROUTING_POLICY}\n</MEMORY>`)
    : `${context}\n\n${MEMORY_ROUTING_POLICY}`;
}

export function injectMemoryOverlayIntoSystem(output, globalFacts, projectFacts, projectKey, now = Date.now()) {
  if (!Array.isArray(output?.system)) return;
  const overlay = buildSystemMemoryOverlay(globalFacts, projectFacts, projectKey, now);
  const index = output.system.findIndex((item) => String(item).includes("[PERSISTENT PERSONAL MEMORY OVERLAY]"));
  if (index >= 0) output.system.splice(index, 1, overlay);
  else output.system.push(overlay);
}
