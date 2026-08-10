import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BLOBS_DIR } from "../db/database.js";

// Hard cap on gunzip output to prevent zip-bomb style memory exhaustion.
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

export async function deleteBlob(hash, baseDir = BLOBS_DIR) {
  const blobPath = getBlobPath(hash, baseDir);
  if (existsSync(blobPath)) {
    await unlink(blobPath);
    return true;
  }
  return false;
}
