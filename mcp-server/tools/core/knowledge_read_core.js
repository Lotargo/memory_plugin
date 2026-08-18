import { getDatabase } from "../../db/database.js";
import { resolveManageRagScopeKeys } from "../../rag_scope.js";
import { readBlob } from "../../storage/blob_store.js";
import { parseDocumentMetadata } from "../../retrieval/retriever.js";

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return [...new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].sort();
  }
  if (typeof tags === "string") {
    return [...new Set(tags.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
  }
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

/**
 * Read the authoritative raw content for a scoped RAG document/note.
 *
 * This is shared by MCP and native OpenCode so `read_document` has identical
 * visibility and metadata semantics on both integration surfaces.
 */
export async function readKnowledgeDocument(
  { docId, scope = null, directory = null, project = null },
  ctx = {}
) {
  if (!docId) throw new Error("docId parameter is required for read_document action");

  const db = await getDatabase();
  const effectiveDirectory = directory || project || ctx.directory || null;
  const scopeKeys = await resolveManageRagScopeKeys("read_document", scope, {
    worktree: ctx.worktree ?? null,
    directory: effectiveDirectory,
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

  const rawContent = await readBlob(doc.blob_hash);
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
