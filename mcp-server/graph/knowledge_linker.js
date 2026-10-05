import { getDatabase } from "../db/database.js";
import { randomUUID } from "node:crypto";
import { GLOBAL_KEY, MEMORY_DIR, readMemory } from "../memory.js";
import { hasKnowledgeSchema, rebuildLinkProjections } from '../storage/knowledge_schema.js';
import { factMeta, factBody, parseFactEntry } from '../fact_format.js';
import { withSnapshotLock } from "../storage/snapshot_lock.js";

export async function touchDocument(db, docId) {
  await db.prepare("UPDATE documents SET updated_at = ? WHERE id = ?;").run(Date.now(), docId);
}

export async function linkFactToDocument(args) {
  return withSnapshotLock(MEMORY_DIR, async () => {
    const db = await getDatabase();
    if (!hasKnowledgeSchema(db)) return linkFactToDocumentLocked(args);
    const entries = await readMemory(args.factKey);
    const matches = entries.filter(line => factBody(line) === args.factText || parseFactEntry(line)?.text === args.factText);
    if (matches.length !== 1 || entries.filter(line => factMeta(line).id === factMeta(matches[0]).id).length !== 1) throw Object.assign(new Error('Fact text is missing or ambiguous. Use a stable factRef to create a link.'), { code: 'CONFLICT' });
    const { manageKnowledgeLinks } = await import('../services/knowledge_links_service.js');
    const docs = await db.prepare(`SELECT d.id FROM documents d WHERE (id=? OR path=? OR title=?) AND EXISTS
      (SELECT 1 FROM document_scopes ds WHERE ds.doc_id=d.id AND ds.scope_key IN (?, 'global'))`).all(args.docId, args.docId, args.docId, args.factKey);
    if (docs.length !== 1) throw Object.assign(new Error('Document address is missing or ambiguous. Use docId.'), { code: 'CONFLICT' });
    const request = { operation: 'create', scopeKey: args.factKey, fields: { factRef: `id:${factMeta(matches[0]).id}`, docId: docs[0].id,
      sectionId: args.sectionId ?? null, startLine: args.startLine == null ? null : Number(args.startLine), endLine: args.endLine == null ? null : Number(args.endLine), relationType: args.relationType || 'LINKS_TO' } };
    if (request.fields.startLine && request.fields.endLine == null) request.fields.endLine = request.fields.startLine;
    const preview = await manageKnowledgeLinks({ ...request, action: 'preview' });
    const result = await manageKnowledgeLinks({ ...request, action: 'apply', previewToken: preview.previewToken });
    return { ...result.link, docTitle: docs[0].id };
  });
}

