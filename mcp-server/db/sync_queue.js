import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { MEMORY_DIR, GLOBAL_KEY, buildMemoryContent, extractFacts, writeMemoryFile } from "../memory.js";
import { toVectorBytes } from "../retrieval/retriever.js";
import { pushBlobToCloud, deleteCloudBlobIfUnreferenced } from "./rag_blob_transport.js";
import { pullRagFromCloud } from "./rag_sync.js";

let isSyncing = false;
let syncRequested = false;

// Reverse sync (cloud -> local) throttling: only pull at most once per window
// even if readMemory/retrieval triggers it frequently.
let lastReverseSync = 0;
let isReverseSyncing = false;
const REVERSE_SYNC_INTERVAL_MS = 5000;

async function processSyncTask(db, task) {
  if (task.action === "write_memory") {
    await db.cloudClient.execute({
      sql: `
        INSERT INTO notebooks (key, content, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at;
      `,
      args: [task.key_or_id, task.payload, task.created_at],
    });
    return;
  }

  if (task.action === "delete_document") {
    const docId = task.key_or_id;
    const docRow = await db.cloudClient.execute({
      sql: "SELECT id, blob_hash FROM documents WHERE id = ? OR path = ?;",
      args: [docId, docId],
    });
    if (docRow.rows.length > 0) {
      const realDocId = docRow.rows[0].id;
      const blobHash = docRow.rows[0].blob_hash || null;
      await db.cloudClient.execute({
        sql: `DELETE FROM graph_edges
              WHERE source_id = ? OR target_id = ?
                 OR target_id GLOB ?
                 OR source_id IN (SELECT id FROM sections WHERE doc_id = ?)
                 OR target_id IN (SELECT id FROM sections WHERE doc_id = ?)
                 OR source_id IN (SELECT id FROM medium_chunks WHERE doc_id = ?)
                 OR target_id IN (SELECT id FROM medium_chunks WHERE doc_id = ?)
                 OR source_id IN (SELECT id FROM micro_chunks WHERE doc_id = ?)
                 OR target_id IN (SELECT id FROM micro_chunks WHERE doc_id = ?);`,
        args: [realDocId, realDocId, `${realDocId}:L*`, realDocId, realDocId, realDocId, realDocId, realDocId, realDocId],
      });
      await db.cloudClient.execute({ sql: "DELETE FROM micro_chunks_fts WHERE id IN (SELECT id FROM micro_chunks WHERE doc_id = ?);", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM micro_chunks WHERE doc_id = ?;", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM medium_chunks WHERE doc_id = ?;", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM sections WHERE doc_id = ?;", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM knowledge_links WHERE doc_id = ?;", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM documents WHERE id = ?;", args: [realDocId] });
      if (blobHash) await deleteCloudBlobIfUnreferenced(db, blobHash);
    }
    return;
  }

  if (task.action === "ingest_document") {
    const data = JSON.parse(task.payload);
    const doc = data.document;

    // Upload the content-addressed raw truth before publishing the document
    // structure. If blob transport fails, the task remains queued and the
    // remote side never receives a half-readable new document version.
    await pushBlobToCloud(db, doc.blob_hash);

    // 1. Delete existing doc from cloud if any
    const existingDocRow = await db.cloudClient.execute({
      sql: "SELECT id, blob_hash FROM documents WHERE id = ? OR path = ?;",
      args: [doc.id, doc.path],
    });
    let previousBlobHash = null;
    if (existingDocRow.rows.length > 0) {
      const realDocId = existingDocRow.rows[0].id;
      previousBlobHash = existingDocRow.rows[0].blob_hash || null;
      await db.cloudClient.execute({
        sql: `DELETE FROM graph_edges
              WHERE source_id = ? OR target_id = ?
                 OR target_id GLOB ?
                 OR source_id IN (SELECT id FROM sections WHERE doc_id = ?)
                 OR target_id IN (SELECT id FROM sections WHERE doc_id = ?)
                 OR source_id IN (SELECT id FROM medium_chunks WHERE doc_id = ?)
                 OR target_id IN (SELECT id FROM medium_chunks WHERE doc_id = ?)
                 OR source_id IN (SELECT id FROM micro_chunks WHERE doc_id = ?)
                 OR target_id IN (SELECT id FROM micro_chunks WHERE doc_id = ?);`,
        args: [realDocId, realDocId, `${realDocId}:L*`, realDocId, realDocId, realDocId, realDocId, realDocId, realDocId],
      });
      await db.cloudClient.execute({ sql: "DELETE FROM micro_chunks_fts WHERE id IN (SELECT id FROM micro_chunks WHERE doc_id = ?);", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM micro_chunks WHERE doc_id = ?;", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM medium_chunks WHERE doc_id = ?;", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM sections WHERE doc_id = ?;", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM knowledge_links WHERE doc_id = ?;", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM documents WHERE id = ?;", args: [realDocId] });
    }

    // 2. Insert document
    await db.cloudClient.execute({
      sql: `
        INSERT INTO documents (id, path, blob_hash, title, checksum, toc_json, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
      `,
      args: [
        doc.id,
        doc.path,
        doc.blob_hash,
        doc.title,
        doc.checksum,
        doc.toc_json ? (typeof doc.toc_json === "string" ? doc.toc_json : JSON.stringify(doc.toc_json)) : null,
        doc.metadata_json ? (typeof doc.metadata_json === "string" ? doc.metadata_json : JSON.stringify(doc.metadata_json)) : null,
        doc.created_at,
        doc.updated_at,
      ],
    });

    const scopes = Array.isArray(data.document_scopes) && data.document_scopes.length
      ? data.document_scopes
      : [{ scope_key: "global", created_at: doc.created_at }];
    for (const scope of scopes) {
      await db.cloudClient.execute({
        sql: "INSERT OR IGNORE INTO document_scopes (doc_id, scope_key, created_at) VALUES (?, ?, ?);",
        args: [doc.id, scope.scope_key || "global", scope.created_at || Date.now()],
      });
    }

    // 3. Insert sections
    if (Array.isArray(data.sections)) {
      for (const s of data.sections) {
        await db.cloudClient.execute({
          sql: "INSERT INTO sections (id, doc_id, heading, breadcrumbs, content, token_count) VALUES (?, ?, ?, ?, ?, ?);",
          args: [s.id, doc.id, s.heading, s.breadcrumbs, s.content, s.token_count],
        });
      }
    }

    // 4. Insert medium_chunks
    if (Array.isArray(data.medium_chunks)) {
      for (const m of data.medium_chunks) {
        await db.cloudClient.execute({
          sql: "INSERT INTO medium_chunks (id, section_id, doc_id, content, block_type, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?);",
          args: [m.id, m.section_id, doc.id, m.content, m.block_type, m.token_count, m.created_at || Date.now()],
        });
      }
    }

    // 5. Insert micro_chunks & FTS
    if (Array.isArray(data.micro_chunks)) {
      for (const mc of data.micro_chunks) {
        const vecBytes = toVectorBytes(mc.vector);
        const vecBuf = vecBytes
          ? Buffer.from(vecBytes.buffer, vecBytes.byteOffset, vecBytes.byteLength)
          : Buffer.alloc(0);
        await db.cloudClient.execute({
          sql: "INSERT INTO micro_chunks (id, section_id, doc_id, content, vector, token_count, medium_id, retrieval_policy, policy_source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
          args: [
            mc.id,
            mc.section_id,
            doc.id,
            mc.content,
            vecBuf,
            mc.token_count,
            mc.medium_id || null,
            mc.retrieval_policy || "micro_chunk",
            mc.policy_source_id || null,
          ],
        });

        try {
          await db.cloudClient.execute({
            sql: "INSERT INTO micro_chunks_fts (id, content, breadcrumbs) VALUES (?, ?, ?);",
            args: [mc.id, mc.content, mc.breadcrumbs || ""],
          });
        } catch (ftsErr) {
          console.warn("FTS insertion failed on cloud:", ftsErr.message);
        }
      }
    }

    // 6. Insert graph_edges
    if (Array.isArray(data.graph_edges)) {
      for (const e of data.graph_edges) {
        await db.cloudClient.execute({
          sql: "INSERT OR IGNORE INTO graph_edges (source_id, target_id, relation_type, metadata_json, created_at) VALUES (?, ?, ?, ?, ?);",
          args: [e.source_id, e.target_id, e.relation_type, e.metadata_json ? (typeof e.metadata_json === "string" ? e.metadata_json : JSON.stringify(e.metadata_json)) : null, e.created_at || Date.now()],
        });
      }
    }

    if (Array.isArray(data.knowledge_links)) {
      for (const link of data.knowledge_links) {
        await db.cloudClient.execute({
          sql: `INSERT OR REPLACE INTO knowledge_links
                (id, fact_key, fact_text, doc_id, section_id, start_line, end_line, relation_type, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          args: [
            link.id,
            link.fact_key,
            link.fact_text,
            doc.id,
            link.section_id || null,
            link.start_line || null,
            link.end_line || null,
            link.relation_type || "LINKS_TO",
            link.metadata_json || null,
            link.created_at || Date.now(),
          ],
        });
      }
    }

    if (previousBlobHash && previousBlobHash !== doc.blob_hash) {
      await deleteCloudBlobIfUnreferenced(db, previousBlobHash);
    }
  }
}

export async function enqueueSyncTask(action, keyOrId, payload = null) {
  const { getDatabase } = await import("./database.js");
  const db = await getDatabase();
  if (db.mode === "only-cloud") return;

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        key_or_id TEXT NOT NULL,
        payload TEXT,
        created_at INTEGER NOT NULL
    );
  `);

  await db.prepare(`
    INSERT INTO sync_queue (action, key_or_id, payload, created_at)
    VALUES (?, ?, ?, ?);
  `).run(action, keyOrId, payload ? (typeof payload === "string" ? payload : JSON.stringify(payload)) : null, Date.now());

  triggerBackgroundSync().catch((err) => {
    console.error("Background sync trigger error:", err.message);
  });
}

async function enumerateLocalStores() {
  const files = await readdir(MEMORY_DIR).catch(() => []);
  const stores = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const fp = join(MEMORY_DIR, f);
    let content = "";
    try {
      content = await readFile(fp, "utf-8");
    } catch (e) {
      continue;
    }
    const meta = content.match(/<!-- path: (.+?) -->/);
    const key = f === `${GLOBAL_KEY}.md` ? GLOBAL_KEY : (meta ? meta[1].trim() : f.slice(0, -3));
    stores.push({ key, path: fp, file: f });
  }
  return stores;
}

// Reverse sync: pull cloud Notebook state down to local stores, resolving
// conflicts according to config.conflictStrategy.
async function pullFromCloud(db) {
  const { getConfig } = await import("../config/config_manager.js");
  const config = getConfig();
  const strategy = config.conflictStrategy || "merge";

  const summary = { pulled: 0, pushed: 0, merged: 0, cloudWins: 0, localWins: 0, unchanged: 0, conflicts: 0 };

  const cloudRes = await db.cloudClient.execute("SELECT key, content FROM notebooks;");
  const cloudRows = cloudRes.rows || [];
  const cloudByKey = new Map(cloudRows.map((r) => [r.key, r.content || ""]));

  const localStores = await enumerateLocalStores();
  const localByKey = new Map(localStores.map((s) => [s.key, s.path]));
  const localContentByKey = new Map();
  for (const s of localStores) {
    try {
      localContentByKey.set(s.key, await readFile(s.path, "utf-8"));
    } catch (e) {}
  }

  const allKeys = new Set([...cloudByKey.keys(), ...localByKey.keys()]);

  const upsertCloud = async (key, content) => {
    await db.cloudClient.execute({
      sql: `
        INSERT INTO notebooks (key, content, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at;
      `,
      args: [key, content, Date.now()],
    });
  };

  for (const key of allKeys) {
    const cloudContent = cloudByKey.get(key);
    const localPath = localByKey.get(key);
    const localContent = localContentByKey.get(key) || "";

    const cloudFacts = cloudContent !== undefined ? extractFacts(cloudContent) : null;
    const localFacts = extractFacts(localContent);
    const cloudHas = cloudFacts !== null && cloudFacts.length > 0;
    const localHas = localFacts.length > 0;

    if (cloudFacts === null) {
      if (localHas) {
        await upsertCloud(key, localContent);
        summary.pushed++;
      }
      continue;
    }

    if (!localHas) {
      if (cloudHas) {
        await writeMemoryFile(key, cloudContent);
        summary.pulled++;
      }
      continue;
    }

    if (localContent === cloudContent) {
      summary.unchanged++;
      continue;
    }

    summary.conflicts++;
    if (strategy === "cloud-wins") {
      await writeMemoryFile(key, cloudContent);
      summary.cloudWins++;
    } else if (strategy === "local-wins") {
      await upsertCloud(key, localContent);
      summary.localWins++;
    } else {
      const seen = new Set();
      const mergedFacts = [];
      for (const l of [...localFacts, ...cloudFacts]) {
        if (!seen.has(l)) {
          seen.add(l);
          mergedFacts.push(l);
        }
      }
      const mergedContent = buildMemoryContent(key, mergedFacts);
      await writeMemoryFile(key, mergedContent);
      await upsertCloud(key, mergedContent);
      summary.merged++;
    }
  }

  return summary;
}

// Trigger a reverse sync now (regardless of throttle). Notebook memory and the
// normalized RAG corpus are restored together; RAG uses merge-style semantics
// and does not treat cloud absence as a deletion tombstone.
export async function syncFromCloud() {
  if (isReverseSyncing) return { skipped: true };
  isReverseSyncing = true;
  try {
    const { getDatabase } = await import("./database.js");
    const db = await getDatabase();
    if (db.mode !== "hybrid-sync" || !db.cloudClient) return { skipped: true };
    lastReverseSync = Date.now();
    const notebook = await pullFromCloud(db);
    const rag = await pullRagFromCloud(db);
    return { ...notebook, rag };
  } finally {
    isReverseSyncing = false;
  }
}

export async function ensureReverseSync() {
  if (Date.now() - lastReverseSync < REVERSE_SYNC_INTERVAL_MS) return { throttled: true };
  return syncFromCloud();
}

export function resetReverseSyncThrottle() {
  lastReverseSync = 0;
}

export async function triggerBackgroundSync() {
  if (isSyncing) {
    syncRequested = true;
    return;
  }
  isSyncing = true;
  syncRequested = false;

  try {
    const { getDatabase } = await import("./database.js");
    const db = await getDatabase();
    if (db.mode !== "hybrid-sync" || !db.cloudClient) {
      isSyncing = false;
      return;
    }

    await db.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL,
          key_or_id TEXT NOT NULL,
          payload TEXT,
          created_at INTEGER NOT NULL
      );
    `);

    let syncFailed = false;
    while (!syncFailed) {
      const tasks = await db.prepare("SELECT * FROM sync_queue ORDER BY id ASC LIMIT 50;").all();
      if (tasks.length === 0) break;

      for (const task of tasks) {
        try {
          await processSyncTask(db, task);
          await db.prepare("DELETE FROM sync_queue WHERE id = ?;").run(task.id);
        } catch (err) {
          console.error(`Failed to process sync task ${task.id} (${task.action}):`, err.message, err.stack);
          syncFailed = true;
          break;
        }
      }
    }

    await syncFromCloud();
  } catch (err) {
    console.error("Error during background sync execution:", err.message);
  } finally {
    isSyncing = false;
    if (syncRequested) {
      syncRequested = false;
      await triggerBackgroundSync();
    }
  }
}
