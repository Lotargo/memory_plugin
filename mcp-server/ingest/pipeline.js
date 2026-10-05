import { randomUUID } from "node:crypto";
import { getDatabase, BLOBS_DIR } from "../db/database.js";
import { saveBlob, deleteBlob } from "../storage/blob_store.js";
import { buildTripleHierarchy } from "./chunker.js";
import { embedBatch, vectorToBuffer } from "../ml/model_manager.js";
import { buildGraphEdges, saveGraphEdges } from "../graph/graph_extractor.js";
import { getConfig } from "../config/config_manager.js";
import { logger } from "../logger.js";
import { normalizeIngestionSource } from './staged.js';
import { GLOBAL_KEY, MEMORY_DIR } from "../memory.js";
import { withSnapshotLock } from '../storage/snapshot_lock.js';
import { hasKnowledgeSchema, rebuildLinkProjections } from '../storage/knowledge_schema.js';
import { addDocumentScope } from "../rag_scope.js";

export const RAG_NOTE_KINDS = Object.freeze(["decision", "research", "context", "handoff", "note"]);
const RAG_NOTE_KIND_SET = new Set(RAG_NOTE_KINDS);

export function normalizeNoteKind(kind = "note") {
  const normalized = String(kind || "note").trim().toLowerCase();
  return RAG_NOTE_KIND_SET.has(normalized) ? normalized : "note";
}

