import * as z from "zod/v4";
import { optStr, defBool, defNum, optNum } from "./helpers.js";
import { MEMORY_DIR } from "../memory.js";
import { registerSnapshotDir } from "../admin/snapshot.js";
import { ensureExportsDir } from "../ingest/exporter.js";
import { resolveRagScopeKey, resolveManageRagScopeKeys, removeDocumentScopes } from "../rag_scope.js";
import { runSingleRagQuery, runBatchRagQuery } from "./core/rag_query_core.js";

export function registerRagTools(server) {
  // Restrict snapshot export/import paths to the plugin's own data directories.
  registerSnapshotDir(ensureExportsDir());
  registerSnapshotDir(MEMORY_DIR);

  server.registerTool(
    "ingest_document",
    {
      description:
        "Selectively preserve a reliable, reusable source in the RAG knowledge base; do not ingest everything encountered. " +
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
        scope: z.enum(["project", "global"]).nullish().transform((v) => v || "project").describe("RAG visibility: current Git project (default) or global"),
        directory: optStr().describe("Optional workspace/project directory path to target"),
        project: optStr().describe("Alias for directory"),
        generateEmbeddings: defBool(true).describe("Compute dense vector embeddings"),
      }),
    },
    async ({ content, type, title, path, scope, directory, project, generateEmbeddings }) => {
      const { ingestDocument } = await import("../ingest/pipeline.js");
      const projectScope = await resolveRagScopeKey(scope, { directory, project });
      const result = await ingestDocument({
        content,
        type,
        title: title || null,
        path: path || null,
        generateEmbeddings,
        projectScope,
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
                scope: result.projectScope,
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
        "Perform project-isolated hybrid search (RSF/RRF BM25 full-text + dense vector similarity) across the RAG knowledge base. " +
        "Returns ranked candidate sections with stable parent document IDs, source metadata, breadcrumbs, GraphRAG code symbols, and relevance scores.",
      inputSchema: z.object({
        query: z.string().describe("Search query in natural language or symbol name"),
        limit: defNum(5).describe("Maximum number of sections to return"),
        instruction: optStr().describe(
          "Optional task-specific retrieval instruction shaping embedding focus (e.g. 'Retrieve code snippets', 'Find user preferences'). " +
            "Recommended when using E5/BGE models for domain-specific queries."
        ),
        generateEmbeddings: defBool(true).describe("Use vector search alongside BM25"),
        scope: z.enum(["all", "project", "global"]).nullish().transform((v) => v || "all").describe("Search global + current project (default), project only, or global only"),
        directory: optStr().describe("Optional workspace/project directory path to target"),
        project: optStr().describe("Alias for directory"),
      }),
    },
    async (args) => ({
      content: [{ type: "text", text: await runSingleRagQuery(args) }],
    })
  );

  server.registerTool(
    "batch_query_knowledge_base",
    {
      description:
        "Execute multiple hybrid search queries in a single batch call. " +
        "Search is isolated to global plus the current project unless another scope is requested. " +
        "More efficient than separate query_knowledge_base calls: all query embeddings computed in one ONNX pass. " +
        "Returns one result set per query with stable parent document IDs and source metadata.",
      inputSchema: z.object({
        queries: z
          .array(z.string())
          .describe("Array of search queries to execute in batch"),
        limit: defNum(5).describe("Maximum number of sections to return per query"),
        instruction: optStr().describe(
          "Optional task-specific retrieval instruction shaping embedding focus. Applied to all queries."
        ),
        generateEmbeddings: defBool(true).describe("Use vector search alongside BM25"),
        scope: z.enum(["all", "project", "global"]).nullish().transform((v) => v || "all").describe("Search global + current project (default), project only, or global only"),
        directory: optStr().describe("Optional workspace/project directory path to target"),
        project: optStr().describe("Alias for directory"),
      }),
    },
    async (args) => ({
      content: [{ type: "text", text: await runBatchRagQuery(args) }],
    })
  );

  server.registerTool(
    "reindex_knowledge_base",
    {
      description:
        "Re-embed all existing documents in the RAG knowledge base with the active (or specified) embedding model and vector dimension. " +
        "Use after switching the embedding model or vector dimension so previously stored vectors match the new configuration. " +
        "Preserves documents, sections, FTS index, graph edges, and fact links.",
      inputSchema: z.object({
        model: optStr().describe("Embedding model to use (defaults to active config.embeddingModel)"),
        dimension: optNum().describe(
          "Fixed vector dimension (defaults to active config.vectorDimension; auto-detect if unset)"
        ),
      }),
    },
    async ({ model, dimension }) => {
      const { reindexEmbeddings } = await import("../ingest/pipeline.js");
      const result = await reindexEmbeddings({
        model: model || null,
        dimension: dimension !== undefined && dimension !== null ? dimension : null,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "success",
                reindexed: result.reindexed,
                documentsAffected: result.documentsAffected,
                model: result.model,
                dimension: result.dimension || "auto",
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
    "manage_knowledge_base",
    {
      description:
        "Manage the project-isolated RAG knowledge base: inspect stats, list documents, read full raw document, unlink/delete documents, or export/import complete snapshots.",
      inputSchema: z.object({
        action: z.enum(["stats", "list", "read_document", "delete", "export_snapshot", "import_snapshot"]).describe("Management action"),
        docId: optStr().describe("Document ID, title, or path (required for read_document and delete)"),
        snapshotPath: optStr().describe("File path for snapshot export/import"),
        scope: z.enum(["all", "project", "global"]).nullish().describe("For stats/list/read: global + current project by default. Delete defaults to the current project (or global outside Git); pass all/global explicitly for broader removal"),
        directory: optStr().describe("Optional workspace/project directory path to target"),
        project: optStr().describe("Alias for directory"),
      }),
    },
    async ({ action, docId, snapshotPath, scope, directory, project }) => {
      const { getDatabase } = await import("../db/database.js");
      const db = await getDatabase();
      const scopeKeys = ["stats", "list", "read_document", "delete"].includes(action)
        ? await resolveManageRagScopeKeys(action, scope, { directory, project })
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
        const docs = await db.prepare(`
          SELECT d.id, d.title, d.path, d.blob_hash, d.created_at,
                 GROUP_CONCAT(ds.scope_key) AS scopes
          FROM documents d
          JOIN document_scopes ds ON ds.doc_id = d.id AND ds.scope_key IN (${placeholders})
          GROUP BY d.id, d.title, d.path, d.blob_hash, d.created_at
          ORDER BY d.created_at DESC
        `).all(...scopeKeys);
        return {
          content: [{ type: "text", text: JSON.stringify(docs, null, 2) }],
        };
      }

      if (action === "read_document") {
        if (!docId) throw new Error("docId parameter is required for read_document action");
        const doc = await db
          .prepare(`SELECT d.id, d.title, d.path, d.blob_hash, d.created_at FROM documents d WHERE (d.id = ? OR d.path = ? OR d.title = ?) AND ${visibleDocWhere}`)
          .get(docId, docId, docId, ...scopeKeys);
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
        const visible = await db
          .prepare(`SELECT d.id FROM documents d WHERE (d.id = ? OR d.path = ? OR d.title = ?) AND ${visibleDocWhere}`)
          .get(docId, docId, docId, ...scopeKeys);
        if (!visible) throw new Error(`Document not found in the selected RAG scope for docId: ${docId}`);
        const scopeRemoval = await removeDocumentScopes(db, visible.id, scopeKeys);
        if (scopeRemoval.remainingScopes > 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                deleted: false,
                unlinked: true,
                docId: visible.id,
                removedScopes: scopeRemoval.removedScopes,
                remainingScopes: scopeRemoval.remainingScopes,
              }, null, 2),
            }],
          };
        }
        const { deleteDocument } = await import("../ingest/pipeline.js");
        const result = await deleteDocument(visible.id, db);
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
