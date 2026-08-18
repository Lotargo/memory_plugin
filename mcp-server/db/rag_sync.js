import { toVectorBytes } from "../retrieval/retriever.js";
import { deleteBlob } from "../storage/blob_store.js";
import { materializeBlobFromCloud } from "./rag_blob_transport.js";

async function executeCloud(db, sql, args = []) {
  if (!db?.cloudClient && !db?.failoverClient) {
    throw new Error("Cloud database client is not available for RAG reverse sync");
  }
  if (typeof db.runWithRetry === "function") {
    return await db.runWithRetry(async (client) => client.execute({ sql, args }));
  }
  return await db.cloudClient.execute({ sql, args });
}

export async function recordCloudDocumentTombstone(db, { docId, path = null, deletedAt = Date.now() }) {
  if (!docId || !db || db.mode === "only-local") return { recorded: false };
  await executeCloud(
    db,
    `INSERT INTO rag_document_tombstones (doc_id, path, deleted_at)
     VALUES (?, ?, ?)
     ON CONFLICT(doc_id) DO UPDATE SET path = excluded.path, deleted_at = excluded.deleted_at;`,
    [docId, path || null, deletedAt]
  );
  return { recorded: true, docId, path, deletedAt };
}

export async function clearCloudDocumentTombstone(db, { docId, path = null }) {
  if (!db || db.mode === "only-local") return { cleared: false };
  if (!docId && !path) return { cleared: false };
  await executeCloud(
    db,
    "DELETE FROM rag_document_tombstones WHERE doc_id = ? OR (? IS NOT NULL AND path = ?);",
    [docId || "", path || null, path || null]
  );
  return { cleared: true };
}

async function fetchRemoteDocumentBundle(db, doc) {
  const [sectionsRes, mediumRes, microRes, scopesRes, linksRes, edgesRes] = await Promise.all([
    executeCloud(db, "SELECT * FROM sections WHERE doc_id = ? ORDER BY id;", [doc.id]),
    executeCloud(db, "SELECT * FROM medium_chunks WHERE doc_id = ? ORDER BY id;", [doc.id]),
    executeCloud(db, "SELECT * FROM micro_chunks WHERE doc_id = ? ORDER BY id;", [doc.id]),
    executeCloud(db, "SELECT * FROM document_scopes WHERE doc_id = ? ORDER BY scope_key;", [doc.id]),
    executeCloud(db, "SELECT * FROM knowledge_links WHERE doc_id = ? ORDER BY id;", [doc.id]),
    executeCloud(
      db,
      `SELECT * FROM graph_edges
       WHERE source_id = ? OR target_id = ?
          OR source_id GLOB ? OR target_id GLOB ?
          OR source_id IN (SELECT id FROM sections WHERE doc_id = ?)
          OR target_id IN (SELECT id FROM sections WHERE doc_id = ?)
          OR source_id IN (SELECT id FROM medium_chunks WHERE doc_id = ?)
          OR target_id IN (SELECT id FROM medium_chunks WHERE doc_id = ?)
          OR source_id IN (SELECT id FROM micro_chunks WHERE doc_id = ?)
          OR target_id IN (SELECT id FROM micro_chunks WHERE doc_id = ?);`,
      [doc.id, doc.id, `${doc.id}:L*`, `${doc.id}:L*`, doc.id, doc.id, doc.id, doc.id, doc.id, doc.id]
    ),
  ]);

  return {
    document: doc,
    sections: sectionsRes.rows || [],
    medium_chunks: mediumRes.rows || [],
    micro_chunks: microRes.rows || [],
    document_scopes: scopesRes.rows || [],
    knowledge_links: linksRes.rows || [],
    graph_edges: edgesRes.rows || [],
  };
}

async function collectOwnedIds(db, docId) {
  const rows = await db.prepare(`
    SELECT id FROM sections WHERE doc_id = ?
    UNION SELECT id FROM medium_chunks WHERE doc_id = ?
    UNION SELECT id FROM micro_chunks WHERE doc_id = ?;
  `).all(docId, docId, docId);
  return [docId, ...rows.map((row) => row.id)];
}

async function clearLocalDocumentRelations(db, docId) {
  const ownedIds = await collectOwnedIds(db, docId);
  try {
    await db.prepare("DELETE FROM micro_chunks_fts WHERE id IN (SELECT id FROM micro_chunks WHERE doc_id = ?);").run(docId);
  } catch {}
  await db.prepare("DELETE FROM knowledge_links WHERE doc_id = ?;").run(docId);
  for (const id of ownedIds) {
    await db.prepare(
      "DELETE FROM graph_edges WHERE source_id = ? OR target_id = ? OR source_id GLOB ? OR target_id GLOB ?;"
    ).run(id, id, `${id}:L*`, `${id}:L*`);
  }
  await db.prepare("DELETE FROM micro_chunks WHERE doc_id = ?;").run(docId);
  await db.prepare("DELETE FROM medium_chunks WHERE doc_id = ?;").run(docId);
  await db.prepare("DELETE FROM sections WHERE doc_id = ?;").run(docId);
  await db.prepare("DELETE FROM document_scopes WHERE doc_id = ?;").run(docId);
}

