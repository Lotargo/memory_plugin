import { BLOBS_DIR } from "./database.js";
import {
  blobExists,
  readBlobTransport,
  saveBlobTransport,
} from "../storage/blob_store.js";

async function executeCloud(db, sql, args = []) {
  if (!db?.cloudClient && !db?.failoverClient) {
    throw new Error("Cloud database client is not available for RAG blob transport");
  }
  if (typeof db.runWithRetry === "function") {
    return await db.runWithRetry(async (client) => client.execute({ sql, args }));
  }
  return await db.cloudClient.execute({ sql, args });
}

export async function pushBlobToCloud(db, hash, baseDir = BLOBS_DIR) {
  if (!hash) return { skipped: true, reason: "missing_hash" };
  if (!db || db.mode === "only-local") return { skipped: true, reason: "local_mode" };

  const transport = await readBlobTransport(hash, baseDir);
  await executeCloud(
    db,
    `INSERT INTO rag_blobs (hash, gzip_base64, raw_size, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(hash) DO NOTHING;`,
    [transport.hash, transport.gzipBase64, transport.rawSize, Date.now()]
  );
  return { pushed: true, hash, rawSize: transport.rawSize };
}

/**
 * Upgrade/backfill path for documents that existed before portable cloud blobs.
 * Existing cloud hashes are fetched once, then only missing local blobs are sent.
 */
export async function backfillCloudBlobsFromLocal(db, baseDir = BLOBS_DIR) {
  if (!db || db.mode === "only-local") return { skipped: true };

  const docs = await db.prepare("SELECT DISTINCT blob_hash FROM documents WHERE blob_hash IS NOT NULL;").all();
  const cloudRes = await executeCloud(db, "SELECT hash FROM rag_blobs;");
  const existing = new Set((cloudRes?.rows || []).map((row) => row.hash));
  const summary = { candidates: docs.length, pushed: 0, existing: 0, missingLocal: 0, errors: 0 };

  for (const row of docs) {
    const hash = row.blob_hash;
    if (!hash) continue;
    if (existing.has(hash)) {
      summary.existing++;
      continue;
    }
    if (!(await blobExists(hash, baseDir))) {
      summary.missingLocal++;
      continue;
    }
    try {
      await pushBlobToCloud(db, hash, baseDir);
      existing.add(hash);
      summary.pushed++;
    } catch (err) {
      summary.errors++;
      console.warn(`Failed to backfill RAG blob ${hash}: ${err.message}`);
    }
  }

  return summary;
}

export async function materializeBlobFromCloud(db, hash, baseDir = BLOBS_DIR) {
  if (!hash) return { materialized: false, reason: "missing_hash" };
  if (await blobExists(hash, baseDir)) {
    return { materialized: false, existing: true, hash };
  }
  if (!db || db.mode === "only-local") {
    return { materialized: false, reason: "local_mode", hash };
  }

  const res = await executeCloud(
    db,
    "SELECT gzip_base64, raw_size FROM rag_blobs WHERE hash = ?;",
    [hash]
  );
  const row = res?.rows?.[0];
  if (!row?.gzip_base64) {
    return { materialized: false, reason: "cloud_blob_missing", hash };
  }

  const saved = await saveBlobTransport(hash, row.gzip_base64, baseDir);
  return {
    materialized: true,
    hash,
    rawSize: Number(row.raw_size || saved.size || 0),
    path: saved.path,
  };
}

export async function deleteCloudBlobIfUnreferenced(db, hash) {
  if (!hash || !db || db.mode === "only-local") return { deleted: false };
  const refs = await executeCloud(
    db,
    "SELECT COUNT(*) AS cnt FROM documents WHERE blob_hash = ?;",
    [hash]
  );
  const count = Number(refs?.rows?.[0]?.cnt || 0);
  if (count > 0) return { deleted: false, references: count };

  await executeCloud(db, "DELETE FROM rag_blobs WHERE hash = ?;", [hash]);
  return { deleted: true, references: 0 };
}

export async function cloudBlobExists(db, hash) {
  if (!hash || !db || db.mode === "only-local") return false;
  const res = await executeCloud(db, "SELECT hash FROM rag_blobs WHERE hash = ?;", [hash]);
  return Boolean(res?.rows?.length);
}
