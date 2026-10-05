import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import JSZip from "jszip";
import { getBlobPath } from "../storage/blob_store.js";
import { atomicWrite } from "../storage/snapshot_lock.js";
import { hasKnowledgeSchema, createKnowledgeSchema, KNOWLEDGE_COLUMNS, KNOWLEDGE_TABLES, restoreKnowledgeRevisions, rebuildLinkProjections } from '../storage/knowledge_schema.js';
import { prepareKnowledge, recordKnowledgeCommit, recoverKnowledgeSync, journalPath } from '../storage/knowledge_recovery.js';

export const TABLES = {
  project_identities: ["key", "name", "primary_remote", "created_at", "updated_at"],
  project_aliases: ["alias", "identity_key", "kind", "created_at"],
  documents: ["id", "path", "blob_hash", "title", "checksum", "toc_json", "metadata_json", "created_at", "updated_at"],
  sections: ["id", "doc_id", "heading", "breadcrumbs", "content", "token_count"],
  medium_chunks: ["id", "section_id", "doc_id", "content", "block_type", "token_count", "created_at"],
  micro_chunks: ["id", "section_id", "doc_id", "content", "vector", "token_count", "medium_id", "retrieval_policy", "policy_source_id"],
  document_scopes: ["doc_id", "scope_key", "created_at"],
  knowledge_links: ["id", "fact_key", "fact_text", "doc_id", "section_id", "start_line", "end_line", "relation_type", "metadata_json", "created_at"],
  graph_edges: ["source_id", "target_id", "relation_type", "metadata_json", "created_at"],
  rag_document_tombstones: ["doc_id", "path", "deleted_at"],
};
const HASH = /^[a-f0-9]{64}$/;
export const TABLES_V2 = { ...TABLES,
  documents: [...TABLES.documents, ...KNOWLEDGE_COLUMNS.documents],
  knowledge_links: [...TABLES.knowledge_links, ...KNOWLEDGE_COLUMNS.knowledge_links], ...KNOWLEDGE_TABLES };
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
export const sha256 = value => createHash("sha256").update(value).digest("hex");
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const stateHash = payload => sha256(canonical(payload));
export function encodeRows(rows) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) =>
    [k, k === "vector" ? Buffer.from(v).toString("base64") : typeof v === "bigint" ? Number(v) : v]
  ))).sort((a, b) => canonical(a).localeCompare(canonical(b), "en"));
}

export function captureLocal(db, memoryDir, blobDir, config, transaction = true) {
  const raw = db.localDb;
  if (!raw) throw new Error("Full local snapshot requires a local database");
  if (transaction) raw.exec("BEGIN IMMEDIATE");
  try {
    const tables = {};
    const modern = hasKnowledgeSchema(raw), layout = modern ? TABLES_V2 : TABLES;
    for (const [table, columns] of Object.entries(layout)) {
      tables[table] = encodeRows(raw.prepare(`SELECT ${columns.join(",")} FROM ${table}`).all());
    }
    const notebooks = fs.readdirSync(memoryDir).filter(f => f.endsWith(".md")).sort().map(file => ({
      file, content: fs.readFileSync(path.join(memoryDir, file), "utf8"),
    }));
    const blobs = {};
    for (const { blob_hash: hash } of tables.documents) {
      if (!HASH.test(hash)) throw new Error("Invalid document blob hash");
      if (!(hash in blobs)) {
        const content = gunzipSync(fs.readFileSync(getBlobPath(hash, blobDir)), { maxOutputLength: 512 * 1024 * 1024 }).toString("utf8");
        if (sha256(content) !== hash) throw new Error(`Corrupt blob ${hash}; snapshot aborted`);
        blobs[hash] = content;
      }
    }
    const payload = { format: "memory-full", version: modern ? 2 : 1, tables, notebooks, blobs,
      settings: { embeddingModel: config.embeddingModel, vectorDimension: config.vectorDimension } };
    if (transaction) raw.exec("COMMIT");
    return payload;
  } catch (error) { if (transaction) raw.exec("ROLLBACK"); throw error; }
}

