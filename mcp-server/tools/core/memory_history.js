import { randomUUID } from "node:crypto";
import { getDatabase } from "../../db/database.js";
import { readMemory, writeMemory } from "../../memory.js";

function factEdgePrefix(factKey) {
  return `fact:${factKey}:`;
}

function stableSnapshot(snapshot) {
  return {
    entries: [...(snapshot?.entries || [])],
    links: [...(snapshot?.links || [])],
    edges: [...(snapshot?.edges || [])],
  };
}

function snapshotsEqual(a, b) {
  return JSON.stringify(stableSnapshot(a)) === JSON.stringify(stableSnapshot(b));
}

export async function captureMemorySnapshot(factKey, entries = null) {
  const db = await getDatabase();
  const prefix = factEdgePrefix(factKey);
  const memoryEntries = entries ? [...entries] : await readMemory(factKey);
  const links = await db
    .prepare("SELECT * FROM knowledge_links WHERE fact_key = ? ORDER BY id")
    .all(factKey);
  const edges = await db
    .prepare(
      "SELECT source_id, target_id, relation_type, metadata_json, created_at FROM graph_edges " +
        "WHERE substr(source_id, 1, ?) = ? ORDER BY source_id, target_id, relation_type"
    )
    .all(prefix.length, prefix);

  return stableSnapshot({ entries: memoryEntries, links, edges });
}

export async function recordMemoryOperation({ factKey, operationType, beforeSnapshot, afterEntries }) {
  if (!beforeSnapshot) return null;
  const db = await getDatabase();
  const afterSnapshot = await captureMemorySnapshot(factKey, afterEntries);
  const id = `op_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await db
    .prepare(
      `INSERT INTO memory_operations
       (id, fact_key, operation_type, before_json, after_json, created_at, undone_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      id,
      factKey,
      operationType,
      JSON.stringify(stableSnapshot(beforeSnapshot)),
      JSON.stringify(afterSnapshot),
      Date.now()
    );
  return id;
}

async function restoreDatabaseSnapshot(db, factKey, snapshot) {
  const prefix = factEdgePrefix(factKey);
  await db.prepare("DELETE FROM knowledge_links WHERE fact_key = ?").run(factKey);
  await db
    .prepare("DELETE FROM graph_edges WHERE substr(source_id, 1, ?) = ?")
    .run(prefix.length, prefix);

  for (const link of snapshot.links || []) {
    await db
      .prepare(
        `INSERT INTO knowledge_links
         (id, fact_key, fact_text, doc_id, section_id, start_line, end_line, relation_type, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        link.id,
        link.fact_key,
        link.fact_text,
        link.doc_id,
        link.section_id ?? null,
        link.start_line ?? null,
        link.end_line ?? null,
        link.relation_type || "LINKS_TO",
        link.metadata_json ?? null,
        link.created_at
      );
  }

  for (const edge of snapshot.edges || []) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO graph_edges
         (source_id, target_id, relation_type, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        edge.source_id,
        edge.target_id,
        edge.relation_type,
        edge.metadata_json ?? null,
        edge.created_at ?? null
      );
  }
}

async function queueAffectedDocuments(db, snapshots) {
  try {
    const { queueDocumentSyncIfNeeded } = await import("../../graph/knowledge_linker.js");
    const docIds = new Set();
    for (const snapshot of snapshots) {
      for (const link of snapshot?.links || []) {
        if (link.doc_id) docIds.add(link.doc_id);
      }
    }
    for (const docId of docIds) await queueDocumentSyncIfNeeded(db, docId);
  } catch {}
}

export async function undoLastMemoryOperation(factKey) {
  const db = await getDatabase();
  const row = await db
    .prepare(
      `SELECT * FROM memory_operations
       WHERE fact_key = ? AND undone_at IS NULL
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`
    )
    .get(factKey);

  if (!row) return { ok: false, reason: "empty" };

  let beforeSnapshot;
  let afterSnapshot;
  try {
    beforeSnapshot = stableSnapshot(JSON.parse(row.before_json));
    afterSnapshot = stableSnapshot(JSON.parse(row.after_json));
  } catch {
    return { ok: false, reason: "corrupt", operationId: row.id };
  }

  const currentSnapshot = await captureMemorySnapshot(factKey);
  if (!snapshotsEqual(currentSnapshot, afterSnapshot)) {
    return {
      ok: false,
      reason: "conflict",
      operationId: row.id,
      operationType: row.operation_type,
    };
  }

  await db.exec("BEGIN;");
  try {
    await restoreDatabaseSnapshot(db, factKey, beforeSnapshot);
    await db.exec("COMMIT;");
  } catch (err) {
    try {
      await db.exec("ROLLBACK;");
    } catch {}
    throw err;
  }

  try {
    await writeMemory(factKey, beforeSnapshot.entries);
  } catch (err) {
    // Cross-file/SQLite updates cannot be one transaction. If the notebook write
    // fails, put the DB-side link state back so the operation remains retryable.
    try {
      await db.exec("BEGIN;");
      await restoreDatabaseSnapshot(db, factKey, currentSnapshot);
      await db.exec("COMMIT;");
    } catch {
      try {
        await db.exec("ROLLBACK;");
      } catch {}
    }
    throw err;
  }

  await db
    .prepare("UPDATE memory_operations SET undone_at = ? WHERE id = ?")
    .run(Date.now(), row.id);
  await queueAffectedDocuments(db, [currentSnapshot, beforeSnapshot]);

  return {
    ok: true,
    operationId: row.id,
    operationType: row.operation_type,
  };
}
