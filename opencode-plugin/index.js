const { readFile, writeFile, mkdir, cp, readdir, unlink } = await import("fs/promises");
const { existsSync } = await import("fs");
const { join, basename, dirname, resolve } = await import("path");
const { homedir } = await import("os");
const { fileURLToPath } = await import("url");

const CONFIG_DIR = process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode");
const MEMORY_DIR = join(CONFIG_DIR, "memory");
const SKILLS_DIR = join(CONFIG_DIR, "skills");
const GLOBAL_KEY = "global";

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

function canonicalPath(dir) {
  let p = resolve(dir || process.cwd());
  if (process.platform === "win32") {
    p = p.replace(/\\/g, "/").replace(/^([a-zA-Z]):/, (_, d) => `${d.toLowerCase()}:`);
  }
  return p;
}

// Display label for a project (basename of the resolved directory).
function projectName(worktree, directory) {
  const dir = worktree || directory;
  return dir ? basename(resolve(dir)) : "default";
}

// Project store key = full directory path (removes basename collisions).
function projectKey(worktree, directory) {
  return canonicalPath(worktree || directory);
}

function scopeKey(scope, worktree, directory) {
  return scope === "global" ? GLOBAL_KEY : projectKey(worktree, directory);
}

function slugify(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function memoryPath(key) {
  return join(MEMORY_DIR, `${slugify(key)}.md`);
}

function memoryFileName(key) {
  return basename(memoryPath(key));
}

function parseMeta(content) {
  const m = content.match(/<!-- path: (.+?) -->/);
  return { path: m ? m[1].trim() : null };
}

function isSimpleKey(key) {
  return /^[a-zA-Z0-9_-]+$/.test(key);
}

// Lazy migration: when reading a project path store that doesn't exist yet but a
// legacy <basename>.md store (without path binding) does, claim it under the path.
async function maybeMigrateLegacy(key) {
  if (key === GLOBAL_KEY || isSimpleKey(key)) return null;
  const legacyBasename = basename(key);
  if (!legacyBasename) return null;
  const legacyFp = join(MEMORY_DIR, `${legacyBasename}.md`);
  if (slugify(key) === legacyBasename || !existsSync(legacyFp)) return null;
  const content = await readFile(legacyFp, "utf-8");
  if (parseMeta(content).path) return null; // already bound to another project
  // Collision guard: a different path with the same basename is already bound,
  // so this legacy store is ambiguous and must not be silently claimed.
  const files = await readdir(MEMORY_DIR).catch(() => []);
  for (const f of files) {
    if (!f.endsWith(".md") || f === `${legacyBasename}.md` || f === `${GLOBAL_KEY}.md`) continue;
    try {
      const other = parseMeta(await readFile(join(MEMORY_DIR, f), "utf-8")).path;
      if (other && basename(other) === legacyBasename) return null;
    } catch (e) {}
  }
  const facts = content.split("\n").filter((l) => l.startsWith("- ["));
  await writeMemory(key, facts);
  try {
    await unlink(legacyFp);
  } catch (e) {}
  return facts;
}

async function readMemory(key) {
  const fp = memoryPath(key);
  if (existsSync(fp)) {
    const content = await readFile(fp, "utf-8");
    return content.split("\n").filter((l) => l.startsWith("- ["));
  }
  const migrated = await maybeMigrateLegacy(key);
  return migrated || [];
}

async function readMemoryRaw(key) {
  return (await readMemory(key)).map((e) => e.slice(2));
}

async function writeMemory(key, entries) {
  const lines = [];
  if (key === GLOBAL_KEY) {
    lines.push("# Global Memory", "");
  } else {
    lines.push(`# Memory: ${basename(key) || key}`, "");
    if (!isSimpleKey(key)) {
      lines.push(`<!-- path: ${key} -->`, "");
    }
  }
  const content = lines.join("\n") + "\n" + (entries.length ? entries.join("\n") + "\n" : "");
  await writeFile(memoryPath(key), content);
}

async function listProjectStores() {
  const stores = [];
  const files = await readdir(MEMORY_DIR).catch(() => []);
  for (const f of files) {
    if (!f.endsWith(".md") || f === `${GLOBAL_KEY}.md`) continue;
    let content = "";
    try {
      content = await readFile(join(MEMORY_DIR, f), "utf-8");
    } catch (e) {
      continue;
    }
    const facts = content.split("\n").filter((l) => l.startsWith("- ["));
    const meta = parseMeta(content);
    const key = meta.path || f.slice(0, -3);
    stores.push({
      key,
      path: meta.path,
      basename: basename(meta.path || key) || key,
      file: f,
      count: facts.length,
      legacy: !meta.path,
    });
  }
  stores.sort((a, b) => a.basename.localeCompare(b.basename));
  return stores;
}

async function migrateLegacyStore(legacyKey, targetDir) {
  const legacyFp = join(MEMORY_DIR, `${legacyKey.replace(/[^a-zA-Z0-9_-]/g, "_")}.md`);
  if (!existsSync(legacyFp)) return { ok: false, reason: "not_found", key: legacyKey };
  const content = await readFile(legacyFp, "utf-8");
  if (parseMeta(content).path) return { ok: false, reason: "already_bound", key: legacyKey };
  const targetKey = projectKey(targetDir, null);
  const facts = content.split("\n").filter((l) => l.startsWith("- ["));
  await writeMemory(targetKey, facts);
  try {
    await unlink(legacyFp);
  } catch (e) {}
  return { ok: true, key: targetKey, file: memoryPath(targetKey), facts: facts.length };
}

function today() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${date} ${time}`;
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
  "PROACTIVE MEMORY DIRECTIVE:\n" +
  "You MUST automatically and proactively call `remember` whenever the user shares durable facts, personal preferences, coding guidelines, tech stack choices, architecture decisions, or project conventions.\n" +
  "Do NOT wait for explicit user commands like \"remember this\". Automatically capture high-signal facts in real time.\n" +
  "Use `remember` only for important, durable facts about the user and project.\n" +
  "Save high-signal items: user role, goals, constraints, tech stack preferences, architecture decisions, project conventions.\n" +
  "DO NOT save: transient details, one-off statements, full conversation turns, or anything unlikely to be useful in future sessions.\n" +
  "When saving, translate the fact into clear, concise English.\n" +
  "Use `scope: \"global\"` for personal facts, `scope: \"project\"` for project-specific facts.";

function buildMemoryContext(globalFacts, projectFacts, projectKey) {
  const parts = [MEMORY_INSTRUCTION];
  if (globalFacts.length) {
    parts.push("## Global\n" + globalFacts.map((f, i) => `${i + 1}. ${f}`).join("\n"));
  }
  if (projectFacts.length) {
    parts.push(`## Project: ${projectKey}\n` + projectFacts.map((f, i) => `${i + 1}. ${f}`).join("\n"));
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
  await ensureDir();
  const activeProjectKey = scopeKey("project", worktree, directory);

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages?.length) return;
      const firstUser = output.messages.find((m) => m?.info?.role === "user");
      if (!firstUser?.parts?.length) return;

      if (firstUser.parts.some((p) => p.type === "text" && p.text.includes("<MEMORY>"))) return;

      const [globalFacts, projectFacts] = await Promise.all([
        readMemoryRaw(GLOBAL_KEY),
        readMemoryRaw(activeProjectKey),
      ]);

      const context = buildMemoryContext(globalFacts, projectFacts, activeProjectKey);
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
          "Translate the fact into English and keep it concise. " +
          "scope: 'project' (default) or 'global'",
        args: {
          fact: { type: "string", description: "The fact to remember, written in English" },
          scope: {
            type: "string",
            description: "'project' (default) or 'global'",
            default: "project",
          },
          docId: { type: "string", description: "Optional document ID, title, or path to link this fact to" },
          startLine: { type: "number", description: "Optional starting line number in target document" },
          endLine: { type: "number", description: "Optional ending line number in target document" },
          relationType: {
            type: "string",
            description: "Relation type (e.g. 'RULES_FOR', 'IMPLEMENTS', 'REFERENCES')",
            default: "LINKS_TO",
          },
        },
        async execute({ fact, scope, docId, startLine, endLine, relationType }, { worktree, directory }) {
          const key = scopeKey(scope || "project", worktree, directory);
          const entries = await readMemory(key);
          const factNormalized = fact.toLowerCase().trim();
          if (!entries.some((e) => {
            const idx = e.indexOf("] ");
            return idx !== -1 && e.slice(idx + 2).toLowerCase().trim() === factNormalized;
          })) {
            entries.push(`- [${today()}] ${fact}`);
            await writeMemory(key, entries);
          }

          let linkInfo = "";
          if (docId) {
            try {
              const { linkFactToDocument } = await import("../mcp-server/graph/knowledge_linker.js");
              const linkRes = linkFactToDocument({
                factKey: key,
                factText: fact,
                docId,
                startLine,
                endLine,
                relationType: relationType || "LINKS_TO",
              });
              const linesStr = startLine ? `:L${startLine}${endLine ? `-${endLine}` : ""}` : "";
              linkInfo = ` [Linked to Doc: "${linkRes.docTitle}"${linesStr}]`;
            } catch (err) {
              linkInfo = ` (Note: Fact saved, but document link failed: ${err.message})`;
            }
          }

          await notify(client, "Memory updated" + linkInfo);
          return "Memory updated" + linkInfo;
        },
      },
      "recall": {
        description:
          "Show saved facts with any Agent-linked Knowledge Base documents/lines. " +
          "scope: 'project', 'global', 'all' (default), or 'list_projects'. " +
          "Use project: '<directory path>' to read facts of a specific project from any working directory.",
        args: {
          scope: {
            type: "string",
            description: "project, global, all (по умолчанию) или list_projects",
            default: "all",
          },
          project: { type: "string", description: "Directory path of the project to read facts from (e.g. 'F:/projects/plugins/memory')" },
        },
        async execute({ scope, project }, { worktree, directory }) {
          const results = [];

          let getLinksForFact;
          try {
            const linker = await import("../mcp-server/graph/knowledge_linker.js");
            getLinksForFact = linker.getLinksForFact;
          } catch (e) {}

          const formatFactWithLinks = (factText, key) => {
            let line = factText;
            if (getLinksForFact) {
              try {
                const links = getLinksForFact(key, factText);
                if (links && links.length > 0) {
                  const docStr = links
                    .map((l) => {
                      const range = l.start_line ? `:L${l.start_line}${l.end_line ? `-${l.end_line}` : ""}` : "";
                      return `${l.doc_title || l.doc_path}${range}`;
                    })
                    .join(", ");
                  line += ` 🔗 [Linked Docs: ${docStr}]`;
                }
              } catch (e) {}
            }
            return line;
          };

          if (scope === "list_projects") {
            return listProjectStores().then((stores) => {
              if (!stores.length) return "No project memory stores found.";
              const lines = stores.map(
                (s, i) => `${i + 1}. ${s.basename} — ${s.count} fact(s) [${s.file}]${s.path ? ` (bound to ${s.path})` : " (unbound legacy store)"}`
              );
              return `Project Memory Stores:\n${lines.join("\n")}\n\nUse recall(scope: "project", project: "<path>") to read a specific store.`;
            });
          }

          const target = project ? canonicalPath(project) : projectKey(worktree, directory);
          const label = project ? target : projectName(worktree, directory);

          if (scope !== "project") {
            const global = await readMemoryRaw(GLOBAL_KEY);
            if (global.length) {
              results.push("--- Global ---");
              global.forEach((e, i) => results.push(`${i + 1}. ${formatFactWithLinks(e, GLOBAL_KEY)}`));
            }
          }
          if (scope !== "global") {
            const local = await readMemoryRaw(target);
            if (local.length) {
              if (results.length) results.push("");
              results.push(`--- Project: ${label} ---`);
              local.forEach((e, i) => results.push(`${i + 1}. ${formatFactWithLinks(e, target)}`));
            }
          }
          return results.length ? results.join("\n") : "Memory is empty.";
        },
      },
      "forget": {
        description: "Удалить факт по номеру (см. recall), по диапазону (например '3-30', включительно) или тексту",
        args: {
          query: { type: "string", description: "Номер факта, диапазон вида '3-30' или текст для поиска" },
          scope: {
            type: "string",
            description: "project (по умолчанию) или global",
            default: "project",
          },
        },
        async execute({ query, scope }, { worktree, directory }) {
          const key = scopeKey(scope || "project", worktree, directory);
          const entries = await readMemory(key);
          const rangeMatch = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(query);
          const num = parseInt(query, 10);
          let removed;
          if (rangeMatch) {
            const from = parseInt(rangeMatch[1], 10);
            const to = parseInt(rangeMatch[2], 10);
            if (from > 0 && to >= from && to <= entries.length) {
              removed = entries.splice(from - 1, to - from + 1);
            }
          }
          if (!removed && !isNaN(num) && num > 0 && num <= entries.length) {
            removed = entries.splice(num - 1, 1);
          }
          if (!removed) {
            const filtered = entries.filter((e) => !e.toLowerCase().includes(query.toLowerCase()));
            removed = entries.filter((e) => e.toLowerCase().includes(query.toLowerCase()));
            entries.length = 0;
            entries.push(...filtered);
          }
          await writeMemory(key, entries);
          const result = removed.length ? "Memory updated" : "Not found.";
          if (removed.length) await notify(client, "Memory updated");
          return result;
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
          startLine: { type: "number", description: "Starting line number in target document" },
          endLine: { type: "number", description: "Ending line number in target document" },
          relationType: {
            type: "string",
            description: "Relation type (e.g. 'RULES_FOR', 'IMPLEMENTS', 'EXPLAINS')",
            default: "LINKS_TO",
          },
        },
        async execute({ action, factText, docId, scope, startLine, endLine, relationType }, { worktree, directory }) {
          const { linkFactToDocument, getLinksForDoc, listAllLinks } = await import("../mcp-server/graph/knowledge_linker.js");
          const key = scopeKey(scope || "project", worktree, directory);
          const act = action || "link";

          if (act === "link") {
            if (!factText || !docId) {
              throw new Error("factText and docId are required parameters for link action");
            }
            const res = linkFactToDocument({
              factKey: key,
              factText,
              docId,
              startLine,
              endLine,
              relationType: relationType || "LINKS_TO",
            });
            return JSON.stringify(res, null, 2);
          }

          if (act === "get_doc_links") {
            if (!docId) throw new Error("docId parameter is required for get_doc_links action");
            const links = getLinksForDoc(docId);
            return JSON.stringify(links, null, 2);
          }

          if (act === "list_links") {
            const links = listAllLinks(key);
            return JSON.stringify(links, null, 2);
          }

          throw new Error(`Unknown action: ${act}`);
        },
      },
      "ingest_document": {
        description:
          "Ingest a document into the RAG knowledge base. " +
          "Accepts local file paths, web URLs, or raw Markdown/text content. " +
          "For type='url' the page is fetched and its content is indexed (not just the URL). " +
          "Processes document through 3-tier hierarchy chunking (Big/Medium/Small), " +
          "computes dense vectors, and extracts GraphRAG code symbols.",
        args: {
          content: { type: "string", description: "Raw text content, file path, or web URL" },
          type: { type: "string", description: "Input content type: 'text', 'file', 'url' (url fetches the page content)", default: "text" },
          title: { type: "string", description: "Document title" },
          path: { type: "string", description: "Original document file path" },
          generateEmbeddings: { type: "boolean", description: "Compute dense vector embeddings", default: true },
        },
        async execute({ content, type, title, path, generateEmbeddings }) {
          const { ingestDocument } = await import("../mcp-server/ingest/pipeline.js");
          const result = await ingestDocument({
            content,
            type: type || "text",
            title: title || null,
            path: path || null,
            generateEmbeddings: generateEmbeddings !== false,
          });
          return JSON.stringify(
            {
              status: "success",
              docId: result.docId,
              title: result.title,
              sectionsCount: result.sectionsCount,
              microChunksCount: result.microChunksCount,
              deduplicated: result.deduplicated,
            },
            null,
            2
          );
        },
      },
      "query_knowledge_base": {
        description:
          "Perform hybrid search (RSF/RRF BM25 full-text + dense vector similarity) across the RAG knowledge base. " +
          "Returns top-ranked candidate document sections with breadcrumbs, GraphRAG defined code symbols, and relevance scores.",
        args: {
          query: { type: "string", description: "Search query in natural language or symbol name" },
          limit: { type: "number", description: "Maximum number of sections to return", default: 5 },
          instruction: {
            type: "string",
            description: "Optional task-specific retrieval instruction shaping embedding focus",
          },
          generateEmbeddings: { type: "boolean", description: "Use vector search alongside BM25", default: true },
        },
        async execute({ query, limit, instruction, generateEmbeddings }) {
          const { hybridQuery } = await import("../mcp-server/retrieval/retriever.js");
          const { getConfig } = await import("../mcp-server/config/config_manager.js");
          const activeConfig = getConfig();

          const results = await hybridQuery({
            query,
            limit: limit || 5,
            generateEmbeddings: generateEmbeddings !== false,
            instruction: instruction || null,
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
      "manage_knowledge_base": {
        description:
          "Manage the RAG knowledge base: inspect stats, list documents, read full raw document, delete documents, or export/import snapshots.",
        args: {
          action: {
            type: "string",
            description: "Management action: 'stats', 'list', 'read_document', 'delete', 'export_snapshot', 'import_snapshot'",
          },
          docId: { type: "string", description: "Document ID, title, or path (required for read_document and delete)" },
          snapshotPath: { type: "string", description: "File path for snapshot export/import" },
        },
        async execute({ action, docId, snapshotPath }) {
          const { getDatabase } = await import("../mcp-server/db/database.js");
          const db = getDatabase();

          if (action === "stats") {
            const docCount = db.prepare("SELECT COUNT(*) as cnt FROM documents").get().cnt;
            const secCount = db.prepare("SELECT COUNT(*) as cnt FROM sections").get().cnt;
            const chunkCount = db.prepare("SELECT COUNT(*) as cnt FROM micro_chunks").get().cnt;
            const edgeCount = db.prepare("SELECT COUNT(*) as cnt FROM graph_edges").get().cnt;
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
            const docs = db
              .prepare("SELECT id, title, path, blob_hash, created_at FROM documents ORDER BY created_at DESC")
              .all();
            return JSON.stringify(docs, null, 2);
          }

          if (action === "read_document") {
            if (!docId) throw new Error("docId parameter is required for read_document action");
            const doc = db
              .prepare("SELECT id, title, path, blob_hash, created_at FROM documents WHERE id = ? OR path = ? OR title = ?")
              .get(docId, docId, docId);
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
            const { deleteDocument } = await import("../mcp-server/ingest/pipeline.js");
            const result = await deleteDocument(docId, db);
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
    },
  };
};

export default MemoryPlugin;
