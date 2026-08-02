let isSyncing = false;

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
      sql: "SELECT id FROM documents WHERE id = ? OR path = ?;",
      args: [docId, docId],
    });
    if (docRow.rows.length > 0) {
      const realDocId = docRow.rows[0].id;
      await db.cloudClient.execute({ sql: "DELETE FROM micro_chunks_fts WHERE id IN (SELECT id FROM micro_chunks WHERE doc_id = ?);", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM micro_chunks WHERE doc_id = ?;", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM medium_chunks WHERE doc_id = ?;", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM sections WHERE doc_id = ?;", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM graph_edges WHERE source_id = ? OR target_id = ?;", args: [realDocId, realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM knowledge_links WHERE doc_id = ?;", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM documents WHERE id = ?;", args: [realDocId] });
    }
    return;
  }

  if (task.action === "ingest_document") {
    const data = JSON.parse(task.payload);
    const doc = data.document;

    // 1. Delete existing doc from cloud if any
    const existingDocRow = await db.cloudClient.execute({
      sql: "SELECT id FROM documents WHERE id = ? OR path = ?;",
      args: [doc.id, doc.path],
    });
    if (existingDocRow.rows.length > 0) {
      const realDocId = existingDocRow.rows[0].id;
      await db.cloudClient.execute({ sql: "DELETE FROM micro_chunks_fts WHERE id IN (SELECT id FROM micro_chunks WHERE doc_id = ?);", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM micro_chunks WHERE doc_id = ?;", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM medium_chunks WHERE doc_id = ?;", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM sections WHERE doc_id = ?;", args: [realDocId] });
      await db.cloudClient.execute({ sql: "DELETE FROM graph_edges WHERE source_id = ? OR target_id = ?;", args: [realDocId, realDocId] });
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
        let vecBuf = Buffer.alloc(0);
        if (mc.vector) {
          if (Buffer.isBuffer(mc.vector)) {
            vecBuf = mc.vector;
          } else if (typeof mc.vector === "string") {
            vecBuf = Buffer.from(mc.vector, "base64");
          } else if (mc.vector.type === "Buffer" && Array.isArray(mc.vector.data)) {
            vecBuf = Buffer.from(mc.vector.data);
          } else if (Array.isArray(mc.vector)) {
            vecBuf = Buffer.from(mc.vector);
          }
        }
        await db.cloudClient.execute({
          sql: "INSERT INTO micro_chunks (id, section_id, doc_id, content, vector, token_count, medium_id) VALUES (?, ?, ?, ?, ?, ?, ?);",
          args: [mc.id, mc.section_id, doc.id, mc.content, vecBuf, mc.token_count, mc.medium_id || null],
        });

        // Insert into remote FTS
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
  }
}

export async function enqueueSyncTask(action, keyOrId, payload = null) {
  const { getDatabase } = await import("./database.js");
  const db = await getDatabase();
  if (db.mode === "only-cloud") return; // No need to queue in only-cloud mode

  // Ensure queue table exists
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

  // Trigger background sync worker asynchronously
  triggerBackgroundSync().catch((err) => {
    console.error("Background sync trigger error:", err.message);
  });
}

export async function triggerBackgroundSync() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const { getDatabase } = await import("./database.js");
    const db = await getDatabase();
    if (db.mode !== "hybrid-sync" || !db.cloudClient) {
      isSyncing = false;
      return;
    }

    // Ensure table exists
    await db.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL,
          key_or_id TEXT NOT NULL,
          payload TEXT,
          created_at INTEGER NOT NULL
      );
    `);

    // Fetch tasks ordered by id
    const tasks = await db.prepare("SELECT * FROM sync_queue ORDER BY id ASC LIMIT 50;").all();
    if (tasks.length === 0) {
      isSyncing = false;
      return;
    }

    for (const task of tasks) {
      try {
        await processSyncTask(db, task);
        // On success, delete from queue
        await db.prepare("DELETE FROM sync_queue WHERE id = ?;").run(task.id);
      } catch (err) {
        console.error(`Failed to process sync task ${task.id} (${task.action}):`, err.message, err.stack);
        // Stop processing this batch to preserve order on error, retry next time
        break;
      }
    }
  } catch (err) {
    console.error("Error during background sync execution:", err.message);
  } finally {
    isSyncing = false;
  }
}
