import { getDatabase } from "../db/database.js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MEMORY_DIR } from "../memory.js";
import { toVectorBytes } from "../retrieval/retriever.js";

export const EXPORTS_DIR = join(MEMORY_DIR, "exports");

export function ensureExportsDir() {
  if (!existsSync(EXPORTS_DIR)) {
    mkdirSync(EXPORTS_DIR, { recursive: true });
  }
  return EXPORTS_DIR;
}

export async function exportDocumentData(docIdOrPath, customDb = null) {
  const db = customDb || await getDatabase();
  const doc = await db.prepare("SELECT * FROM documents WHERE id = ? OR path = ?").get(docIdOrPath, docIdOrPath);
  if (!doc) {
    throw new Error(`Document not found for ID or path: ${docIdOrPath}`);
  }

  let toc = null;
  try {
    toc = doc.toc_json ? JSON.parse(doc.toc_json) : null;
  } catch {
    toc = doc.toc_json;
  }

  let metadata = null;
  try {
    metadata = doc.metadata_json ? JSON.parse(doc.metadata_json) : null;
  } catch {
    metadata = doc.metadata_json;
  }

  const sections = await db.prepare("SELECT id, heading, breadcrumbs, content, token_count FROM sections WHERE doc_id = ?").all(doc.id);
  const mediumChunks = await db.prepare("SELECT id, section_id, content, block_type, token_count, created_at FROM medium_chunks WHERE doc_id = ?").all(doc.id);
  const rawMicroChunks = await db.prepare(`
    SELECT m.id, m.medium_id, m.section_id, m.content, m.vector, m.token_count,
           m.retrieval_policy, m.policy_source_id, s.breadcrumbs
    FROM micro_chunks m
    LEFT JOIN sections s ON s.id = m.section_id
    WHERE m.doc_id = ?;
  `).all(doc.id);
  const microChunks = rawMicroChunks.map((chunk) => {
    const bytes = toVectorBytes(chunk.vector);
    return {
      ...chunk,
      vector: bytes && bytes.byteLength
        ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")
        : "",
    };
  });
  const ownedRows = await db.prepare(`
    SELECT id FROM sections WHERE doc_id = ?
    UNION SELECT id FROM medium_chunks WHERE doc_id = ?
    UNION SELECT id FROM micro_chunks WHERE doc_id = ?;
  `).all(doc.id, doc.id, doc.id);
  const ownedIds = [doc.id, ...ownedRows.map((row) => row.id)];
  const placeholders = ownedIds.map(() => "?").join(",");
  const graphEdges = await db.prepare(`
    SELECT source_id, target_id, relation_type, metadata_json, created_at
    FROM graph_edges
    WHERE source_id IN (${placeholders})
       OR target_id IN (${placeholders})
       OR target_id GLOB ?;
  `).all(...ownedIds, ...ownedIds, `${doc.id}:L*`);
  const knowledgeLinks = await db.prepare("SELECT * FROM knowledge_links WHERE doc_id = ?").all(doc.id);
  const documentScopes = await db.prepare("SELECT scope_key, created_at FROM document_scopes WHERE doc_id = ?").all(doc.id);

  return {
    document: {
      id: doc.id,
      path: doc.path,
      title: doc.title,
      blob_hash: doc.blob_hash,
      checksum: doc.checksum,
      toc_json: doc.toc_json,
      metadata_json: doc.metadata_json,
      toc,
      metadata,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    },
    counts: {
      sections: sections.length,
      medium_chunks: mediumChunks.length,
      micro_chunks: microChunks.length,
      graph_edges: graphEdges.length,
    },
    sections,
    medium_chunks: mediumChunks,
    micro_chunks: microChunks,
    graph_edges: graphEdges,
    knowledge_links: knowledgeLinks,
    document_scopes: documentScopes,
  };
}

export async function exportDocumentToJsonString(docIdOrPath, customDb = null) {
  const data = await exportDocumentData(docIdOrPath, customDb);
  return JSON.stringify(data, null, 2);
}

export async function exportDocumentToFile(docIdOrPath, outputPath = null, customDb = null) {
  const targetDir = ensureExportsDir();
  const db = customDb || await getDatabase();
  const data = await exportDocumentData(docIdOrPath, db);
  const jsonStr = JSON.stringify(data, null, 2);

  const finalPath = outputPath || join(targetDir, `doc_export_${data.document.id}.json`);
  writeFileSync(finalPath, jsonStr, "utf-8");
  return finalPath;
}