export function normalizeNoteTags(tags) {
  const values = Array.isArray(tags) ? tags : String(tags || "").split(",");
  return [...new Set(values.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].sort();
}

export function createNoteVirtualPath() {
  return `memory://note/${randomUUID()}`;
}
function assertLegacyPublication(sql, current, metadata, title, blobHash, managed) {
  if(!current||managed)return;
  let old;try{old=JSON.parse(current.metadata_json||'{}');}catch{old={};}
  if(old.source_type && old.source_type!==metadata.source_type)throw Object.assign(new Error('Source type cannot change implicitly. Use managed refresh or a new source.'),{code:'INVALID'});
  const owners=sql.prepare('SELECT COUNT(*) AS n FROM document_scopes WHERE doc_id=?').get(current.id).n;
  if(owners>1&&(current.checksum!==blobHash||current.title!==title||JSON.stringify(old)!==JSON.stringify(metadata)))throw Object.assign(new Error('Shared source update requires a prepared preview. Use manage_knowledge_content or knowledge content prepare/apply.'),{code:'CONFIRMATION'});
}

export async function ingestDocument({
  content,
  type = "text",
  path = null,
  title = null,
  customDb = null,
  customBlobDir = BLOBS_DIR,
  generateEmbeddings = true,
  projectScope = GLOBAL_KEY,
  metadataOverrides = null,
  prepared = null,
  beforePublish = null,
  publicationEffects = null,
  forceReindex = false,
}) {
  const db = customDb || await getDatabase();

  const normalized = prepared || await normalizeIngestionSource({ content, type, path, title, metadataOverrides });
  const effectivePath = normalized.path;
  const markdown = normalized.markdown;
  const docTitle = normalized.title;
  const metadata = normalized.metadata;

  const blobRes = await saveBlob(markdown, customBlobDir);
  const blobHash = blobRes.hash;

  const generatedDocId = prepared?.docId || `doc_${randomUUID().replace(/-/g, "").substring(0, 12)}`;
  const docPath = effectivePath || `virtual://${type}/${generatedDocId}`;
  const existingDoc = await db.prepare("SELECT * FROM documents WHERE path = ?").get(docPath);
  const docId = existingDoc?.id || generatedDocId;
  const now = Date.now();
  if(!prepared && existingDoc?.checksum===blobHash && existingDoc.title===docTitle){
    let old;try{old=JSON.parse(existingDoc.metadata_json||'{}');}catch{old={};}
    Object.assign(metadata,{...old,...metadata});
  }
  if(!prepared && existingDoc && existingDoc.title!==docTitle)forceReindex=true;

  if (existingDoc && existingDoc.checksum === blobHash && !forceReindex) {
    return withSnapshotLock(MEMORY_DIR, async () => {
    const current = await db.prepare('SELECT * FROM documents WHERE path=?').get(docPath);
    if (JSON.stringify(current) !== JSON.stringify(existingDoc)) throw Object.assign(new Error('Source changed during preparation. Retry ingestion.'), { code: 'CONFLICT' });
    await saveBlob(markdown, customBlobDir);
    let assignedScope = projectScope || GLOBAL_KEY;
    await db.exec("BEGIN IMMEDIATE;");
    try {
      assertLegacyPublication(db.localDb,current,metadata,docTitle,blobHash,beforePublish);
      beforePublish?.(db.localDb);
      await db.prepare("UPDATE documents SET title = ?, metadata_json = ?, updated_at = ? WHERE id = ?;")
        .run(docTitle, JSON.stringify(metadata), now, docId);
      assignedScope = await addDocumentScope(db, docId, projectScope);
      publicationEffects?.(db.localDb);
      await db.exec("COMMIT;");
    } catch (err) {
      try { await db.exec("ROLLBACK;"); } catch {}
      if (err.code) throw err;
      throw new Error(`Ingestion scope transaction failed: ${err.message}`);
    }

    const sectionsRow = await db.prepare("SELECT COUNT(*) AS cnt FROM sections WHERE doc_id = ?").get(docId);
    const chunksRow = await db.prepare("SELECT COUNT(*) AS cnt FROM micro_chunks WHERE doc_id = ?").get(docId);
    return {
      docId, doc_id: docId, path: docPath, blobHash, blob_hash: blobHash, title: docTitle,
      sectionsCount: sectionsRow?.cnt || 0, sections_count: sectionsRow?.cnt || 0,
      microChunksCount: chunksRow?.cnt || 0, micro_chunks_count: chunksRow?.cnt || 0,
      deduplicated: true, projectScope: assignedScope,
    };
    });
  }

  const hierarchy = prepared?.hierarchy || buildTripleHierarchy(markdown, docId, docTitle);

  if (prepared) {
    // Vectors belong to this exact prepared text/title and were computed before the lock.
  } else if (generateEmbeddings && hierarchy.microChunks.length > 0) {
    const embeddingConfig=getConfig(),model=embeddingConfig.embeddingModel||'Xenova/multilingual-e5-small',dimension=embeddingConfig.vectorDimension||null;
    const BATCH_SIZE = embeddingConfig.batchSize || 12;
    let actualDimension=null;
    const indexedItems = hierarchy.microChunks.map((micro, idx) => ({
      index: idx,
      text: micro.breadcrumbs
        ? `${micro.content}\n\nContext: ${docTitle} > ${micro.breadcrumbs}`
        : `${micro.content}\n\nContext: ${docTitle}`,
    }));
    indexedItems.sort((a, b) => a.text.length - b.text.length);
    for (let i = 0; i < indexedItems.length; i += BATCH_SIZE) {
      const batch = indexedItems.slice(i, i + BATCH_SIZE);
      const batchVecs = await embedBatch(batch.map((item) => item.text), false,model,null,null,{},dimension);
      if(batchVecs.length!==batch.length||batchVecs.some(vector=>!vector?.length||[...vector].some(value=>!Number.isFinite(value))))throw Object.assign(new Error('Incomplete embedding batch.'),{code:'EMBEDDING_FAILED'});
      for (let j = 0; j < batchVecs.length; j++) {
        actualDimension??=batchVecs[j].length;
        if(actualDimension!==batchVecs[j].length)throw Object.assign(new Error('Mixed embedding dimensions.'),{code:'EMBEDDING_FAILED'});
        hierarchy.microChunks[batch[j].index].vector = vectorToBuffer(batchVecs[j]);
      }
    }
    metadata.index_state='dense';metadata.embedding_provenance={model,dimension:actualDimension,recordedAt:Date.now()};
  } else {
    for (const micro of hierarchy.microChunks) micro.vector = Buffer.alloc(0);
    metadata.index_state='lexical-only';metadata.embedding_provenance=null;
  }

  return withSnapshotLock(MEMORY_DIR, async () => {
  const current = await db.prepare('SELECT * FROM documents WHERE path=?').get(docPath);
  if (JSON.stringify(current || null) !== JSON.stringify(existingDoc || null)) throw Object.assign(new Error('Source changed during preparation. Retry ingestion.'), { code: 'CONFLICT' });
  await saveBlob(markdown, customBlobDir);
  let assignedScope = projectScope || GLOBAL_KEY;
  await db.exec("BEGIN IMMEDIATE;");
  try {
    assertLegacyPublication(db.localDb,current,metadata,docTitle,blobHash,beforePublish);
    beforePublish?.(db.localDb);
    if (existingDoc) {
      const ownedRows = await db.prepare(`
        SELECT id FROM sections WHERE doc_id = ?
        UNION SELECT id FROM medium_chunks WHERE doc_id = ?
        UNION SELECT id FROM micro_chunks WHERE doc_id = ?;
      `).all(docId, docId, docId);
      const ownedIds = [docId, ...ownedRows.map((row) => row.id)];
      await db.prepare("DELETE FROM micro_chunks_fts WHERE id IN (SELECT id FROM micro_chunks WHERE doc_id = ?);").run(docId);
      if (ownedIds.length > 0) {
        const placeholders = ownedIds.map(() => "?").join(",");
        await db.prepare(`DELETE FROM graph_edges WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders});`)
          .run(...ownedIds, ...ownedIds);
      }
      await db.prepare("DELETE FROM micro_chunks WHERE doc_id = ?;").run(docId);
      await db.prepare("DELETE FROM medium_chunks WHERE doc_id = ?;").run(docId);
      await db.prepare("DELETE FROM sections WHERE doc_id = ?;").run(docId);
      await db.prepare(`UPDATE documents
        SET blob_hash = ?, title = ?, checksum = ?, toc_json = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?;`).run(blobHash, docTitle, blobHash, hierarchy.toc, JSON.stringify(metadata), now, docId);
    } else {
      await db.prepare(`INSERT INTO documents
        (id, path, blob_hash, title, checksum, toc_json, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`)
        .run(docId, docPath, blobHash, docTitle, blobHash, hierarchy.toc, JSON.stringify(metadata), now, now);
    }
    assignedScope = await addDocumentScope(db, docId, projectScope);

    const insertSectionStmt = db.prepare(`INSERT INTO sections
      (id, doc_id, heading, breadcrumbs, content, token_count) VALUES (?, ?, ?, ?, ?, ?);`);
    for (const sec of hierarchy.sections) {
      await insertSectionStmt.run(sec.id, sec.doc_id, sec.heading, sec.breadcrumbs, sec.content, sec.token_count);
    }

    if (hierarchy.mediumChunks?.length) {
      const insertMediumStmt = db.prepare(`INSERT INTO medium_chunks
        (id, section_id, doc_id, content, block_type, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?);`);
      for (const med of hierarchy.mediumChunks) {
        await insertMediumStmt.run(med.id, med.section_id, med.doc_id, med.content, med.block_type, med.token_count, now);
      }
    }

    const insertMicroStmt = db.prepare(`INSERT INTO micro_chunks
      (id, section_id, doc_id, content, vector, token_count, medium_id, retrieval_policy, policy_source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`);
    const insertFtsStmt = db.prepare(`INSERT INTO micro_chunks_fts (id, content, breadcrumbs) VALUES (?, ?, ?);`);
    for (const micro of hierarchy.microChunks) {
      await insertMicroStmt.run(micro.id, micro.section_id, micro.doc_id, micro.content, micro.vector, micro.token_count, micro.medium_id || null, micro.retrieval_policy || "micro_chunk", micro.policy_source_id || null);
      await insertFtsStmt.run(micro.id, micro.content, micro.breadcrumbs);
    }

    await saveGraphEdges(db, buildGraphEdges(docId, hierarchy));

    if (existingDoc) {
      const links = await db.prepare("SELECT * FROM knowledge_links WHERE doc_id = ?").all(docId);
      const insertLinkEdge = db.prepare(`INSERT OR IGNORE INTO graph_edges
        (source_id, target_id, relation_type, metadata_json, created_at) VALUES (?, ?, ?, ?, ?);`);
      for (const link of hasKnowledgeSchema(db) ? [] : links) {
        const targetSpec = link.start_line ? `${docId}:L${link.start_line}-${link.end_line || link.start_line}` : docId;
        await insertLinkEdge.run(`fact:${link.fact_key}:${link.fact_text.substring(0, 30)}`, targetSpec, link.relation_type || "LINKS_TO", JSON.stringify({ linkId: link.id }), link.created_at || now);
      }
    }

    publicationEffects?.(db.localDb);
    if (hasKnowledgeSchema(db)) rebuildLinkProjections(db.localDb);
    await db.exec("COMMIT;");
  } catch (err) {
    try { await db.exec("ROLLBACK;"); } catch {}
    if (err.code) throw err;
    throw new Error(`Ingestion transaction failed: ${err.message}`);
  }

  if (existingDoc?.blob_hash && existingDoc.blob_hash !== blobHash) {
    const refs = await db.prepare("SELECT COUNT(*) AS cnt FROM documents WHERE blob_hash = ?").get(existingDoc.blob_hash);
    if (!refs?.cnt) {
      try { await deleteBlob(existingDoc.blob_hash, customBlobDir); } catch {}
    }
  }

  return {
    docId, doc_id: docId, path: docPath, blobHash, blob_hash: blobHash, title: docTitle,
    sectionsCount: hierarchy.sections.length, sections_count: hierarchy.sections.length,
    microChunksCount: hierarchy.microChunks.length, micro_chunks_count: hierarchy.microChunks.length,
    deduplicated: blobRes.deduplicated, projectScope: assignedScope,
  };
  });
}

export async function ingestNote({
  title,
  content,
  kind = "note",
  tags = null,
  customDb = null,
  customBlobDir = BLOBS_DIR,
  generateEmbeddings = true,
  projectScope = GLOBAL_KEY,
}) {
  const noteTitle = String(title ?? "").trim();
  const noteContent = String(content ?? "");
  if (!noteTitle) throw new Error("RAG Memory Note title must not be empty");
  if (!noteContent.trim()) throw new Error("RAG Memory Note content must not be empty");

  const noteKind = normalizeNoteKind(kind);
  const normalizedTags = normalizeNoteTags(tags);
  const notePath = createNoteVirtualPath();
  const noteMetadata = { source_type: "note", note_kind: noteKind, tags: normalizedTags };

  const result = await ingestDocument({
    content: noteContent,
    type: "text",
    path: notePath,
    title: noteTitle,
    customDb,
    customBlobDir,
    generateEmbeddings,
    projectScope,
    metadataOverrides: noteMetadata,
  });

  return {
    ...result,
    sourceType: "note", source_type: "note", kind: noteKind, noteKind, note_kind: noteKind,
    tags: normalizedTags, metadata: noteMetadata,
  };
}

export async function deleteDocument(docIdOrPath, customDb = null, customBlobDir = BLOBS_DIR) {
  return withSnapshotLock(MEMORY_DIR, () => deleteDocumentLocked(docIdOrPath, customDb, customBlobDir));
}
async function deleteDocumentLocked(docIdOrPath, customDb = null, customBlobDir = BLOBS_DIR) {
  const db = customDb || await getDatabase();
  const rows = await db.prepare('SELECT * FROM documents WHERE id=? OR path=? OR title=? LIMIT 2').all(docIdOrPath,docIdOrPath,docIdOrPath);
  const doc = rows.find(row => row.id === docIdOrPath) || rows.find(row => row.path === docIdOrPath) || (rows.length === 1 ? rows[0] : null);
  if (!rows.length) return {deleted:false,reason:'Document not found'};
  if (!doc) throw Object.assign(new Error('Ambiguous document title; use exact docId.'),{code:'INVALID'});
  const {removalState,publishRemoval} = await import('../storage/knowledge_removal.js');
  return publishRemoval(db,removalState(db.localDb,doc.id),customBlobDir);
}

export async function reindexEmbeddings({
  model = null,
  dimension = null,
  customDb = null,
  embedFn = null,
  progressCallback = null,
  modelOptions = {},
  beforePublish = null,
} = {}) {
  const db = customDb || await getDatabase();
  const config = getConfig();
  const targetModel = model || config.embeddingModel || "Xenova/multilingual-e5-small";
  const targetDim = dimension !== null && dimension !== undefined ? Number(dimension) : (config.vectorDimension || 0);

  const countRow = await db.prepare("SELECT COUNT(*) as cnt FROM micro_chunks").get();
  const total = countRow ? countRow.cnt : 0;
  if (total === 0) return { reindexed: 0, documentsAffected: 0, model: targetModel, dimension: targetDim };

  const rows = await db.prepare(`SELECT m.id, m.doc_id, m.content, s.breadcrumbs, d.title as doc_title
    FROM micro_chunks m
    LEFT JOIN sections s ON m.section_id = s.id
    LEFT JOIN documents d ON m.doc_id = d.id
    ORDER BY m.doc_id, m.id`).all();
  const items = rows.map((row) => ({
    id: row.id,
    doc_id: row.doc_id,
    text: row.breadcrumbs
      ? `${row.content}\n\nContext: ${row.doc_title || ""} > ${row.breadcrumbs}`
      : `${row.content}\n\nContext: ${row.doc_title || ""}`,
  }));

  const defaultEmbed = async (texts) => embedBatch(texts, false, targetModel, progressCallback, null, {}, targetDim || null, modelOptions);
  const embed = embedFn || defaultEmbed;
  const BATCH_SIZE = config.batchSize || 12;
  const vectors = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchVecs = await embed(batch.map((item) => item.text));
    if (!batchVecs || batchVecs.length !== batch.length) {
      throw new Error(`Embedding batch returned ${batchVecs ? batchVecs.length : 0} vectors, expected ${batch.length}`);
    }
    for (let j = 0; j < batch.length; j++) vectors.push({ id: batch[j].id, doc_id: batch[j].doc_id, vector: vectorToBuffer(batchVecs[j]) });
    if (progressCallback) progressCallback({ done: vectors.length, total });
  }

  const affectedDocIds = [...new Set(items.map((item) => item.doc_id).filter(Boolean))];
  const itemDocs=new Map(items.map(item=>[item.id,item.doc_id])),docDimensions=new Map();
  for(const vector of vectors){const docId=itemDocs.get(vector.id);if(!docDimensions.has(docId))docDimensions.set(docId,new Set());docDimensions.get(docId).add(vector.vector.length/4);}

  return withSnapshotLock(MEMORY_DIR, async () => {
  const current = await db.prepare(`SELECT m.id, m.doc_id, m.content, s.breadcrumbs, d.title as doc_title
    FROM micro_chunks m LEFT JOIN sections s ON m.section_id=s.id LEFT JOIN documents d ON m.doc_id=d.id ORDER BY m.doc_id,m.id`).all();
  if (JSON.stringify(current) !== JSON.stringify(rows)) throw Object.assign(new Error('Index changed during embedding preparation. Retry reindexing.'), { code: 'CONFLICT' });
  await beforePublish?.();
  await db.exec("BEGIN IMMEDIATE;");
  try {
    const stmt = db.prepare("UPDATE micro_chunks SET vector = ? WHERE id = ?;");
    for (const vector of vectors) await stmt.run(vector.vector, vector.id);
    const touchedAt = Date.now();
    const touchDoc = db.prepare("UPDATE documents SET updated_at = ?,metadata_json = ? WHERE id = ?;");
    for (const docId of affectedDocIds) {
      const row = await db.prepare('SELECT metadata_json FROM documents WHERE id=?').get(docId);
      let metadata; try { metadata = JSON.parse(row.metadata_json || '{}'); } catch { metadata = {}; }
      const dimensions = [...docDimensions.get(docId)];
      metadata.index_state = dimensions.length === 1 ? 'dense' : 'UNKNOWN';
      metadata.embedding_provenance = dimensions.length === 1 ? { model: targetModel, dimension: dimensions[0], recordedAt: touchedAt } : null;
      await touchDoc.run(touchedAt, JSON.stringify(metadata), docId);
    }
    await db.exec("COMMIT;");
  } catch (err) {
    try { await db.exec("ROLLBACK;"); } catch {}
    throw new Error(`Re-index transaction failed: ${err.message}`);
  }

  return { reindexed: vectors.length, documentsAffected: affectedDocIds.length, model: targetModel, dimension: targetDim };
  });
}
