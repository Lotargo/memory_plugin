import { randomUUID } from "node:crypto";
import { getDatabase } from "../db/database.js";
import { saveBlob } from "../storage/blob_store.js";
import { normalizeContent } from "./normalizer.js";
import { buildTripleHierarchy } from "./chunker.js";
import { embedText, vectorToBuffer } from "../ml/model_manager.js";
import { buildGraphEdges, saveGraphEdges } from "../graph/graph_extractor.js";

export async function ingestDocument({
  content,
  type = "text",
  path = null,
  title = null,
  customDb = null,
  generateEmbeddings = true,
}) {
  const db = customDb || getDatabase();

  const { markdown, title: docTitle, metadata } = normalizeContent({ content, type, path, title });

  const blobRes = await saveBlob(markdown);
  const blobHash = blobRes.hash;

  const docId = `doc_${randomUUID().replace(/-/g, "").substring(0, 12)}`;
  const docPath = path || `virtual://${type}/${docId}`;
  const now = Date.now();

  const hierarchy = buildTripleHierarchy(markdown, docId, docTitle);

  if (generateEmbeddings) {
    for (const micro of hierarchy.microChunks) {
      const vec = await embedText(micro.content, false);
      micro.vector = vectorToBuffer(vec);
    }
  } else {
    for (const micro of hierarchy.microChunks) {
      micro.vector = Buffer.alloc(384 * 4);
    }
  }

  db.exec("BEGIN IMMEDIATE;");
  try {
    const existingDoc = db.prepare("SELECT id FROM documents WHERE path = ?").get(docPath);
    if (existingDoc) {
      db.prepare("DELETE FROM documents WHERE id = ?").run(existingDoc.id);
    }

    db.prepare(`
      INSERT INTO documents (id, path, blob_hash, title, checksum, toc_json, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      docId,
      docPath,
      blobHash,
      docTitle,
      blobHash,
      hierarchy.toc,
      JSON.stringify(metadata),
      now,
      now
    );

    const insertSectionStmt = db.prepare(`
      INSERT INTO sections (id, doc_id, heading, breadcrumbs, content, token_count)
      VALUES (?, ?, ?, ?, ?, ?);
    `);
    for (const sec of hierarchy.sections) {
      insertSectionStmt.run(sec.id, sec.doc_id, sec.heading, sec.breadcrumbs, sec.content, sec.token_count);
    }

    const insertMicroStmt = db.prepare(`
      INSERT INTO micro_chunks (id, section_id, doc_id, content, vector, token_count)
      VALUES (?, ?, ?, ?, ?, ?);
    `);
    const insertFtsStmt = db.prepare(`
      INSERT INTO micro_chunks_fts (id, content, breadcrumbs)
      VALUES (?, ?, ?);
    `);

    for (const micro of hierarchy.microChunks) {
      insertMicroStmt.run(micro.id, micro.section_id, micro.doc_id, micro.content, micro.vector, micro.token_count);
      insertFtsStmt.run(micro.id, micro.content, micro.breadcrumbs);
    }

    const edges = buildGraphEdges(docId, hierarchy);
    saveGraphEdges(db, edges);

    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw new Error(`Ingestion transaction failed: ${err.message}`);
  }

  return {
    doc_id: docId,
    path: docPath,
    blob_hash: blobHash,
    title: docTitle,
    sections_count: hierarchy.sections.length,
    micro_chunks_count: hierarchy.microChunks.length,
  };
}
