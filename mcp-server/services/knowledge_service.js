// Local, read-only knowledge contract shared by HTTP, CLI, MCP and OpenCode.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getDatabase, BLOBS_DIR } from "../db/database.js";
import { getBlobPath, safeGunzip, hashContent } from "../storage/blob_store.js";
import { listNotebookTargets, serviceError } from "./notebook_service.js";
import { normalizeKnowledgeDocumentMetadata } from "../tools/core/knowledge_read_core.js";
import { readMemory } from "../memory.js";
import { parseFactEntry, factBody, factTitle, factMeta } from "../fact_format.js";

export const KNOWLEDGE_LIMITS = Object.freeze({ page: 100, text: 20000, rawBytes: 16 * 1024 * 1024 });
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const shortText = (value, max = 2000) => value == null ? null : String(value).slice(0, max);
const idField = (value, name) => {
  if (typeof value !== "string" || !value || value.length > 1000) throw serviceError("INVALID", `${name} must be an explicit ID/key.`);
  return value;
};
function integer(value, fallback, max, name) {
  if (value == null) return fallback;
  if (typeof value === "string" && !/^\d+$/.test(value)) throw serviceError("INVALID", `${name} must be an integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > max) throw serviceError("INVALID", `${name} is outside the supported range.`);
  return number;
}
function page(input) {
  const limit = integer(input.limit, 30, KNOWLEDGE_LIMITS.page, "limit");
  if (!limit) throw serviceError("INVALID", "limit must be positive.");
  return { limit, offset: integer(input.offset, 0, 10000000, "offset") };
}

// No await inside a SQLite read transaction: older async writers on this same
// connection are rejected as BUSY instead of exposing their uncommitted rows.
function view(db, work) {
  const sql = db.localDb;
  try { sql.exec("BEGIN;"); }
  catch { throw serviceError("BUSY", "Storage is publishing another operation. Retry shortly."); }
  try { const result = work(sql); sql.exec("COMMIT;"); return result; }
  catch (error) { sql.exec("ROLLBACK;"); throw error; }
}

export async function listKnowledgeTargets() {
  const notebook = await listNotebookTargets();
  const db = await getDatabase();
  const keys = view(db, sql => sql.prepare("SELECT DISTINCT scope_key FROM document_scopes ORDER BY scope_key").all());
  const targets = notebook.map(target => ({ ...target, notebookAvailable: true }));
  for (const { scope_key: key } of keys) if (!targets.some(target => target.key === key)) {
    // A persisted RAG scope is selectable even without a Notebook or directory.
    targets.push({ key, name: key, aliases: [], legacy: false, notebookAvailable: false });
  }
  return targets;
}
async function context(input) {
  const key = idField(input.scopeKey, "scopeKey");
  const target = (await listKnowledgeTargets()).find(item => item.key === key);
  if (!target) throw serviceError("NOT_FOUND", "Unknown knowledge scope.");
  const includeGlobal = input.includeGlobal ?? false;
  if (typeof includeGlobal !== "boolean") throw serviceError("INVALID", "includeGlobal must be boolean.");
  return { target, keys: includeGlobal && key !== "global" ? [key, "global"] : [key], db: await getDatabase() };
}
function documentRow(sql, docId, keys) {
  idField(docId, "docId");
  const row = sql.prepare(`SELECT d.* FROM documents d WHERE d.id = ? AND EXISTS
    (SELECT 1 FROM document_scopes ds WHERE ds.doc_id = d.id AND ds.scope_key IN (${keys.map(() => "?")}))`).get(docId, ...keys);
  if (!row) throw serviceError("NOT_FOUND", "Document is not visible in the selected scope.");
  return row;
}
function describe(sql, row, keys) {
  const meta = normalizeKnowledgeDocumentMetadata(row);
  const scopes = sql.prepare("SELECT scope_key, created_at FROM document_scopes WHERE doc_id = ? ORDER BY scope_key").all(row.id);
  const counts = Object.fromEntries(["sections", "medium_chunks", "micro_chunks"].map(table => [table,
    sql.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE doc_id = ?`).get(row.id).count]));
  const vectors = sql.prepare("SELECT COUNT(*) AS count FROM micro_chunks WHERE doc_id = ? AND length(vector) > 0").get(row.id).count;
  return { docId: row.id, title: shortText(row.title), path: shortText(row.path, 4000), source_type: shortText(meta.sourceType || "UNKNOWN", 100),
    note_kind: shortText(meta.noteKind, 100), tags: meta.tags.slice(0, 100).map(tag => shortText(tag, 200)), created_at: row.created_at, updated_at: row.updated_at,
    metadataTruncated: String(row.title || "").length > 2000 || row.path.length > 4000 || meta.tags.length > 100 || meta.tags.some(tag => tag.length > 200),
    visibleScopes: scopes.filter(item => keys.includes(item.scope_key)).map(item => item.scope_key),
    shared: scopes.length > 1, otherScopeCount: scopes.filter(item => !keys.includes(item.scope_key)).length,
    version: digest([row, counts, vectors]), scopeVersion: digest(scopes), counts,
    rawState: !/^[a-f0-9]{64}$/.test(row.blob_hash) ? "corrupt" : existsSync(getBlobPath(row.blob_hash, BLOBS_DIR)) ? "present_unverified" : "missing",
    index: { microCount: counts.micro_chunks, vectorCount: vectors,
      state: meta.metadata.index_state || 'UNKNOWN',
      model: shortText(meta.metadata.embedding_provenance?.model || 'UNKNOWN', 500),
      dimension: meta.metadata.embedding_provenance?.dimension || null,
      provenance: meta.metadata.embedding_provenance ? 'recorded-at-publication' : 'not-recorded' } };
}

