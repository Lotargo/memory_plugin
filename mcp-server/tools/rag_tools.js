import * as z from "zod/v4";
import { optStr, defBool, defNum } from "./helpers.js";
import { MEMORY_DIR } from "../memory.js";
import { registerSnapshotDir } from "../admin/snapshot.js";
import { ensureExportsDir } from "../ingest/exporter.js";

export function registerRagTools(server) {
  // Restrict snapshot export/import paths to the plugin's own data directories.
  registerSnapshotDir(ensureExportsDir());
  registerSnapshotDir(MEMORY_DIR);

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
        content: z
          .string()
          .describe(
            "Raw text content, file path, or web URL. For type='file' this can be the file path (reads from disk) or the file content directly"
          ),
        type: z
          .enum(["text", "file", "url"])
          .nullish()
          .transform((v) => v || "text")
          .describe("Input content type: 'text' (raw content), 'file' (reads from disk, wraps in code block), or 'url' (fetches page content)"),
        title: optStr().describe("Document title"),
        path: optStr().describe("Original document file path"),
        generateEmbeddings: defBool(true).describe("Compute dense vector embeddings"),
      }),
    },
    async ({ content, type, title, path, generateEmbeddings }) => {
      const { ingestDocument } = await import("../ingest/pipeline.js");
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
      const { hybridQuery } = await import("../retrieval/retriever.js");
      const { getConfig } = await import("../config/config_manager.js");
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
      const { getDatabase } = await import("../db/database.js");
      const db = await getDatabase();

      if (action === "stats") {
        const docCountRow = await db.prepare("SELECT COUNT(*) as cnt FROM documents").get();
        const docCount = docCountRow ? docCountRow.cnt : 0;
        const secCountRow = await db.prepare("SELECT COUNT(*) as cnt FROM sections").get();
        const secCount = secCountRow ? secCountRow.cnt : 0;
        const chunkCountRow = await db.prepare("SELECT COUNT(*) as cnt FROM micro_chunks").get();
        const chunkCount = chunkCountRow ? chunkCountRow.cnt : 0;
        const edgeCountRow = await db.prepare("SELECT COUNT(*) as cnt FROM graph_edges").get();
        const edgeCount = edgeCountRow ? edgeCountRow.cnt : 0;
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
        const docs = await db.prepare("SELECT id, title, path, blob_hash, created_at FROM documents ORDER BY created_at DESC").all();
        return {
          content: [{ type: "text", text: JSON.stringify(docs, null, 2) }],
        };
      }

      if (action === "read_document") {
        if (!docId) throw new Error("docId parameter is required for read_document action");
        const doc = await db
          .prepare("SELECT id, title, path, blob_hash, created_at FROM documents WHERE id = ? OR path = ? OR title = ?")
          .get(docId, docId, docId);
        if (!doc) {
          throw new Error(`Document not found in knowledge base for docId: ${docId}`);
        }
        const { readBlob } = await import("../storage/blob_store.js");
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
        const { deleteDocument } = await import("../ingest/pipeline.js");
        const result = await deleteDocument(docId, db);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      if (action === "export_snapshot") {
        const { exportSnapshot } = await import("../admin/snapshot.js");
        const result = await exportSnapshot({ customDb: db, outputPath: snapshotPath || null });
        return {
          content: [
            {
              type: "text",
              text: snapshotPath ? `Snapshot exported successfully to ${snapshotPath}` : JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      if (action === "import_snapshot") {
        if (!snapshotPath) throw new Error("snapshotPath parameter is required for import_snapshot action");
        const { importSnapshot } = await import("../admin/snapshot.js");
        const result = await importSnapshot({ customDb: db, snapshotPathOrData: snapshotPath });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      throw new Error(`Unknown action: ${action}`);
    }
  );
}
