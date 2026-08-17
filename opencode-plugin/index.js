// Static ESM imports: top-level `await import(...)` blocked module evaluation
// and made this file an async module for every consumer.
import { mkdir, cp, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  parseFactEntry,
  factText,
  factMeta,
  isSuperseded,
  displayFact,
  factBody,
} from "../mcp-server/fact_format.js";

import {
  MEMORY_DIR,
  GLOBAL_KEY,
  canonicalPath,
  projectKey,
  scopeKey,
  readMemory,
  writeMemory,
  storeFilePath,
} from "../mcp-server/memory.js";

import { closeDatabase } from "../mcp-server/db/database.js";
import { requireProjectKey } from "../mcp-server/tools/helpers.js";
import { resolveRagScopeKey, resolveRagScopeKeys, resolveManageRagScopeKeys, removeDocumentScopes } from "../mcp-server/rag_scope.js";
// Shared Notebook tool implementations — the same code the MCP server runs, so
// a fix in one surface can no longer miss the other.
import {
  rememberFact,
  recallFacts,
  getFactById,
  forgetFacts,
  updateFactText,
  memoryInfo,
} from "../mcp-server/tools/core/memory_core.js";

// Registered once when the plugin is instantiated, never at import time:
// importing this module repeatedly used to stack duplicate "exit" listeners.
let exitHookInstalled = false;
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    try {
      closeDatabase();
    } catch {}
  });
}

const CONFIG_DIR = process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode");
const SKILLS_DIR = join(CONFIG_DIR, "skills");

async function ensureDir() {
  if (!existsSync(MEMORY_DIR)) await mkdir(MEMORY_DIR, { recursive: true });
  try {
    const pluginDir = dirname(fileURLToPath(import.meta.url));
    const packageSkillsDir = join(pluginDir, "..", "skills");
    if (existsSync(packageSkillsDir)) {
      await mkdir(SKILLS_DIR, { recursive: true });
      const entries = await readdir(packageSkillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const src = join(packageSkillsDir, entry.name);
          const dest = join(SKILLS_DIR, entry.name);
          await cp(src, dest, { recursive: true });
        }
      }
    }
  } catch (e) {}
}

async function notify(client, message, variant = "success") {
  if (!client?.tui?.showToast) {
    await client?.app?.log({
      body: { service: "memory-plugin", level: "warn", message: "client.tui.showToast not available" },
    });
    return;
  }
  const payload = { message, variant, duration: 3000 };
  try {
    await client.tui.showToast({ body: payload });
  } catch (err1) {
    try {
      await client.tui.showToast(payload);
    } catch (err2) {
      await client?.app?.log({
        body: {
          service: "memory-plugin",
          level: "error",
          message: "showToast failed",
          extra: { shape1: String(err1), shape2: String(err2) },
        },
      });
    }
  }
}

const MEMORY_INSTRUCTION =
  "MANDATORY FIRST STEP (READ MEMORIES FIRST):\n" +
  "At the start of every session, you MUST thoroughly review all saved memories provided below BEFORE performing any user task or editing code.\n" +
  "If calling `recall` manually, your very first action MUST BE to request ALL global memories (`scope: \"all\"` without restrictive query filters) to ensure no global facts or preferences are missed.\n" +
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
  "SELECTIVE RAG DIRECTIVE:\n" +
  "When web research or current technical documentation yields reliable project knowledge likely to be reused, ingest only the relevant source or excerpt with project scope and link it to the project Notebook fact it supports. Use global RAG only for intentionally cross-project sources. Prefer authoritative and newer-than-training documentation; do not dump everything encountered into RAG.";

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
  const activeEntries = entries.filter((e) => !isSuperseded(e));
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

  if (globalFacts.length) {
    const formatted = formatInjectedFacts(globalFacts, injectLimit, now);
    if (formatted) parts.push("## Global\n" + formatted);
  }
  if (projectFacts.length) {
    const formatted = formatInjectedFacts(projectFacts, injectLimit, now);
    if (formatted) parts.push(`## Project: ${projectKey}\n` + formatted);
  }
  return `<MEMORY>\n${parts.join("\n\n")}\n</MEMORY>`;
}

const MCP_SERVERS = [
  { id: "context7", desc: "Документация библиотек и фреймворков (Context7)" },
  { id: "supabase", desc: "БД Supabase — SQL, миграции, edge functions" },
  { id: "stitch", desc: "UI дизайн — генерация и редактирование экранов" },
  { id: "neon", desc: "БД Neon — PostgreSQL, схемы, миграции" },
  { id: "linear", desc: "Linear — задачи, проекты, документы" },
  { id: "grep", desc: "Поиск примеров кода на GitHub" },
  { id: "skills-anthropic", desc: "Скиллы Anthropic — дизайн, доки, MCP, PDF/PPTX/XLSX" },
  { id: "skills-vercel", desc: "Скиллы mattpocock — engineering workflow (grill, tdd, triage, architecture)" },
  { id: "playwright", desc: "Браузерные тесты — навигация, скриншоты, клики" },
  { id: "github", desc: "GitHub API — PRs, issues, репозитории" },
];

