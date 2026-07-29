import { getDatabase } from "../db/database.js";
import { randomUUID } from "node:crypto";

export function linkFactToDocument({
  factKey,
  factText,
  docId,
  sectionId = null,
  startLine = null,
  endLine = null,
  relationType = "LINKS_TO",
  metadata = null,
}) {
  const db = getDatabase();
  const id = `link_${randomUUID().substring(0, 12)}`;
  const now = Date.now();

  const doc = db
    .prepare("SELECT id, title, path FROM documents WHERE id = ? OR path = ? OR title = ?")
    .get(docId, docId, docId);

  if (!doc) {
    throw new Error(`Target document not found in knowledge base for link: ${docId}`);
  }

  const stmt = db.prepare(`
    INSERT INTO knowledge_links (id, fact_key, fact_text, doc_id, section_id, start_line, end_line, relation_type, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
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
  edgeStmt.run(`fact:${factKey}:${factText.substring(0, 30)}`, targetSpec, relationType, JSON.stringify({ linkId: id }), now);

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

export function getLinksForFact(factKey, factText) {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT k.*, d.title as doc_title, d.path as doc_path
    FROM knowledge_links k
    JOIN documents d ON k.doc_id = d.id
    WHERE k.fact_key = ? AND (k.fact_text LIKE ? OR ? LIKE '%' || k.fact_text || '%')
    ORDER BY k.created_at DESC
  `);
  const queryPattern = `%${factText.substring(0, 20)}%`;
  return stmt.all(factKey, queryPattern, factText);
}

export function getLinksForDoc(docId) {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT k.*, d.title as doc_title, d.path as doc_path
    FROM knowledge_links k
    JOIN documents d ON k.doc_id = d.id
    WHERE k.doc_id = ? OR d.path = ? OR d.title = ?
    ORDER BY k.created_at DESC
  `);
  return stmt.all(docId, docId, docId);
}

export function listAllLinks(factKey = null) {
  const db = getDatabase();
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
  return db.prepare(sql).all(...params);
}
