import { KNOWLEDGE_REMOVAL_DESCRIPTION, KNOWLEDGE_REMOVAL_FIELDS, knowledgeRemovalTool } from '../mcp-server/tools/core/knowledge_removal_core.js';
import BaseMemoryPlugin from "./index.js";
import { KNOWLEDGE_INSPECT_DESCRIPTION, KNOWLEDGE_INSPECT_FIELDS, inspectKnowledgeTool } from "../mcp-server/tools/core/knowledge_inspect_core.js";
import { KNOWLEDGE_LINKS_DESCRIPTION, KNOWLEDGE_LINKS_FIELDS, knowledgeLinksTool } from '../mcp-server/tools/core/knowledge_links_core.js';
import { KNOWLEDGE_CONTENT_DESCRIPTION, KNOWLEDGE_CONTENT_FIELDS, knowledgeContentTool } from '../mcp-server/tools/core/knowledge_content_core.js';
import { RAG_MAINTENANCE_ACTIONS, executeRagMaintenanceTool } from '../mcp-server/tools/core/rag_maintenance_core.js';
import { manageSnapshots, startSnapshotScheduler, stopSnapshotScheduler } from "../mcp-server/admin/cloud_snapshots.js";
import { SNAPSHOT_DESCRIPTION, SNAPSHOT_PROPERTIES } from "../mcp-server/tools/snapshot_tools.js";
import {
  MEMORY_DIR,
  GLOBAL_KEY,
  canonicalPath,
  scopeKey,
  readMemory,
  writeMemory,
  storeFilePath,
} from "../mcp-server/memory.js";
import { basename } from "node:path";
import { closeDatabase } from "../mcp-server/db/database.js";
import { requireProjectKey } from "../mcp-server/tools/helpers.js";
import {
  resolveRagScopeKey,
  resolveRagScopeKeys,
  resolveManageRagScopeKeys,
  removeDocumentScopes,
} from "../mcp-server/rag_scope.js";
import {
  rememberFact,
  recallFacts,
  getFactById,
  forgetFacts,
  updateFactText,
  memoryInfo,
} from "../mcp-server/tools/core/memory_core.js";
import { rememberNote } from "../mcp-server/tools/core/note_core.js";
import { runSingleRagQuery, runBatchRagQuery } from "../mcp-server/tools/core/rag_query_core.js";
import { readKnowledgeDocument, listKnowledgeDocuments } from "../mcp-server/tools/core/knowledge_read_core.js";
import {
  buildMemoryContext,
  buildSystemMemoryOverlay,
  injectMemoryOverlayIntoSystem,
} from "./index.js";
import { buildOpenCodeV2MemoryContext, withMemoryRoutingPolicy } from '../mcp-server/context/opencode_context.js';

const REMEMBER_NOTE_DESCRIPTION =
  "Save high-value long-form or episodic context as a cold RAG Memory Note. " +
  "Use this for decisions with rationale, research/experiment results, investigations, handoffs, and detailed context that may matter later but should NOT be injected into every session. " +
  "Use remember instead for concise durable facts that should stay hot/automatically available. " +
  "Use ingest_document instead for external reusable truth sources such as files, URLs, documentation, reports, or codebases. " +
  "The note is indexed in the existing RAG knowledge base and can later be found semantically and expanded by document ID.";

function buildRememberNoteTool() {
  return {
    description: REMEMBER_NOTE_DESCRIPTION,
    args: {
      title: { type: "string", description: "Concise descriptive title for the memory note" },
      content: { type: "string", description: "Full long-form note content to preserve" },
      scope: { type: "string", description: "Visibility: current Git project (default) or global", default: "project" },
      kind: { type: "string", description: "Note kind: decision, research, context, handoff, or note", default: "note" },
      tags: { type: "string", description: "Optional comma-separated tags; normalized to lowercase unique values" },
      directory: { type: "string", description: "Optional workspace/project directory path to target" },
      project: { type: "string", description: "Alias for directory" },
      generateEmbeddings: { type: "boolean", description: "Compute dense vector embeddings; set false for offline/tests", default: true },
    },
    async execute(args, ctx = {}) {
      const result = await rememberNote(args, {
        worktree: ctx.worktree ?? null,
        directory: ctx.directory ?? null,
      });
      return JSON.stringify(result, null, 2);
    },
  };
}

function injectRoutingPolicyIntoMemory(output) {
  const firstUser = output?.messages?.find((message) => message?.info?.role === "user");
  if (!firstUser?.parts?.length) return;

  const memoryPart = firstUser.parts.find(
    (part) => part?.type === "text" && typeof part.text === "string" && part.text.includes("<MEMORY>")
  );
  if (!memoryPart || memoryPart.text.includes("MEMORY ROUTING DIRECTIVE:")) return;

  memoryPart.text = withMemoryRoutingPolicy(memoryPart.text);
}

