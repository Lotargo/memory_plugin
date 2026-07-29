import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { getDatabase, BLOBS_DIR } from "../db/database.js";
import { readBlob, saveBlob } from "../storage/blob_store.js";

export async function exportSnapshot({ customDb = null, customBlobDir = BLOBS_DIR, outputPath = null } = {}) {
  const db = customDb || getDatabase();

  const documents = db.prepare("SELECT * FROM documents").all();
  const sections = db.prepare("SELECT * FROM sections").all();
  const rawMicroChunks = db.prepare("SELECT * FROM micro_chunks").all();
  const graphEdges = db.prepare("SELECT * FROM graph_edges").all();

  const microChunks = rawMicroChunks.map((mc) => {
    let vecBase64 = "";
    if (mc.vector) {
      const buf = Buffer.isBuffer(mc.vector) ? mc.vector : Buffer.from(mc.vector);
      vecBase64 = buf.toString("base64");
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
    version: 1,
    created_at: new Date().toISOString(),
    documents,
    sections,
    micro_chunks: microChunks,
    graph_edges: graphEdges,
    blobs,
  };

  const jsonStr = JSON.stringify(snapshot, null, 2);

  if (outputPath) {
    if (outputPath.endsWith(".gz")) {
      const gzipped = gzipSync(Buffer.from(jsonStr, "utf-8"));
      writeFileSync(outputPath, gzipped);
    } else {
      writeFileSync(outputPath, jsonStr, "utf-8");
    }
  }

  return snapshot;
}

export async function importSnapshot({ customDb = null, customBlobDir = BLOBS_DIR, snapshotPathOrData } = {}) {
  const db = customDb || getDatabase();
  let snapshot;

  if (typeof snapshotPathOrData === "string") {
    if (!existsSync(snapshotPathOrData)) {
      throw new Error(`Snapshot file not found: ${snapshotPathOrData}`);
    }
    const raw = readFileSync(snapshotPathOrData);
    if (snapshotPathOrData.endsWith(".gz")) {
      const decompressed = gunzipSync(raw);
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

  // 2. Database Insert
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

  const insertChunk = db.prepare(`
    INSERT INTO micro_chunks (id, section_id, doc_id, content, vector, token_count)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      content=excluded.content,
      vector=excluded.vector,
      token_count=excluded.token_count
  `);

  const insertFts = db.prepare(`
    INSERT INTO micro_chunks_fts (id, content, breadcrumbs)
    VALUES (?, ?, ?)
  `);

  const deleteFts = db.prepare("DELETE FROM micro_chunks_fts WHERE id = ?");

  const insertEdge = db.prepare(`
    INSERT INTO graph_edges (source_id, target_id, relation_type)
    VALUES (?, ?, ?)
    ON CONFLICT(source_id, target_id, relation_type) DO NOTHING
  `);

  if (Array.isArray(snapshot.documents)) {
    for (const d of snapshot.documents) {
      insertDoc.run(
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
      insertSection.run(s.id, s.doc_id, s.heading, s.breadcrumbs, s.content, s.token_count);
    }
  }

  if (Array.isArray(snapshot.micro_chunks)) {
    for (const mc of snapshot.micro_chunks) {
      let vecBuf = Buffer.alloc(0);
      if (mc.vector) {
        vecBuf = Buffer.from(mc.vector, "base64");
      }
      insertChunk.run(mc.id, mc.section_id, mc.doc_id, mc.content, vecBuf, mc.token_count);

      // Refresh FTS
      try {
        deleteFts.run(mc.id);
      } catch {
        // ignore if not present
      }
      insertFts.run(mc.id, mc.content, mc.breadcrumbs || "");
    }
  }

  if (Array.isArray(snapshot.graph_edges)) {
    for (const e of snapshot.graph_edges) {
      insertEdge.run(e.source_id, e.target_id, e.relation_type);
    }
  }

  return {
    documents: snapshot.documents ? snapshot.documents.length : 0,
    sections: snapshot.sections ? snapshot.sections.length : 0,
    micro_chunks: snapshot.micro_chunks ? snapshot.micro_chunks.length : 0,
    graph_edges: snapshot.graph_edges ? snapshot.graph_edges.length : 0,
    blobs: blobCount,
  };
}
