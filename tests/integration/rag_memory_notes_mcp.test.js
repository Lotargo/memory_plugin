import assert from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export async function runRagMemoryNotesMcpTests() {
  console.log("--- Running Integration Tests: rag_memory_notes_mcp ---");
  const temp = mkdtempSync(join(tmpdir(), "rag-memory-notes-mcp-"));
  const memoryDir = join(temp, "memory");

  let child;
  let nextId = 0;
  let buffer = "";
  const pending = new Map();
  const stderr = [];

  const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });
  const withTimeout = (promise, label, ms = 15000) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), ms)),
  ]);
  const textOf = (result) => (result?.content || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

  child = spawn(process.execPath, [join(ROOT, "mcp-server/index.js")], {
    cwd: temp,
    env: { ...process.env, MEMORY_DIR: memoryDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (data) => {
    buffer += data;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id && pending.has(message.id)) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
      }
    }
  });
  child.stderr.on("data", (data) => stderr.push(data));

  try {
    await withTimeout(request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "rag-memory-notes-mcp-test", version: "1.0.0" },
    }), "initialize");
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

    const tools = await withTimeout(request("tools/list"), "tools/list");
    const toolNames = (tools?.tools || []).map((tool) => tool.name);
    assert.ok(toolNames.includes("remember_note"), "MCP registry exposes remember_note");
    assert.ok(toolNames.includes("query_knowledge_base"));
    assert.ok(toolNames.includes("manage_knowledge_base"));

    const noteBody = [
      "MCP cold-memory integration record.",
      "mcp-cold-note-token should be discoverable through compact index retrieval.",
      "RAW_BODY_SENTINEL must only appear after explicit raw expansion.",
    ].join("\n\n");

    const createText = textOf(await withTimeout(request("tools/call", {
      name: "remember_note",
      arguments: {
        title: "MCP cold memory note",
        content: noteBody,
        scope: "global",
        kind: "research",
        tags: "MCP,Test,mcp",
        generateEmbeddings: false,
      },
    }), "remember_note"));
    const created = JSON.parse(createText);
    assert.strictEqual(created.status, "success");
    assert.strictEqual(created.sourceType, "note");
    assert.strictEqual(created.kind, "research");
    assert.deepStrictEqual(created.tags, ["mcp", "test"]);
    assert.ok(created.docId.startsWith("doc_"));

    const indexText = textOf(await withTimeout(request("tools/call", {
      name: "query_knowledge_base",
      arguments: {
        query: "mcp cold note token",
        scope: "global",
        resultMode: "index",
        limit: 5,
        generateEmbeddings: false,
      },
    }), "query index"));
    assert.ok(indexText.includes(created.docId), "MCP index returns stable doc ID");
    assert.ok(indexText.includes("Source: note"));
    assert.ok(indexText.includes("Kind: research"));
    assert.ok(!indexText.includes("RAW_BODY_SENTINEL"), "MCP index must not leak raw body");

    const readText = textOf(await withTimeout(request("tools/call", {
      name: "manage_knowledge_base",
      arguments: { action: "read_document", docId: created.docId, scope: "global" },
    }), "read_document"));
    const read = JSON.parse(readText);
    assert.strictEqual(read.docId, created.docId);
    assert.strictEqual(read.source_type, "note");
    assert.strictEqual(read.note_kind, "research");
    assert.deepStrictEqual(read.tags, ["mcp", "test"]);
    assert.ok(read.content.includes("RAW_BODY_SENTINEL"));

    const listText = textOf(await withTimeout(request("tools/call", {
      name: "manage_knowledge_base",
      arguments: { action: "list", scope: "global" },
    }), "knowledge list"));
    const list = JSON.parse(listText);
    const item = list.find((entry) => entry.docId === created.docId);
    assert.ok(item, "MCP list exposes created note");
    assert.strictEqual(item.source_type, "note");
    assert.strictEqual(item.note_kind, "research");

    const deleteText = textOf(await withTimeout(request("tools/call", {
      name: "manage_knowledge_base",
      arguments: { action: "delete", docId: created.docId, scope: "global" },
    }), "delete note"));
    const deleted = JSON.parse(deleteText);
    assert.strictEqual(deleted.deleted, true);

    const afterDelete = textOf(await withTimeout(request("tools/call", {
      name: "query_knowledge_base",
      arguments: {
        query: "mcp cold note token",
        scope: "global",
        resultMode: "index",
        limit: 5,
        generateEmbeddings: false,
      },
    }), "query after delete"));
    assert.ok(afterDelete.includes("No matching knowledge"));

    console.log("✅ RAG MEMORY NOTES MCP CONTRACT PASSED!");
  } finally {
    if (child) {
      child.kill();
      try {
        await new Promise((resolve) => {
          if (child.exitCode !== null) resolve();
          else child.once("exit", resolve);
        });
      } catch {}
    }
    rmSync(temp, { recursive: true, force: true });
    if (stderr.length) {
      const unexpected = stderr.join("").trim();
      if (unexpected && process.env.DEBUG_RAG_MEMORY_NOTES_TESTS) {
        console.error(unexpected);
      }
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("rag_memory_notes_mcp.test.js")) {
  runRagMemoryNotesMcpTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