function addRoutingGuidance(plugin) {
  if (!plugin?.tool) return plugin;

  const transformKey = "experimental.chat.messages.transform";
  if (typeof plugin[transformKey] === "function") {
    const baseTransform = plugin[transformKey];
    plugin[transformKey] = async (input, output) => {
      await baseTransform(input, output);
      injectRoutingPolicyIntoMemory(output);
    };
  }

  if (plugin.tool.remember?.description && !plugin.tool.remember.description.includes("remember_note")) {
    plugin.tool.remember.description +=
      " Use remember_note instead when the durable information needs a long-form reasoning/research record that should remain cold and retrieval-only.";
  }

  if (plugin.tool.ingest_document?.description && !plugin.tool.ingest_document.description.includes("remember_note")) {
    plugin.tool.ingest_document.description +=
      " Use remember_note for agent-authored long-form internal memory; use remember for concise hot facts.";
  }

  plugin.tool.remember_note = buildRememberNoteTool();
  plugin.tool.manage_snapshots = {
    description: SNAPSHOT_DESCRIPTION,
    args: SNAPSHOT_PROPERTIES,
    execute: async (args) => JSON.stringify(await manageSnapshots(args), null, 2),
  };

  if (plugin.tool.query_knowledge_base) {
    plugin.tool.query_knowledge_base.description =
      "Perform project-isolated hybrid search (RSF/RRF BM25 full-text + dense vector similarity). " +
      "Returns ranked candidates with stable parent document IDs and source metadata. Use resultMode='index' for a compact semantic table of contents without retrieved bodies.";
    plugin.tool.query_knowledge_base.args.resultMode = {
      type: "string",
      description: "Result presentation: 'snippet' (default) or compact metadata-only semantic TOC 'index'",
      default: "snippet",
    };
    plugin.tool.query_knowledge_base.execute = async (args, ctx = {}) =>
      runSingleRagQuery(args, {
        worktree: ctx.worktree ?? null,
        directory: ctx.directory ?? null,
      });
  }

  if (plugin.tool.batch_query_knowledge_base) {
    plugin.tool.batch_query_knowledge_base.description =
      "Execute multiple project-isolated hybrid searches in one call. " +
      "All query embeddings are computed in one ONNX pass. Use resultMode='index' for compact candidate metadata without retrieved bodies.";
    plugin.tool.batch_query_knowledge_base.args.resultMode = {
      type: "string",
      description: "Result presentation for every query: 'snippet' (default) or compact metadata-only semantic TOC 'index'",
      default: "snippet",
    };
    plugin.tool.batch_query_knowledge_base.execute = async (args, ctx = {}) =>
      runBatchRagQuery(args, {
        worktree: ctx.worktree ?? null,
        directory: ctx.directory ?? null,
      });
  }

  if (plugin.tool.manage_knowledge_base) {
    const baseManageExecute = plugin.tool.manage_knowledge_base.execute;
    plugin.tool.manage_knowledge_base.description =
      "Manage the project-isolated RAG knowledge base: inspect stats, list documents/notes with source metadata, read full raw document/note, unlink/delete documents, or export/import complete snapshots.";
    plugin.tool.manage_knowledge_base.execute = async (args, ctx = {}) => {
      const sharedCtx = {
        worktree: ctx.worktree ?? null,
        directory: ctx.directory ?? null,
      };
      if (args?.action === "read_document") {
        return JSON.stringify(await readKnowledgeDocument(args, sharedCtx), null, 2);
      }
      if (args?.action === "list") {
        return JSON.stringify(await listKnowledgeDocuments(args, sharedCtx), null, 2);
      }
      return baseManageExecute(args, ctx);
    };
  }

  return plugin;
}

// ---------------------------------------------------------------------------
// Legacy V1 surface (kept for existing tests / older runtimes).
// The V2 loader ignores this named export; it only validates `default`.
// ---------------------------------------------------------------------------
export const MemoryPlugin = async (ctx) => addRoutingGuidance(await BaseMemoryPlugin(ctx));

// ---------------------------------------------------------------------------
// V2 (OpenCode >= 1.18 / v2) surface.
// Plain object — intentionally no `import { Plugin } from "@opencode/plugin"`
// so cached installs without that package still load.
// ---------------------------------------------------------------------------

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

let exitHookInstalled = false;
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    try {
      stopSnapshotScheduler();
      closeDatabase();
    } catch {}
  });
}