export async function listKnowledge(input) {
  const ctx = await context(input), paging = page(input);
  const query = input.query ?? "";
  if (typeof query !== "string" || query.length > 500) throw serviceError("INVALID", "query must be at most 500 characters.");
  const type = input.sourceType ?? "all";
  if (!["all", "note", "source"].includes(type)) throw serviceError("INVALID", "Unknown sourceType filter.");
  return view(ctx.db, sql => {
    const where = `EXISTS (SELECT 1 FROM document_scopes ds WHERE ds.doc_id = d.id AND ds.scope_key IN (${ctx.keys.map(() => "?")}))
      AND (? = '' OR instr(lower(coalesce(d.title, '') || ' ' || d.path || ' ' || coalesce(d.metadata_json, '')), lower(?)) > 0)
      AND (? = 'all' OR (? = 'note' AND (d.path LIKE 'memory://note/%' OR json_extract(CASE WHEN json_valid(d.metadata_json) THEN d.metadata_json ELSE '{}' END, '$.source_type') = 'note'))
      OR (? = 'source' AND d.path NOT LIKE 'memory://note/%' AND coalesce(json_extract(CASE WHEN json_valid(d.metadata_json) THEN d.metadata_json ELSE '{}' END, '$.source_type'), '') != 'note'))`;
    const params = [...ctx.keys, query, query, type, type, type];
    const total = sql.prepare(`SELECT COUNT(*) AS count FROM documents d WHERE ${where}`).get(...params).count;
    const rows = sql.prepare(`SELECT d.* FROM documents d WHERE ${where} ORDER BY d.created_at DESC, d.id ASC LIMIT ? OFFSET ?`).all(...params, paging.limit, paging.offset);
    return { target: ctx.target, contextKeys: ctx.keys, items: rows.map(row => describe(sql, row, ctx.keys)), total, ...paging,
      nextOffset: paging.offset + rows.length < total ? paging.offset + rows.length : null };
  });
}

