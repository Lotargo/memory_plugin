// Explicit K2 schema activation. Opening the panel never migrates Notebook
// identities. A migration service creates a full backup before calling this.
export const KNOWLEDGE_COLUMNS = {
  documents: ['revision', 'content_revision', 'index_revision'],
  knowledge_links: ['fact_id', 'revision', 'status', 'source_revision'],
};
export const KNOWLEDGE_TABLES = {
  knowledge_scope_revisions: ['scope_key', 'generation'],
  knowledge_operations: ['id', 'journal_hash', 'committed_at'],
};
export function hasKnowledgeSchema(db) {
  const sql = db.localDb || db;
  return !!sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_operations'").get();
}
export function createKnowledgeSchema(sql) {
  if (hasKnowledgeSchema(sql)) return;
  sql.exec(`ALTER TABLE documents ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE documents ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE documents ADD COLUMN index_revision INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE knowledge_links ADD COLUMN fact_id TEXT;
    ALTER TABLE knowledge_links ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE knowledge_links ADD COLUMN status TEXT NOT NULL DEFAULT 'needs_review';
    ALTER TABLE knowledge_links ADD COLUMN source_revision INTEGER;
    CREATE TABLE knowledge_scope_revisions (scope_key TEXT PRIMARY KEY, generation INTEGER NOT NULL);
    CREATE TABLE knowledge_operations (id TEXT PRIMARY KEY, journal_hash TEXT NOT NULL, committed_at INTEGER NOT NULL);
    INSERT INTO knowledge_scope_revisions SELECT DISTINCT scope_key, 1 FROM document_scopes;
    CREATE TRIGGER knowledge_document_revision AFTER UPDATE ON documents WHEN NEW.revision = OLD.revision BEGIN
      UPDATE documents SET revision = OLD.revision + 1,
        content_revision = OLD.content_revision + CASE WHEN NEW.blob_hash IS NOT OLD.blob_hash OR NEW.checksum IS NOT OLD.checksum THEN 1 ELSE 0 END
        WHERE id = NEW.id;
    END;
    CREATE TRIGGER knowledge_link_revision AFTER UPDATE ON knowledge_links WHEN NEW.revision = OLD.revision BEGIN
      UPDATE knowledge_links SET revision = OLD.revision + 1 WHERE id = NEW.id;
    END;
    CREATE TRIGGER knowledge_scope_added AFTER INSERT ON document_scopes BEGIN
      INSERT INTO knowledge_scope_revisions VALUES (NEW.scope_key, 1) ON CONFLICT(scope_key) DO UPDATE SET generation = generation + 1;
      UPDATE documents SET revision = revision + 1 WHERE id = NEW.doc_id;
    END;
    CREATE TRIGGER knowledge_scope_removed AFTER DELETE ON document_scopes BEGIN
      INSERT INTO knowledge_scope_revisions VALUES (OLD.scope_key, 1) ON CONFLICT(scope_key) DO UPDATE SET generation = generation + 1;
      UPDATE documents SET revision = revision + 1 WHERE id = OLD.doc_id;
    END;`);
  for (const table of ['sections', 'medium_chunks', 'micro_chunks']) {
    for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
      const row = action === 'DELETE' ? 'OLD' : 'NEW';
      sql.exec(`CREATE TRIGGER knowledge_${table}_${action.toLowerCase()} AFTER ${action} ON ${table} BEGIN
        UPDATE documents SET revision = revision + 1, index_revision = index_revision + 1 WHERE id = ${row}.doc_id;
      END;`);
    }
  }
}

export function factNode(key, id) { return `fact:${encodeURIComponent(key)}:id:${encodeURIComponent(id)}`; }
export function restoreKnowledgeRevisions(sql, documents, links, modern = true) {
  if (!hasKnowledgeSchema(sql)) return;
  for (const doc of documents) {
    sql.prepare('UPDATE documents SET revision=-1 WHERE id=?').run(doc.id);
    sql.prepare('UPDATE documents SET revision=?,content_revision=?,index_revision=? WHERE id=?')
      .run(modern ? doc.revision : 1, modern ? doc.content_revision : 1, modern ? doc.index_revision : 1, doc.id);
  }
  for (const link of links) {
    sql.prepare('UPDATE knowledge_links SET revision=-1 WHERE id=?').run(link.id);
    sql.prepare('UPDATE knowledge_links SET fact_id=?,revision=?,status=?,source_revision=? WHERE id=?')
      .run(modern ? link.fact_id : null, modern ? link.revision : 1, modern ? link.status : 'needs_review', modern ? link.source_revision : null, link.id);
  }
}
export function rebuildLinkProjections(sql) {
  // Only edges positively marked as our projection are replaced. Structural
  // and independently authored graph edges are never candidates for cleanup.
  for (const edge of sql.prepare('SELECT source_id,target_id,relation_type,metadata_json FROM graph_edges').all()) {
    let meta; try { meta = JSON.parse(edge.metadata_json || '{}'); } catch { continue; }
    if (meta.knowledgeProjection === true) sql.prepare('DELETE FROM graph_edges WHERE source_id=? AND target_id=? AND relation_type=?').run(edge.source_id, edge.target_id, edge.relation_type);
  }
  const groups = new Map();
  for (const link of sql.prepare('SELECT * FROM knowledge_links WHERE fact_id IS NOT NULL ORDER BY id').all()) {
    const source = factNode(link.fact_key, link.fact_id);
    const target = link.start_line ? `${link.doc_id}:L${link.start_line}-${link.end_line || link.start_line}` : link.section_id || link.doc_id;
    const key = JSON.stringify([source, target, link.relation_type]);
    if (!groups.has(key)) groups.set(key, { source, target, relation: link.relation_type, ids: [], created: link.created_at });
    groups.get(key).ids.push(link.id);
  }
  for (const group of groups.values()) {
    const existing = sql.prepare('SELECT metadata_json FROM graph_edges WHERE source_id=? AND target_id=? AND relation_type=?').get(group.source, group.target, group.relation);
    if (existing) throw Object.assign(new Error('A manually authored edge occupies this projection. Review the graph before changing links.'), { code: 'CONFLICT' });
    sql.prepare('INSERT INTO graph_edges (source_id,target_id,relation_type,metadata_json,created_at) VALUES (?,?,?,?,?)')
      .run(group.source, group.target, group.relation, JSON.stringify({ knowledgeProjection: true, linkIds: group.ids }), group.created);
  }
}
