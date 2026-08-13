import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "memory-rag-integrity-"));
const memoryDir = join(temp, "memory");
const blobDir = join(memoryDir, "storage", "blobs");
process.env.MEMORY_DIR = memoryDir;

const { getDatabase, closeDatabase } = await import("../../mcp-server/db/database.js");
const { ingestDocument } = await import("../../mcp-server/ingest/pipeline.js");
const { hybridQuery } = await import("../../mcp-server/retrieval/retriever.js");
const { linkFactToDocument, getLinksForDoc } = await import("../../mcp-server/graph/knowledge_linker.js");
const { exportDocumentData } = await import("../../mcp-server/ingest/exporter.js");
const { exportSnapshot, importSnapshot } = await import("../../mcp-server/admin/snapshot.js");
const { removeDocumentScopes, resolveManageRagScopeKeys } = await import("../../mcp-server/rag_scope.js");
const { moveKnowledgeScope } = await import("../../mcp-server/graph/knowledge_linker.js");

export async function runRagIntegrityTests() {
  console.log("--- Running Unit Tests: rag_integrity ---");
  const db = await getDatabase();
  const projectA = "git:example.com/team/project-a";
  const projectB = "git:example.com/team/project-b";

  const defaultDeleteScopes = await resolveManageRagScopeKeys("delete", undefined, { directory: process.cwd() });
  assert.strictEqual(defaultDeleteScopes.length, 1, "default delete targets one ownership boundary");
  assert.notStrictEqual(defaultDeleteScopes[0], "global", "inside Git, default delete targets the current project");
  const explicitAllScopes = await resolveManageRagScopeKeys("delete", "all", { directory: process.cwd() });
  assert.ok(explicitAllScopes.includes("global") && explicitAllScopes.length === 2, "explicit all retains broad removal semantics");

  const globalDoc = await ingestDocument({
    content: "# Shared Reference\n\nshared-global-token is available to every project.",
    type: "text",
    path: "virtual://shared-reference.md",
    generateEmbeddings: false,
    projectScope: "global",
  });
  const docA = await ingestDocument({
    content: "# Project A\n\nproject-alpha-token belongs only to project A.",
    type: "text",
    path: "virtual://project-a.md",
    generateEmbeddings: false,
    projectScope: projectA,
  });
  const docB = await ingestDocument({
    content: "# Project B\n\nproject-beta-token belongs only to project B.",
    type: "text",
    path: "virtual://project-b.md",
    generateEmbeddings: false,
    projectScope: projectB,
  });

  const query = (text, scopeKeys) => hybridQuery({
    query: text,
    customDb: db,
    generateEmbeddings: false,
    scopeKeys,
    limit: 10,
  });

  assert.ok((await query("shared global token", ["global", projectA])).some((hit) => hit.doc_path === globalDoc.path));
  assert.ok((await query("project alpha token", ["global", projectA])).some((hit) => hit.doc_path === docA.path));
  assert.ok(!(await query("project beta token", ["global", projectA])).some((hit) => hit.doc_path === docB.path));
  assert.ok((await query("project beta token", ["global", projectB])).some((hit) => hit.doc_path === docB.path));

  await linkFactToDocument({
    factKey: projectA,
    factText: "Project A link to shared reference",
    docId: globalDoc.docId,
  });
  await linkFactToDocument({
    factKey: projectB,
    factText: "Project B private link to shared reference",
    docId: globalDoc.docId,
  });
  const projectALinks = await getLinksForDoc(globalDoc.docId, ["global", projectA]);
  assert.ok(projectALinks.some((link) => link.fact_key === projectA));
  assert.ok(!projectALinks.some((link) => link.fact_key === projectB), "shared docs must not expose another project's fact links");

  const sharedA = await ingestDocument({
    content: "# Shared Project Source\n\nshared-project-token is reused by A and B.",
    type: "text",
    path: "virtual://shared-project.md",
    generateEmbeddings: false,
    projectScope: projectA,
  });
  const sharedB = await ingestDocument({
    content: "# Shared Project Source\n\nshared-project-token is reused by A and B.",
    type: "text",
    path: "virtual://shared-project.md",
    generateEmbeddings: false,
    projectScope: projectB,
  });
  assert.strictEqual(sharedB.docId, sharedA.docId, "same source is shared without duplicating the document");
  const unlinkedA = await removeDocumentScopes(db, sharedA.docId, [projectA]);
  assert.strictEqual(unlinkedA.remainingScopes, 1);
  assert.ok(!(await query("shared project token", [projectA])).some((hit) => hit.doc_path === sharedA.path));
  assert.ok((await query("shared project token", [projectB])).some((hit) => hit.doc_path === sharedA.path));

  await linkFactToDocument({
    factKey: projectA,
    factText: "Project A uses the alpha reference",
    docId: docA.docId,
    startLine: 1,
    endLine: 3,
    relationType: "EXPLAINS",
  });
  const beforeLink = await db.prepare("SELECT id FROM knowledge_links WHERE doc_id = ?").get(docA.docId);
  assert.ok(beforeLink?.id, "knowledge link exists before re-ingestion");

  const updatedA = await ingestDocument({
    content: "# Project A Updated\n\nproject-alpha-v2-token replaces the old source content.",
    type: "text",
    path: "virtual://project-a.md",
    generateEmbeddings: false,
    projectScope: projectA,
  });
  assert.strictEqual(updatedA.docId, docA.docId, "re-ingestion preserves document identity");
  const afterLink = await db.prepare("SELECT id FROM knowledge_links WHERE doc_id = ?").get(docA.docId);
  assert.strictEqual(afterLink?.id, beforeLink.id, "re-ingestion preserves Notebook knowledge links");
  assert.ok((await query("project alpha v2 token", ["global", projectA])).some((hit) => hit.doc_path === docA.path));

  const chunk = await db.prepare("SELECT id, medium_id FROM micro_chunks WHERE doc_id = ? LIMIT 1").get(docA.docId);
  const vector = Buffer.from(new Float32Array([0.1, 0.2, 0.3, 0.4]).buffer);
  await db.prepare("UPDATE micro_chunks SET vector = ?, retrieval_policy = ?, policy_source_id = ? WHERE id = ?")
    .run(vector, "code_signature", chunk.medium_id, chunk.id);

  const exportedDoc = await exportDocumentData(docA.docId, db);
  assert.ok(exportedDoc.micro_chunks[0].vector, "cloud payload includes vector bytes");
  assert.strictEqual(exportedDoc.micro_chunks[0].retrieval_policy, "code_signature");
  assert.ok(exportedDoc.document_scopes.some((scope) => scope.scope_key === projectA));
  assert.ok(exportedDoc.knowledge_links.some((link) => link.id === beforeLink.id));
  assert.ok(exportedDoc.graph_edges.length > 0, "cloud payload includes structural graph edges");
  assert.ok(exportedDoc.graph_edges.some((edge) => edge.target_id === `${docA.docId}:L1-3`), "cloud payload includes line-range knowledge graph edges");

  const exported = await exportSnapshot({ customDb: db, customBlobDir: blobDir });
  assert.strictEqual(exported.snapshot.version, 3);
  assert.ok(exported.snapshot.knowledge_links.some((link) => link.id === beforeLink.id));
  assert.ok(exported.snapshot.document_scopes.some((scope) => scope.doc_id === docA.docId && scope.scope_key === projectA));

  const restoreDir = join(temp, "restore");
  const restoreDb = await getDatabase(join(restoreDir, "restore.sqlite"));
  await importSnapshot({
    customDb: restoreDb,
    customBlobDir: join(restoreDir, "blobs"),
    snapshotPathOrData: exported.snapshot,
  });
  const restoredLink = await restoreDb.prepare("SELECT id FROM knowledge_links WHERE id = ?").get(beforeLink.id);
  assert.ok(restoredLink, "snapshot restores knowledge links");
  const restoredScope = await restoreDb.prepare("SELECT scope_key FROM document_scopes WHERE doc_id = ? AND scope_key = ?").get(docA.docId, projectA);
  assert.ok(restoredScope, "snapshot restores document scopes");
  const restoredChunk = await restoreDb.prepare("SELECT vector, retrieval_policy, policy_source_id FROM micro_chunks WHERE id = ?").get(chunk.id);
  assert.strictEqual(restoredChunk.vector.byteLength, vector.byteLength, "snapshot restores vector bytes");
  assert.strictEqual(restoredChunk.retrieval_policy, "code_signature");
  assert.strictEqual(restoredChunk.policy_source_id, chunk.medium_id);

  const movedProject = "git:example.com/team/project-a-renamed";
  const moved = await moveKnowledgeScope(db, projectA, movedProject);
  assert.ok(moved.movedLinks >= 1);
  assert.ok(moved.movedDocuments >= 1);
  const movedLink = await db.prepare("SELECT fact_key FROM knowledge_links WHERE id = ?").get(beforeLink.id);
  assert.strictEqual(movedLink.fact_key, movedProject, "project relink moves knowledge-link ownership");
  const oldScope = await db.prepare("SELECT 1 AS found FROM document_scopes WHERE scope_key = ?").get(projectA);
  assert.ok(!oldScope, "project relink removes the old RAG scope");
  const newScope = await db.prepare("SELECT 1 AS found FROM document_scopes WHERE doc_id = ? AND scope_key = ?").get(docA.docId, movedProject);
  assert.ok(newScope, "project relink moves RAG document scopes");

  restoreDb.close();
  closeDatabase();
  rmSync(temp, { recursive: true, force: true });
  console.log("✅ RAG SCOPE, RE-INGEST, SYNC PAYLOAD & SNAPSHOT TESTS PASSED!");
}

if (process.argv[1] && process.argv[1].endsWith("rag_integrity.test.js")) {
  runRagIntegrityTests().catch((err) => {
    try { closeDatabase(); } catch {}
    try { rmSync(temp, { recursive: true, force: true }); } catch {}
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
