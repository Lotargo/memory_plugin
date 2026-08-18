import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "rag-memory-notes-flow-"));
process.env.MEMORY_DIR = join(temp, "memory");

const { getDatabase, closeDatabase } = await import("../../mcp-server/db/database.js");
const { rememberNote } = await import("../../mcp-server/tools/core/note_core.js");
const { runSingleRagQuery, runBatchRagQuery } = await import("../../mcp-server/tools/core/rag_query_core.js");
const { readKnowledgeDocument, listKnowledgeDocuments } = await import("../../mcp-server/tools/core/knowledge_read_core.js");
const { ingestNote, deleteDocument } = await import("../../mcp-server/ingest/pipeline.js");
const { hybridQuery } = await import("../../mcp-server/retrieval/retriever.js");
const { rememberFact } = await import("../../mcp-server/tools/core/memory_core.js");
const { readMemory, GLOBAL_KEY } = await import("../../mcp-server/memory.js");
const { getLinksForDoc } = await import("../../mcp-server/graph/knowledge_linker.js");
const { MemoryPlugin } = await import("../../opencode-plugin/main.js");

export async function runRagMemoryNotesIntegrationTests() {
  console.log("--- Running Integration Tests: rag_memory_notes ---");
  const db = await getDatabase();

  // 1. Agent-facing cold memory creation.
  const note = await rememberNote({
    title: "Decision: cold memory retrieval flow",
    content: [
      "We rejected eager injection of long episodic records.",
      "The chosen architecture uses semantic table-of-contents retrieval first.",
      "A stable document identifier is then used to deliberately expand the exact raw note.",
      "cold-memory-flow-token marks this decision for lexical test retrieval.",
    ].join("\n\n"),
    scope: "global",
    kind: "decision",
    tags: "Architecture, Memory,architecture",
    generateEmbeddings: false,
  });

  assert.strictEqual(note.status, "success");
  assert.ok(note.docId.startsWith("doc_"));
  assert.ok(note.path.startsWith("memory://note/"));
  assert.strictEqual(note.sourceType, "note");
  assert.strictEqual(note.kind, "decision");
  assert.deepStrictEqual(note.tags, ["architecture", "memory"]);

  // 2. Same raw body may deduplicate storage but must remain a different note.
  const duplicateBody = await rememberNote({
    title: "Decision: duplicate raw body remains separate memory",
    content: [
      "We rejected eager injection of long episodic records.",
      "The chosen architecture uses semantic table-of-contents retrieval first.",
      "A stable document identifier is then used to deliberately expand the exact raw note.",
      "cold-memory-flow-token marks this decision for lexical test retrieval.",
    ].join("\n\n"),
    scope: "global",
    kind: "context",
    generateEmbeddings: false,
  });
  assert.notStrictEqual(duplicateBody.docId, note.docId, "identical raw bodies do not collapse note identity");
  assert.notStrictEqual(duplicateBody.path, note.path, "each note keeps a unique memory:// path");
  assert.strictEqual(duplicateBody.blobHash, note.blobHash, "content-addressed raw storage is still deduplicated");

  // 3. Semantic TOC/index mode discovers identity without returning the note body.
  const indexResult = await runSingleRagQuery({
    query: "cold memory flow token",
    limit: 5,
    scope: "global",
    resultMode: "index",
    generateEmbeddings: false,
  });
  assert.ok(indexResult.includes(note.docId), "index search exposes stable parent doc_id");
  assert.ok(indexResult.includes("Source: note"));
  assert.ok(indexResult.includes("Kind: decision") || indexResult.includes("Kind: context"));
  assert.ok(!indexResult.includes("We rejected eager injection"), "index mode does not leak raw note body");

  const snippetResult = await runSingleRagQuery({
    query: "cold memory flow token",
    limit: 5,
    scope: "global",
    resultMode: "snippet",
    generateEmbeddings: false,
  });
  assert.ok(snippetResult.includes("cold-memory-flow-token"), "snippet mode remains content-rich");

  const batchIndex = await runBatchRagQuery({
    queries: ["cold memory flow token", "stable document identifier raw note"],
    limit: 5,
    scope: "global",
    resultMode: "index",
    generateEmbeddings: false,
  });
  assert.ok(batchIndex.includes("Query [1]"));
  assert.ok(batchIndex.includes("Query [2]"));
  assert.ok(batchIndex.includes(note.docId));
  assert.ok(!batchIndex.includes("We rejected eager injection"), "batch index mirrors single-query compact semantics");

  // 4. Deliberate raw expansion returns exact source plus note metadata.
  const raw = await readKnowledgeDocument({ docId: note.docId, scope: "global" });
  assert.strictEqual(raw.docId, note.docId);
  assert.strictEqual(raw.source_type, "note");
  assert.strictEqual(raw.note_kind, "decision");
  assert.deepStrictEqual(raw.tags, ["architecture", "memory"]);
  assert.ok(raw.content.includes("cold-memory-flow-token"));

  const listed = await listKnowledgeDocuments({ scope: "global" });
  const listedNote = listed.find((item) => item.docId === note.docId);
  assert.ok(listedNote, "note is visible through normal knowledge management list");
  assert.strictEqual(listedNote.source_type, "note");
  assert.strictEqual(listedNote.note_kind, "decision");
  assert.deepStrictEqual(listedNote.tags, ["architecture", "memory"]);

  // 5. Hot Notebook fact can point to detailed cold note; deleting note preserves the fact.
  const factText = "Detailed cold-memory reasoning is stored in a linked RAG Memory Note";
  const rememberResult = await rememberFact({
    fact: factText,
    title: "Cold memory pointer",
    scope: "global",
    docId: note.docId,
    relationType: "EXPLAINS",
  });
  assert.ok(rememberResult.includes("Memory updated"));
  assert.ok(rememberResult.includes("Linked to Doc"));
  const linksBeforeDelete = await getLinksForDoc(note.docId, [GLOBAL_KEY]);
  assert.ok(linksBeforeDelete.some((link) => link.fact_text === factText));

  const deleteResult = await deleteDocument(note.docId);
  assert.strictEqual(deleteResult.deleted, true);
  const globalFacts = await readMemory(GLOBAL_KEY);
  assert.ok(globalFacts.some((entry) => entry.includes(factText)), "deleting cold note must not delete hot Notebook fact");
  const linksAfterDelete = await db.prepare("SELECT COUNT(*) AS cnt FROM knowledge_links WHERE doc_id = ?").get(note.docId);
  assert.strictEqual(Number(linksAfterDelete?.cnt || 0), 0, "note deletion removes only the document link projection");

  const deletedQuery = await hybridQuery({
    query: "cold memory flow token",
    customDb: db,
    generateEmbeddings: false,
    scopeKeys: [GLOBAL_KEY],
    limit: 10,
  });
  assert.ok(!deletedQuery.some((hit) => hit.doc_id === note.docId), "deleted note is absent from retrieval index");
  assert.ok(deletedQuery.some((hit) => hit.doc_id === duplicateBody.docId), "deleting one note does not delete another note sharing the blob");

  // 6. Project-scoped cold memories remain isolated in the common RAG engine.
  const projectA = "git:example.com/team/rag-note-a";
  const projectB = "git:example.com/team/rag-note-b";
  const noteA = await ingestNote({
    title: "Project A decision",
    content: "project-alpha-cold-token belongs only to project A cold memory.",
    kind: "decision",
    generateEmbeddings: false,
    projectScope: projectA,
  });
  const noteB = await ingestNote({
    title: "Project B research",
    content: "project-beta-cold-token belongs only to project B cold memory.",
    kind: "research",
    generateEmbeddings: false,
    projectScope: projectB,
  });

  const queryProject = (query, scopes) => hybridQuery({
    query,
    customDb: db,
    generateEmbeddings: false,
    scopeKeys: scopes,
    limit: 10,
  });
  assert.ok((await queryProject("project alpha cold token", [projectA])).some((hit) => hit.doc_id === noteA.docId));
  assert.ok(!(await queryProject("project beta cold token", [projectA])).some((hit) => hit.doc_id === noteB.docId));
  assert.ok((await queryProject("project beta cold token", [projectB])).some((hit) => hit.doc_id === noteB.docId));

  // 7. Native OpenCode package entry exposes the same user-facing primitives.
  const opencode = await MemoryPlugin({ directory: temp, worktree: null, client: {} });
  assert.ok(opencode.tool.remember_note, "native OpenCode exposes remember_note");
  assert.ok(opencode.tool.query_knowledge_base.args.resultMode, "native OpenCode exposes resultMode");
  assert.ok(opencode.tool.manage_knowledge_base, "native OpenCode exposes raw/list management");
  const opencodeGlobalNote = JSON.parse(await opencode.tool.remember_note.execute({
    title: "OpenCode cold note",
    content: "opencode-cold-memory-token verifies the native package surface.",
    scope: "global",
    kind: "handoff",
    generateEmbeddings: false,
  }, {}));
  assert.strictEqual(opencodeGlobalNote.sourceType, "note");
  const opencodeIndex = await opencode.tool.query_knowledge_base.execute({
    query: "opencode cold memory token",
    scope: "global",
    resultMode: "index",
    generateEmbeddings: false,
    limit: 5,
  }, {});
  assert.ok(opencodeIndex.includes(opencodeGlobalNote.docId));
  assert.ok(!opencodeIndex.includes("verifies the native package surface"));

  closeDatabase();
  rmSync(temp, { recursive: true, force: true });
  console.log("✅ RAG MEMORY NOTES END-TO-END FLOW TESTS PASSED!");
}

if (process.argv[1] && process.argv[1].endsWith("rag_memory_notes.test.js")) {
  runRagMemoryNotesIntegrationTests().catch((err) => {
    try { closeDatabase(); } catch {}
    try { rmSync(temp, { recursive: true, force: true }); } catch {}
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
