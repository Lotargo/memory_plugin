import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { getDatabase, BLOBS_DIR } from "../db/database.js";
import { readBlob, saveBlob } from "../storage/blob_store.js";
import { ensureExportsDir } from "../ingest/exporter.js";
import { realResolve, isWithin } from "../security/path_guard.js";
import { toVectorBytes } from "../retrieval/retriever.js";
import { safeGunzip } from "../storage/blob_store.js";

const ALLOWED_SNAPSHOT_DIRS = new Set();

export function registerSnapshotDir(dir) {
  ALLOWED_SNAPSHOT_DIRS.add(realResolve(dir));
}

export function validateSnapshotPath(pathStr, isExport = false) {
  if (typeof pathStr !== "string" || !pathStr.trim()) {
    throw new Error("Snapshot path cannot be empty.");
  }
  // realResolve follows symlinks/junctions, so a link inside the exports dir
  // cannot be used to escape the allowlist.
  const resolved = realResolve(pathStr.trim());
  if (!resolved.endsWith(".json") && !resolved.endsWith(".json.gz")) {
    throw new Error(`Invalid snapshot file extension for path '${pathStr}'. Path must end with .json or .json.gz`);
  }
  if (!isExport && !existsSync(resolved)) {
    throw new Error(`Snapshot file not found: ${pathStr}`);
  }
  if (ALLOWED_SNAPSHOT_DIRS.size > 0) {
    const allowed = [...ALLOWED_SNAPSHOT_DIRS].some((dir) => isWithin(resolved, dir));
    if (!allowed) {
      throw new Error(`Snapshot path '${pathStr}' is outside the allowed directories.`);
    }
  }
  return resolved;
}

export function listAvailableSnapshots() {
  const exportsDir = ensureExportsDir();
  if (!existsSync(exportsDir)) return [];

  const files = readdirSync(exportsDir);
  const snapshotFiles = [];

  for (const f of files) {
    if (f.endsWith(".json") || f.endsWith(".json.gz")) {
      const fullPath = join(exportsDir, f);
      try {
        const st = statSync(fullPath);
        if (st.isFile()) {
          snapshotFiles.push({
            name: f,
            path: fullPath,
            sizeBytes: st.size,
            sizeMB: Number((st.size / (1024 * 1024)).toFixed(2)),
            mtime: st.mtime,
            dateStr: st.mtime.toISOString().substring(0, 16).replace("T", " "),
          });
        }
      } catch {}
    }
  }

  snapshotFiles.sort((a, b) => b.mtime - a.mtime);
  return snapshotFiles;
}

export async function exportSnapshot({ customDb = null, customBlobDir = BLOBS_DIR, outputPath = null } = {}) {
  const db = customDb || await getDatabase();

  const documents = await db.prepare("SELECT * FROM documents").all();
  const sections = await db.prepare("SELECT * FROM sections").all();
  const mediumChunks = await db.prepare("SELECT * FROM medium_chunks").all();
  const rawMicroChunks = await db.prepare("SELECT * FROM micro_chunks").all();
  const graphEdges = await db.prepare("SELECT * FROM graph_edges").all();
  const knowledgeLinks = await db.prepare("SELECT * FROM knowledge_links").all();
  const documentScopes = await db.prepare("SELECT * FROM document_scopes").all();

  const microChunks = rawMicroChunks.map((mc) => {
    let vecBase64 = "";
    const vecBytes = toVectorBytes(mc.vector);
    if (vecBytes && vecBytes.byteLength) {
      vecBase64 = Buffer.from(vecBytes.buffer, vecBytes.byteOffset, vecBytes.byteLength).toString("base64");
    }
    return {
      ...mc,
      vector: vecBase64,
    };
  });

  const uniqueBlobHashes = [...new Set(documents.map((d) => d.blob_hash).filter(Boolean))];
  const blobs = [];
  for (const hash of uniqueBlobHashes) {
    try {
      const content = await readBlob(hash, customBlobDir);
      blobs.push({ hash, content });
    } catch {
      // Blob missing, ignore
    }
  }

  const snapshot = {
    version: 3,
    created_at: new Date().toISOString(),
    documents,
    sections,
    medium_chunks: mediumChunks,
    micro_chunks: microChunks,
    graph_edges: graphEdges,
    knowledge_links: knowledgeLinks,
    document_scopes: documentScopes,
    blobs,
  };

  const jsonStr = JSON.stringify(snapshot, null, 2);
  const targetPath = outputPath ? validateSnapshotPath(outputPath, true) : join(ensureExportsDir(), `rag_snapshot_${Date.now()}.json.gz`);

  if (targetPath.endsWith(".gz")) {
    const gzipped = gzipSync(Buffer.from(jsonStr, "utf-8"));
    writeFileSync(targetPath, gzipped);
  } else {
    writeFileSync(targetPath, jsonStr, "utf-8");
  }

  return { snapshot, outputPath: targetPath };
}

