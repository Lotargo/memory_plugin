import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { getDatabase, BLOBS_DIR } from "../db/database.js";
import { saveBlob, deleteBlob } from "../storage/blob_store.js";
import { normalizeContent, fetchUrlContent } from "./normalizer.js";
import { buildTripleHierarchy } from "./chunker.js";
import { embedBatch, vectorToBuffer } from "../ml/model_manager.js";
import { buildGraphEdges, saveGraphEdges } from "../graph/graph_extractor.js";
import { getConfig } from "../config/config_manager.js";
import { assertIngestPathAllowed } from "../security/path_guard.js";
import { logger } from "../logger.js";
import { GLOBAL_KEY } from "../memory.js";
import { addDocumentScope } from "../rag_scope.js";

export async function ingestDocument({
  content,
  type = "text",
  path = null,
  title = null,
  customDb = null,
  customBlobDir = BLOBS_DIR,
  generateEmbeddings = true,
  projectScope = GLOBAL_KEY,
}) {
  const db = customDb || await getDatabase();

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
      const safePath = assertIngestPathAllowed(filePath);
      const ext = extname(safePath).toLowerCase();
      const isBinary = [".pdf", ".docx", ".xlsx", ".xls"].includes(ext);
      content = await readFile(safePath, isBinary ? null : "utf-8");
      effectivePath = filePath;
    }
  }

  const { markdown, title: docTitle, metadata } = await normalizeContent({ content, type: effectiveType, path: effectivePath, title: effectiveTitle });
  if (type === "url") metadata.source_type = "url";

  const blobRes = await saveBlob(markdown, customBlobDir);
  const blobHash = blobRes.hash;

  const generatedDocId = `doc_${randomUUID().replace(/-/g, "").substring(0, 12)}`;
  const docPath = effectivePath || `virtual://${type}/${generatedDocId}`;
  const existingDoc = await db.prepare("SELECT * FROM documents WHERE path = ?").get(docPath);
  const docId = existingDoc?.id || generatedDocId;
  const now = Date.now();

  // Identical re-ingestion only adds the new project/global scope. Keeping the
  // existing document id preserves every Notebook link and avoids recomputing vectors.
  if (existingDoc && existingDoc.checksum === blobHash) {
    await db.exec("BEGIN IMMEDIATE;");
    try {
      await db
        .prepare("UPDATE documents SET title = ?, metadata_json = ?, updated_at = ? WHERE id = ?;")
        .run(docTitle, JSON.stringify(metadata), now, docId);
      const assignedScope = await addDocumentScope(db, docId, projectScope);
      await db.exec("COMMIT;");

      const sectionsRow = await db.prepare("SELECT COUNT(*) AS cnt FROM sections WHERE doc_id = ?").get(docId);
      const chunksRow = await db.prepare("SELECT COUNT(*) AS cnt FROM micro_chunks WHERE doc_id = ?").get(docId);
      if (getConfig().mode === "hybrid-sync") {
        try {
          const { exportDocumentData } = await import("./exporter.js");
          const { enqueueSyncTask } = await import("../db/sync_queue.js");
          await enqueueSyncTask("ingest_document", docId, await exportDocumentData(docId, db));
        } catch (err) {
          logger.error("Failed to queue document scope sync task:", err.message);
        }
      }
      return {
        docId,
        doc_id: docId,
        path: docPath,
        blobHash,
        blob_hash: blobHash,
        title: docTitle,
        sectionsCount: sectionsRow?.cnt || 0,
        sections_count: sectionsRow?.cnt || 0,
        microChunksCount: chunksRow?.cnt || 0,
        micro_chunks_count: chunksRow?.cnt || 0,
        deduplicated: true,
        projectScope: assignedScope,
      };
    } catch (err) {
      await db.exec("ROLLBACK;");
      throw new Error(`Ingestion scope transaction failed: ${err.message}`);
    }
  }

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
      micro.vector = Buffer.alloc(0);
    }
  }

  await db.exec("BEGIN IMMEDIATE;");
  try {
    if (existingDoc) {
      const ownedRows = await db.prepare(`
        SELECT id FROM sections WHERE doc_id = ?
        UNION SELECT id FROM medium_chunks WHERE doc_id = ?
        UNION SELECT id FROM micro_chunks WHERE doc_id = ?;
      `).all(docId, docId, docId);
      const ownedIds = [docId, ...ownedRows.map((row) => row.id)];
      try {
        await db.prepare("DELETE FROM micro_chunks_fts WHERE id IN (SELECT id FROM micro_chunks WHERE doc_id = ?);").run(docId);
      } catch {}
      if (ownedIds.length > 0) {
        const placeholders = ownedIds.map(() => "?").join(",");
        await db
          .prepare(`DELETE FROM graph_edges WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders});`)
          .run(...ownedIds, ...ownedIds);
      }
      await db.prepare("DELETE FROM micro_chunks WHERE doc_id = ?;").run(docId);
      await db.prepare("DELETE FROM medium_chunks WHERE doc_id = ?;").run(docId);
      await db.prepare("DELETE FROM sections WHERE doc_id = ?;").run(docId);
      await db.prepare(`
        UPDATE documents
        SET blob_hash = ?, title = ?, checksum = ?, toc_json = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?;
      `).run(blobHash, docTitle, blobHash, hierarchy.toc, JSON.stringify(metadata), now, docId);
    } else {
      await db.prepare(`
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
    }
    const assignedScope = await addDocumentScope(db, docId, projectScope);

    const insertSectionStmt = db.prepare(`
      INSERT INTO sections (id, doc_id, heading, breadcrumbs, content, token_count)
      VALUES (?, ?, ?, ?, ?, ?);
    `);
    for (const sec of hierarchy.sections) {
      await insertSectionStmt.run(sec.id, sec.doc_id, sec.heading, sec.breadcrumbs, sec.content, sec.token_count);
    }

    if (hierarchy.mediumChunks && hierarchy.mediumChunks.length > 0) {
      const insertMediumStmt = db.prepare(`
        INSERT INTO medium_chunks (id, section_id, doc_id, content, block_type, token_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?);
      `);
      for (const med of hierarchy.mediumChunks) {
        await insertMediumStmt.run(med.id, med.section_id, med.doc_id, med.content, med.block_type, med.token_count, now);
      }
    }

    const insertMicroStmt = db.prepare(`
      INSERT INTO micro_chunks (id, section_id, doc_id, content, vector, token_count, medium_id, retrieval_policy, policy_source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    const insertFtsStmt = db.prepare(`
      INSERT INTO micro_chunks_fts (id, content, breadcrumbs)
      VALUES (?, ?, ?);
    `);

    for (const micro of hierarchy.microChunks) {
      await insertMicroStmt.run(micro.id, micro.section_id, micro.doc_id, micro.content, micro.vector, micro.token_count, micro.medium_id || null, micro.retrieval_policy || "micro_chunk", micro.policy_source_id || null);
      await insertFtsStmt.run(micro.id, micro.content, micro.breadcrumbs);
    }

    const edges = buildGraphEdges(docId, hierarchy);
    await saveGraphEdges(db, edges);

    // Recreate graph projections for preserved Notebook links after replacing
    // the document's structural chunks. The knowledge_links rows themselves
    // remain stable because the document id remains stable.
    if (existingDoc) {
      const links = await db.prepare("SELECT * FROM knowledge_links WHERE doc_id = ?").all(docId);
      const insertLinkEdge = db.prepare(`
        INSERT OR IGNORE INTO graph_edges (source_id, target_id, relation_type, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?);
      `);
      for (const link of links) {
        const targetSpec = link.start_line
          ? `${docId}:L${link.start_line}-${link.end_line || link.start_line}`
          : docId;
        await insertLinkEdge.run(
          `fact:${link.fact_key}:${link.fact_text.substring(0, 30)}`,
          targetSpec,
          link.relation_type || "LINKS_TO",
          JSON.stringify({ linkId: link.id }),
          link.created_at || now
        );
      }
    }

    await db.exec("COMMIT;");
  } catch (err) {
    await db.exec("ROLLBACK;");
    throw new Error(`Ingestion transaction failed: ${err.message}`);
  }

  if (existingDoc?.blob_hash && existingDoc.blob_hash !== blobHash) {
    const refs = await db.prepare("SELECT COUNT(*) AS cnt FROM documents WHERE blob_hash = ?").get(existingDoc.blob_hash);
    if (!refs?.cnt) {
      try {
        await deleteBlob(existingDoc.blob_hash, customBlobDir);
      } catch {}
    }
  }

  if (getConfig().mode === "hybrid-sync") {
    try {
      const { exportDocumentData } = await import("./exporter.js");
      const { enqueueSyncTask } = await import("../db/sync_queue.js");
      const exportedData = await exportDocumentData(docId, db);
      await enqueueSyncTask("ingest_document", docId, exportedData);
    } catch (err) {
      logger.error("Failed to queue document ingest sync task:", err.message);
    }
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
    projectScope: projectScope || GLOBAL_KEY,
  };
}

export async function deleteDocument(docIdOrPath, customDb = null, customBlobDir = BLOBS_DIR) {
  const db = customDb || await getDatabase();
  const doc = await db.prepare("SELECT * FROM documents WHERE id = ? OR path = ? OR title = ?").get(docIdOrPath, docIdOrPath, docIdOrPath);
  if (!doc) {
    return { deleted: false, reason: "Document not found" };
  }

  // Collect every id owned by this document so we can purge dangling graph edges
  // (graph_edges has no FK constraints, so section/chunk/doc references would otherwise leak).
  const ownedIds = [doc.id];
  for (const table of ["sections", "medium_chunks", "micro_chunks"]) {
    const rows = await db.prepare(`SELECT id FROM ${table} WHERE doc_id = ?`).all(doc.id);
    for (const r of rows) ownedIds.push(r.id);
  }

  await db.exec("BEGIN IMMEDIATE;");
  try {
    try {
      await db.prepare("DELETE FROM micro_chunks_fts WHERE id IN (SELECT id FROM micro_chunks WHERE doc_id = ?);").run(doc.id);
    } catch {}

    // Auto-clean Agent knowledge graph links pointing at this document.
    await db.prepare("DELETE FROM knowledge_links WHERE doc_id = ?").run(doc.id);

    for (const id of ownedIds) {
      // GLOB: '*' suffix is exact (unlike LIKE, '_' stays literal in ids like doc_xxx).
      await db.prepare(
        "DELETE FROM graph_edges WHERE source_id = ? OR target_id = ? OR source_id GLOB ? OR target_id GLOB ?"
      ).run(id, id, `${id}*`, `${id}*`);
    }

    await db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);

    await db.exec("COMMIT;");
  } catch (err) {
    await db.exec("ROLLBACK;");
    throw err;
  }

  if (doc.blob_hash) {
    const refCountRow = await db.prepare("SELECT COUNT(*) as cnt FROM documents WHERE blob_hash = ?").get(doc.blob_hash);
    const refCount = refCountRow ? refCountRow.cnt : 0;
    if (refCount === 0) {
      await deleteBlob(doc.blob_hash, customBlobDir);
    }
  }

  if (getConfig().mode === "hybrid-sync") {
    try {
      const { enqueueSyncTask } = await import("../db/sync_queue.js");
      await enqueueSyncTask("delete_document", docIdOrPath);
    } catch (err) {
      logger.error("Failed to queue document delete sync task:", err.message);
    }
  }

  return { deleted: true, docId: doc.id, title: doc.title, linksCleaned: true };
}

export async function reindexEmbeddings({
  model = null,
  dimension = null,
  customDb = null,
  embedFn = null,
  progressCallback = null,
} = {}) {
  const db = customDb || await getDatabase();
  const config = getConfig();
  const targetModel = model || config.embeddingModel || "Xenova/multilingual-e5-small";
  const targetDim = dimension !== null && dimension !== undefined ? Number(dimension) : (config.vectorDimension || 0);

  const countRow = await db.prepare("SELECT COUNT(*) as cnt FROM micro_chunks").get();
  const total = countRow ? countRow.cnt : 0;
  if (total === 0) return { reindexed: 0, documentsAffected: 0, model: targetModel, dimension: targetDim };

  const rows = await db.prepare(`
    SELECT m.id, m.doc_id, m.content, s.breadcrumbs, d.title as doc_title
    FROM micro_chunks m
    LEFT JOIN sections s ON m.section_id = s.id
    LEFT JOIN documents d ON m.doc_id = d.id
    ORDER BY m.doc_id, m.id
  `).all();

  const items = rows.map((r) => ({
    id: r.id,
    doc_id: r.doc_id,
    text: r.breadcrumbs
      ? `${r.content}\n\nContext: ${r.doc_title || ""} > ${r.breadcrumbs}`
      : `${r.content}\n\nContext: ${r.doc_title || ""}`,
  }));

  const defaultEmbed = async (texts) =>
    embedBatch(texts, false, targetModel, progressCallback, null, {}, targetDim || null);
  const embed = embedFn || defaultEmbed;

  const BATCH_SIZE = config.batchSize || 12;
  const vectors = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchVecs = await embed(batch.map((b) => b.text));
    if (!batchVecs || batchVecs.length !== batch.length) {
      throw new Error(`Embedding batch returned ${batchVecs ? batchVecs.length : 0} vectors, expected ${batch.length}`);
    }
    for (let j = 0; j < batch.length; j++) {
      vectors.push({ id: batch[j].id, doc_id: batch[j].doc_id, vector: vectorToBuffer(batchVecs[j]) });
    }
    if (progressCallback) progressCallback({ done: vectors.length, total });
  }

  await db.exec("BEGIN IMMEDIATE;");
  try {
    const stmt = db.prepare("UPDATE micro_chunks SET vector = ? WHERE id = ?;");
    for (const v of vectors) {
      await stmt.run(v.vector, v.id);
    }
    await db.exec("COMMIT;");
  } catch (err) {
    await db.exec("ROLLBACK;");
    throw new Error(`Re-index transaction failed: ${err.message}`);
  }

  const affectedDocIds = [...new Set(items.map((i) => i.doc_id).filter(Boolean))];

  if (config.mode === "hybrid-sync") {
    try {
      const { enqueueSyncTask } = await import("../db/sync_queue.js");
      const { exportDocumentData } = await import("./exporter.js");
      for (const docId of affectedDocIds) {
        const exportedData = await exportDocumentData(docId, db);
        await enqueueSyncTask("ingest_document", docId, exportedData);
      }
    } catch (err) {
      logger.error("Failed to queue document re-index sync tasks:", err.message);
    }
  }

  return {
    reindexed: vectors.length,
    documentsAffected: affectedDocIds.length,
    model: targetModel,
    dimension: targetDim,
  };
}