const str = (description, extra) => ({ type: "string", description, ...(extra || {}) });
const num = (description, extra) => ({ type: "number", description, ...(extra || {}) });
const bool = (description, extra) => ({ type: "boolean", description, ...(extra || {}) });
const arr = (description, items, extra) => ({ type: "array", description, items, ...(extra || {}) });
const obj = (properties, required) => ({
  type: "object",
  properties,
  required: required || [],
  additionalProperties: false,
});

function getTextParts(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((p) => p?.type === "text" && typeof p?.text === "string");
}

async function v2Setup(ctx) {
  installExitHook();
  const { startModelControlLoop } = await import('../mcp-server/ml/model_manager.js');
  startModelControlLoop();
  startSnapshotScheduler();
  const { autoStartWeb } = await import('../mcp-server/dashboard/runtime.js');
  void autoStartWeb().catch(error => console.error(`Memory panel: ${error.message}`));
  const { ensureMemoryDir } = await import("../mcp-server/memory.js").catch(() => ({}));
  try {
    if (typeof ensureMemoryDir === "function") await ensureMemoryDir();
    else {
      const { mkdir } = await import("node:fs/promises");
      const { existsSync } = await import("node:fs");
      if (!existsSync(MEMORY_DIR)) await mkdir(MEMORY_DIR, { recursive: true });
    }
  } catch {}
  // Mirror V1: copy bundled skills into the global skills dir (best effort).
  try {
    const { mkdir, cp, readdir } = await import("node:fs/promises");
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const { fileURLToPath } = await import("node:url");
    const { dirname } = await import("node:path");
    const configDir = process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode");
    const pluginDir = dirname(fileURLToPath(import.meta.url));
    const packageSkillsDir = join(pluginDir, "..", "skills");
    if (existsSync(packageSkillsDir)) {
      const skillsDir = join(configDir, "skills");
      await mkdir(skillsDir, { recursive: true });
      const entries = await readdir(packageSkillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) await cp(join(packageSkillsDir, entry.name), join(skillsDir, entry.name), { recursive: true });
      }
    }
  } catch {}

  const locationDir = () => {
    try {
      return ctx?.location?.directory || process.cwd();
    } catch {
      return process.cwd();
    }
  };
  const effectiveDir = (input) => input?.directory || input?.project || locationDir();
  const coreCtx = (input) => ({ worktree: null, directory: effectiveDir(input) });

  // --- session context hook: system overlay + <MEMORY> message injection ---
  await ctx.session.hook("context", async (event) => {
    let key = null;
    try {
      key = await scopeKey("project", null, locationDir());
    } catch {
      key = null;
    }
    let globalFacts = [];
    let projectFacts = [];
    try {
      [globalFacts, projectFacts] = await Promise.all([readMemory(GLOBAL_KEY), readMemory(key)]);
    } catch {
      return;
    }

    // 1. System overlay (directives only).
    try {
      const overlay = buildSystemMemoryOverlay(globalFacts, projectFacts, key);
      const system = event?.system;
      if (Array.isArray(system)) {
        const hasOverlay = system.some((p) => String(p?.text || "").includes("[PERSISTENT PERSONAL MEMORY OVERLAY]"));
        if (!hasOverlay && overlay) system.push({ type: "text", text: overlay });
      }
    } catch {}

    // 2. Full memory block into the first user message (once per request).
    try {
      const messages = event?.messages;
      if (!Array.isArray(messages) || messages.length === 0) return;
      for (const m of messages) {
        for (const p of getTextParts(m)) {
          if (p.text.includes("<MEMORY>")) return;
        }
      }
      const firstUser = messages.find((m) => m?.role === "user");
      if (!firstUser || !Array.isArray(firstUser.content)) return;
      const context = buildOpenCodeV2MemoryContext(globalFacts, projectFacts, key);
      const anchor = firstUser.content.find((p) => p?.type === "text");
      if (!anchor) return;
      firstUser.content.unshift({ type: "text", text: context });
    } catch {}
  });

  // --- tools ---
  await ctx.tool.transform((editor) => {
    editor.add({name:'manage_knowledge_removal',description:KNOWLEDGE_REMOVAL_DESCRIPTION,input:obj(KNOWLEDGE_REMOVAL_FIELDS,['action','scopeKey']),async execute(input){return {content:(await knowledgeRemovalTool(input)).content[0].text};}});
    editor.add({ name: 'manage_knowledge_content', description: KNOWLEDGE_CONTENT_DESCRIPTION,
      input: obj(KNOWLEDGE_CONTENT_FIELDS, ['action','scopeKey']),
      execute: async input => ({ content: (await knowledgeContentTool(input)).content[0].text }),
    });
    editor.add({ name: 'manage_knowledge_links', description: KNOWLEDGE_LINKS_DESCRIPTION,
      input: obj(KNOWLEDGE_LINKS_FIELDS, ['action']),
      execute: async input => ({ content: (await knowledgeLinksTool(input)).content[0].text }),
    });
    editor.add({
      name: "inspect_knowledge",
      description: KNOWLEDGE_INSPECT_DESCRIPTION,
      input: obj(KNOWLEDGE_INSPECT_FIELDS, ["action"]),
      execute: async input => ({ content: (await inspectKnowledgeTool(input)).content[0].text }),
    });
    editor.add({
      name: "list-mcp-tools",
      description: "Показать список всех подключённых MCP серверов и их назначение",
      input: obj({}),
      execute: async () => ({
        content: "Доступные MCP серверы:\n" + MCP_SERVERS.map((s) => `  ${s.id.padEnd(20)} ${s.desc}`).join("\n"),
      }),
    });

    editor.add({
      name: "mcp-reminder",
      description: "Напомнить какие MCP инструменты подходят для текущей задачи. Вызови когда сомневаешься что выбрать.",
      input: obj({ task: str("Описание того что собираешься делать (опционально)") }),
      execute: async (input) => {
        const task = input?.task;
        return {
          content: task
            ? `Для задачи "${task}" рекомендую посмотреть список через list-mcp-tools. Основные сценарии:\n- Работа с кодом → skills-vercel (grill, tdd, review), github\n- UI/дизайн → stitch, skills-anthropic (frontend-design, webapp-testing)\n- База данных → supabase, neon\n- Документы → skills-anthropic (docx, pdf, pptx, xlsx)\n- Поиск примеров → grep`
            : "Вызови list-mcp-tools чтобы увидеть все доступные MCP серверы",
        };
      },
    });

    editor.add({
      name: "remember",
      description:
        "Save an important, durable fact to memory. Only use for high-signal information " +
        "(name, goals, constraints, tech preferences, project conventions). " +
        "Use kind='directive' for active personality, behavior, tone, style, preference, or working instructions; use kind='fact' for descriptive context. " +
        "docId/startLine/endLine/relationType are OPTIONAL and only used to link the fact to a " +
        "Knowledge Base document or line range; omit them when no linking is needed. " +
        "ttl is OPTIONAL (e.g. '90d', '2w', '24h') — expired facts are shown with [EXPIRED] but not auto-deleted. " +
        "keep=true protects the fact from forget deletion unless force=true. " +
        "tags is OPTIONAL comma-separated text for filtering. " +
        "supersedes is OPTIONAL: a number, id, or text of a fact this one replaces. " +
        "Translate the fact into English and keep it concise. " +
        "scope: 'project' (default) or 'global'. Use remember_note instead when the durable information needs a long-form reasoning/research record that should remain cold and retrieval-only.",
      input: obj(
        {
          fact: str("The fact to remember, written in English"),
          title: str("Optional title for the fact"),
          kind: str("Semantic kind: 'fact' (context) or 'directive' (active personalization/working instruction)", { default: "fact" }),
          scope: str("'project' (default) or 'global'", { default: "project" }),
          directory: str("Optional workspace/project directory path to target when scope='project' (e.g. '/path/to/my-app')"),
          project: str("Alias for directory"),
          docId: str("Optional document ID, title, or path to link this fact to"),
          startLine: num("Optional starting line number in target document"),
          endLine: num("Optional ending line number in target document"),
          relationType: str("Relation type (e.g. 'RULES_FOR', 'IMPLEMENTS', 'REFERENCES')", { default: "LINKS_TO" }),
          ttl: str("Optional time-to-live, e.g. '90d', '2w', '24h', '12m'"),
          keep: bool("Protect the fact from forget deletion unless force=true"),
          tags: str("Optional comma-separated tags, e.g. 'pref,arch'"),
          supersedes: str("Optional number, id, or text of the fact this one replaces"),
        },
        ["fact"]
      ),
      execute: async (input) => ({ content: await rememberFact(input, coreCtx(input)) }),
    });

    editor.add({
      name: "recall",
      description:
        "Show saved facts with any Agent-linked Knowledge Base documents/lines. " +
        "scope: 'project', 'global', 'all' (default), or 'list_projects'. " +
        "Use directory: '<directory path>' to read facts of a specific project from any working directory. " +
        "query filters by keyword, tags by comma-separated tags, since/until by date (YYYY-MM-DD). " +
        "The response includes the store file paths.",
      input: obj({
        scope: str("project, global, all (по умолчанию) или list_projects", { default: "all" }),
        directory: str("Directory path of the project to read facts from (e.g. '/path/to/project')"),
        project: str("Alias for directory"),
        query: str("Optional keyword filter; all space-separated terms must match"),
        tags: str("Optional comma-separated tag filter (any match)"),
        since: str("Optional start date filter, YYYY-MM-DD (inclusive)"),
        until: str("Optional end date filter, YYYY-MM-DD (inclusive)"),
        mode: str("Result mode: 'full' (with body, default) or 'headers' (title and badges only)", { default: "full" }),
        offset: num("Pagination offset (optional)"),
        limit: num("Pagination limit (optional)"),
        includeSuperseded: bool("Include superseded historical facts (excluded by default)", { default: false }),
      }),
      execute: async (input) => ({ content: await recallFacts(input, coreCtx(input)) }),
    });

    editor.add({
      name: "get_fact",
      description: "Get the full text and metadata of a single fact by its metadata id.",
      input: obj(
        {
          id: str("The unique metadata id of the fact (e.g. '8f3a2c')"),
          scope: str("'project', 'global', or 'all' (default)", { default: "all" }),
          directory: str("Optional workspace/project directory path"),
          project: str("Alias for directory"),
        },
        ["id"]
      ),
      execute: async (input) => ({ content: await getFactById(input, coreCtx(input)) }),
    });

    editor.add({
      name: "forget",
      description:
        "Удалить факт по номеру (см. recall), по диапазону (например '3-30', включительно) или тексту. Защищённые факты (remember с keep=true) пропускаются, если не передан force=true. Предпочитай этот инструмент ручному редактированию .md файлов; ручные правки (включая удаления) подхватываются следующим фоновым синком.",
      input: obj(
        {
          query: str("Номер факта, диапазон вида '3-30' или текст для поиска"),
          scope: str("project (по умолчанию) или global", { default: "project" }),
          directory: str("Optional workspace/project directory path"),
          project: str("Alias for directory"),
          force: bool("Удалить также защищённые (keep) факты"),
        },
        ["query"]
      ),
      execute: async (input) => ({ content: await forgetFacts(input, coreCtx(input)) }),
    });

    editor.add({
      name: "update_fact",
      description:
        "Update the text of an existing fact by number (from recall), id, or text match, " +
        "preserving its original date and metadata. kind can optionally change directive/fact semantics. Linked Knowledge Base documents are re-pointed to the new text.",
      input: obj(
        {
          id: str("Number (from recall), metadata id, or text of the fact to update"),
          newText: str("New fact text"),
          title: str("Optional new title for the fact"),
          kind: str("Optional new semantic kind: 'fact' or 'directive'"),
          scope: str("'project' (default) or 'global'", { default: "project" }),
          directory: str("Optional workspace/project directory path"),
          project: str("Alias for directory"),
        },
        ["id", "newText"]
      ),
      execute: async (input) => ({ content: await updateFactText(input, coreCtx(input)) }),
    });

    editor.add({
      name: "memory_info",
      description: "Show memory storage paths (store files, MEMORY_DIR, SQLite DB), fact counts, and Knowledge Base stats.",
      input: obj({
        directory: str("Optional workspace/project directory path to inspect (default: current directory)"),
        project: str("Alias for directory"),
      }),
      execute: async (input) => ({ content: await memoryInfo(input, coreCtx(input)) }),
    });

    editor.add({
      name: "link_knowledge",
      description:
        "Explicitly link a Notebook memory fact to a Knowledge Base document, section, or line range. " +
        "Creates Agent-driven Graph Edges connecting memory to RAG documents.",
      input: obj({
        action: str("Action type: 'link' (default), 'list_links', 'get_doc_links'", { default: "link" }),
        factText: str("Memory fact text or keyword"),
        docId: str("Document ID, title, or file path"),
        scope: str("'project' (default) or 'global'", { default: "project" }),
        directory: str("Optional workspace/project directory path"),
        project: str("Alias for directory"),
        startLine: num("Starting line number in target document"),
        endLine: num("Ending line number in target document"),
        relationType: str("Relation type (e.g. 'RULES_FOR', 'IMPLEMENTS', 'EXPLAINS')", { default: "LINKS_TO" }),
      }),
      execute: async (input) => {
        const { linkFactToDocument, getLinksForDoc, listAllLinks } = await import(
          "../mcp-server/graph/knowledge_linker.js"
        );
        const { factBody } = await import("../mcp-server/fact_format.js");
        const dir = effectiveDir(input);
        const key = await scopeKey(input.scope || "project", null, dir);
        const act = input.action || "link";
        if (act === "link" || act === "list_links") requireProjectKey(key);
        if (act === "link") {
          if (!input.factText || !input.docId) throw new Error("factText and docId are required parameters for link action");
          const facts = await readMemory(key);
          const needle = input.factText.toLowerCase().trim();
          const matches = facts.filter((entry) => {
            const body = factBody(entry).toLowerCase();
            return body === needle || body.includes(needle) || entry.toLowerCase().includes(needle);
          });
          if (matches.length === 0) throw new Error(`Notebook fact not found for link: ${input.factText}`);
          if (matches.length > 1) throw new Error(`Notebook fact match is ambiguous; use a more specific factText: ${input.factText}`);
          const res = await linkFactToDocument({
            factKey: key,
            factText: factBody(matches[0]),
            docId: input.docId,
            startLine: input.startLine,
            endLine: input.endLine,
            relationType: input.relationType || "LINKS_TO",
          });
          return { content: JSON.stringify(res, null, 2) };
        }
        if (act === "get_doc_links") {
          if (!input.docId) throw new Error("docId parameter is required for get_doc_links action");
          const allowedScopes = key === GLOBAL_KEY ? [GLOBAL_KEY] : [GLOBAL_KEY, key];
          const links = await getLinksForDoc(input.docId, allowedScopes);
          return { content: JSON.stringify(links, null, 2) };
        }
        if (act === "list_links") {
          const links = await listAllLinks(key);
          return { content: JSON.stringify(links, null, 2) };
        }
        throw new Error(`Unknown action: ${act}`);
      },
    });

    editor.add({
      name: "ingest_document",
      description:
        "Selectively preserve a reliable, reusable source in the RAG knowledge base; do not ingest everything encountered. " +
        "Accepts local file paths, web URLs, or raw Markdown/text content. " +
        "For type='url' the page is fetched and its content is indexed (not just the URL). " +
        "Processes document through 3-tier hierarchy chunking (Big/Medium/Small), " +
        "computes dense vectors, and extracts GraphRAG code symbols. Use remember_note for agent-authored long-form internal memory; use remember for concise hot facts.",
      input: obj(
        {
          content: str("Raw text content, file path, or web URL"),
          type: str("Input content type: 'text', 'file', 'url' (url fetches the page content)", { default: "text" }),
          title: str("Document title"),
          path: str("Original document file path"),
          scope: str("RAG visibility: current Git project (default) or global", { default: "project" }),
          directory: str("Optional workspace/project directory path to target"),
          project: str("Alias for directory"),
          generateEmbeddings: bool("Compute dense vector embeddings", { default: true }),
        },
        ["content"]
      ),
      execute: async (input) => {
        const { ingestDocument } = await import("../mcp-server/ingest/pipeline.js");
        const projectScope = await resolveRagScopeKey(input.scope || "project", {
          worktree: null,
          directory: effectiveDir(input),
        });
        const result = await ingestDocument({
          content: input.content,
          type: input.type || "text",
          title: input.title || null,
          path: input.path || null,
          generateEmbeddings: input.generateEmbeddings !== false,
          projectScope,
        });
        return {
          content: JSON.stringify(
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
          ),
        };
      },
    });

    editor.add({
      name: "query_knowledge_base",
      description:
        "Perform project-isolated hybrid search (RSF/RRF BM25 full-text + dense vector similarity). " +
        "Returns ranked candidates with stable parent document IDs and source metadata. Use resultMode='index' for a compact semantic table of contents without retrieved bodies.",
      input: obj(
        {
          query: str("Search query in natural language or symbol name"),
          limit: num("Maximum number of sections to return", { default: 5 }),
          instruction: str("Optional task-specific retrieval instruction shaping embedding focus"),
          generateEmbeddings: bool("Use vector search alongside BM25", { default: true }),
          scope: str("Search global + current project (default), project only, or global only", { default: "all" }),
          directory: str("Optional workspace/project directory path to target"),
          project: str("Alias for directory"),
          resultMode: str("Result presentation: 'snippet' (default) or compact metadata-only semantic TOC 'index'", {
            default: "snippet",
          }),
        },
        ["query"]
      ),
      execute: async (input) =>
        { const content = await runSingleRagQuery(input, { worktree: null, directory: effectiveDir(input) }); return { content }; },
    });

    editor.add({
      name: "batch_query_knowledge_base",
      description:
        "Execute multiple project-isolated hybrid searches in one call. " +
        "All query embeddings are computed in one ONNX pass. Use resultMode='index' for compact candidate metadata without retrieved bodies.",
      input: obj(
        {
          queries: arr("Search queries to execute in one batch", { type: "string" }),
          limit: num("Maximum sections per query", { default: 5 }),
          instruction: str("Optional retrieval instruction applied to every query"),
          generateEmbeddings: bool("Use vector search alongside BM25", { default: true }),
          scope: str("Search global + current project (default), project only, or global only", { default: "all" }),
          directory: str("Optional workspace/project directory path to target"),
          project: str("Alias for directory"),
          resultMode: str("Result presentation for every query: 'snippet' (default) or compact metadata-only semantic TOC 'index'", {
            default: "snippet",
          }),
        },
        ["queries"]
      ),
      execute: async (input) =>
        { const content = await runBatchRagQuery(input, { worktree: null, directory: effectiveDir(input) }); return { content }; },
    });

    editor.add({
      name: "manage_knowledge_base",
      description:
        "Manage the project-isolated RAG knowledge base: inspect stats, list documents/notes with source metadata, read full raw document/note, unlink/delete documents, or export/import complete snapshots.",
      input: obj(
        {
          action: str("Management action: stats, list, read_document, delete, export_snapshot, import_snapshot, rag_status, reset_rag, rag_receipt. Import/reset return preview, then require previewToken and confirm."),
          docId: str("Document ID, title, or path (required for read_document and delete)"),
          snapshotPath: str("File path for snapshot export/import"),
          snapshotId: str('Immutable RAG input ID from preview'),
          importMode: str('merge or replace; all local RAG scopes'),
          previewToken: str('Fresh RAG preview token'),
          confirm: bool('Explicit approval of reviewed all-local-RAG effects'),
          operationId: str('Committed RAG receipt ID'),
          scope: str("For stats/list/read: global + current project by default. Delete defaults to the current project (or global outside Git); pass all/global explicitly for broader removal"),
          directory: str("Optional workspace/project directory path to target"),
          project: str("Alias for directory"),
        },
        ["action"]
      ),
      execute: async (input) => {
        if(RAG_MAINTENANCE_ACTIONS.includes(input?.action))return {content:JSON.stringify(await executeRagMaintenanceTool(input),null,2)};
        const sharedCtx = { worktree: null, directory: effectiveDir(input) };
        if (input?.action === "read_document") {
          return { content: JSON.stringify(await readKnowledgeDocument(input, sharedCtx), null, 2) };
        }
        if (input?.action === "list") {
          return { content: JSON.stringify(await listKnowledgeDocuments(input, sharedCtx), null, 2) };
        }
        const { getDatabase } = await import("../mcp-server/db/database.js");
        const db = await getDatabase();
        const scopeKeys = ["stats", "list", "read_document", "delete"].includes(input.action)
          ? await resolveManageRagScopeKeys(input.action, input.scope, sharedCtx)
          : null;
        const placeholders = scopeKeys ? scopeKeys.map(() => "?").join(",") : "";
        const visibleDocWhere = scopeKeys
          ? `EXISTS (SELECT 1 FROM document_scopes ds WHERE ds.doc_id = d.id AND ds.scope_key IN (${placeholders}))`
          : "1=1";
        if (input.action === "stats") {
          const docCountRow = await db.prepare(`SELECT COUNT(*) as cnt FROM documents d WHERE ${visibleDocWhere}`).get(...scopeKeys);
          const secCountRow = await db.prepare(`SELECT COUNT(*) as cnt FROM sections s JOIN documents d ON d.id = s.doc_id WHERE ${visibleDocWhere}`).get(...scopeKeys);
          const chunkCountRow = await db.prepare(`SELECT COUNT(*) as cnt FROM micro_chunks m JOIN documents d ON d.id = m.doc_id WHERE ${visibleDocWhere}`).get(...scopeKeys);
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
          return {
            content: JSON.stringify(
              { documents: docCountRow ? docCountRow.cnt : 0, sections: secCountRow ? secCountRow.cnt : 0, micro_chunks: chunkCountRow ? chunkCountRow.cnt : 0, graph_edges: edgeCount },
              null,
              2
            ),
          };
        }
        if (input.action === "read_document") throw new Error("docId parameter is required for read_document action");
        if (input.action === "delete") {
          if (!input.docId) throw new Error("docId parameter is required for delete action");
          const visible = await db
            .prepare(`SELECT d.id FROM documents d WHERE (d.id = ? OR d.path = ? OR d.title = ?) AND ${visibleDocWhere}`)
            .get(input.docId, input.docId, input.docId, ...scopeKeys);
          if (!visible) throw new Error(`Document not found in the selected RAG scope for docId: ${input.docId}`);
          const scopeRemoval = await removeDocumentScopes(db, visible.id, scopeKeys);
          if (scopeRemoval.remainingScopes > 0) {
            return {
              content: JSON.stringify({ deleted: false, unlinked: true, docId: visible.id, removedScopes: scopeRemoval.removedScopes, remainingScopes: scopeRemoval.remainingScopes }, null, 2),
            };
          }
          const { deleteDocument } = await import("../mcp-server/ingest/pipeline.js");
          return { content: JSON.stringify(scopeRemoval, null, 2) };
        }
        throw new Error(`Unknown action: ${input.action}`);
      },
    });

    editor.add({
      name: "reindex_knowledge_base",
      description:
        "Re-embed all existing documents in the RAG knowledge base with the active (or specified) embedding model and vector dimension. " +
        "Use after switching the embedding model or vector dimension so previously stored vectors match the new configuration. " +
        "Preserves documents, sections, FTS index, graph edges, and fact links.",
      input: obj({
        model: str("Embedding model to use (defaults to active config.embeddingModel)"),
        dimension: num("Fixed vector dimension (defaults to active config.vectorDimension; auto-detect if unset)"),
      }),
      execute: async (input) => {
        const { reindexEmbeddings } = await import("../mcp-server/ingest/pipeline.js");
        const result = await reindexEmbeddings({ model: input.model || null, dimension: input.dimension ?? null });
        return {
          content: JSON.stringify({ status: "success", reindexed: result.reindexed, documentsAffected: result.documentsAffected, model: result.model, dimension: result.dimension || "auto" }, null, 2),
        };
      },
    });

    for (const operation of ['link','unlink','relink']) {
      editor.add({
        name: `${operation}_project_memory`, description: `${operation} project memory through shared Git identity administration with backup and conflict checks.`,
        input: obj({ directory: str('Workspace directory'), remote: str('Repository remote'), ...(operation === 'unlink' ? {purge:bool('Explicitly remove registry identity/aliases; memory remains')} : {}) }),
        execute: async input => {
          const { executeProjectOperation } = await import('../mcp-server/services/project_service.js');
          return { content:JSON.stringify(await executeProjectOperation(operation, {...input,directory:effectiveDir(input)}),null,2) };
        },
      });
    }
    editor.add({
      name:'manage_project_memory', description:'List, inspect, preview and confirm scoped project administration.',
      input:obj({action:str('list, inspect, preview or apply'),operation:str('link, unlink, relink or migrate'),directory:str('Absolute directory'),sourceKey:str('Source key'),targetKey:str('Target key'),remote:str('Repository remote'),previewToken:str('Fresh preview token'),confirm:bool('Confirm reviewed operation')},['action']),
      execute:async input => {
        const { projectRequest } = await import('../mcp-server/services/project_service.js');
        return {content:JSON.stringify(await projectRequest(input),null,2)};
      },
    });

    editor.add({
      name: "remember_note",
      description:
        "Save high-value long-form or episodic context as a cold RAG Memory Note. " +
        "Use this for decisions with rationale, research/experiment results, investigations, handoffs, and detailed context that may matter later but should NOT be injected into every session. " +
        "Use remember instead for concise durable facts that should stay hot/automatically available. " +
        "Use ingest_document instead for external reusable truth sources such as files, URLs, documentation, reports, or codebases. " +
        "The note is indexed in the existing RAG knowledge base and can later be found semantically and expanded by document ID.",
      input: obj(
        {
          title: str("Concise descriptive title for the memory note"),
          content: str("Full long-form note content to preserve"),
          scope: str("Visibility: current Git project (default) or global", { default: "project" }),
          kind: str("Note kind: decision, research, context, handoff, or note", { default: "note" }),
          tags: str("Optional comma-separated tags; normalized to lowercase unique values"),
          directory: str("Optional workspace/project directory path to target"),
          project: str("Alias for directory"),
          generateEmbeddings: bool("Compute dense vector embeddings; set false for offline/tests", { default: true }),
        },
        ["title", "content"]
      ),
      execute: async (input) => ({
        content: JSON.stringify(await rememberNote(input, { worktree: null, directory: effectiveDir(input) }), null, 2),
      }),
    });
    editor.add({ name: "manage_snapshots", description: SNAPSHOT_DESCRIPTION,
      input: obj(SNAPSHOT_PROPERTIES, ["action"]),
      execute: async input => ({ content: JSON.stringify(await manageSnapshots(input), null, 2) }),
    });
  });
}

export default {
  id: "memory-plugin",
  setup: v2Setup,
};

// Re-export pure helpers so unit tests keep importing them from the entrypoint.
export { buildMemoryContext, buildSystemMemoryOverlay, injectMemoryOverlayIntoSystem, buildOpenCodeV2MemoryContext };