export async function importSnapshot({ customDb = null, customBlobDir = BLOBS_DIR, snapshotPathOrData } = {}) {
  const db = customDb || await getDatabase();
  let snapshot;

  if (typeof snapshotPathOrData === "string") {
    const validPath = validateSnapshotPath(snapshotPathOrData, false);
    const raw = readFileSync(validPath);
    if (validPath.endsWith(".gz")) {
      const decompressed = safeGunzip(raw);
      snapshot = JSON.parse(decompressed.toString("utf-8"));
    } else {
      snapshot = JSON.parse(raw.toString("utf-8"));
    }
  } else {
    snapshot = snapshotPathOrData;
  }

  if (!snapshot || !snapshot.version) {
    throw new Error("Invalid snapshot format");
  }

  // 1. Restore Blobs
  let blobCount = 0;
  if (Array.isArray(snapshot.blobs)) {
    for (const b of snapshot.blobs) {
      if (b.content) {
        await saveBlob(b.content, customBlobDir);
        blobCount++;
      }
    }
  }

  // 2. Database Inserts
  const insertDoc = db.prepare(`
    INSERT INTO documents (id, path, blob_hash, title, checksum, toc_json, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      path=excluded.path,
      blob_hash=excluded.blob_hash,
      title=excluded.title,
      checksum=excluded.checksum,
      toc_json=excluded.toc_json,
      metadata_json=excluded.metadata_json,
      updated_at=excluded.updated_at
  `);

  const insertSection = db.prepare(`
    INSERT INTO sections (id, doc_id, heading, breadcrumbs, content, token_count)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      heading=excluded.heading,
      breadcrumbs=excluded.breadcrumbs,
      content=excluded.content,
      token_count=excluded.token_count
  `);

  const insertMedium = db.prepare(`
    INSERT INTO medium_chunks (id, section_id, doc_id, content, block_type, token_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      content=excluded.content,
      block_type=excluded.block_type,
      token_count=excluded.token_count
  `);

  const insertChunk = db.prepare(`
    INSERT INTO micro_chunks (id, section_id, doc_id, content, vector, token_count, medium_id, retrieval_policy, policy_source_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      content=excluded.content,
      vector=excluded.vector,
      token_count=excluded.token_count,
      medium_id=excluded.medium_id,
      retrieval_policy=excluded.retrieval_policy,
      policy_source_id=excluded.policy_source_id
  `);

  const insertFts = db.prepare(`
    INSERT INTO micro_chunks_fts (id, content, breadcrumbs)
    VALUES (?, ?, ?)
  `);

  const deleteFts = db.prepare("DELETE FROM micro_chunks_fts WHERE id = ?");

  const insertEdge = db.prepare(`
    INSERT INTO graph_edges (source_id, target_id, relation_type, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_id, target_id, relation_type) DO UPDATE SET
      metadata_json=excluded.metadata_json,
      created_at=excluded.created_at
  `);
  const insertScope = db.prepare(`
    INSERT OR IGNORE INTO document_scopes (doc_id, scope_key, created_at)
    VALUES (?, ?, ?)
  `);
  const insertLink = db.prepare(`
    INSERT INTO knowledge_links
      (id, fact_key, fact_text, doc_id, section_id, start_line, end_line, relation_type, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      fact_key=excluded.fact_key,
      fact_text=excluded.fact_text,
      doc_id=excluded.doc_id,
      section_id=excluded.section_id,
      start_line=excluded.start_line,
      end_line=excluded.end_line,
      relation_type=excluded.relation_type,
      metadata_json=excluded.metadata_json,
      created_at=excluded.created_at
  `);

  await db.exec("BEGIN IMMEDIATE;");
  try {
    if (Array.isArray(snapshot.documents)) {
      for (const d of snapshot.documents) {
        await insertDoc.run(
          d.id,
          d.path,
          d.blob_hash,
          d.title,
          d.checksum,
          d.toc_json,
          d.metadata_json,
          d.created_at,
          d.updated_at
        );
      }
    }

    if (Array.isArray(snapshot.sections)) {
      for (const s of snapshot.sections) {
        await insertSection.run(s.id, s.doc_id, s.heading, s.breadcrumbs, s.content, s.token_count);
      }
    }

    if (Array.isArray(snapshot.document_scopes) && snapshot.document_scopes.length > 0) {
      for (const scope of snapshot.document_scopes) {
        await insertScope.run(scope.doc_id, scope.scope_key || "global", scope.created_at || Date.now());
      }
    } else if (Array.isArray(snapshot.documents)) {
      // v1/v2 snapshots predate project-scoped RAG and retain their historical
      // globally-visible behavior after import.
      for (const d of snapshot.documents) {
        await insertScope.run(d.id, "global", d.created_at || Date.now());
      }
    }

    if (Array.isArray(snapshot.medium_chunks)) {
      for (const m of snapshot.medium_chunks) {
        await insertMedium.run(m.id, m.section_id, m.doc_id, m.content, m.block_type, m.token_count, m.created_at || Date.now());
      }
    }

    if (Array.isArray(snapshot.micro_chunks)) {
      for (const mc of snapshot.micro_chunks) {
        let vecBuf = Buffer.alloc(0);
        if (mc.vector) {
          vecBuf = Buffer.from(mc.vector, "base64");
        }
        await insertChunk.run(
          mc.id,
          mc.section_id,
          mc.doc_id,
          mc.content,
          vecBuf,
          mc.token_count,
          mc.medium_id || null,
          mc.retrieval_policy || "micro_chunk",
          mc.policy_source_id || null
        );

        try {
          await deleteFts.run(mc.id);
        } catch {}
        await insertFts.run(mc.id, mc.content, mc.breadcrumbs || "");
      }
    }

    if (Array.isArray(snapshot.graph_edges)) {
      for (const e of snapshot.graph_edges) {
        await insertEdge.run(e.source_id, e.target_id, e.relation_type, e.metadata_json || null, e.created_at || null);
      }
    }
    if (Array.isArray(snapshot.knowledge_links)) {
      for (const link of snapshot.knowledge_links) {
        await insertLink.run(
          link.id,
          link.fact_key,
          link.fact_text,
          link.doc_id,
          link.section_id || null,
          link.start_line || null,
          link.end_line || null,
          link.relation_type || "LINKS_TO",
          link.metadata_json || null,
          link.created_at || Date.now()
        );
      }
    }
    await db.exec("COMMIT;");
  } catch (err) {
    await db.exec("ROLLBACK;");
    throw err;
  }

  return {
    documents: snapshot.documents ? snapshot.documents.length : 0,
    sections: snapshot.sections ? snapshot.sections.length : 0,
    medium_chunks: snapshot.medium_chunks ? snapshot.medium_chunks.length : 0,
    micro_chunks: snapshot.micro_chunks ? snapshot.micro_chunks.length : 0,
    graph_edges: snapshot.graph_edges ? snapshot.graph_edges.length : 0,
    knowledge_links: snapshot.knowledge_links ? snapshot.knowledge_links.length : 0,
    document_scopes: snapshot.document_scopes ? snapshot.document_scopes.length : 0,
    blobs: blobCount,
  };
}