export function validatePayload(payload) {
  if (payload?.format !== "memory-full" || ![1, 2].includes(payload.version)) throw new Error("Unsupported full snapshot format");
  if (!payload.tables || !Array.isArray(payload.notebooks) || !payload.blobs || !payload.settings) throw new Error("Incomplete snapshot");
  const files = new Set();
  for (const store of payload.notebooks) {
    if (typeof store.file !== "string" || !/^[^\\/\x00-\x1f:]+\.md$/.test(store.file) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\./i.test(store.file) || store.file === ".md" || typeof store.content !== "string") throw new Error("Invalid Notebook file");
    const name = store.file.toLowerCase();
    if (files.has(name)) throw new Error("Duplicate Notebook file");
    files.add(name);
  }
  const layout = payload.version === 2 ? TABLES_V2 : TABLES;
  if (Object.keys(payload.tables).some(name => !Object.hasOwn(layout, name))) throw new Error('Unknown snapshot table');
  for (const [table, columns] of Object.entries(layout)) {
    if (!Array.isArray(payload.tables[table])) throw new Error(`Missing table ${table}`);
    for (const row of payload.tables[table]) {
      if (!row || Object.keys(row).length !== columns.length || columns.some(k => !(k in row))) throw new Error(`Invalid row in ${table}`);
      for (const [key, value] of Object.entries(row)) {
        if (value !== null && typeof value !== "string" && typeof value !== "number") throw new Error(`Invalid ${table}.${key}`);
        if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error(`Invalid integer ${table}.${key}`);
      }
      if (table === "micro_chunks" && (typeof row.vector !== "string" || !BASE64.test(row.vector) || Buffer.from(row.vector, "base64").length % 4)) throw new Error("Invalid vector encoding");
      if (payload.version === 2 && table === 'documents' && KNOWLEDGE_COLUMNS.documents.some(key => !Number.isSafeInteger(row[key]) || row[key] < 1)) throw new Error('Invalid document revision');
      if (payload.version === 2 && table === 'knowledge_links' && (!['valid', 'needs_review', 'orphaned'].includes(row.status) || !Number.isSafeInteger(row.revision) || row.revision < 1 || (row.fact_id !== null && typeof row.fact_id !== 'string') || (row.source_revision !== null && (!Number.isSafeInteger(row.source_revision) || row.source_revision < 1)))) throw new Error('Invalid link state');
    }
  }
  for (const [hash, content] of Object.entries(payload.blobs)) {
    if (!HASH.test(hash) || typeof content !== "string" || sha256(content) !== hash) throw new Error("Blob integrity check failed");
  }
  for (const row of payload.tables.documents) if (!(row.blob_hash in payload.blobs)) throw new Error("Missing document blob");
  if (typeof payload.settings.embeddingModel !== "string" || !Number.isSafeInteger(payload.settings.vectorDimension) || payload.settings.vectorDimension < 0) throw new Error("Invalid embedding settings");
  return payload;
}

export async function packPayload(payload) {
  validatePayload(payload);
  const zip = new JSZip();
  zip.file("memory.json", canonical(payload), { date: new Date("1980-01-01T00:00:00Z") });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
}
export async function unpackPayload(bytes, checksum, expectedHash, maxBytes = 512 * 1024 * 1024) {
  if (sha256(bytes) !== checksum) throw new Error("ZIP checksum mismatch");
  const zip = await JSZip.loadAsync(bytes);
  if (Object.keys(zip.files).length !== 1 || !zip.file("memory.json")) throw new Error("Unexpected ZIP entries");
  const content = await new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    const stream = zip.file("memory.json").internalStream("nodebuffer");
    stream.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) { stream.pause(); reject(new Error("Unpacked snapshot exceeds local safety limit")); }
      else chunks.push(chunk);
    }).on("error", reject).on("end", () => resolve(Buffer.concat(chunks))).resume();
  });
  const payload = validatePayload(JSON.parse(content.toString("utf8")));
  if (stateHash(payload) !== expectedHash) throw new Error("Snapshot state hash mismatch");
  return payload;
}