async function cleanupOrphanBlob(db, hash) {
  if (!hash) return;
  const refs = await db.prepare("SELECT COUNT(*) AS cnt FROM documents WHERE blob_hash = ?;").get(hash);
  if (Number(refs?.cnt || 0) === 0) {
    try { await deleteBlob(hash); } catch {}
  }
}

async function applyRemoteTombstone(db, tombstone) {
  const local = await db.prepare(
    "SELECT id, path, blob_hash, updated_at FROM documents WHERE id = ? OR (? IS NOT NULL AND path = ?);"
  ).get(tombstone.doc_id, tombstone.path || null, tombstone.path || null);
  if (!local) return "absent";
  if (Number(local.updated_at || 0) > Number(tombstone.deleted_at || 0)) return "local_newer";

  await db.exec("BEGIN IMMEDIATE;");
  try {
    await clearLocalDocumentRelations(db, local.id);
    await db.prepare("DELETE FROM documents WHERE id = ?;").run(local.id);
    await db.prepare(`
      INSERT INTO rag_document_tombstones (doc_id, path, deleted_at)
      VALUES (?, ?, ?)
      ON CONFLICT(doc_id) DO UPDATE SET path = excluded.path, deleted_at = excluded.deleted_at;
    `).run(tombstone.doc_id, tombstone.path || local.path || null, tombstone.deleted_at || Date.now());
    await db.exec("COMMIT;");
  } catch (err) {
    try { await db.exec("ROLLBACK;"); } catch {}
    throw err;
  }
  await cleanupOrphanBlob(db, local.blob_hash);
  return "deleted";
}

async function removeConflictingLocalDocument(db, doc) {
  const conflict = await db.prepare("SELECT id, blob_hash, updated_at FROM documents WHERE path = ? AND id != ?;").get(doc.path, doc.id);
  if (!conflict) return null;
  if (Number(conflict.updated_at || 0) > Number(doc.updated_at || 0)) {
    return { blocked: true, conflict };
  }
  await clearLocalDocumentRelations(db, conflict.id);
  await db.prepare("DELETE FROM documents WHERE id = ?;").run(conflict.id);
  return { blocked: false, conflict };
}

