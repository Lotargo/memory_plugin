import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabase, DB_PATH, BLOBS_DIR } from "../db/database.js";
import { ingestDocument, deleteDocument } from "../ingest/pipeline.js";
import { hybridQuery } from "../retrieval/retriever.js";
import { exportSnapshot, importSnapshot } from "./snapshot.js";
import { readBlob } from "../storage/blob_store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function findAvailablePort(startPort = 8765, maxPort = 8785) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const tryPort = () => {
      if (port > maxPort) {
        return reject(new Error(`No free port found between ${startPort} and ${maxPort}`));
      }
      const server = createServer();
      server.listen(port, () => {
        server.close(() => resolve(port));
      });
      server.on("error", () => {
        port++;
        tryPort();
      });
    };
    tryPort();
  });
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

export async function startAdminServer({ port = null, customDb = null, customBlobDir = BLOBS_DIR } = {}) {
  const db = customDb || getDatabase();
  const selectedPort = port || (await findAvailablePort());
  const htmlPath = join(__dirname, "index.html");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // Helper for CORS and JSON response
    const sendJson = (data, status = 200) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end(JSON.stringify(data));
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }

    try {
      // 1. Static HTML SPA
      if (pathname === "/" || pathname === "/index.html") {
        if (!existsSync(htmlPath)) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          return res.end("index.html not found");
        }
        const html = readFileSync(htmlPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(html);
      }

      // 2. API: Stats
      if (pathname === "/api/stats" && req.method === "GET") {
        const docCount = db.prepare("SELECT COUNT(*) as cnt FROM documents").get().cnt;
        const secCount = db.prepare("SELECT COUNT(*) as cnt FROM sections").get().cnt;
        const chunkCount = db.prepare("SELECT COUNT(*) as cnt FROM micro_chunks").get().cnt;
        const edgeCount = db.prepare("SELECT COUNT(*) as cnt FROM graph_edges").get().cnt;
        let dbSize = 0;
        if (existsSync(DB_PATH)) {
          try {
            dbSize = statSync(DB_PATH).size;
          } catch {}
        }
        return sendJson({
          documents: docCount,
          sections: secCount,
          micro_chunks: chunkCount,
          graph_edges: edgeCount,
          db_size_bytes: dbSize,
        });
      }

      // 3. API: Documents List
      if (pathname === "/api/documents" && req.method === "GET") {
        const docs = db.prepare("SELECT * FROM documents ORDER BY updated_at DESC").all();
        return sendJson(docs);
      }

      // 4. API: Document Detail
      if (pathname.startsWith("/api/documents/") && req.method === "GET") {
        const docId = pathname.replace("/api/documents/", "");
        const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(docId);
        if (!doc) return sendJson({ error: "Document not found" }, 404);

        const sections = db.prepare("SELECT * FROM sections WHERE doc_id = ?").all(docId);
        const microChunks = db.prepare("SELECT id, section_id, token_count FROM micro_chunks WHERE doc_id = ?").all(docId);
        const edges = db.prepare("SELECT * FROM graph_edges WHERE source_id = ? OR target_id = ?").all(docId, docId);

        let blobContent = null;
        if (doc.blob_hash) {
          try {
            blobContent = await readBlob(doc.blob_hash, customBlobDir);
          } catch {}
        }

        return sendJson({ doc, sections, microChunks, edges, blobContent });
      }

      // 5. API: Delete Document
      if (pathname.startsWith("/api/documents/") && req.method === "DELETE") {
        const docId = pathname.replace("/api/documents/", "");
        const result = await deleteDocument(docId, db, customBlobDir);
        return sendJson(result);
      }

      // 6. API: Ingest Document
      if (pathname === "/api/ingest" && req.method === "POST") {
        const body = await parseJsonBody(req);
        const result = await ingestDocument({
          content: body.content,
          type: body.type || "text",
          path: body.path || null,
          title: body.title || null,
          generateEmbeddings: body.generateEmbeddings !== false,
          customDb: db,
          customBlobDir,
        });
        return sendJson(result, 201);
      }

      // 7. API: Query Knowledge Base
      if (pathname === "/api/query" && req.method === "POST") {
        const body = await parseJsonBody(req);
        const results = await hybridQuery({
          query: body.query,
          limit: body.limit || 5,
          generateEmbeddings: body.generateEmbeddings !== false,
          customDb: db,
        });
        return sendJson({ results });
      }

      // 8. API: Graph Visualizer Data
      if (pathname === "/api/graph" && req.method === "GET") {
        const docs = db.prepare("SELECT id, title, path FROM documents").all();
        const edges = db.prepare("SELECT * FROM graph_edges").all();
        
        const nodes = docs.map((d) => ({
          id: d.id,
          label: d.title || d.path || d.id,
          type: "DOCUMENT",
        }));

        // Add code symbol nodes
        const symbolEdges = edges.filter((e) => e.relation_type === "DEFINES_SYMBOL");
        for (const se of symbolEdges) {
          if (!nodes.some((n) => n.id === se.target_id)) {
            nodes.push({
              id: se.target_id,
              label: se.target_id,
              type: "CODE_SYMBOL",
            });
          }
        }

        return sendJson({ nodes, edges });
      }

      // 9. API: Export Snapshot
      if (pathname === "/api/snapshot/export" && (req.method === "GET" || req.method === "POST")) {
        const snapshot = await exportSnapshot({ customDb: db, customBlobDir });
        return sendJson(snapshot);
      }

      // 10. API: Import Snapshot
      if (pathname === "/api/snapshot/import" && req.method === "POST") {
        const body = await parseJsonBody(req);
        const result = await importSnapshot({ customDb: db, customBlobDir, snapshotPathOrData: body });
        return sendJson(result);
      }

      // 404 Fallback
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } catch (err) {
      console.error("Admin server error:", err);
      sendJson({ error: err.message }, 500);
    }
  });

  return new Promise((resolve) => {
    server.listen(selectedPort, () => {
      const url = `http://localhost:${selectedPort}`;
      console.log(`🚀 memory-agent Web Admin Dashboard running at ${url}`);
      resolve({ server, port: selectedPort, url });
    });
  });
}