async function rawPage(row, input) {
  if (!/^[a-f0-9]{64}$/.test(row.blob_hash)) return { state: "corrupt", text: "" };
  let text;
  try {
    const bytes = safeGunzip(await readFile(getBlobPath(row.blob_hash, BLOBS_DIR)), KNOWLEDGE_LIMITS.rawBytes);
    if (hashContent(bytes) !== row.blob_hash) return { state: "corrupt", text: "" };
    text = bytes.toString("utf8").replace(/\r\n?/g, "\n");
  } catch (error) {
    return { state: error.code === "ENOENT" ? "missing" : error.code === "ERR_BUFFER_TOO_LARGE" ? "too_large" : "corrupt", text: "" };
  }
  const requestedLine = integer(input.startLine, 1, 10000000, "startLine");
  const lines = text.split("\n");
  if (!requestedLine || requestedLine > lines.length) throw serviceError("INVALID", "startLine is outside the saved text.");
  const offset = input.rawOffset == null ? lines.slice(0, requestedLine - 1).reduce((sum, line) => sum + line.length + 1, 0)
    : integer(input.rawOffset, 0, text.length, "rawOffset");
  const limit = integer(input.textLimit, KNOWLEDGE_LIMITS.text, KNOWLEDGE_LIMITS.text, "textLimit");
  if (!limit) throw serviceError("INVALID", "textLimit must be positive.");
  const fragment = text.slice(offset, offset + limit);
  const lineStart = 1 + (text.slice(0, offset).match(/\n/g) || []).length;
  return { state: "available", text: fragment, offset, nextOffset: offset + fragment.length < text.length ? offset + fragment.length : null,
    truncated: offset > 0 || fragment.length < text.length, totalCharacters: text.length, totalLines: lines.length,
    lineStart, lineEnd: lineStart + (fragment.match(/\n/g) || []).length, numbering: "1-based; CRLF and CR normalized to LF" };
}
export async function readKnowledge(input) {
  const ctx = await context(input);
  const saved = view(ctx.db, sql => { const row = documentRow(sql, input.docId, ctx.keys); return { row, document: describe(sql, row, ctx.keys) }; });
  const raw = await rawPage(saved.row, input);
  // Blob IO occurs outside SQL. A concurrent refresh/delete cannot turn this
  // into a successful response with a mixture of two document revisions.
  view(ctx.db, sql => {
    const current = describe(sql, documentRow(sql, input.docId, ctx.keys), ctx.keys);
    if (current.version !== saved.document.version || current.scopeVersion !== saved.document.scopeVersion) throw serviceError("CONFLICT", "Document changed while reading. Reload it.");
  });
  return { ...saved.document, raw };
}