async function applyRemoteDocumentBundle(db, bundle) {
  const doc = bundle.document;
  const local = await db.prepare("SELECT id, path, blob_hash, updated_at FROM documents WHERE id = ?;").get(doc.id);
  const remoteUpdated = Number(doc.updated_at || 0);
  const localUpdated = Number(local?.updated_at || 0);

  if (local && localUpdated > remoteUpdated) return { action: "local_newer" };
  if (local && localUpdated === remoteUpdated && local.blob_hash === doc.blob_hash && local.path === doc.path) {
    return { action: "unchanged" };
  }

  let orphanCandidate = null;
  await db.exec("BEGIN IMMEDIATE;");
  try {
    const conflictResult = await removeConflictingLocalDocument(db, doc);
    if (conflictResult?.blocked) {
      await db.exec("ROLLBACK;");
      return { action: "path_conflict_local_newer" };
    }
    orphanCandidate = conflictResult?.conflict?.blob_hash || null;

    if (local) await clearLocalDocumentRelations(db, doc.id);

    await db.prepare(`
      INSERT INTO documents (id, path, blob_hash, title, checksum, toc_json, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        blob_hash = excluded.blob_hash,
        title = excluded.title,
        checksum = excluded.checksum,
        toc_json = excluded.toc_json,
        metadata_json = excluded.metadata_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at;
    `).run(doc.id, doc.path, doc.blob_hash, doc.title, doc.checksum, doc.toc_json || null, doc.metadata_json || null, doc.created_at || Date.now(), doc.updated_at || Date.now());

    await db.prepare("DELETE FROM rag_document_tombstones WHERE doc_id = ? OR path = ?;").run(doc.id, doc.path);

    const scopes = bundle.document_scopes.length ? bundle.document_scopes : [{ scope_key: "global", created_at: doc.created_at || Date.now() }];
    for (const scope of scopes) {
      await db.prepare("INSERT OR IGNORE INTO document_scopes (doc_id, scope_key, created_at) VALUES (?, ?, ?);").run(doc.id, scope.scope_key || "global", scope.created_at || Date.now());
    }

    for (const section of bundle.sections) {
      await db.prepare("INSERT INTO sections (id, doc_id, heading, breadcrumbs, content, token_count) VALUES (?, ?, ?, ?, ?, ?);").run(section.id, doc.id, section.heading || null, section.breadcrumbs || null, section.content || "", Number(section.token_count || 0));
    }
    for (const medium of bundle.medium_chunks) {
      await db.prepare("INSERT INTO medium_chunks (id, section_id, doc_id, content, block_type, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?);").run(medium.id, medium.section_id, doc.id, medium.content || "", medium.block_type || "paragraph", Number(medium.token_count || 0), medium.created_at || Date.now());
    }

    const sectionBreadcrumbs = new Map(bundle.sections.map((section) => [section.id, section.breadcrumbs || ""]));
    for (const chunk of bundle.micro_chunks) {
      const bytes = toVectorBytes(chunk.vector);
      const vector = bytes ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : Buffer.alloc(0);
      await db.prepare(`INSERT INTO micro_chunks
        (id, section_id, doc_id, content, vector, token_count, medium_id, retrieval_policy, policy_source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`).run(chunk.id, chunk.section_id, doc.id, chunk.content || "", vector, Number(chunk.token_count || 0), chunk.medium_id || null, chunk.retrieval_policy || "micro_chunk", chunk.policy_source_id || null);
      await db.prepare("INSERT INTO micro_chunks_fts (id, content, breadcrumbs) VALUES (?, ?, ?);").run(chunk.id, chunk.content || "", sectionBreadcrumbs.get(chunk.section_id) || "");
    }

    for (const edge of bundle.graph_edges) {
      await db.prepare(`INSERT OR REPLACE INTO graph_edges
        (source_id, target_id, relation_type, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?);`).run(edge.source_id, edge.target_id, edge.relation_type, edge.metadata_json || null, edge.created_at || null);
    }
    for (const link of bundle.knowledge_links) {
      await db.prepare(`INSERT OR REPLACE INTO knowledge_links
        (id, fact_key, fact_text, doc_id, section_id, start_line, end_line, relation_type, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`).run(link.id, link.fact_key, link.fact_text, doc.id, link.section_id || null, link.start_line || null, link.end_line || null, link.relation_type || "LINKS_TO", link.metadata_json || null, link.created_at || Date.now());
    }

    await db.exec("COMMIT;");
  } catch (err) {
    try { await db.exec("ROLLBACK;"); } catch {}
    throw err;
  }

  if (orphanCandidate) await cleanupOrphanBlob(db, orphanCandidate);
  if (local?.blob_hash && local.blob_hash !== doc.blob_hash) await cleanupOrphanBlob(db, local.blob_hash);
  return { action: local ? "updated" : "pulled" };
}

export async function pullRagFromCloud(db) {
  if (!db || db.mode !== "hybrid-sync" || !db.cloudClient) return { skipped: true };

  const tombRes = await executeCloud(db, "SELECT * FROM rag_document_tombstones ORDER BY deleted_at ASC;");
  const tombstones = tombRes.rows || [];
  const tombById = new Map(tombstones.map((t) => [t.doc_id, t]));
  const tombByPath = new Map(tombstones.filter((t) => t.path).map((t) => [t.path, t]));

  const docsRes = await executeCloud(db, "SELECT * FROM documents ORDER BY updated_at ASC;");
  const docs = docsRes.rows || [];
  const summary = {
    remoteDocuments: docs.length,
    remoteTombstones: tombstones.length,
    pulled: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    localNewer: 0,
    pathConflicts: 0,
    blobsMaterialized: 0,
    missingBlobs: 0,
    errors: 0,
  };

  for (const tombstone of tombstones) {
    try {
      const action = await applyRemoteTombstone(db, tombstone);
      if (action === "deleted") summary.deleted++;
      else if (action === "local_newer") summary.localNewer++;
    } catch (err) {
      summary.errors++;
      console.warn(`Failed to apply RAG tombstone ${tombstone.doc_id}: ${err.message}`);
    }
  }

  for (const doc of docs) {
    try {
      const tombstone = tombById.get(doc.id) || tombByPath.get(doc.path);
      if (tombstone && Number(tombstone.deleted_at || 0) >= Number(doc.updated_at || 0)) {
        continue;
      }

      const bundle = await fetchRemoteDocumentBundle(db, doc);
      const result = await applyRemoteDocumentBundle(db, bundle);
      if (result.action === "pulled") summary.pulled++;
      else if (result.action === "updated") summary.updated++;
      else if (result.action === "unchanged") summary.unchanged++;
      else if (result.action === "local_newer") summary.localNewer++;
      else if (result.action === "path_conflict_local_newer") summary.pathConflicts++;

      const blobResult = await materializeBlobFromCloud(db, doc.blob_hash);
      if (blobResult.materialized) summary.blobsMaterialized++;
      else if (blobResult.reason === "cloud_blob_missing") summary.missingBlobs++;
    } catch (err) {
      summary.errors++;
      console.warn(`Failed to reverse-sync RAG document ${doc.id}: ${err.message}`);
    }
  }

  return summary;
}
