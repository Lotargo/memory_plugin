import assert from "node:assert";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export async function runRagMcpToolsTests() {
  console.log("--- Running Integration Tests: rag_mcp_tools ---");
  const temp = mkdtempSync(join(tmpdir(), "rag-mcp-tools-"));
  const MEMORY_DIR = join(temp, "mem");
  const GIT_CMD = process.platform === "win32" ? "git.exe" : "git";
  execFileSync(GIT_CMD, ["init"], { cwd: temp, stdio: "ignore" });

  let id = 0;
  const pending = new Map();
  let child;
  let buf = "";
  let output = [];

  function send(obj) {
    child.stdin.write(JSON.stringify(obj) + "\n");
  }

  function request(method, params) {
    return new Promise((resolve2, reject2) => {
      const rid = ++id;
      pending.set(rid, { resolve: resolve2, reject: reject2 });
      send({ jsonrpc: "2.0", id: rid, method, params });
    });
  }

  function onLine(line) {
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  }

  function toolResult(result) {
    const text = (result?.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    return text;
  }

  function withTimeout(p, ms, what) {
    return Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout waiting for ${what}`)), ms)),
    ]);
  }

  const ok = (name) => {
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  };

  function attach(c) {
    c.stdout.setEncoding("utf8");
    c.stderr.setEncoding("utf8");
    c.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim()) {
          try {
            onLine(line);
          } catch (e) {
            output.push(`[PARSE ERR] ${line}: ${e.message}`);
          }
        }
      }
    });
    c.stderr.on("data", (d) => {
      output.push(`[stderr] ${d.trim()}`);
    });
    c.on("error", (e) => output.push(`[spawn error] ${e.message}`));
    c.on("exit", (code, signal) => output.push(`[exit] code=${code} signal=${signal}`));
  }

  child = spawn(process.execPath, [join(ROOT, "mcp-server/index.js")], {
    cwd: temp,
    env: { ...process.env, MEMORY_DIR },
    stdio: ["pipe", "pipe", "pipe"],
  });
  attach(child);

  try {
    // ── Initialize MCP server ────────────────────────────────────────────
    await withTimeout(
      request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "rag-hermetic-test", version: "1.0.0" },
      }),
      15000,
      "initialize"
    );
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

    // ── 1. ingest_document ───────────────────────────────────────────────
    const sampleDoc = [
      "# RAG Architecture Guide",
      "",
      "## Overview",
      "The memory plugin provides a hybrid RAG engine combining BM25 full-text search with dense vector similarity.",
      "",
      "## API Reference",
      "",
      "```javascript",
      "export function initEngine(options = {}) {",
      "  const db = getDatabase();",
      '  console.log("Engine initialized");',
      "  return { status: 'ready', db };",
      "}",
      "```",
      "",
      "## Configuration Table",
      "",
      "| Parameter | Type | Default |",
      "| --- | --- | --- |",
      "| fusionAlgorithm | string | rsf |",
      "| alpha | number | 0.5 |",
      "| embeddingModel | string | e5-small |",
    ].join("\n");

    const ingestRes = toolResult(
      await withTimeout(
        request("tools/call", {
          name: "ingest_document",
          arguments: {
            content: sampleDoc,
            type: "text",
            title: "RAG Architecture Guide",
            path: "virtual://docs/guide.md",
            generateEmbeddings: false,
          },
        }),
        15000,
        "ingest_document"
      )
    );
    const ingestData = JSON.parse(ingestRes);
    assert.strictEqual(ingestData.status, "success", "ingest status=success");
    assert.ok(ingestData.docId, "ingest returns docId");
    assert.strictEqual(ingestData.title, "RAG Architecture Guide", "title preserved");
    assert.ok(ingestData.sectionsCount >= 2, `sectionsCount=${ingestData.sectionsCount}`);
    assert.ok(ingestData.microChunksCount >= 2, `microChunksCount=${ingestData.microChunksCount}`);
    let docId = ingestData.docId;
    ok("ingest_document: text ingestion with sections and chunks");

    // ── 2. ingest_document: deduplication ─────────────────────────────────
    const dedupeRes = toolResult(
      await withTimeout(
        request("tools/call", {
          name: "ingest_document",
          arguments: {
            content: sampleDoc,
            type: "text",
            title: "RAG Architecture Guide",
            path: "virtual://docs/guide.md",
            generateEmbeddings: false,
          },
        }),
        15000,
        "ingest_document dedup"
      )
    );
    const dedupeData = JSON.parse(dedupeRes);
    assert.strictEqual(dedupeData.deduplicated, true, "duplicate document detected");
    docId = dedupeData.docId || docId;
    ok("ingest_document: deduplication on identical content");

    // ── 3. manage_knowledge_base: stats ──────────────────────────────────
    const statsRes = toolResult(
      await request("tools/call", {
        name: "manage_knowledge_base",
        arguments: { action: "stats" },
      })
    );
    const statsData = JSON.parse(statsRes);
    assert.ok(statsData.documents >= 1, `docs=${statsData.documents}`);
    assert.ok(statsData.sections >= 2, `sections=${statsData.sections}`);
    assert.ok(statsData.micro_chunks >= 2, `chunks=${statsData.micro_chunks}`);
    ok("manage_knowledge_base: stats returns counts");

    // ── 4. manage_knowledge_base: list ───────────────────────────────────
    const listRes = toolResult(
      await request("tools/call", {
        name: "manage_knowledge_base",
        arguments: { action: "list" },
      })
    );
    const listData = JSON.parse(listRes);
    assert.ok(Array.isArray(listData), "list returns array");
    assert.ok(listData.length >= 1, "list has at least 1 document");
    assert.ok(listData.some((d) => d.title === "RAG Architecture Guide"), "listed doc has correct title");
    ok("manage_knowledge_base: list returns documents");

    // ── 5. manage_knowledge_base: read_document ──────────────────────────
    const readRes = toolResult(
      await request("tools/call", {
        name: "manage_knowledge_base",
        arguments: { action: "read_document", docId },
      })
    );
    const readData = JSON.parse(readRes);
    assert.strictEqual(readData.title, "RAG Architecture Guide", "read doc title match");
    assert.ok(readData.content.includes("RAG Architecture Guide"), "read doc has content");
    ok("manage_knowledge_base: read_document returns full content");

    // ── 6. query_knowledge_base: BM25 search ─────────────────────────────
    const queryRes = toolResult(
      await request("tools/call", {
        name: "query_knowledge_base",
        arguments: {
          query: "fusionAlgorithm",
          limit: 3,
          generateEmbeddings: false,
        },
      })
    );
    assert.ok(queryRes.includes("fusionAlgorithm") || queryRes.includes("Configuration"), `query found relevant content`);
    assert.ok(!queryRes.includes("No matching knowledge"), "query returned results");
    ok("query_knowledge_base: BM25 retrieval finds relevant content");

    // ── 7. query_knowledge_base: no results ──────────────────────────────
    const emptyQueryRes = toolResult(
      await request("tools/call", {
        name: "query_knowledge_base",
        arguments: {
          query: "xyzzy_nonexistent_unicorn_12345",
          limit: 3,
          generateEmbeddings: false,
        },
      })
    );
    assert.ok(emptyQueryRes.includes("No matching knowledge"), "empty query returns no-match message");
    ok("query_knowledge_base: no-match returns informative message");

    // ── 8. remember + get_fact ────────────────────────────────────────────
    const remRes = toolResult(
      await request("tools/call", {
        name: "remember",
        arguments: {
          scope: "project",
          fact: "Use RSF fusion for all searches",
          tags: "config,rag",
        },
      })
    );
    assert.ok(remRes.includes("Memory updated"), remRes);

    // Recall to find the fact's id
    const recRes = toolResult(
      await request("tools/call", {
        name: "recall",
        arguments: { scope: "project" },
      })
    );
    // Extract id from the recall output using the [id:XXXX] badge pattern
    const idMatch = recRes.match(/id:([a-z0-9]+)/i);
    assert.ok(idMatch, "recall output contains fact id");
    const factId = idMatch[1];

    const getFactRes = toolResult(
      await request("tools/call", {
        name: "get_fact",
        arguments: { id: factId, scope: "project" },
      })
    );
    assert.ok(getFactRes.includes("Use RSF fusion"), "get_fact returns correct body");
    assert.ok(getFactRes.includes("Title:"), "get_fact includes Title field");
    assert.ok(getFactRes.includes("Body:"), "get_fact includes Body field");
    assert.ok(getFactRes.includes("Metadata:"), "get_fact includes Metadata field");
    ok("get_fact: retrieves fact by ID with full metadata");

    // ── 9. get_fact: not found ───────────────────────────────────────────
    const notFoundRes = toolResult(
      await request("tools/call", {
        name: "get_fact",
        arguments: { id: "000000", scope: "project" },
      })
    );
    assert.ok(notFoundRes.includes("not found"), "get_fact returns not-found for missing ID");
    ok("get_fact: returns not-found for missing ID");

    // ── 10. link_knowledge: link fact to document ────────────────────────
    const linkRes = toolResult(
      await request("tools/call", {
        name: "link_knowledge",
        arguments: {
          action: "link",
          factText: "Use RSF fusion for all searches",
          docId,
          scope: "project",
          startLine: 1,
          endLine: 5,
          relationType: "IMPLEMENTS",
        },
      })
    );
    const linkData = JSON.parse(linkRes);
    assert.ok(linkData.linkId, `link created: ${linkRes}`);
    ok("link_knowledge: link fact to document");

    // ── 11. link_knowledge: list_links ────────────────────────────────────
    const listLinksRes = toolResult(
      await request("tools/call", {
        name: "link_knowledge",
        arguments: {
          action: "list_links",
          scope: "project",
        },
      })
    );
    const links = JSON.parse(listLinksRes);
    assert.ok(Array.isArray(links), "list_links returns array");
    assert.ok(links.length >= 1, "at least 1 link exists");
    ok("link_knowledge: list_links returns linked edges");

    // ── 12. link_knowledge: get_doc_links ────────────────────────────────
    const docLinksRes = toolResult(
      await request("tools/call", {
        name: "link_knowledge",
        arguments: {
          action: "get_doc_links",
          docId,
        },
      })
    );
    const docLinks = JSON.parse(docLinksRes);
    assert.ok(Array.isArray(docLinks), "get_doc_links returns array");
    assert.ok(docLinks.length >= 1, "document has at least 1 link");
    ok("link_knowledge: get_doc_links returns links for document");

    // ── 13. manage_knowledge_base: delete ─────────────────────────────────
    const deleteRes = toolResult(
      await request("tools/call", {
        name: "manage_knowledge_base",
        arguments: { action: "delete", docId },
      })
    );
    const deleteData = JSON.parse(deleteRes);
    assert.ok(deleteData.deleted || deleteData.status === "deleted", `delete result: ${deleteRes}`);
    ok("manage_knowledge_base: delete removes document");

    // ── 14. Verify deletion ──────────────────────────────────────────────
    const postDeleteStats = toolResult(
      await request("tools/call", {
        name: "manage_knowledge_base",
        arguments: { action: "stats" },
      })
    );
    const postStats = JSON.parse(postDeleteStats);
    assert.strictEqual(postStats.documents, 0, "0 documents after deletion");
    ok("manage_knowledge_base: stats confirms deletion");

  } finally {
    child.kill();
    try {
      await new Promise((res) => {
        if (child.exitCode !== null) res();
        else child.once("exit", res);
      });
    } catch (e) {}
    try {
      rmSync(temp, { recursive: true, force: true });
    } catch (e) {
      output.push(`[cleanup] ${e.message}`);
    }
  }

  console.log("✅ ALL RAG MCP TOOLS TESTED AND VERIFIED!");
}

if (process.argv[1] && process.argv[1].endsWith("rag_mcp_tools.test.js")) {
  runRagMcpToolsTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
