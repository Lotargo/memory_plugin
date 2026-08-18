import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BLOBS_DIR } from "../db/database.js";

export const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;

export function safeGunzip(compressed, maxBytes = MAX_UNPACKED_BYTES) {
  const decompressed = gunzipSync(compressed, { maxOutputLength: maxBytes });
  if (decompressed.length > maxBytes) {
    throw new Error(
      `Decompressed payload of ${decompressed.length} bytes exceeds the ${maxBytes} byte limit.`
    );
  }
  return decompressed;
}

export function hashContent(data) {
  const hash = createHash("sha256");
  hash.update(data);
  return hash.digest("hex");
}

export function getBlobPath(hash, baseDir = BLOBS_DIR) {
  const prefix = hash.substring(0, 2);
  return join(baseDir, prefix, `${hash}.raw.gz`);
}

export async function blobExists(hash, baseDir = BLOBS_DIR) {
  const blobPath = getBlobPath(hash, baseDir);
  return existsSync(blobPath);
}

export async function saveBlob(content, baseDir = BLOBS_DIR) {
  const buffer = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  const hash = hashContent(buffer);
  const blobPath = getBlobPath(hash, baseDir);

  if (existsSync(blobPath)) {
    return { hash, size: buffer.length, path: blobPath, deduplicated: true };
  }

  const parentDir = join(blobPath, "..");
  if (!existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true });
  }

  const compressed = gzipSync(buffer);
  await writeFile(blobPath, compressed);

  return { hash, size: buffer.length, path: blobPath, deduplicated: false };
}

export async function readBlob(hash, baseDir = BLOBS_DIR) {
  const blobPath = getBlobPath(hash, baseDir);
  if (!existsSync(blobPath)) {
    throw new Error(`Blob not found for hash: ${hash}`);
  }

  const compressed = await readFile(blobPath);
  const decompressed = safeGunzip(compressed);
  return decompressed.toString("utf-8");
}

/**
 * Return the exact gzip bytes used by the local content-addressed blob store as
 * base64 text for portable SQLite/Turso transport. The raw content is validated
 * against the requested SHA-256 before leaving the machine.
 */
export async function readBlobTransport(hash, baseDir = BLOBS_DIR) {
  const blobPath = getBlobPath(hash, baseDir);
  if (!existsSync(blobPath)) {
    throw new Error(`Blob not found for hash: ${hash}`);
  }
  const compressed = await readFile(blobPath);
  const decompressed = safeGunzip(compressed);
  const actualHash = hashContent(decompressed);
  if (actualHash !== hash) {
    throw new Error(`Blob integrity check failed: expected ${hash}, received ${actualHash}`);
  }
  return {
    hash,
    gzipBase64: compressed.toString("base64"),
    rawSize: decompressed.length,
  };
}

/**
 * Materialize a transported gzip blob into the local filesystem only after
 * decompression and SHA-256 verification. This prevents a corrupt/cloud payload
 * from poisoning the local content-addressed store.
 */
export async function saveBlobTransport(hash, gzipBase64, baseDir = BLOBS_DIR) {
  if (!/^[a-f0-9]{64}$/i.test(String(hash || ""))) {
    throw new Error(`Invalid blob hash: ${hash}`);
  }
  if (typeof gzipBase64 !== "string" || !gzipBase64) {
    throw new Error(`Missing transported blob content for hash: ${hash}`);
  }

  const compressed = Buffer.from(gzipBase64, "base64");
  const decompressed = safeGunzip(compressed);
  const actualHash = hashContent(decompressed);
  if (actualHash !== hash) {
    throw new Error(`Transported blob integrity check failed: expected ${hash}, received ${actualHash}`);
  }

  const blobPath = getBlobPath(hash, baseDir);
  if (existsSync(blobPath)) {
    return { hash, size: decompressed.length, path: blobPath, deduplicated: true };
  }
  const parentDir = join(blobPath, "..");
  if (!existsSync(parentDir)) await mkdir(parentDir, { recursive: true });
  await writeFile(blobPath, compressed);
  return { hash, size: decompressed.length, path: blobPath, deduplicated: false };
}

export async function deleteBlob(hash, baseDir = BLOBS_DIR) {
  const blobPath = getBlobPath(hash, baseDir);
  if (existsSync(blobPath)) {
    await unlink(blobPath);
    return true;
  }
  return false;
}
