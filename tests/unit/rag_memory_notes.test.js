import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const temp = mkdtempSync(join(tmpdir(), "rag-memory-notes-unit-"));
process.env.MEMORY_DIR = join(temp, "memory");

const {
  RAG_NOTE_KINDS,
  normalizeNoteKind,
  normalizeNoteTags,
  createNoteVirtualPath,
  ingestNote,
} = await import("../../mcp-server/ingest/pipeline.js");
const { parseDocumentMetadata } = await import("../../mcp-server/retrieval/retriever.js");
const { formatIndexResult, formatSnippetResult } = await import("../../mcp-server/tools/core/rag_query_core.js");
const { normalizeKnowledgeDocumentMetadata } = await import("../../mcp-server/tools/core/knowledge_read_core.js");
const {
  saveBlob,
  readBlob,
  readBlobTransport,
  saveBlobTransport,
  hashContent,
} = await import("../../mcp-server/storage/blob_store.js");
const { MEMORY_ROUTING_POLICY } = await import("../../mcp-server/tools/core/memory_routing.js");
const { closeDatabase } = await import("../../mcp-server/db/database.js");

async function assertRejectsMessage(fn, pattern) {
  await assert.rejects(fn, (err) => pattern.test(String(err?.message || err)));
}

export async function runRagMemoryNotesUnitTests() {
  console.log("--- Running Unit Tests: rag_memory_notes ---");

  assert.deepStrictEqual(
    [...RAG_NOTE_KINDS],
    ["decision", "research", "context", "handoff", "note"],
    "note kind contract stays intentionally small"
  );
  assert.strictEqual(normalizeNoteKind(" DECISION "), "decision");
  assert.strictEqual(normalizeNoteKind("unknown-future-kind"), "note", "unknown kinds safely fall back to note");
  assert.deepStrictEqual(
    normalizeNoteTags(" Vision,ocr, vision , Architecture,OCR "),
    ["architecture", "ocr", "vision"],
    "tags are lowercase, unique and stable"
  );

  const pathA = createNoteVirtualPath();
  const pathB = createNoteVirtualPath();
  assert.match(pathA, /^memory:\/\/note\/[0-9a-f-]{36}$/i);
  assert.notStrictEqual(pathA, pathB, "each note gets a unique virtual path");

  await assertRejectsMessage(
    () => ingestNote({ title: "   ", content: "body", generateEmbeddings: false }),
    /title must not be empty/i
  );
  await assertRejectsMessage(
    () => ingestNote({ title: "Valid", content: "   ", generateEmbeddings: false }),
    /content must not be empty/i
  );

  assert.deepStrictEqual(parseDocumentMetadata(null), {});
  assert.deepStrictEqual(parseDocumentMetadata("not-json"), {}, "malformed legacy metadata never breaks retrieval");
  assert.deepStrictEqual(parseDocumentMetadata("[1,2,3]"), {}, "non-object JSON is ignored");
  assert.deepStrictEqual(parseDocumentMetadata('{"source_type":"note","tags":["x"]}'), {
    source_type: "note",
    tags: ["x"],
  });

  const normalizedNote = normalizeKnowledgeDocumentMetadata({
    path: "memory://note/123",
    metadata_json: JSON.stringify({ note_kind: "research", tags: "OCR, Vision,ocr" }),
  });
  assert.strictEqual(normalizedNote.sourceType, "note", "memory://note path is a defensive source-type fallback");
  assert.strictEqual(normalizedNote.noteKind, "research");
  assert.deepStrictEqual(normalizedNote.tags, ["ocr", "vision"]);

  const result = {
    doc_id: "doc_test123",
    doc_title: "Decision: Retrieval architecture",
    source_type: "note",
    note_kind: "decision",
    tags: ["architecture", "rag"],
    heading: "Why",
    breadcrumbs: "Decision > Why",
    score: 0.8123,
    retrieval_policy: "micro_chunk",
    doc_created_at: 1760000000000,
    doc_updated_at: 1760000001000,
    snippet: "SECRET_SNIPPET_BODY",
    paragraph_context: "SECRET_PARAGRAPH_BODY",
    full_section_content: "SECRET_FULL_SECTION_BODY",
    defined_symbols: ["secretSymbol"],
  };

  const indexText = formatIndexResult(result, 1, 3);
  assert.ok(indexText.includes("Doc ID: doc_test123"));
  assert.ok(indexText.includes("Source: note"));
  assert.ok(indexText.includes("Kind: decision"));
  assert.ok(indexText.includes("Tags: architecture, rag"));
  assert.ok(!indexText.includes("SECRET_SNIPPET_BODY"));
  assert.ok(!indexText.includes("SECRET_PARAGRAPH_BODY"));
  assert.ok(!indexText.includes("SECRET_FULL_SECTION_BODY"));
  assert.ok(!indexText.includes("secretSymbol"), "index output must not leak GraphRAG expansion");

  const snippetText = formatSnippetResult(result, 1, 3);
  assert.ok(snippetText.includes("SECRET_SNIPPET_BODY"), "default snippet presentation remains content-rich");
  assert.ok(snippetText.includes("secretSymbol"), "snippet presentation preserves existing GraphRAG context");

  const blobA = join(temp, "blob-a");
  const blobB = join(temp, "blob-b");
  const body = "Portable cold-memory raw body with unicode: память / 記憶";
  const stored = await saveBlob(body, blobA);
  const transported = await readBlobTransport(stored.hash, blobA);
  assert.strictEqual(transported.hash, hashContent(Buffer.from(body, "utf8")));
  assert.ok(transported.gzipBase64.length > 0);

  await saveBlobTransport(stored.hash, transported.gzipBase64, blobB);
  assert.strictEqual(await readBlob(stored.hash, blobB), body, "transported gzip materializes exact raw source");

  const wrongBody = Buffer.from("wrong raw body", "utf8");
  const wrongPayload = gzipSync(wrongBody).toString("base64");
  await assertRejectsMessage(
    () => saveBlobTransport(stored.hash, wrongPayload, join(temp, "blob-wrong")),
    /integrity check failed/i
  );
  await assertRejectsMessage(
    () => saveBlobTransport(stored.hash, Buffer.from("not gzip").toString("base64"), join(temp, "blob-corrupt")),
    /(incorrect header|invalid|unexpected|decompress|gzip)/i
  );

  assert.ok(MEMORY_ROUTING_POLICY.includes("Use remember for concise durable facts"));
  assert.ok(MEMORY_ROUTING_POLICY.includes("Use remember_note for high-value long-form internal memory"));
  assert.ok(MEMORY_ROUTING_POLICY.includes("Use ingest_document for external reusable source material"));
  assert.ok(MEMORY_ROUTING_POLICY.includes('resultMode="index"'));
  assert.ok(MEMORY_ROUTING_POLICY.includes('action="read_document"'));

  closeDatabase();
  rmSync(temp, { recursive: true, force: true });
  console.log("✅ RAG MEMORY NOTES UNIT CONTRACTS PASSED!");
}

if (process.argv[1] && process.argv[1].endsWith("rag_memory_notes.test.js")) {
  runRagMemoryNotesUnitTests().catch((err) => {
    try { closeDatabase(); } catch {}
    try { rmSync(temp, { recursive: true, force: true }); } catch {}
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