async function linkFactToDocumentLocked({
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
  await touchDocument(db, doc.id);

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
  return withSnapshotLock(MEMORY_DIR, () => linksForFactLocked(factKey, factText));
}
async function linksForFactLocked(factKey, factText) {
  const db = await getDatabase();
  if (hasKnowledgeSchema(db)) {
    const entries = await readMemory(factKey);
    const matches = entries.filter(line => factBody(line) === factText || parseFactEntry(line)?.text === factText);
    if (matches.length !== 1 || entries.filter(line => factMeta(line).id === factMeta(matches[0]).id).length !== 1) return [];
    const rows = await db.prepare(`SELECT k.*,d.title AS doc_title,d.path AS doc_path FROM knowledge_links k JOIN documents d ON d.id=k.doc_id
      WHERE k.fact_key=? AND k.fact_id=? AND EXISTS (SELECT 1 FROM document_scopes ds WHERE ds.doc_id=d.id AND ds.scope_key IN (?, 'global')) ORDER BY k.id`).all(factKey, factMeta(matches[0]).id, factKey);
    const { resolvedLinkState } = await import('../services/knowledge_links_service.js');
    return rows.map(row => ({ ...row, ...resolvedLinkState(db.localDb, row) }));
  }
  const stmt = db.prepare(`
    SELECT k.*, d.title as doc_title, d.path as doc_path
    FROM knowledge_links k
    JOIN documents d ON k.doc_id = d.id
    WHERE k.fact_key = ? AND k.fact_text = ?
    ORDER BY k.created_at DESC
  `);
  const rows = await stmt.all(factKey, factText);
  return rows.map(row => ({ ...row, status: 'needs_review', coordinatesConfirmed: false }));
}

export async function getLinksForDoc(docId, scopeKeys = null) {
  return withSnapshotLock(MEMORY_DIR, () => linksForDocLocked(docId, scopeKeys));
}
async function linksForDocLocked(docId, scopeKeys = null) {
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
  const rows = await stmt.all(
    docId,
    docId,
    docId,
    ...(scoped ? [...scopeKeys, ...scopeKeys] : [])
  );
  const { resolvedLinkState } = await import('../services/knowledge_links_service.js');
  return rows.map(row => hasKnowledgeSchema(db) ? { ...row, ...resolvedLinkState(db.localDb, row) } : { ...row, status: 'needs_review', coordinatesConfirmed: false });
}

export async function listAllLinks(factKey = null) {
  return withSnapshotLock(MEMORY_DIR, () => allLinksLocked(factKey));
}
async function allLinksLocked(factKey = null) {
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
  const rows = await db.prepare(sql).all(...params);
  const { resolvedLinkState } = await import('../services/knowledge_links_service.js');
  return rows.map(row => hasKnowledgeSchema(db) ? { ...row, ...resolvedLinkState(db.localDb, row) } : { ...row, status: 'needs_review', coordinatesConfirmed: false });
}

export async function moveKnowledgeScope(db, sourceKey, targetKey) {
  return withSnapshotLock(MEMORY_DIR, () => moveScopeLocked(db, sourceKey, targetKey));
}
async function moveScopeLocked(db, sourceKey, targetKey) {
  if (!sourceKey || !targetKey || sourceKey === targetKey) {
    return { movedLinks: 0, movedDocuments: 0 };
  }

  const links = await db.prepare("SELECT * FROM knowledge_links WHERE fact_key = ?").all(sourceKey);
  const scopedDocs = await db.prepare("SELECT doc_id, created_at FROM document_scopes WHERE scope_key = ?").all(sourceKey);
  const docIds = new Set([...scopedDocs.map((row) => row.doc_id), ...links.map((link) => link.doc_id)]);
  if (hasKnowledgeSchema(db)) {
    const target = await readMemory(targetKey), mapping = new Map();
    for (const link of links) {
      if (!link.fact_id) { mapping.set(link.id, null); continue; }
      const exactId = target.filter(line => factMeta(line).id === link.fact_id && factBody(line) === link.fact_text);
      const matches = exactId.length === 1 ? exactId : target.filter(line => factBody(line) === link.fact_text);
      const id = matches.length === 1 && factMeta(matches[0]).id;
      if (!id || target.filter(line => factMeta(line).id === id).length !== 1) throw Object.assign(new Error('Scope move has an ambiguous target fact. Review the merged Notebook before moving links.'), { code: 'CONFLICT' });
      mapping.set(link.id, id);
    }
    const { commitKnowledge } = await import('../storage/knowledge_recovery.js');
    await commitKnowledge(MEMORY_DIR, db, [], sql => {
      for (const docId of docIds) sql.prepare('INSERT OR IGNORE INTO document_scopes (doc_id,scope_key,created_at) VALUES (?,?,?)').run(docId, targetKey, Date.now());
      sql.prepare('DELETE FROM document_scopes WHERE scope_key=?').run(sourceKey);
      for (const link of links) sql.prepare('UPDATE knowledge_links SET fact_key=?,fact_id=? WHERE id=?').run(targetKey, mapping.get(link.id), link.id);
      rebuildLinkProjections(sql);
    });
    return { movedLinks: links.length, movedDocuments: docIds.size };
  }

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
    await touchDocument(db, docId);
  }

  return { movedLinks: links.length, movedDocuments: docIds.size };
}

export async function deleteLinksForFacts(db, factKey, factTexts) {
  // Migrated Notebook writes already journal exact fact-ID removals. A second
  // text-based cleanup could remove a different fact with the same body.
  if (hasKnowledgeSchema(db)) return { deletedLinks: 0, affectedDocuments: 0 };
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
  for (const docId of docIds) await touchDocument(db, docId);
  return { deletedLinks: links.length, affectedDocuments: docIds.length };
}
