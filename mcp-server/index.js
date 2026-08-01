#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { ensureDir, readMemory, readMemoryRaw, writeMemory, today, MEMORY_DIR, GLOBAL_KEY, scopeKey, projectKey, projectName, canonicalPath, listProjectStores, storeFilePath } from "./memory.js";
import {
  parseFactEntry,
  factText,
  factMeta,
  withMeta,
  nextFactId,
  isKeepFact,
  displayFact,
  formatFactEntry,
  matchesQuery,
  matchesTags,
  inDateRange,
} from "./fact_format.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Resolve a fact reference (1-based number, metadata id, or text) to an index.
function resolveFactIndex(entries, ref) {
  const trimmed = String(ref || "").trim();
  if (!trimmed) return -1;
  const num = parseInt(trimmed, 10);
  if (/^\d+$/.test(trimmed) && num >= 1 && num <= entries.length) return num - 1;
  const idIdx = entries.findIndex((e) => factMeta(e).id === trimmed);
  if (idIdx !== -1) return idIdx;
  const textIdx = entries.findIndex((e) => factText(e).toLowerCase().includes(trimmed.toLowerCase()));
  return textIdx;
}

const cliArgs = process.argv.slice(2);

if (cliArgs.includes("setup") || cliArgs.includes("install") || cliArgs.includes("--setup") || cliArgs.includes("-s")) {
  const { runSetup } = await import("./setup.js");
  await runSetup();
  process.exit(0);
}

if (cliArgs.includes("admin") || cliArgs.includes("--admin") || cliArgs.includes("-a")) {
  const { startAdminServer } = await import("./admin/server.js");
  await startAdminServer();
  // Keep process running for web server
  await new Promise(() => {});
}

if (cliArgs.includes("cli") || cliArgs.includes("config") || cliArgs.includes("--cli") || cliArgs.includes("-c")) {
  const { runCli } = await import("./cli.js");
  await runCli();
  process.exit(0);
}

await ensureDir();

const server = new McpServer({
  name: "memory-agent",
  version: "1.0.0",
});

// Optional string/number that tolerates null (some tool-call layers fill omitted
// optional args with null). Linking fields must NEVER be mandatory.
const optStr = () => z.string().optional().nullable();
const optNum = () => z.number().optional().nullable();
const defStr = (fallback) =>
  z
    .string()
    .nullish()
    .transform((v) => (v === null || v === undefined || v === "" ? fallback : v));
const defBool = (fallback) => z.boolean().nullish().transform((v) => (v === null || v === undefined ? fallback : v));
const defNum = (fallback) => z.number().nullish().transform((v) => (v === null || v === undefined ? fallback : v));

// --- Legacy Key-Value Memory Tools ---

// --- Legacy Key-Value Memory Tools & Agent Graph Linking ---

