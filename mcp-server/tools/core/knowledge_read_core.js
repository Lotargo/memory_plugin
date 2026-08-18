import { getDatabase } from "../../db/database.js";
import { resolveManageRagScopeKeys } from "../../rag_scope.js";
import { readBlob } from "../../storage/blob_store.js";
import { parseDocumentMetadata } from "../../retrieval/retriever.js";
import { getConfig } from "../../config/config_manager.js";

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return [...new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].sort();
  }
  if (typeof tags === "string") {
    return [...new Set(tags.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
  }
  return [];
}

function normalizeScopes(scopes) {
  if (Array.isArray(scopes)) return [...new Set(scopes.filter(Boolean))];
  if (typeof scopes === "string") return [...new Set(scopes.split(",").map((scope) => scope.trim()).filter(Boolean))];
  return [];
}

export function normalizeKnowledgeDocumentMetadata(doc) {
  const metadata = parseDocumentMetadata(doc?.metadata_json);
  const sourceType = metadata.source_type || (String(doc?.path || "").startsWith("memory://note/") ? "note" : null);
  const noteKind = sourceType === "note" ? (metadata.note_kind || "note") : null;
  const tags = normalizeTags(metadata.tags);

  return {
    metadata,
    sourceType,
    noteKind,
    tags,
  };
}

function resolveEffectiveDirectory(directory, project, ctx) {
  return directory || project || ctx.directory || null;
}

async function ensureKnowledgeFresh() {
  if (getConfig().mode !== "hybrid-sync") return;
  const { ensureReverseSync } = await import("../../db/sync_queue.js");
  await ensureReverseSync();
}

async function readRawWithCloudFallback(db, blobHash) {
  try {
    return await readBlob(blobHash);
  } catch (localErr) {
    if (getConfig().mode === "only-local") throw localErr;

    const { materializeBlobFromCloud } = await import("../../db/rag_blob_transport.js");
    const result = await materializeBlobFromCloud(db, blobHash);
    if (!result.materialized && !result.existing) {
      throw new Error(
        `Raw blob ${blobHash} is unavailable locally and could not be restored from cloud (${result.reason || "unknown"})`
      );
    }
    return await readBlob(blobHash);
  }
}

/**
 * List scoped RAG documents/notes with normalized metadata.
 */
export async function listKnowledgeDocuments(
  { scope = null, directory = null, project = null } = {},
  ctx = {}
) {
  await ensureKnowledgeFresh();
  const db = await getDatabase();
  const scopeKeys = await resolveManageRagScopeKeys("list", scope, {
    worktree: ctx.worktree ?? null,
    directory: resolveEffectiveDirectory(directory, project, ctx),
  });
  const placeholders = scopeKeys.map(() => "?").join(",");

  const docs = await db.prepare(`
    SELECT d.id, d.title, d.path, d.blob_hash, d.metadata_json,
           d.created_at, d.updated_at,
           GROUP_CONCAT(DISTINCT ds.scope_key) AS scopes
    FROM documents d
    JOIN document_scopes ds ON ds.doc_id = d.id
    WHERE ds.scope_key IN (${placeholders})
    GROUP BY d.id, d.title, d.path, d.blob_hash, d.metadata_json, d.created_at, d.updated_at
    ORDER BY d.created_at DESC
  `).all(...scopeKeys);

  return docs.map((doc) => {
    const { metadata, sourceType, noteKind, tags } = normalizeKnowledgeDocumentMetadata(doc);
    return {
      id: doc.id,
      docId: doc.id,
      title: doc.title,
      path: doc.path,
      blob_hash: doc.blob_hash,
      source_type: sourceType,
      note_kind: noteKind,
      tags,
      metadata,
      scopes: normalizeScopes(doc.scopes),
      created_at: doc.created_at ?? null,
      updated_at: doc.updated_at ?? null,
    };
  });
}

/**
 * Read the authoritative raw content for a scoped RAG document/note.
 *
 * In Turso-backed modes a missing local content-addressed blob is restored from
 * the portable `rag_blobs` table and integrity-checked before use.
 */
export async function readKnowledgeDocument(
  { docId, scope = null, directory = null, project = null },
  ctx = {}
) {
  if (!docId) throw new Error("docId parameter is required for read_document action");

  await ensureKnowledgeFresh();
  const db = await getDatabase();
  const scopeKeys = await resolveManageRagScopeKeys("read_document", scope, {
    worktree: ctx.worktree ?? null,
    directory: resolveEffectiveDirectory(directory, project, ctx),
  });
  const placeholders = scopeKeys.map(() => "?").join(",");

  const doc = await db
    .prepare(`
      SELECT d.id, d.title, d.path, d.blob_hash, d.metadata_json,
             d.created_at, d.updated_at
      FROM documents d
      WHERE (d.id = ? OR d.path = ? OR d.title = ?)
        AND EXISTS (
          SELECT 1 FROM document_scopes ds
          WHERE ds.doc_id = d.id
            AND ds.scope_key IN (${placeholders})
        )
    `)
    .get(docId, docId, docId, ...scopeKeys);

  if (!doc) {
    throw new Error(`Document not found in knowledge base for docId: ${docId}`);
  }

  const rawContent = await readRawWithCloudFallback(db, doc.blob_hash);
  const { metadata, sourceType, noteKind, tags } = normalizeKnowledgeDocumentMetadata(doc);

  return {
    id: doc.id,
    docId: doc.id,
    title: doc.title,
    path: doc.path,
    source_type: sourceType,
    note_kind: noteKind,
    tags,
    metadata,
    created_at: doc.created_at ?? null,
    updated_at: doc.updated_at ?? null,
    content: rawContent,
  };
}
