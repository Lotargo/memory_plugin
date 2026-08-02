import { getDatabase } from "../db/database.js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MEMORY_DIR } from "../memory.js";

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
  const microChunks = await db.prepare("SELECT id, medium_id, section_id, content, token_count FROM micro_chunks WHERE doc_id = ?").all(doc.id);
  const graphEdges = await db.prepare("SELECT source_id, target_id, relation_type, metadata_json FROM graph_edges WHERE source_id = ? OR target_id = ?").all(doc.id, doc.id);

  return {
    document: {
      id: doc.id,
      path: doc.path,
      title: doc.title,
      blob_hash: doc.blob_hash,
      checksum: doc.checksum,
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