server.registerTool(
  "remember",
  {
    description:
      "Save an important, durable fact to memory. Only use for high-signal information " +
      "(name, goals, constraints, tech preferences, project conventions). " +
      "docId/startLine/endLine/relationType are OPTIONAL and only used to link the fact to a " +
      "Knowledge Base document or line range; omit them when no linking is needed. " +
      "ttl is OPTIONAL (e.g. '90d', '2w', '24h') — expired facts are shown with [EXPIRED] but not auto-deleted. " +
      "keep=true protects the fact from forget deletion unless force=true. " +
      "tags is OPTIONAL comma-separated text for filtering. " +
      "supersedes is OPTIONAL: a number (from recall), id, or text of a fact this one replaces; " +
      "the target is then marked [SUPERSEDED]. " +
      "Translate the fact into English and keep it concise. " +
      "scope: 'project' (default) or 'global'",
    inputSchema: z.object({
      fact: z.string().describe("The fact to remember, written in English"),
      scope: defStr("project").describe("'project' (default) or 'global'"),
      docId: optStr().describe("Optional document ID, title, or path to link this fact to"),
      startLine: optNum().describe("Optional starting line number in target document"),
      endLine: optNum().describe("Optional ending line number in target document"),
      relationType: defStr("LINKS_TO").describe("Relation type (e.g. 'RULES_FOR', 'IMPLEMENTS', 'REFERENCES')"),
      ttl: optStr().describe("Optional time-to-live, e.g. '90d', '2w', '24h', '12m'"),
      keep: defBool(false).describe("Protect the fact from forget deletion unless force=true"),
      tags: optStr().describe("Optional comma-separated tags, e.g. 'pref,arch'"),
      supersedes: optStr().describe("Optional number, id, or text of the fact this one replaces"),
    }),
  },
  async ({ fact, scope, docId, startLine, endLine, relationType, ttl, keep, tags, supersedes }) => {
    const key = scopeKey(scope, null, null);
    const entries = await readMemory(key);
    const factNormalized = fact.toLowerCase().trim();
    let duplicate = false;
    if (entries.some((e) => factText(e).toLowerCase().trim() === factNormalized)) {
      duplicate = true;
    }

    let supersededInfo = "";
    if (!duplicate) {
      const [date, time] = today().split(" ");
      const meta = { ttl, tags };
      if (keep) meta.keep = "1";
      if (supersedes) {
        const targetIdx = resolveFactIndex(entries, supersedes);
        if (targetIdx !== -1) {
          const newId = nextFactId(entries);
          const targetMeta = factMeta(entries[targetIdx]);
          const targetId = targetMeta.id || nextFactId(entries);
          entries[targetIdx] = withMeta(entries[targetIdx], { id: targetId, supersededBy: newId });
          meta.id = newId;
          meta.supersedes = targetId;
          supersededInfo = ` [superseded: "${factText(entries[targetIdx]).slice(0, 60)}"]`;
        } else {
          supersededInfo = " (note: supersedes target not found)";
        }
      }
      if (!meta.id) meta.id = nextFactId(entries);
      entries.push(formatFactEntry({ date, time, text: fact, meta }));
      await writeMemory(key, entries);
    }

    let linkInfo = "";
    if (docId) {
      const { linkFactToDocument } = await import("./graph/knowledge_linker.js");
      try {
        const linkRes = linkFactToDocument({
          factKey: key,
          factText: fact,
          docId,
          startLine,
          endLine,
          relationType,
        });
        const linesStr = startLine ? `:L${startLine}${endLine ? `-${endLine}` : ""}` : "";
        linkInfo = ` [Linked to Doc: "${linkRes.docTitle}"${linesStr}]`;
      } catch (err) {
        linkInfo = ` (Note: Fact saved, but document link failed: ${err.message})`;
      }
    }

    return { content: [{ type: "text", text: `Memory updated${supersededInfo}${linkInfo}` }] };
  }
);