export const MemoryPlugin = async ({ directory, worktree, client }) => {
  installExitHook();
  await ensureDir();
  let activeProjectKey = await scopeKey("project", worktree, directory);
  let identityResolveAt = 0;

  const currentProjectKey = async () => {
    const now = Date.now();
    if (now < identityResolveAt) return activeProjectKey;
    identityResolveAt = now + 2000;
    try {
      const path = client?.path?.get ? await client.path.get() : null;
      const wt = path?.worktree || worktree;
      const dir = path?.directory || directory;
      const key = await scopeKey("project", wt, dir);
      if (key !== activeProjectKey) activeProjectKey = key;
    } catch (e) {}
    return activeProjectKey;
  };

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages?.length) return;
      const firstUser = output.messages.find((m) => m?.info?.role === "user");
      if (!firstUser?.parts?.length) return;

      if (firstUser.parts.some((p) => p.type === "text" && p.text.includes("<MEMORY>"))) return;

      const [globalFacts, projectFacts] = await Promise.all([
        readMemory(GLOBAL_KEY),
        readMemory(await currentProjectKey()),
      ]);

      const context = buildMemoryContext(globalFacts, projectFacts, activeProjectKey, null);
      const ref = firstUser.parts[0];
      firstUser.parts.unshift({ ...ref, type: "text", text: context });
    },

    tool: {
      "list-mcp-tools": {
        description: "Показать список всех подключённых MCP серверов и их назначение",
        args: {},
        async execute() {
          const lines = MCP_SERVERS.map((s) => `  ${s.id.padEnd(20)} ${s.desc}`);
          return "Доступные MCP серверы:\n" + lines.join("\n");
        },
      },
      "mcp-reminder": {
        description: "Напомнить какие MCP инструменты подходят для текущей задачи. Вызови когда сомневаешься что выбрать.",
        args: {
          task: {
            type: "string",
            description: "Описание того что собираешься делать (опционально)",
          },
        },
        async execute({ task }) {
          if (task) {
            return `Для задачи "${task}" рекомендую посмотреть список через list-mcp-tools. Основные сценарии:\n- Работа с кодом → skills-vercel (grill, tdd, review), github\n- UI/дизайн → stitch, skills-anthropic (frontend-design, webapp-testing)\n- База данных → supabase, neon\n- Документы → skills-anthropic (docx, pdf, pptx, xlsx)\n- Поиск примеров → grep`;
          }
          return "Вызови list-mcp-tools чтобы увидеть все доступные MCP серверы";
        },
      },
      "remember": {
        description:
          "Save an important, durable fact to memory. Only use for high-signal information " +
          "(name, goals, constraints, tech preferences, project conventions). " +
          "docId/startLine/endLine/relationType are OPTIONAL and only used to link the fact to a " +
          "Knowledge Base document or line range; omit them when no linking is needed. " +
          "ttl is OPTIONAL (e.g. \x2790d\x27, \x272w\x27, \x2724h\x27) — expired facts are shown with [EXPIRED] but not auto-deleted. " +
          "keep=true protects the fact from forget deletion unless force=true. " +
          "tags is OPTIONAL comma-separated text for filtering. " +
          "supersedes is OPTIONAL: a number, id, or text of a fact this one replaces. " +
          "Translate the fact into English and keep it concise. " +
          "scope: \x27project\x27 (default) or \x27global\x27",
        args: {
          fact: { type: "string", description: "The fact to remember, written in English" },
          title: { type: "string", description: "Optional title for the fact" },
          scope: {
            type: "string",
            description: "\x27project\x27 (default) or \x27global\x27",
            default: "project",
          },
          directory: { type: "string", description: "Optional workspace/project directory path to target when scope='project' (e.g. 'F:/projects/my-app')" },
          project: { type: "string", description: "Alias for directory" },
          docId: { type: "string", description: "Optional document ID, title, or path to link this fact to" },
          startLine: { type: "number", description: "Optional starting line number in target document" },
          endLine: { type: "number", description: "Optional ending line number in target document" },
          relationType: {
            type: "string",
            description: "Relation type (e.g. \x27RULES_FOR\x27, \x27IMPLEMENTS\x27, \x27REFERENCES\x27)",
            default: "LINKS_TO",
          },
          ttl: { type: "string", description: "Optional time-to-live, e.g. \x2790d\x27, \x272w\x27, \x2724h\x27, \x2712m\x27" },
          keep: { type: "boolean", description: "Protect the fact from forget deletion unless force=true" },
          tags: { type: "string", description: "Optional comma-separated tags, e.g. \x27pref,arch\x27" },
          supersedes: { type: "string", description: "Optional number, id, or text of the fact this one replaces" },
        },
        async execute(args, { worktree, directory }) {
          const result = await rememberFact(args, { worktree, directory });
          await notify(client, result);
          return result;
        },
      },

      "recall": {
        description:
          "Show saved facts with any Agent-linked Knowledge Base documents/lines. " +
          "scope: \x27project\x27, \x27global\x27, \x27all\x27 (default), or \x27list_projects\x27. " +
          "Use directory: \x27<directory path>\x27 to read facts of a specific project from any working directory. " +
          "query filters by keyword, tags by comma-separated tags, since/until by date (YYYY-MM-DD). " +
          "The response includes the store file paths.",
        args: {
          scope: {
            type: "string",
            description: "project, global, all (по умолчанию) или list_projects",
            default: "all",
          },
          directory: { type: "string", description: "Directory path of the project to read facts from (e.g. \x27F:/projects/plugins/memory\x27)" },
          project: { type: "string", description: "Alias for directory" },
          query: { type: "string", description: "Optional keyword filter; all space-separated terms must match" },
          tags: { type: "string", description: "Optional comma-separated tag filter (any match)" },
          since: { type: "string", description: "Optional start date filter, YYYY-MM-DD (inclusive)" },
          until: { type: "string", description: "Optional end date filter, YYYY-MM-DD (inclusive)" },
          mode: { type: "string", description: "Result mode: 'full' (with body, default) or 'headers' (title and badges only)", default: "full" },
          offset: { type: "number", description: "Pagination offset (optional)" },
          limit: { type: "number", description: "Pagination limit (optional)" },
          includeSuperseded: { type: "boolean", description: "Include superseded historical facts (excluded by default)", default: false },
        },
        async execute(args, { worktree, directory }) {
          return await recallFacts(args, { worktree, directory });
        },
      },

      "get_fact": {
        description: "Get the full text and metadata of a single fact by its metadata id.",
        args: {
          id: { type: "string", description: "The unique metadata id of the fact (e.g. \x278f3a2c\x27)" },
          scope: { type: "string", description: "\x27project\x27, \x27global\x27, or \x27all\x27 (default)", default: "all" },
          directory: { type: "string", description: "Optional workspace/project directory path" },
          project: { type: "string", description: "Alias for directory" },
        },
        async execute(args, { worktree, directory }) {
          return await getFactById(args, { worktree, directory });
        },
      },
      "forget": {
        description: "Удалить факт по номеру (см. recall), по диапазону (например '3-30', включительно) или тексту. Защищённые факты (remember с keep=true) пропускаются, если не передан force=true",
        args: {
          query: { type: "string", description: "Номер факта, диапазон вида '3-30' или текст для поиска" },
          scope: {
            type: "string",
            description: "project (по умолчанию) или global",
            default: "project",
          },
          directory: { type: "string", description: "Optional workspace/project directory path" },
          project: { type: "string", description: "Alias for directory" },
          force: { type: "boolean", description: "Удалить также защищённые (keep) факты" },
        },
        async execute(args, { worktree, directory }) {
          const result = await forgetFacts(args, { worktree, directory });
          if (result.startsWith("Memory updated")) await notify(client, result);
          return result;
        },
      },
      "update_fact": {
        description:
          "Update the text of an existing fact by number (from recall), id, or text match, " +
          "preserving its original date and metadata. Linked Knowledge Base documents are re-pointed to the new text.",
        args: {
          id: { type: "string", description: "Number (from recall), metadata id, or text of the fact to update" },
          newText: { type: "string", description: "New fact text" },
          title: { type: "string", description: "Optional new title for the fact" },
          scope: { type: "string", description: "\x27project\x27 (default) or \x27global\x27", default: "project" },
          directory: { type: "string", description: "Optional workspace/project directory path" },
          project: { type: "string", description: "Alias for directory" },
        },
        async execute(args, { worktree, directory }) {
          const result = await updateFactText(args, { worktree, directory });
          await notify(client, result);
          return result;
        },
      },

      "memory_info": {
        description: "Show memory storage paths (store files, MEMORY_DIR, SQLite DB), fact counts, and Knowledge Base stats.",
        args: {
          directory: { type: "string", description: "Optional workspace/project directory path to inspect (default: current directory)" },
          project: { type: "string", description: "Alias for directory" },
        },
        async execute(args, ctx = {}) {
          return await memoryInfo(args, { worktree: ctx.worktree ?? worktree, directory: ctx.directory ?? directory });
        },
      },
      "link_knowledge": {
        description:
          "Explicitly link a Notebook memory fact to a Knowledge Base document, section, or line range. " +
          "Creates Agent-driven Graph Edges connecting memory to RAG documents.",
        args: {
          action: {
            type: "string",
            description: "Action type: 'link' (default), 'list_links', 'get_doc_links'",
            default: "link",
          },
          factText: { type: "string", description: "Memory fact text or keyword" },
          docId: { type: "string", description: "Document ID, title, or file path" },
          scope: { type: "string", description: "'project' (default) or 'global'", default: "project" },
          directory: { type: "string", description: "Optional workspace/project directory path" },
          project: { type: "string", description: "Alias for directory" },
          startLine: { type: "number", description: "Starting line number in target document" },
          endLine: { type: "number", description: "Ending line number in target document" },
          relationType: {
            type: "string",
            description: "Relation type (e.g. 'RULES_FOR', 'IMPLEMENTS', 'EXPLAINS')",
            default: "LINKS_TO",
          },
        },
        async execute({ action, factText, docId, scope, directory, project, startLine, endLine, relationType }, { worktree, directory: ctxDir }) {
          const { linkFactToDocument, getLinksForDoc, listAllLinks } = await import("../mcp-server/graph/knowledge_linker.js");
          const effectiveDir = directory || project || ctxDir;
          const key = await scopeKey(scope || "project", worktree, effectiveDir);
          const act = action || "link";

          if (act === "link" || act === "list_links") {
            requireProjectKey(key);
          }

          if (act === "link") {
            if (!factText || !docId) {
              throw new Error("factText and docId are required parameters for link action");
            }
            const facts = await readMemory(key);
            const needle = factText.toLowerCase().trim();
            const matches = facts.filter((entry) => {
              const body = factBody(entry).toLowerCase();
              return body === needle || body.includes(needle) || entry.toLowerCase().includes(needle);
            });
            if (matches.length === 0) throw new Error(`Notebook fact not found for link: ${factText}`);
            if (matches.length > 1) throw new Error(`Notebook fact match is ambiguous; use a more specific factText: ${factText}`);
            const resolvedFactText = factBody(matches[0]);
            const res = await linkFactToDocument({
              factKey: key,
              factText: resolvedFactText,
              docId,
              startLine,
              endLine,
              relationType: relationType || "LINKS_TO",
            });
            return JSON.stringify(res, null, 2);
          }

          if (act === "get_doc_links") {
            if (!docId) throw new Error("docId parameter is required for get_doc_links action");
            const allowedScopes = key === GLOBAL_KEY ? [GLOBAL_KEY] : [GLOBAL_KEY, key];
            const links = await getLinksForDoc(docId, allowedScopes);
            return JSON.stringify(links, null, 2);
          }

          if (act === "list_links") {
            const links = await listAllLinks(key);
            return JSON.stringify(links, null, 2);
          }

          throw new Error(`Unknown action: ${act}`);
        },
      },
      "ingest_document": {
        description:
          "Selectively preserve a reliable, reusable source in the RAG knowledge base; do not ingest everything encountered. " +
          "Accepts local file paths, web URLs, or raw Markdown/text content. " +
          "For type='url' the page is fetched and its content is indexed (not just the URL). " +
          "Processes document through 3-tier hierarchy chunking (Big/Medium/Small), " +
          "computes dense vectors, and extracts GraphRAG code symbols.",
        args: {
          content: { type: "string", description: "Raw text content, file path, or web URL" },
          type: { type: "string", description: "Input content type: 'text', 'file', 'url' (url fetches the page content)", default: "text" },
          title: { type: "string", description: "Document title" },
          path: { type: "string", description: "Original document file path" },
          scope: { type: "string", description: "RAG visibility: current Git project (default) or global", default: "project" },
          directory: { type: "string", description: "Optional workspace/project directory path to target" },
          project: { type: "string", description: "Alias for directory" },
          generateEmbeddings: { type: "boolean", description: "Compute dense vector embeddings", default: true },
        },
        async execute({ content, type, title, path, scope, directory, project, generateEmbeddings }, { worktree, directory: ctxDir }) {
          const { ingestDocument } = await import("../mcp-server/ingest/pipeline.js");
          const effectiveDir = directory || project || ctxDir;
          const projectScope = await resolveRagScopeKey(scope || "project", { worktree, directory: effectiveDir });
          const result = await ingestDocument({
            content,
            type: type || "text",
            title: title || null,
            path: path || null,
            generateEmbeddings: generateEmbeddings !== false,
            projectScope,
          });
          return JSON.stringify(
            {
              status: "success",
              docId: result.docId,
              title: result.title,
              sectionsCount: result.sectionsCount,
              microChunksCount: result.microChunksCount,
              deduplicated: result.deduplicated,
              scope: result.projectScope,
            },
            null,
            2
          );
        },
      },
      "query_knowledge_base": {
        description:
          "Perform project-isolated hybrid search (RSF/RRF BM25 full-text + dense vector similarity) across the RAG knowledge base. " +
          "Returns top-ranked candidate document sections with breadcrumbs, GraphRAG defined code symbols, and relevance scores.",
        args: {
          query: { type: "string", description: "Search query in natural language or symbol name" },
          limit: { type: "number", description: "Maximum number of sections to return", default: 5 },
          instruction: {
            type: "string",
            description: "Optional task-specific retrieval instruction shaping embedding focus",
          },
          generateEmbeddings: { type: "boolean", description: "Use vector search alongside BM25", default: true },
          scope: { type: "string", description: "Search global + current project (default), project only, or global only", default: "all" },
          directory: { type: "string", description: "Optional workspace/project directory path to target" },
          project: { type: "string", description: "Alias for directory" },
        },
        async execute({ query, limit, instruction, generateEmbeddings, scope, directory, project }, { worktree, directory: ctxDir }) {
          const { hybridQuery } = await import("../mcp-server/retrieval/retriever.js");
          const { getConfig } = await import("../mcp-server/config/config_manager.js");
          const activeConfig = getConfig();
          const effectiveDir = directory || project || ctxDir;
          const scopeKeys = await resolveRagScopeKeys(scope || "all", { worktree, directory: effectiveDir });

          const results = await hybridQuery({
            query,
            limit: limit || 5,
            generateEmbeddings: generateEmbeddings !== false,
            instruction: instruction || null,
            scopeKeys,
          });

          if (!results || results.length === 0) {
            return `[Active Model: ${activeConfig.embeddingModel}]\nNo matching knowledge found for query.`;
          }

          const headerNote = `[Active Model: ${activeConfig.embeddingModel} | Fusion: ${activeConfig.fusionAlgorithm.toUpperCase()}]\n\n`;

          const formatted = results
            .map((r, i) => {
              let header = `### [${i + 1}] ${r.doc_title || "Untitled"}`;
              if (r.heading) header += ` > ${r.heading}`;
              if (r.breadcrumbs) header += ` (${r.breadcrumbs})`;
              let body = `Score: ${(r.score || 0).toFixed(4)}\n`;
              if (r.defined_symbols && r.defined_symbols.length > 0) {
                body += `Defined Symbols: ${r.defined_symbols.join(", ")}\n`;
              }
              body += `\n${r.snippet || r.full_section_content || ""}`;
              return `${header}\n${body}`;
            })
            .join("\n\n---\n\n");

          return headerNote + formatted;
        },
      },
      "batch_query_knowledge_base": {
        description:
          "Execute multiple project-isolated hybrid searches in one call. " +
          "All query embeddings are computed in one ONNX pass and results are returned in input order.",
        args: {
          queries: { type: "array", items: { type: "string" }, description: "Search queries to execute in one batch" },
          limit: { type: "number", description: "Maximum sections per query", default: 5 },
          instruction: { type: "string", description: "Optional retrieval instruction applied to every query" },
          generateEmbeddings: { type: "boolean", description: "Use vector search alongside BM25", default: true },
          scope: { type: "string", description: "Search global + current project (default), project only, or global only", default: "all" },
          directory: { type: "string", description: "Optional workspace/project directory path to target" },
          project: { type: "string", description: "Alias for directory" },
        },
        async execute({ queries, limit, instruction, generateEmbeddings, scope, directory, project }, { worktree, directory: ctxDir }) {
          const { batchHybridQuery } = await import("../mcp-server/retrieval/retriever.js");
          const { getConfig } = await import("../mcp-server/config/config_manager.js");
          const activeConfig = getConfig();
          const effectiveDir = directory || project || ctxDir;
          const scopeKeys = await resolveRagScopeKeys(scope || "all", { worktree, directory: effectiveDir });
          const allResults = await batchHybridQuery(queries, {
            limit: limit || 5,
            generateEmbeddings: generateEmbeddings !== false,
            instruction: instruction || null,
            scopeKeys,
          });

          const formatted = allResults.map((results, queryIndex) => {
            const header = `## Query ${queryIndex + 1}: "${queries[queryIndex]}"\n`;
            if (!results || results.length === 0) return `${header}_No results found._`;
            return header + results.map((result, resultIndex) => {
              let itemHeader = `### [${resultIndex + 1}] ${result.doc_title || "Untitled"}`;
              if (result.heading) itemHeader += ` > ${result.heading}`;
              if (result.breadcrumbs) itemHeader += ` (${result.breadcrumbs})`;
              let body = `Score: ${(result.score || 0).toFixed(4)}`;
              if (result.retrieval_policy && result.retrieval_policy !== "micro_chunk") {
                body += ` [${result.retrieval_policy}]`;
              }
              if (result.defined_symbols && result.defined_symbols.length > 0) {
                body += `\nDefined Symbols: ${result.defined_symbols.join(", ")}`;
              }
              body += `\n\n${result.snippet || result.full_section_content || ""}`;
              return `${itemHeader}\n${body}`;
            }).join("\n\n---\n\n");
          }).join("\n\n===\n\n");

          return `[Active Model: ${activeConfig.embeddingModel} | Fusion: ${activeConfig.fusionAlgorithm.toUpperCase()} | ${queries.length} queries]\n\n${formatted}`;
        },
      },
      "manage_knowledge_base": {
        description:
          "Manage the project-isolated RAG knowledge base: inspect stats, list documents, read full raw document, unlink/delete documents, or export/import complete snapshots.",
        args: {
          action: {
            type: "string",
            description: "Management action: 'stats', 'list', 'read_document', 'delete', 'export_snapshot', 'import_snapshot'",
          },
          docId: { type: "string", description: "Document ID, title, or path (required for read_document and delete)" },
          snapshotPath: { type: "string", description: "File path for snapshot export/import" },
          scope: { type: "string", description: "For stats/list/read: global + current project by default. Delete defaults to the current project (or global outside Git); pass all/global explicitly for broader removal" },
          directory: { type: "string", description: "Optional workspace/project directory path to target" },
          project: { type: "string", description: "Alias for directory" },
        },
        async execute({ action, docId, snapshotPath, scope, directory, project }, { worktree, directory: ctxDir }) {
          const { getDatabase } = await import("../mcp-server/db/database.js");
          const db = await getDatabase();
          const effectiveDir = directory || project || ctxDir;
          const scopeKeys = ["stats", "list", "read_document", "delete"].includes(action)
            ? await resolveManageRagScopeKeys(action, scope, { worktree, directory: effectiveDir })
            : null;
          const placeholders = scopeKeys ? scopeKeys.map(() => "?").join(",") : "";
          const visibleDocWhere = scopeKeys
            ? `EXISTS (SELECT 1 FROM document_scopes ds WHERE ds.doc_id = d.id AND ds.scope_key IN (${placeholders}))`
            : "1=1";

          if (action === "stats") {
            const docCountRow = await db.prepare(`SELECT COUNT(*) as cnt FROM documents d WHERE ${visibleDocWhere}`).get(...scopeKeys);
            const docCount = docCountRow ? docCountRow.cnt : 0;
            const secCountRow = await db.prepare(`SELECT COUNT(*) as cnt FROM sections s JOIN documents d ON d.id = s.doc_id WHERE ${visibleDocWhere}`).get(...scopeKeys);
            const secCount = secCountRow ? secCountRow.cnt : 0;
            const chunkCountRow = await db.prepare(`SELECT COUNT(*) as cnt FROM micro_chunks m JOIN documents d ON d.id = m.doc_id WHERE ${visibleDocWhere}`).get(...scopeKeys);
            const chunkCount = chunkCountRow ? chunkCountRow.cnt : 0;
            const visibleDocIds = await db.prepare(`SELECT d.id FROM documents d WHERE ${visibleDocWhere}`).all(...scopeKeys);
            let edgeCount = 0;
            if (visibleDocIds.length > 0) {
              const docIds = visibleDocIds.map((row) => row.id);
              const docPlaceholders = docIds.map(() => "?").join(",");
              const ownedRows = await db.prepare(`
                SELECT id FROM sections WHERE doc_id IN (${docPlaceholders})
                UNION SELECT id FROM medium_chunks WHERE doc_id IN (${docPlaceholders})
                UNION SELECT id FROM micro_chunks WHERE doc_id IN (${docPlaceholders})
              `).all(...docIds, ...docIds, ...docIds);
              const ownedIds = [...docIds, ...ownedRows.map((row) => row.id)];
              const edgePlaceholders = ownedIds.map(() => "?").join(",");
              const edgeCountRow = await db.prepare(`SELECT COUNT(*) as cnt FROM graph_edges WHERE source_id IN (${edgePlaceholders}) OR target_id IN (${edgePlaceholders})`).get(...ownedIds, ...ownedIds);
              edgeCount = edgeCountRow ? edgeCountRow.cnt : 0;
            }
            return JSON.stringify(
              {
                documents: docCount,
                sections: secCount,
                micro_chunks: chunkCount,
                graph_edges: edgeCount,
              },
              null,
              2
            );
          }

          if (action === "list") {
            const docs = await db
              .prepare(`SELECT d.id, d.title, d.path, d.blob_hash, d.created_at FROM documents d WHERE ${visibleDocWhere} ORDER BY d.created_at DESC`)
              .all(...scopeKeys);
            return JSON.stringify(docs, null, 2);
          }

          if (action === "read_document") {
            if (!docId) throw new Error("docId parameter is required for read_document action");
            const doc = await db
              .prepare(`SELECT d.id, d.title, d.path, d.blob_hash, d.created_at FROM documents d WHERE (d.id = ? OR d.path = ? OR d.title = ?) AND ${visibleDocWhere}`)
              .get(docId, docId, docId, ...scopeKeys);
            if (!doc) {
              throw new Error(`Document not found in knowledge base for docId: ${docId}`);
            }
            const { readBlob } = await import("../mcp-server/storage/blob_store.js");
            const rawContent = await readBlob(doc.blob_hash);
            return JSON.stringify(
              {
                id: doc.id,
                title: doc.title,
                path: doc.path,
                created_at: doc.created_at,
                content: rawContent,
              },
              null,
              2
            );
          }

          if (action === "delete") {
            if (!docId) throw new Error("docId parameter is required for delete action");
            const visible = await db
              .prepare(`SELECT d.id FROM documents d WHERE (d.id = ? OR d.path = ? OR d.title = ?) AND ${visibleDocWhere}`)
              .get(docId, docId, docId, ...scopeKeys);
            if (!visible) throw new Error(`Document not found in the selected RAG scope for docId: ${docId}`);
            const scopeRemoval = await removeDocumentScopes(db, visible.id, scopeKeys);
            if (scopeRemoval.remainingScopes > 0) {
              return JSON.stringify({
                deleted: false,
                unlinked: true,
                docId: visible.id,
                removedScopes: scopeRemoval.removedScopes,
                remainingScopes: scopeRemoval.remainingScopes,
              }, null, 2);
            }
            const { deleteDocument } = await import("../mcp-server/ingest/pipeline.js");
            const result = await deleteDocument(visible.id, db);
            return JSON.stringify(result, null, 2);
          }

          if (action === "export_snapshot") {
            const { exportSnapshot } = await import("../mcp-server/admin/snapshot.js");
            const result = await exportSnapshot({ customDb: db, outputPath: snapshotPath || null });
            return snapshotPath
              ? `Snapshot exported successfully to ${snapshotPath}`
              : JSON.stringify(result, null, 2);
          }

          if (action === "import_snapshot") {
            if (!snapshotPath) throw new Error("snapshotPath parameter is required for import_snapshot action");
            const { importSnapshot } = await import("../mcp-server/admin/snapshot.js");
            const result = await importSnapshot({ customDb: db, snapshotPathOrData: snapshotPath });
            return JSON.stringify(result, null, 2);
          }

          throw new Error(`Unknown action: ${action}`);
        },
      },
      "reindex_knowledge_base": {
        description:
          "Re-embed all existing documents in the RAG knowledge base with the active (or specified) embedding model and vector dimension. " +
          "Use after switching the embedding model or vector dimension so previously stored vectors match the new configuration. " +
          "Preserves documents, sections, FTS index, graph edges, and fact links.",
        args: {
          model: { type: "string", description: "Embedding model to use (defaults to active config.embeddingModel)" },
          dimension: { type: "number", description: "Fixed vector dimension (defaults to active config.vectorDimension; auto-detect if unset)" },
        },
        async execute({ model, dimension }) {
          const { reindexEmbeddings } = await import("../mcp-server/ingest/pipeline.js");
          const result = await reindexEmbeddings({
            model: model || null,
            dimension: dimension !== undefined && dimension !== null ? dimension : null,
          });
          return JSON.stringify(
            {
              status: "success",
              reindexed: result.reindexed,
              documentsAffected: result.documentsAffected,
              model: result.model,
              dimension: result.dimension || "auto",
            },
            null,
            2
          );
        },
      },
      "link_project_memory": {
        description: "Link the current directory to a Git-based project identity, register aliases, and optionally migrate legacy/path stores.",
        args: {
          directory: { type: "string", description: "Directory path to link (default: current directory)" },
          remote: { type: "string", description: "Optional explicit remote URL to use as primary identity key" },
        },
        async execute({ directory, remote }, { worktree, directory: contextDir }) {
          const { getDatabase } = await import("../mcp-server/db/database.js");
          const { resolveProjectIdentity, upsertIdentity, registerAlias, normalizeRemoteUrl } = await import("../mcp-server/identity.js");
          const db = await getDatabase();

          const dir = directory || contextDir || process.cwd();
          const identity = await resolveProjectIdentity(dir);
          if (!identity && !remote) {
            throw new Error("No Git repository detected and no remote URL specified.");
          }

          let key = identity ? identity.key : `git:${normalizeRemoteUrl(remote)}`;
          let name = identity ? identity.name : basename(dir) || "unbound";
          let primaryRemote = remote ? normalizeRemoteUrl(remote) : (identity ? identity.primaryRemote : null);

          await upsertIdentity(db, { key, name, primaryRemote });

          const aliases = [];
          if (primaryRemote) {
            aliases.push({ alias: `remote:${primaryRemote}`, kind: "remote" });
          }
          aliases.push({ alias: `path:${canonicalPath(dir)}`, kind: "path" });
          aliases.push({ alias: `basename:${name}`, kind: "basename" });

          for (const a of aliases) {
            await registerAlias(db, { alias: a.alias, identityKey: key, kind: a.kind });
          }

          let migrated = false;
          const legacyPathKey = canonicalPath(dir);
          const legacyEntries = await readMemory(legacyPathKey);
          if (legacyEntries && legacyEntries.length > 0) {
            const gitEntries = await readMemory(key);
            const seen = new Set(gitEntries.map((e) => factBody(e).toLowerCase().trim()));
            let mergedCount = 0;
            for (const entry of legacyEntries) {
              const body = factBody(entry).toLowerCase().trim();
              if (!seen.has(body)) {
                seen.add(body);
                gitEntries.push(entry);
                mergedCount++;
              }
            }
            if (mergedCount > 0) {
              await writeMemory(key, gitEntries);
              migrated = true;
            }
            try {
              const legacyFp = storeFilePath(legacyPathKey);
              const { existsSync } = await import("node:fs");
              if (existsSync(legacyFp)) {
                const { unlink } = await import("fs/promises");
                await unlink(legacyFp);
              }
            } catch (e) {}
          }
          const { moveKnowledgeScope } = await import("../mcp-server/graph/knowledge_linker.js");
          const migratedKnowledge = await moveKnowledgeScope(db, legacyPathKey, key);
          if (migratedKnowledge.movedLinks > 0 || migratedKnowledge.movedDocuments > 0) migrated = true;

          const res = {
            status: "success",
            key,
            name,
            primaryRemote,
            aliases: aliases.map((a) => a.alias),
            migrated
          };
          await notify(client, "Project memory linked successfully");
          return JSON.stringify(res, null, 2);
        },
      },
      "unlink_project_memory": {
        description: "Remove the path alias link for the specified project directory.",
        args: {
          directory: { type: "string", description: "Directory path to unlink (default: current directory)" },
          purge: { type: "boolean", description: "If true, completely purge the project identity from the SQLite store" },
        },
        async execute({ directory, purge }, { worktree, directory: contextDir }) {
          const { getDatabase } = await import("../mcp-server/db/database.js");
          const { unregisterAlias, removeIdentity, resolveProjectIdentity } = await import("../mcp-server/identity.js");
          const db = await getDatabase();

          const dir = directory || contextDir || process.cwd();
          const alias = `path:${canonicalPath(dir)}`;
          await unregisterAlias(db, alias);

          let key = null;
          if (purge) {
            const identity = await resolveProjectIdentity(dir);
            if (identity) {
              key = identity.key;
              await removeIdentity(db, key);
            }
          }

          const res = {
            status: "success",
            alias,
            purgedIdentityKey: key
          };
          await notify(client, "Project memory unlinked");
          return JSON.stringify(res, null, 2);
        },
      },
      "relink_project_memory": {
        description: "Move or merge project memories from the current identity to a new target identity.",
        args: {
          directory: { type: "string", description: "Directory path to relink (default: current directory)" },
          remote: { type: "string", description: "New target remote URL / identity key to move memories to" },
        },
        async execute({ directory, remote }, { worktree, directory: contextDir }) {
          const { getDatabase } = await import("../mcp-server/db/database.js");
          const { resolveProjectIdentity, upsertIdentity, removeIdentity, normalizeRemoteUrl } = await import("../mcp-server/identity.js");
          const db = await getDatabase();

          const dir = directory || contextDir || process.cwd();
          const sourceIdentity = await resolveProjectIdentity(dir);
          if (!sourceIdentity) {
            throw new Error("Source project identity not detected.");
          }

          const targetKey = `git:${normalizeRemoteUrl(remote)}`;
          const sourceKey = sourceIdentity.key;

          if (sourceKey === targetKey) {
            return "Source and target identities are already identical.";
          }

          const sourceFacts = await readMemory(sourceKey);
          const targetFacts = await readMemory(targetKey);
          const seen = new Set(targetFacts.map((e) => factBody(e).toLowerCase().trim()));

          let mergedCount = 0;
          for (const f of sourceFacts) {
            const body = factBody(f).toLowerCase().trim();
            if (!seen.has(body)) {
              seen.add(body);
              targetFacts.push(f);
              mergedCount++;
            }
          }

          await writeMemory(targetKey, targetFacts);

          await upsertIdentity(db, { key: targetKey, name: sourceIdentity.name, primaryRemote: normalizeRemoteUrl(remote) });
          await db.prepare("UPDATE project_aliases SET identity_key = ? WHERE identity_key = ?;").run(targetKey, sourceKey);
          const { moveKnowledgeScope } = await import("../mcp-server/graph/knowledge_linker.js");
          const movedKnowledge = await moveKnowledgeScope(db, sourceKey, targetKey);
          await removeIdentity(db, sourceKey);

          try {
            const sourceFp = storeFilePath(sourceKey);
            const { existsSync } = await import("node:fs");
            if (existsSync(sourceFp)) {
              const { unlink } = await import("fs/promises");
              await unlink(sourceFp);
            }
          } catch (e) {}

          const res = {
            status: "success",
            sourceKey,
            targetKey,
            mergedFacts: mergedCount,
            movedKnowledgeLinks: movedKnowledge.movedLinks,
            movedRagDocuments: movedKnowledge.movedDocuments
          };
          await notify(client, "Project memory relinked");
          return JSON.stringify(res, null, 2);
        },
      },
    },
  };
};

export default MemoryPlugin;
