#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { ensureDir, readMemory, readMemoryRaw, writeMemory, today, MEMORY_DIR, GLOBAL_KEY, scopeKey, projectName } from "./memory.js";

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

// --- Legacy Key-Value Memory Tools ---

// --- Legacy Key-Value Memory Tools & Agent Graph Linking ---

server.registerTool(
  "remember",
  {
    description:
      "Save an important, durable fact to memory. Only use for high-signal information " +
      "(name, goals, constraints, tech preferences, project conventions). " +
      "Optionally link the fact to a Knowledge Base document or exact line range (docId, startLine, endLine). " +
      "Translate the fact into English and keep it concise. " +
      "scope: 'project' (default) or 'global'",
    inputSchema: z.object({
      fact: z.string().describe("The fact to remember, written in English"),
      scope: z.string().default("project").describe("'project' (default) or 'global'"),
      docId: z.string().optional().describe("Optional document ID, title, or path to link this fact to"),
      startLine: z.number().optional().describe("Optional starting line number in target document"),
      endLine: z.number().optional().describe("Optional ending line number in target document"),
      relationType: z.string().default("LINKS_TO").describe("Relation type (e.g. 'RULES_FOR', 'IMPLEMENTS', 'REFERENCES')"),
    }),
  },
  async ({ fact, scope, docId, startLine, endLine, relationType }) => {
    const key = scopeKey(scope, null, null);
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

    return { content: [{ type: "text", text: `Memory updated${linkInfo}` }] };
  }
);

server.registerTool(
  "recall",
  {
    description: "Show saved facts with any Agent-linked Knowledge Base documents/lines. scope: 'project', 'global', or 'all' (default)",
    inputSchema: z.object({
      scope: z.string().default("all").describe("'project', 'global', or 'all'"),
    }),
  },
  async ({ scope }) => {
    const project = projectName(null, null);
    const { getLinksForFact } = await import("./graph/knowledge_linker.js");
    const results = [];

    const formatFactWithLinks = (factText, key) => {
      let line = factText;
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
      return line;
    };

    if (scope !== "project") {
      const global = await readMemoryRaw(GLOBAL_KEY);
      if (global.length) {
        results.push("--- Global ---");
        global.forEach((e, i) => results.push(`${i + 1}. ${formatFactWithLinks(e, GLOBAL_KEY)}`));
      }
    }
    if (scope !== "global") {
      const local = await readMemoryRaw(project);
      if (local.length) {
        if (results.length) results.push("");
        results.push(`--- ${project} ---`);
        local.forEach((e, i) => results.push(`${i + 1}. ${formatFactWithLinks(e, project)}`));
      }
    }
    const text = results.length ? results.join("\n") : "Memory is empty.";
    return { content: [{ type: "text", text }] };
  }
);

server.registerTool(
  "forget",
  {
    description: "Delete a fact by number (from recall) or text search",
    inputSchema: z.object({
      query: z.string().describe("Number or text to search for"),
      scope: z.string().default("project").describe("'project' (default) or 'global'"),
    }),
  },
  async ({ query, scope }) => {
    const key = scopeKey(scope, null, null);
    const entries = await readMemory(key);
    const num = parseInt(query, 10);
    let removed;
    if (!isNaN(num) && num > 0 && num <= entries.length) {
      removed = entries.splice(num - 1, 1);
    } else {
      const filtered = entries.filter((e) => !e.toLowerCase().includes(query.toLowerCase()));
      removed = entries.filter((e) => e.toLowerCase().includes(query.toLowerCase()));
      entries.length = 0;
      entries.push(...filtered);
    }
    await writeMemory(key, entries);
    const text = removed.length ? "Memory updated" : "Not found.";
    return { content: [{ type: "text", text }] };
  }
);

server.registerTool(
  "link_knowledge",
  {
    description:
      "Explicitly link a Notebook memory fact to a Knowledge Base document, section, or line range. " +
      "Creates Agent-driven Graph Edges connecting memory to RAG documents.",
    inputSchema: z.object({
      action: z.enum(["link", "list_links", "get_doc_links"]).default("link").describe("Action type"),
      factText: z.string().optional().describe("Memory fact text or keyword"),
      docId: z.string().optional().describe("Document ID, title, or file path"),
      scope: z.string().default("project").describe("'project' (default) or 'global'"),
      startLine: z.number().optional().describe("Starting line number in target document"),
      endLine: z.number().optional().describe("Ending line number in target document"),
      relationType: z.string().default("LINKS_TO").describe("Relation type (e.g. 'RULES_FOR', 'IMPLEMENTS', 'EXPLAINS')"),
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
      "Processes document through 3-tier hierarchy chunking (Big/Medium/Small), " +
      "computes dense vectors, and extracts GraphRAG code symbols.",
    inputSchema: z.object({
      content: z.string().describe("Raw text content, file path, or web URL"),
      type: z.enum(["text", "file", "url"]).default("text").describe("Input content type"),
      title: z.string().optional().describe("Document title"),
      path: z.string().optional().describe("Original document file path"),
      generateEmbeddings: z.boolean().default(true).describe("Compute dense vector embeddings"),
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
      limit: z.number().default(5).describe("Maximum number of sections to return"),
      generateEmbeddings: z.boolean().default(true).describe("Use vector search alongside BM25"),
    }),
  },
  async ({ query, limit, generateEmbeddings }) => {
    const { hybridQuery } = await import("./retrieval/retriever.js");
    const results = await hybridQuery({
      query,
      limit,
      generateEmbeddings,
    });

    if (!results || results.length === 0) {
      return { content: [{ type: "text", text: "No matching knowledge found for query." }] };
    }

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

    return { content: [{ type: "text", text: formatted }] };
  }
);

server.registerTool(
  "manage_knowledge_base",
  {
    description:
      "Manage the RAG knowledge base: inspect stats, list documents, read full raw document, delete documents, or export/import snapshots.",
    inputSchema: z.object({
      action: z.enum(["stats", "list", "read_document", "delete", "export_snapshot", "import_snapshot"]).describe("Management action"),
      docId: z.string().optional().describe("Document ID, title, or path (required for read_document and delete)"),
      snapshotPath: z.string().optional().describe("File path for snapshot export/import"),
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