export async function hardResetDatabase({ customDb = null, customBlobDir = BLOBS_DIR } = {}) {
  const db = customDb || await getDatabase();

  let docCount = 0;
  let chunkCount = 0;
  let blobCount = 0;

  try {
    const docRow = await db.prepare("SELECT COUNT(*) as cnt FROM documents").get();
    docCount = docRow ? docRow.cnt : 0;
    const chunkRow = await db.prepare("SELECT COUNT(*) as cnt FROM micro_chunks").get();
    chunkCount = chunkRow ? chunkRow.cnt : 0;
  } catch {}

  await db.exec("BEGIN IMMEDIATE;");
  try {
    try { await db.exec("DELETE FROM micro_chunks_fts;"); } catch {}
    try { await db.exec("DELETE FROM micro_chunks;"); } catch {}
    try { await db.exec("DELETE FROM medium_chunks;"); } catch {}
    try { await db.exec("DELETE FROM sections;"); } catch {}
    try { await db.exec("DELETE FROM graph_edges;"); } catch {}
    try { await db.exec("DELETE FROM knowledge_links;"); } catch {}
    try { await db.exec("DELETE FROM documents;"); } catch {}
    await db.exec("COMMIT;");
  } catch (err) {
    await db.exec("ROLLBACK;");
    throw err;
  }

  // Clear Blobs Directory
  if (existsSync(customBlobDir)) {
    try {
      const files = readdirSync(customBlobDir, { recursive: true });
      for (const f of files) {
        const fullPath = join(customBlobDir, f);
        try {
          const st = statSync(fullPath);
          if (st.isFile()) {
            rmSync(fullPath, { force: true });
            blobCount++;
          }
        } catch {}
      }
    } catch {}
  }

  try {
    await db.exec("VACUUM;");
  } catch {}

  return {
    purgedDocuments: docCount,
    purgedChunks: chunkCount,
    purgedBlobs: blobCount,
  };
}