server.registerTool(
  "recall",
  {
    description:
      "Show saved facts with any Agent-linked Knowledge Base documents/lines. " +
      "scope: 'project', 'global', 'all' (default), or 'list_projects'. " +
      "Use project: '<directory path>' with scope 'project'/'all' to read facts of a specific project from any working directory. " +
      "query filters by keyword (all space-separated terms must match). " +
      "tags filters by comma-separated tags. since/until filter by date (YYYY-MM-DD, inclusive). " +
      "Expired facts are shown with [EXPIRED], protected ones with [KEEP]. The response includes the store file paths.",
    inputSchema: z.object({
      scope: defStr("all").describe("'project', 'global', 'all', or 'list_projects'"),
      project: optStr().describe("Directory path of the project to read facts from (e.g. 'F:/projects/plugins/memory')"),
      query: optStr().describe("Optional keyword filter; all space-separated terms must match"),
      tags: optStr().describe("Optional comma-separated tag filter (any match)"),
      since: optStr().describe("Optional start date filter, YYYY-MM-DD (inclusive)"),
      until: optStr().describe("Optional end date filter, YYYY-MM-DD (inclusive)"),
    }),
  },
  async ({ scope, project, query, tags, since, until }) => {
    const { getLinksForFact } = await import("./graph/knowledge_linker.js");
    const results = [];

    const formatFactWithLinks = (factLine, key) => {
      let line = displayFact(factLine);
      try {
        const links = getLinksForFact(key, factText(factLine));
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
      return line;
    };

    const collect = (entries, key) => {
      const matched = entries.filter(
        (e) => matchesQuery(e, query) && matchesTags(e, tags) && inDateRange(e, since, until)
      );
      if (!matched.length) return;
      if (results.length) results.push("");
      results.push(`--- ${key === GLOBAL_KEY ? "Global" : `Project: ${key === target ? label : key}`} ---`);
      matched.forEach((e, i) => results.push(`${i + 1}. ${formatFactWithLinks(e, key)}`));
      results.push(`Store file: ${storeFilePath(key)}`);
    };

    if (scope === "list_projects") {
      const stores = await listProjectStores();
      if (!stores.length) {
        return { content: [{ type: "text", text: "No project memory stores found." }] };
      }
      const lines = stores.map(
        (s, i) => `${i + 1}. ${s.basename} — ${s.count} fact(s) [${s.file}]${s.path ? ` (bound to ${s.path})` : " (unbound legacy store)"}`
      );
      return {
        content: [
          {
            type: "text",
            text: `Project Memory Stores:\n${lines.join("\n")}\n\nUse recall(scope: "project", project: "<path>") to read a specific store.\n\nMemory dir: ${MEMORY_DIR}`,
          },
        ],
      };
    }

    const target = project ? canonicalPath(project) : projectKey(null, null);
    const label = project ? target : projectName();
    if (scope !== "project") {
      const global = await readMemory(GLOBAL_KEY);
      collect(global, GLOBAL_KEY);
    }
    if (scope !== "global") {
      const local = await readMemory(target);
      collect(local, target);
    }
    const filtered = Boolean(query || tags || since || until);
    const text = results.length
      ? `${results.join("\n")}\n\nMemory dir: ${MEMORY_DIR}`
      : filtered
        ? "No facts match the search."
        : "Memory is empty.";
    return { content: [{ type: "text", text }] };
  }
);

server.registerTool(
  "forget",
  {
    description:
      "Delete a fact by number (from recall), by range (e.g. '3-30', inclusive), or by text search. " +
      "Protected facts (remember with keep=true) are skipped unless force=true.",
    inputSchema: z.object({
      query: z.string().describe("Number, range like '3-30', or text to search for"),
      scope: defStr("project").describe("'project' (default) or 'global'"),
      force: defBool(false).describe("Also delete protected (keep) facts"),
    }),
  },
  async ({ query, scope, force }) => {
    const key = scopeKey(scope, null, null);
    const entries = await readMemory(key);
    const rangeMatch = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(query);
    const num = parseInt(query, 10);
    let indices = [];
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1], 10);
      const to = parseInt(rangeMatch[2], 10);
      if (from > 0 && to >= from && to <= entries.length) {
        for (let i = from - 1; i < to; i++) indices.push(i);
      }
    }
    if (!indices.length && !isNaN(num) && num > 0 && num <= entries.length) {
      indices.push(num - 1);
    }
    if (!indices.length) {
      const q = query.toLowerCase();
      indices = entries.reduce((acc, e, i) => (e.toLowerCase().includes(q) ? acc.concat(i) : acc), []);
    }
    if (!indices.length) {
      return { content: [{ type: "text", text: "Not found." }] };
    }

    const removable = indices.filter((i) => force || !isKeepFact(entries[i]));
    const protectedCount = indices.length - removable.length;
    if (removable.length) {
      for (const i of removable.sort((a, b) => b - a)) entries.splice(i, 1);
      await writeMemory(key, entries);
    }
    let text = removable.length ? "Memory updated" : "Nothing removed.";
    if (protectedCount) text += ` (${protectedCount} protected fact(s) skipped; use force=true to override)`;
    return { content: [{ type: "text", text }] };
  }
);