// The caller owns the shared file lock. K2 restores publish Notebook files
// through the same committed journal as edits; immutable blobs may be staged
// earlier, but no mixed Notebook/SQL state becomes readable after a crash.
export function replaceLocal(payload, db, memoryDir, blobDir, restoreMarker, expectedHash, config, { afterCommit } = {}) {
  validatePayload(payload);
  const raw = db.localDb;
  const oldFiles = new Map(fs.readdirSync(memoryDir).filter(f => f.endsWith(".md")).map(f => [f, fs.readFileSync(path.join(memoryDir, f))]));
  const addedBlobs = [];
  let prepared, committed = false;
  raw.exec("BEGIN IMMEDIATE");
  try {
    if (expectedHash && stateHash(captureLocal(db, memoryDir, blobDir, config, false)) !== expectedHash) throw new Error("Memory changed during backup; preview restore again");
    for (const [hash, content] of Object.entries(payload.blobs)) {
      const file = getBlobPath(hash, blobDir);
      if (!fs.existsSync(file)) { atomicWrite(file, gzipSync(content)); addedBlobs.push(file); }
      else if (sha256(gunzipSync(fs.readFileSync(file), { maxOutputLength: 512 * 1024 * 1024 })) !== hash) throw new Error(`Corrupt existing blob ${hash}`);
    }
    if (payload.version === 2) createKnowledgeSchema(raw);
    const layout = payload.version === 2 ? TABLES_V2 : TABLES;
    raw.exec("DELETE FROM micro_chunks_fts");
    for (const table of Object.keys(hasKnowledgeSchema(raw) ? TABLES_V2 : TABLES).reverse()) raw.exec(`DELETE FROM ${table}`);
    for (const [table, columns] of Object.entries(layout)) {
      const insert = raw.prepare(`INSERT ${table === 'knowledge_scope_revisions' ? 'OR REPLACE ' : ''}INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
      for (const row of payload.tables[table]) insert.run(...columns.map(k => k === "vector" ? Buffer.from(row[k], "base64") : row[k]));
    }
    restoreKnowledgeRevisions(raw, payload.tables.documents, payload.tables.knowledge_links, payload.version === 2);
    if (hasKnowledgeSchema(raw)) rebuildLinkProjections(raw);
    raw.exec(`INSERT INTO micro_chunks_fts(id,content,breadcrumbs)
      SELECT c.id,c.content,s.breadcrumbs FROM micro_chunks c JOIN sections s ON s.id=c.section_id`);
    if (raw.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Snapshot has broken relational references");
    if (raw.prepare("SELECT name FROM sqlite_master WHERE name='sync_queue'").get()) raw.exec("DELETE FROM sync_queue");
    raw.exec("DELETE FROM sync_state; DELETE FROM notebooks; DELETE FROM rag_blobs");
    raw.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES ('snapshot_restore_id',?,?)").run(restoreMarker, Date.now());
    const keep = new Set(payload.notebooks.map(n => n.file.toLowerCase()));
    if (hasKnowledgeSchema(raw)) {
      const files = [...payload.notebooks, ...[...oldFiles.keys()].filter(file => !keep.has(file.toLowerCase())).map(file => ({ file, content: null }))];
      prepared = prepareKnowledge(memoryDir, files, { pruneLedger: true });
      recordKnowledgeCommit(raw, prepared);
    } else {
      for (const store of payload.notebooks) atomicWrite(path.join(memoryDir, store.file), store.content);
      for (const file of oldFiles.keys()) if (!keep.has(file.toLowerCase())) fs.unlinkSync(path.join(memoryDir, file));
    }
    raw.exec("COMMIT"); committed = true;
    if (afterCommit) afterCommit();
    if (prepared) recoverKnowledgeSync(memoryDir, raw);
  } catch (error) {
    if (committed) throw error; // committed journal owns recovery; never undo SQL
    raw.exec("ROLLBACK");
    if (prepared) fs.unlinkSync(journalPath(memoryDir));
    for (const file of fs.readdirSync(memoryDir).filter(f => f.endsWith(".md"))) if (!oldFiles.has(file)) fs.unlinkSync(path.join(memoryDir, file));
    for (const [file, bytes] of oldFiles) atomicWrite(path.join(memoryDir, file), bytes);
    for (const file of addedBlobs) fs.unlinkSync(file);
    throw error;
  }
}