const levels = { section: "sections", medium: "medium_chunks", micro: "micro_chunks" };
function chunkProjection(level) {
  const common = "id, doc_id, token_count, length(content) AS text_length";
  if (level === "section") return `${common}, heading, breadcrumbs`;
  if (level === "medium") return `${common}, section_id, block_type`;
  return `${common}, section_id, medium_id, retrieval_policy, policy_source_id, length(vector) AS vector_bytes`;
}
function parentStatus(sql, row, level) {
  if (level === "section") return "available";
  const section = sql.prepare("SELECT doc_id FROM sections WHERE id = ?").get(row.section_id);
  if (!section || section.doc_id !== row.doc_id) return "missing_or_foreign_section";
  if (level === "micro" && row.medium_id) {
    const medium = sql.prepare("SELECT doc_id, section_id FROM medium_chunks WHERE id = ?").get(row.medium_id);
    if (!medium || medium.doc_id !== row.doc_id || medium.section_id !== row.section_id) return "missing_or_foreign_medium";
  }
  return "available";
}
function chunkInfo(sql, row, level, document) {
  const status = parentStatus(sql, row, level);
  const breadcrumbs = level === "section" ? row.breadcrumbs : status === "available"
    ? sql.prepare("SELECT breadcrumbs FROM sections WHERE id = ? AND doc_id = ?").get(row.section_id, row.doc_id)?.breadcrumbs : null;
  const validPolicySource = row.policy_source_id && sql.prepare("SELECT id FROM medium_chunks WHERE id = ? AND doc_id = ?").get(row.policy_source_id, row.doc_id);
  // Corrupt parent IDs must not become cross-project navigation targets.
  return { ...row, heading: shortText(row.heading), breadcrumbs: shortText(breadcrumbs),
    metadataTruncated: String(row.heading || "").length > 2000 || String(breadcrumbs || "").length > 2000,
    section_id: status === "available" ? row.section_id : null, medium_id: status === "available" ? row.medium_id : null,
    policy_source_id: validPolicySource ? row.policy_source_id : null,
    policySourceState: !row.policy_source_id ? "not-recorded" : validPolicySource ? "available" : "missing_or_foreign",
    level, parentState: status, coordinates: { state: "UNKNOWN", reason: "source-lines-not-recorded" },
    vector: level === "micro" ? { present: row.vector_bytes > 0, bytes: row.vector_bytes, dimension: row.vector_bytes > 0 && row.vector_bytes % 4 === 0 ? row.vector_bytes / 4 : null,
      encoding: "float32", model: row.vector_bytes > 0 && document?.index.dimension === row.vector_bytes / 4 ? document.index.model : "UNKNOWN",
      provenance: row.vector_bytes > 0 && document?.index.dimension === row.vector_bytes / 4 ? document.index.provenance : "not-recorded-or-mismatched" } : null };
}
export async function readHierarchy(input) {
  const ctx = await context(input), paging = page(input), level = input.level ?? "section";
  if (!Object.hasOwn(levels, level)) throw serviceError("INVALID", "level must be section, medium or micro.");
  return view(ctx.db, sql => {
    const document = describe(sql, documentRow(sql, input.docId, ctx.keys), ctx.keys);
    let where = "doc_id = ?", params = [input.docId];
    if (input.parentId != null) {
      if (level === "section") throw serviceError("INVALID", "Sections have no chunk parent filter.");
      idField(input.parentId, "parentId");
      const parentTable = level === "medium" ? "sections" : "medium_chunks";
      if (!sql.prepare(`SELECT id FROM ${parentTable} WHERE id = ? AND doc_id = ?`).get(input.parentId, input.docId)) throw serviceError("NOT_FOUND", "Parent is not in this document.");
      where += level === "medium" ? " AND section_id = ?" : " AND medium_id = ?"; params.push(input.parentId);
    }
    const total = sql.prepare(`SELECT COUNT(*) AS count FROM ${levels[level]} WHERE ${where}`).get(...params).count;
    const rows = sql.prepare(`SELECT ${chunkProjection(level)} FROM ${levels[level]} WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`).all(...params, paging.limit, paging.offset);
    return { docId: input.docId, version: document.version, level, items: rows.map(row => chunkInfo(sql, row, level, document)), total, ...paging,
      order: "stable-id; source positions unavailable", nextOffset: paging.offset + rows.length < total ? paging.offset + rows.length : null };
  });
}
export async function readChunk(input) {
  const ctx = await context(input), level = input.level;
  if (!Object.hasOwn(levels, level)) throw serviceError("INVALID", "level must be section, medium or micro.");
  idField(input.chunkId, "chunkId");
  const textOffset = integer(input.textOffset, 0, 100000000, "textOffset");
  return view(ctx.db, sql => {
    const document = describe(sql, documentRow(sql, input.docId, ctx.keys), ctx.keys);
    const row = sql.prepare(`SELECT ${chunkProjection(level)}, substr(content, ?, ?) AS text FROM ${levels[level]} WHERE id = ? AND doc_id = ?`).get(textOffset + 1, KNOWLEDGE_LIMITS.text, input.chunkId, input.docId);
    if (!row) throw serviceError("NOT_FOUND", "Chunk is not in this visible document.");
    if (textOffset > row.text_length) throw serviceError("INVALID", "textOffset is outside chunk text.");
    // SQLite offsets/length count Unicode code points, not JS UTF-16 units.
    const length = Array.from(row.text).length;
    return { ...chunkInfo(sql, row, level, document), version: document.version, textOffset, textOffsetUnit: "unicode-code-points",
      truncated: textOffset > 0 || length < row.text_length, nextTextOffset: textOffset + length < row.text_length ? textOffset + length : null };
  });
}

