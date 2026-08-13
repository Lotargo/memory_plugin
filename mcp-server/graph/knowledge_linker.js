import { getDatabase } from "../db/database.js";
import { randomUUID } from "node:crypto";
import { GLOBAL_KEY } from "../memory.js";

export async function queueDocumentSyncIfNeeded(db, docId) {
  try {
    const { getConfig } = await import("../config/config_manager.js");
    if (getConfig().mode !== "hybrid-sync") return;
    const { exportDocumentData } = await import("../ingest/exporter.js");
    const { enqueueSyncTask } = await import("../db/sync_queue.js");
    await enqueueSyncTask("ingest_document", docId, await exportDocumentData(docId, db));
  } catch (err) {
    console.warn(`Failed to queue linked RAG document sync for ${docId}: ${err.message}`);
  }
}

export async function linkFactToDocument({
  factKey,
  factText,
  docId,
  sectionId = null,
  startLine = null,
  endLine = null,
  relationType = "LINKS_TO",
  metadata = null,
}) {
  const db = await getDatabase();
  const id = `link_${randomUUID().substring(0, 12)}`;
  const now = Date.now();

  const allowedScopes = factKey === GLOBAL_KEY ? [GLOBAL_KEY] : [GLOBAL_KEY, factKey];
  const placeholders = allowedScopes.map(() => "?").join(",");
  const doc = await db
    .prepare(`
      SELECT d.id, d.title, d.path
      FROM documents d
      WHERE (d.id = ? OR d.path = ? OR d.title = ?)
        AND EXISTS (
          SELECT 1 FROM document_scopes ds
          WHERE ds.doc_id = d.id AND ds.scope_key IN (${placeholders})
        )
    `)
    .get(docId, docId, docId, ...allowedScopes);

  if (!doc) {
    throw new Error(`Target document not found in knowledge base for link: ${docId}`);
  }

  const stmt = db.prepare(`
    INSERT INTO knowledge_links (id, fact_key, fact_text, doc_id, section_id, start_line, end_line, relation_type, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  await stmt.run(
    id,
    factKey,
    factText,
    doc.id,
    sectionId || null,
    startLine ? Number(startLine) : null,
    endLine ? Number(endLine) : null,
    relationType || "LINKS_TO",
    metadata ? JSON.stringify(metadata) : null,
    now
  );

  const edgeStmt = db.prepare(`
    INSERT OR IGNORE INTO graph_edges (source_id, target_id, relation_type, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const targetSpec = startLine ? `${doc.id}:L${startLine}-${endLine || startLine}` : doc.id;
  await edgeStmt.run(`fact:${factKey}:${factText.substring(0, 30)}`, targetSpec, relationType, JSON.stringify({ linkId: id }), now);
  await queueDocumentSyncIfNeeded(db, doc.id);

  return {
    linkId: id,
    factKey,
    factText,
    docId: doc.id,
    docTitle: doc.title || doc.path,
    startLine,
    endLine,
    relationType,
  };
}

export async function getLinksForFact(factKey, factText) {
  const db = await getDatabase();
  const stmt = db.prepare(`
    SELECT k.*, d.title as doc_title, d.path as doc_path
    FROM knowledge_links k
    JOIN documents d ON k.doc_id = d.id
    WHERE k.fact_key = ? AND (k.fact_text LIKE ? OR ? LIKE '%' || k.fact_text || '%')
    ORDER BY k.created_at DESC
  `);
  const queryPattern = `%${factText.substring(0, 20)}%`;
  return await stmt.all(factKey, queryPattern, factText);
}

export async function getLinksForDoc(docId, scopeKeys = null) {
  const db = await getDatabase();
  const scoped = Array.isArray(scopeKeys) && scopeKeys.length > 0;
  const scopeClause = scoped
    ? `AND k.fact_key IN (${scopeKeys.map(() => "?").join(",")})
      AND EXISTS (
        SELECT 1 FROM document_scopes ds
        WHERE ds.doc_id = d.id AND ds.scope_key IN (${scopeKeys.map(() => "?").join(",")})
      )`
    : "";
  const stmt = db.prepare(`
    SELECT k.*, d.title as doc_title, d.path as doc_path
    FROM knowledge_links k
    JOIN documents d ON k.doc_id = d.id
    WHERE (k.doc_id = ? OR d.path = ? OR d.title = ?)
    ${scopeClause}
    ORDER BY k.created_at DESC
  `);
  return await stmt.all(
    docId,
    docId,
    docId,
    ...(scoped ? [...scopeKeys, ...scopeKeys] : [])
  );
}

export async function listAllLinks(factKey = null) {
  const db = await getDatabase();
  let sql = `
    SELECT k.*, d.title as doc_title, d.path as doc_path
    FROM knowledge_links k
    JOIN documents d ON k.doc_id = d.id
  `;
  const params = [];
  if (factKey) {
    sql += " WHERE k.fact_key = ?";
    params.push(factKey);
  }
  sql += " ORDER BY k.created_at DESC";
  return await db.prepare(sql).all(...params);
}

export async function moveKnowledgeScope(db, sourceKey, targetKey) {
  if (!sourceKey || !targetKey || sourceKey === targetKey) {
    return { movedLinks: 0, movedDocuments: 0 };
  }

  const links = await db.prepare("SELECT * FROM knowledge_links WHERE fact_key = ?").all(sourceKey);
  const scopedDocs = await db.prepare("SELECT doc_id, created_at FROM document_scopes WHERE scope_key = ?").all(sourceKey);
  const docIds = new Set([...scopedDocs.map((row) => row.doc_id), ...links.map((link) => link.doc_id)]);

  for (const docId of docIds) {
    await db
      .prepare("INSERT OR IGNORE INTO document_scopes (doc_id, scope_key, created_at) VALUES (?, ?, ?)")
      .run(docId, targetKey, Date.now());
  }
  await db.prepare("DELETE FROM document_scopes WHERE scope_key = ?").run(sourceKey);

  for (const link of links) {
    const oldSource = `fact:${sourceKey}:${link.fact_text.substring(0, 30)}`;
    const targetSpec = link.start_line
      ? `${link.doc_id}:L${link.start_line}-${link.end_line || link.start_line}`
      : link.doc_id;
    await db
      .prepare("DELETE FROM graph_edges WHERE source_id = ? AND target_id = ? AND relation_type = ?")
      .run(oldSource, targetSpec, link.relation_type || "LINKS_TO");
    const newSource = `fact:${targetKey}:${link.fact_text.substring(0, 30)}`;
    await db.prepare(`
      INSERT OR IGNORE INTO graph_edges (source_id, target_id, relation_type, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      newSource,
      targetSpec,
      link.relation_type || "LINKS_TO",
      JSON.stringify({ linkId: link.id }),
      link.created_at || Date.now()
    );
  }
  await db.prepare("UPDATE knowledge_links SET fact_key = ? WHERE fact_key = ?").run(targetKey, sourceKey);

  for (const docId of docIds) {
    await queueDocumentSyncIfNeeded(db, docId);
  }

  return { movedLinks: links.length, movedDocuments: docIds.size };
}

export async function deleteLinksForFacts(db, factKey, factTexts) {
  const texts = [...new Set((factTexts || []).filter(Boolean))];
  if (!factKey || texts.length === 0) return { deletedLinks: 0, affectedDocuments: 0 };
  const placeholders = texts.map(() => "?").join(",");
  const links = await db
    .prepare(`SELECT * FROM knowledge_links WHERE fact_key = ? AND fact_text IN (${placeholders})`)
    .all(factKey, ...texts);
  for (const link of links) {
    const source = `fact:${factKey}:${link.fact_text.substring(0, 30)}`;
    const target = link.start_line
      ? `${link.doc_id}:L${link.start_line}-${link.end_line || link.start_line}`
      : link.doc_id;
    await db
      .prepare("DELETE FROM graph_edges WHERE source_id = ? AND target_id = ? AND relation_type = ?")
      .run(source, target, link.relation_type || "LINKS_TO");
  }
  await db
    .prepare(`DELETE FROM knowledge_links WHERE fact_key = ? AND fact_text IN (${placeholders})`)
    .run(factKey, ...texts);
  const docIds = [...new Set(links.map((link) => link.doc_id))];
  for (const docId of docIds) await queueDocumentSyncIfNeeded(db, docId);
  return { deletedLinks: links.length, affectedDocuments: docIds.length };
}
