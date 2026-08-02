import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDatabase, BLOBS_DIR } from "../db/database.js";
import { saveBlob, deleteBlob } from "../storage/blob_store.js";
import { normalizeContent, fetchUrlContent } from "./normalizer.js";
import { buildTripleHierarchy } from "./chunker.js";
import { embedText, embedBatch, vectorToBuffer } from "../ml/model_manager.js";
import { buildGraphEdges, saveGraphEdges } from "../graph/graph_extractor.js";
import { getConfig } from "../config/config_manager.js";

export async function ingestDocument({
  content,
  type = "text",
  path = null,
  title = null,
  customDb = null,
  customBlobDir = BLOBS_DIR,
  generateEmbeddings = true,
}) {
  const db = customDb || getDatabase();

  let effectiveType = type;
  let effectivePath = path;
  let effectiveTitle = title;

  if (type === "url") {
    const fetched = await fetchUrlContent(String(content));
    content = fetched.markdown;
    effectiveType = "text";
    effectiveTitle = title || fetched.title;
    effectivePath = path || fetched.finalUrl || content;
  } else if (type === "file") {
    const filePath = effectivePath || content;
    const needsRead = !content || content === filePath;
    if (needsRead && filePath) {
      const ext = extname(filePath).toLowerCase();
      const isBinary = [".pdf", ".docx", ".xlsx", ".xls"].includes(ext);
      content = await readFile(filePath, isBinary ? null : "utf-8");
      effectivePath = filePath;
    }
  }

  const { markdown, title: docTitle, metadata } = await normalizeContent({ content, type: effectiveType, path: effectivePath, title: effectiveTitle });
  if (type === "url") metadata.source_type = "url";

  const blobRes = await saveBlob(markdown, customBlobDir);
  const blobHash = blobRes.hash;

  const docId = `doc_${randomUUID().replace(/-/g, "").substring(0, 12)}`;
  const docPath = effectivePath || `virtual://${type}/${docId}`;
  const now = Date.now();

  const hierarchy = buildTripleHierarchy(markdown, docId, docTitle);

  if (generateEmbeddings && hierarchy.microChunks.length > 0) {
    const BATCH_SIZE = getConfig().batchSize || 12;

    // Smart Batching: Sort micro-chunks by character/token length to minimize ONNX zero-padding overhead
    const indexedItems = hierarchy.microChunks.map((micro, idx) => ({
      index: idx,
      text: micro.breadcrumbs
        ? `${micro.content}\n\nContext: ${docTitle} > ${micro.breadcrumbs}`
        : `${micro.content}\n\nContext: ${docTitle}`,
    }));

    indexedItems.sort((a, b) => a.text.length - b.text.length);

    for (let i = 0; i < indexedItems.length; i += BATCH_SIZE) {
      const batch = indexedItems.slice(i, i + BATCH_SIZE);
      const batchTexts = batch.map((item) => item.text);
      const batchVecs = await embedBatch(batchTexts, false);
      for (let j = 0; j < batchVecs.length; j++) {
        const origIdx = batch[j].index;
        hierarchy.microChunks[origIdx].vector = vectorToBuffer(batchVecs[j]);
      }
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
      const microChunks = db.prepare("SELECT id FROM micro_chunks WHERE doc_id = ?").all(existingDoc.id);
      for (const mc of microChunks) {
        try {
          db.prepare("DELETE FROM micro_chunks_fts WHERE id = ?").run(mc.id);
        } catch {}
      }
      db.prepare("DELETE FROM graph_edges WHERE source_id = ? OR target_id = ?").run(existingDoc.id, existingDoc.id);
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

    if (hierarchy.mediumChunks && hierarchy.mediumChunks.length > 0) {
      const insertMediumStmt = db.prepare(`
        INSERT INTO medium_chunks (id, section_id, doc_id, content, block_type, token_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?);
      `);
      for (const med of hierarchy.mediumChunks) {
        insertMediumStmt.run(med.id, med.section_id, med.doc_id, med.content, med.block_type, med.token_count, now);
      }
    }

    const insertMicroStmt = db.prepare(`
      INSERT INTO micro_chunks (id, section_id, doc_id, content, vector, token_count, medium_id)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `);
    const insertFtsStmt = db.prepare(`
      INSERT INTO micro_chunks_fts (id, content, breadcrumbs)
      VALUES (?, ?, ?);
    `);

    for (const micro of hierarchy.microChunks) {
      insertMicroStmt.run(micro.id, micro.section_id, micro.doc_id, micro.content, micro.vector, micro.token_count, micro.medium_id || null);
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
    docId,
    doc_id: docId,
    path: docPath,
    blobHash,
    blob_hash: blobHash,
    title: docTitle,
    sectionsCount: hierarchy.sections.length,
    sections_count: hierarchy.sections.length,
    microChunksCount: hierarchy.microChunks.length,
    micro_chunks_count: hierarchy.microChunks.length,
    deduplicated: blobRes.deduplicated,
  };
}

export async function deleteDocument(docIdOrPath, customDb = null, customBlobDir = BLOBS_DIR) {
  const db = customDb || getDatabase();
  const doc = db.prepare("SELECT * FROM documents WHERE id = ? OR path = ?").get(docIdOrPath, docIdOrPath);
  if (!doc) {
    return { deleted: false, reason: "Document not found" };
  }

  const microChunks = db.prepare("SELECT id FROM micro_chunks WHERE doc_id = ?").all(doc.id);

  // Collect every id owned by this document so we can purge dangling graph edges
  // (graph_edges has no FK constraints, so section/chunk/doc references would otherwise leak).
  const ownedIds = [doc.id];
  for (const table of ["sections", "medium_chunks", "micro_chunks"]) {
    const rows = db.prepare(`SELECT id FROM ${table} WHERE doc_id = ?`).all(doc.id);
    for (const r of rows) ownedIds.push(r.id);
  }

  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const mc of microChunks) {
      try {
        db.prepare("DELETE FROM micro_chunks_fts WHERE id = ?").run(mc.id);
      } catch {}
    }

    // Auto-clean Agent knowledge graph links pointing at this document.
    db.prepare("DELETE FROM knowledge_links WHERE doc_id = ?").run(doc.id);

    for (const id of ownedIds) {
      // GLOB: '*' suffix is exact (unlike LIKE, '_' stays literal in ids like doc_xxx).
      db.prepare(
        "DELETE FROM graph_edges WHERE source_id = ? OR target_id = ? OR source_id GLOB ? OR target_id GLOB ?"
      ).run(id, id, `${id}*`, `${id}*`);
    }

    db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);

    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }

  if (doc.blob_hash) {
    const refCount = db.prepare("SELECT COUNT(*) as cnt FROM documents WHERE blob_hash = ?").get(doc.blob_hash).cnt;
    if (refCount === 0) {
      await deleteBlob(doc.blob_hash, customBlobDir);
    }
  }

  return { deleted: true, docId: doc.id, title: doc.title, linksCleaned: true };
}