export async function listKnowledgeLinks(input) {
  const { withSnapshotLock } = await import('../storage/snapshot_lock.js');
  const { MEMORY_DIR } = await import('../memory.js');
  return withSnapshotLock(MEMORY_DIR, () => knowledgeLinksLocked(input));
}
async function knowledgeLinksLocked(input) {
  const ctx = await context(input), paging = page(input);
  const { hasKnowledgeSchema } = await import('../storage/knowledge_schema.js');
  const migrated = hasKnowledgeSchema(ctx.db);
  const result = view(ctx.db, sql => {
    documentRow(sql, input.docId, ctx.keys);
    const where = `doc_id = ? AND fact_key IN (${ctx.keys.map(() => "?")}) AND EXISTS
      (SELECT 1 FROM document_scopes ds WHERE ds.doc_id = knowledge_links.doc_id AND (ds.scope_key = knowledge_links.fact_key OR ds.scope_key = 'global'))`;
    const total = sql.prepare(`SELECT COUNT(*) AS count FROM knowledge_links WHERE ${where}`).get(input.docId, ...ctx.keys).count;
    const rows = sql.prepare(`SELECT * FROM knowledge_links WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`).all(input.docId, ...ctx.keys, paging.limit, paging.offset);
    return { rows, total };
  });
  const stores = new Map();
  const { resolvedLinkState } = await import('./knowledge_links_service.js');
  for (const key of new Set(result.rows.map(row => row.fact_key))) stores.set(key, await readMemory(key));
  return { items: result.rows.map(link => {
    const matches = stores.get(link.fact_key).map((line, index) => ({ line, index })).filter(({ line }) => link.fact_id ? factMeta(line).id === link.fact_id : factBody(line) === link.fact_text || parseFactEntry(line)?.text === link.fact_text);
    const fact = matches.length === 1 ? matches[0] : null, meta = fact ? factMeta(fact.line) : {};
    const duplicateId = meta.id && stores.get(link.fact_key).filter(line => factMeta(line).id === meta.id).length !== 1;
    return { linkId: link.id, docId: input.docId, factKey: link.fact_key, factRef: fact && !duplicateId ? meta.id ? `id:${meta.id}` : `legacy:${fact.index}` : null,
      factTitle: fact ? shortText(factTitle(fact.line)) : null, factText: shortText(link.fact_text, KNOWLEDGE_LIMITS.text), relationType: shortText(link.relation_type, 100),
      textTruncated: link.fact_text.length > KNOWLEDGE_LIMITS.text,
      ...(migrated ? resolvedLinkState(ctx.db.localDb, link) : { status: 'needs_review', reason: 'legacy-source-revision-not-recorded', coordinatesConfirmed: false }),
      ...(!matches.length || matches.length > 1 || duplicateId ? { status: 'needs_review', coordinatesConfirmed: false, reason: !matches.length ? 'fact-not-found' : 'ambiguous-fact' } : {}),
      requestedLines: { start: link.start_line, end: link.end_line } };
  }), total: result.total, ...paging, nextOffset: paging.offset + result.rows.length < result.total ? paging.offset + result.rows.length : null };
}

export async function inspectKnowledge(input = {}) {
  const actions = { search:async value=>(await import('./knowledge_search_service.js')).searchKnowledge(value), 'search-status':async value=>(await import('./knowledge_search_service.js')).searchKnowledge(value), graph: async value => (await import('./knowledge_graph_service.js')).readKnowledgeGraph(value), targets: listKnowledgeTargets, list: listKnowledge, read: readKnowledge, hierarchy: readHierarchy, chunk: readChunk, links: listKnowledgeLinks };
  if (!Object.hasOwn(actions, input.action)) throw serviceError("INVALID", "Unknown knowledge inspection action.");
  return actions[input.action](input);
}