server.registerTool(
  "update_fact",
  {
    description:
      "Update the text of an existing fact by number (from recall), id, or text match, " +
      "preserving its original date and metadata. Linked Knowledge Base documents are re-pointed to the new text.",
    inputSchema: z.object({
      id: z.string().describe("Number (from recall), metadata id, or text of the fact to update"),
      newText: z.string().describe("New fact text"),
      scope: defStr("project").describe("'project' (default) or 'global'"),
    }),
  },
  async ({ id, newText, scope }) => {
    const key = scopeKey(scope, null, null);
    const entries = await readMemory(key);
    const idx = resolveFactIndex(entries, id);
    if (idx === -1) throw new Error(`Fact not found: ${id}`);
    const p = parseFactEntry(entries[idx]);
    const oldText = p ? p.text : entries[idx];
    const newLine = formatFactEntry({ date: p.date, time: p.time, text: newText, meta: p.meta });
    entries[idx] = newLine;
    await writeMemory(key, entries);

    let linksUpdated = 0;
    try {
      const { getDatabase } = await import("./db/database.js");
      const db = getDatabase();
      const res = db
        .prepare(
          "UPDATE knowledge_links SET fact_text = ? WHERE fact_key = ? AND fact_text = ?"
        )
        .run(newText, key, oldText);
      linksUpdated = res.changes;
    } catch (e) {}

    return {
      content: [
        { type: "text", text: `Fact updated${linksUpdated ? `, ${linksUpdated} doc link(s) updated` : ""}` },
      ],
    };
  }
);

server.registerTool(
  "memory_info",
  {
    description:
      "Show memory storage paths (store file locations, MEMORY_DIR, SQLite DB), fact counts, " +
      "Knowledge Base stats, and the installed package version.",
    inputSchema: z.object({}),
  },
  async () => {
    const dbPath = join(MEMORY_DIR, "storage", "memory.sqlite");
    const globalFile = storeFilePath(GLOBAL_KEY);
    const projectFile = storeFilePath(projectKey(null, null));

    let version = "unknown";
    try {
      version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf-8")).version;
    } catch (e) {}

    let rag = {};
    try {
      const { getDatabase } = await import("./db/database.js");
      const db = getDatabase();
      rag.documents = db.prepare("SELECT COUNT(*) AS c FROM documents").get().c;
      rag.sections = db.prepare("SELECT COUNT(*) AS c FROM sections").get().c;
      rag.chunks = db.prepare("SELECT COUNT(*) AS c FROM micro_chunks").get().c;
      rag.edges = db.prepare("SELECT COUNT(*) AS c FROM graph_edges").get().c;
      rag.links = db.prepare("SELECT COUNT(*) AS c FROM knowledge_links").get().c;
    } catch (e) {
      rag.error = e.message;
    }

    const stores = await listProjectStores();
    const lines = [
      `Version: ${version}`,
      `MEMORY_DIR: ${MEMORY_DIR}`,
      `SQLite DB: ${dbPath}`,
      `Global store: ${globalFile}`,
      `Project store: ${projectFile}`,
      `Project stores: ${stores.length}`,
      `Facts (global): ${(await readMemoryRaw(GLOBAL_KEY)).length}`,
      `Facts (project): ${(await readMemoryRaw(projectKey(null, null))).length}`,
    ];
    if (rag.error) lines.push(`RAG: unavailable (${rag.error})`);
    else lines.push(
      `RAG: ${rag.documents} doc(s), ${rag.sections} section(s), ${rag.chunks} chunk(s), ${rag.edges} edge(s), ${rag.links} memory link(s)`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.registerTool(
  "link_knowledge",
  {
    description:
      "Explicitly link a Notebook memory fact to a Knowledge Base document, section, or line range. " +
      "Creates Agent-driven Graph Edges connecting memory to RAG documents.",
    inputSchema: z.object({
      action: z.enum(["link", "list_links", "get_doc_links"]).nullish().transform((v) => v || "link").describe("Action type"),
      factText: optStr().describe("Memory fact text or keyword"),
      docId: optStr().describe("Document ID, title, or file path"),
      scope: defStr("project").describe("'project' (default) or 'global'"),
      startLine: optNum().describe("Starting line number in target document"),
      endLine: optNum().describe("Ending line number in target document"),
      relationType: defStr("LINKS_TO").describe("Relation type (e.g. 'RULES_FOR', 'IMPLEMENTS', 'EXPLAINS')"),
    }),
  },
  async ({ action, factText, docId, scope, startLine, endLine, relationType }) => {
    const { linkFactToDocument, getLinksForDoc, listAllLinks } = await import("./graph/knowledge_linker.js");
    const key = scopeKey(scope, null, null);

    if (action === "link") {
      if (!factText || !docId) {
        throw new Error("factText and docId are required parameters for link action");
      }
      const res = linkFactToDocument({
        factKey: key,
        factText,
        docId,
        startLine,
        endLine,
        relationType,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    }

    if (action === "get_doc_links") {
      if (!docId) throw new Error("docId parameter is required for get_doc_links action");
      const links = getLinksForDoc(docId);
      return {
        content: [{ type: "text", text: JSON.stringify(links, null, 2) }],
      };
    }

    if (action === "list_links") {
      const links = listAllLinks(key);
      return {
        content: [{ type: "text", text: JSON.stringify(links, null, 2) }],
      };
    }

    throw new Error(`Unknown action: ${action}`);
  }
);

// --- Hybrid RAG Knowledge Engine Tools ---

server.registerTool(
  "ingest_document",
  {
    description:
      "Ingest a document into the RAG knowledge base. " +
      "Accepts local file paths, web URLs, or raw Markdown/text content. " +
      "For type='file' the file is read from disk and indexed with a code-block wrapper. " +
      "For type='url' the page is fetched and its content is indexed (not just the URL). " +
      "Processes document through 3-tier hierarchy chunking (Big/Medium/Small), " +
      "computes dense vectors, and extracts GraphRAG code symbols.",
    inputSchema: z.object({
      content: z.string().describe("Raw text content, file path, or web URL. For type='file' this can be the file path (reads from disk) or the file content directly"),
      type: z.enum(["text", "file", "url"]).nullish().transform((v) => v || "text").describe("Input content type: 'text' (raw content), 'file' (reads from disk, wraps in code block), or 'url' (fetches page content)"),
      title: optStr().describe("Document title"),
      path: optStr().describe("Original document file path"),
      generateEmbeddings: defBool(true).describe("Compute dense vector embeddings"),
    }),
  },
  async ({ content, type, title, path, generateEmbeddings }) => {
    const { ingestDocument } = await import("./ingest/pipeline.js");
    const result = await ingestDocument({
      content,
      type,
      title: title || null,
      path: path || null,
      generateEmbeddings,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
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
          ),
        },
      ],
    };
  }
);

server.registerTool(
  "query_knowledge_base",
  {
    description:
      "Perform hybrid search (RSF/RRF BM25 full-text + dense vector similarity) across the RAG knowledge base. " +
      "Returns top-ranked candidate document sections with breadcrumbs, GraphRAG defined code symbols, and relevance scores.",
    inputSchema: z.object({
      query: z.string().describe("Search query in natural language or symbol name"),
      limit: defNum(5).describe("Maximum number of sections to return"),
      instruction: optStr().describe(
        "Optional task-specific retrieval instruction shaping embedding focus (e.g. 'Retrieve code snippets', 'Find user preferences'). " +
        "Recommended when using E5/BGE models for domain-specific queries."
      ),
      generateEmbeddings: defBool(true).describe("Use vector search alongside BM25"),
    }),
  },
  async ({ query, limit, instruction, generateEmbeddings }) => {
    const { hybridQuery } = await import("./retrieval/retriever.js");
    const { getConfig } = await import("./config/config_manager.js");
    const activeConfig = getConfig();

    const results = await hybridQuery({
      query,
      limit,
      generateEmbeddings,
      instruction: instruction || null,
    });

    if (!results || results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `[Active Model: ${activeConfig.embeddingModel}]\nNo matching knowledge found for query.`,
          },
        ],
      };
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

    return { content: [{ type: "text", text: headerNote + formatted }] };
  }
);

server.registerTool(
  "manage_knowledge_base",
  {
    description:
      "Manage the RAG knowledge base: inspect stats, list documents, read full raw document, delete documents, or export/import snapshots.",
    inputSchema: z.object({
      action: z.enum(["stats", "list", "read_document", "delete", "export_snapshot", "import_snapshot"]).describe("Management action"),
      docId: optStr().describe("Document ID, title, or path (required for read_document and delete)"),
      snapshotPath: optStr().describe("File path for snapshot export/import"),
    }),
  },
  async ({ action, docId, snapshotPath }) => {
    const { getDatabase } = await import("./db/database.js");
    const db = getDatabase();

    if (action === "stats") {
      const docCount = db.prepare("SELECT COUNT(*) as cnt FROM documents").get().cnt;
      const secCount = db.prepare("SELECT COUNT(*) as cnt FROM sections").get().cnt;
      const chunkCount = db.prepare("SELECT COUNT(*) as cnt FROM micro_chunks").get().cnt;
      const edgeCount = db.prepare("SELECT COUNT(*) as cnt FROM graph_edges").get().cnt;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                documents: docCount,
                sections: secCount,
                micro_chunks: chunkCount,
                graph_edges: edgeCount,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (action === "list") {
      const docs = db
        .prepare("SELECT id, title, path, blob_hash, created_at FROM documents ORDER BY created_at DESC")
        .all();
      return {
        content: [{ type: "text", text: JSON.stringify(docs, null, 2) }],
      };
    }

    if (action === "read_document") {
      if (!docId) throw new Error("docId parameter is required for read_document action");
      const doc = db
        .prepare("SELECT id, title, path, blob_hash, created_at FROM documents WHERE id = ? OR path = ? OR title = ?")
        .get(docId, docId, docId);
      if (!doc) {
        throw new Error(`Document not found in knowledge base for docId: ${docId}`);
      }
      const { readBlob } = await import("./storage/blob_store.js");
      const rawContent = await readBlob(doc.blob_hash);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: doc.id,
                title: doc.title,
                path: doc.path,
                created_at: doc.created_at,
                content: rawContent,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (action === "delete") {
      if (!docId) throw new Error("docId parameter is required for delete action");
      const { deleteDocument } = await import("./ingest/pipeline.js");
      const result = await deleteDocument(docId, db);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (action === "export_snapshot") {
      const { exportSnapshot } = await import("./admin/snapshot.js");
      const result = await exportSnapshot({ customDb: db, outputPath: snapshotPath || null });
      return {
        content: [
          {
            type: "text",
            text: snapshotPath
              ? `Snapshot exported successfully to ${snapshotPath}`
              : JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (action === "import_snapshot") {
      if (!snapshotPath) throw new Error("snapshotPath parameter is required for import_snapshot action");
      const { importSnapshot } = await import("./admin/snapshot.js");
      const result = await importSnapshot({ customDb: db, snapshotPathOrData: snapshotPath });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    throw new Error(`Unknown action: ${action}`);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`memory-agent MCP server running, data dir: ${MEMORY_DIR}`);
