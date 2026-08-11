import assert from "node:assert";
import {
  estimateTokens,
  parseSections,
  extractMediumBlocks,
  createSmallChunks,
  buildTripleHierarchy,
  generateTableSummary,
} from "../../mcp-server/ingest/chunker.js";

function ok(name) {
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
}

export async function runChunkerTests() {
  console.log("--- Running Unit Tests: chunker ---");
  let passed = 0;

  // ── estimateTokens ──────────────────────────────────────────────────────
  {
    assert.strictEqual(estimateTokens(""), 0, "empty string → 0 tokens");
    assert.strictEqual(estimateTokens(null), 0, "null → 0 tokens");
    assert.strictEqual(estimateTokens(undefined), 0, "undefined → 0 tokens");
    assert.strictEqual(estimateTokens("abcd"), 1, "4 chars → 1 token");
    assert.strictEqual(estimateTokens("a".repeat(100)), 25, "100 chars → 25 tokens");
    ok("estimateTokens: edge cases");
    passed++;
  }

  // ── parseSections: flat text without headings ───────────────────────────
  {
    const text = "Just a plain paragraph.\nSecond line.";
    const sections = parseSections(text, "FlatDoc");
    assert.strictEqual(sections.length, 1, "flat text → single section");
    assert.strictEqual(sections[0].heading, "FlatDoc", "heading = docTitle");
    assert.strictEqual(sections[0].breadcrumbs, "FlatDoc", "breadcrumbs = docTitle only");
    assert.ok(sections[0].content.includes("Just a plain paragraph"), "content preserved");
    assert.ok(sections[0].token_count > 0, "token_count > 0");
    ok("parseSections: flat text without headings");
    passed++;
  }

  // ── parseSections: empty input ─────────────────────────────────────────
  {
    const sections = parseSections("", "EmptyDoc");
    assert.strictEqual(sections.length, 1, "empty → 1 fallback section");
    assert.strictEqual(sections[0].content, "", "content is empty");
    ok("parseSections: empty input fallback");
    passed++;
  }

  // ── parseSections: heading hierarchy ────────────────────────────────────
  {
    const md = [
      "# H1 Title",
      "Intro para.",
      "## H2 Section A",
      "Content A.",
      "### H3 Subsection",
      "Nested content.",
      "## H2 Section B",
      "Content B.",
    ].join("\n");

    const sections = parseSections(md, "Doc");
    assert.strictEqual(sections.length, 4, "4 sections from heading hierarchy");
    assert.strictEqual(sections[0].heading, "H1 Title");
    assert.strictEqual(sections[1].heading, "H2 Section A");
    assert.strictEqual(sections[2].heading, "H3 Subsection");
    assert.ok(sections[2].breadcrumbs.includes("H2 Section A"), "nested breadcrumbs include parent");
    assert.ok(sections[2].breadcrumbs.includes("H3 Subsection"), "nested breadcrumbs include self");
    assert.strictEqual(sections[3].heading, "H2 Section B");
    // H2 Section B should NOT include H3 in its breadcrumbs (popped)
    assert.ok(!sections[3].breadcrumbs.includes("H3"), "sibling heading pops nested stack");
    ok("parseSections: heading hierarchy with breadcrumbs");
    passed++;
  }

  // ── extractMediumBlocks: paragraph, code, table, list ──────────────────
  {
    const section = {
      content: [
        "A paragraph of text.",
        "",
        "```javascript",
        "const x = 1;",
        "```",
        "",
        "| Col1 | Col2 |",
        "| --- | --- |",
        "| A | B |",
        "",
        "- item 1",
        "- item 2",
      ].join("\n"),
      breadcrumbs: "Doc > Section",
    };

    const blocks = extractMediumBlocks(section, "s0", "doc1");
    const types = blocks.map((b) => b.block_type);
    assert.ok(types.includes("paragraph"), "has paragraph block");
    assert.ok(types.includes("code"), "has code block");
    assert.ok(types.includes("table"), "has table block");
    assert.ok(types.includes("list"), "has list block");
    assert.strictEqual(blocks.length, 4, "4 distinct blocks");
    blocks.forEach((b) => {
      assert.ok(b.id.startsWith("s0_m"), `block id prefixed: ${b.id}`);
      assert.strictEqual(b.doc_id, "doc1");
      assert.ok(b.token_count > 0);
    });
    ok("extractMediumBlocks: paragraph, code, table, list types");
    passed++;
  }

  // ── extractMediumBlocks: empty section ─────────────────────────────────
  {
    const blocks = extractMediumBlocks({ content: "", breadcrumbs: "X" }, "s0", "d0");
    assert.strictEqual(blocks.length, 0, "empty content → no blocks");
    ok("extractMediumBlocks: empty section returns []");
    passed++;
  }

  // ── createSmallChunks: small code block kept whole ─────────────────────
  {
    const medBlock = {
      id: "s0_m0",
      section_id: "s0",
      doc_id: "d1",
      content: "```js\nconst a = 1;\n```",
      block_type: "code",
      breadcrumbs: "Doc > Sec",
      token_count: estimateTokens("```js\nconst a = 1;\n```"),
    };
    const chunks = createSmallChunks(medBlock, "s0", "d1");
    assert.strictEqual(chunks.length, 1, "small code block → 1 chunk");
    assert.ok(chunks[0].content.includes("const a = 1"), "code content preserved");
    ok("createSmallChunks: small code block kept whole");
    passed++;
  }

  // ── createSmallChunks: small table kept whole + summary ────────────────
  {
    const tableContent = "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
    const medBlock = {
      id: "s0_m0",
      section_id: "s0",
      doc_id: "d1",
      content: tableContent,
      block_type: "table",
      breadcrumbs: "Doc",
      token_count: estimateTokens(tableContent),
    };
    const chunks = createSmallChunks(medBlock, "s0", "d1");
    assert.strictEqual(chunks.length, 2, "small table → 2 chunks (summary + content)");
    assert.strictEqual(chunks[0].retrieval_policy, "table_summary", "first chunk is table_summary");
    assert.strictEqual(chunks[1].retrieval_policy, "micro_chunk", "second chunk is micro_chunk");
    assert.ok(chunks[0].content.includes("columns"), "summary mentions columns");
    assert.ok(chunks[0].content.includes("A"), "summary contains column name A");
    assert.ok(chunks[0].content.includes("B"), "summary contains column name B");
    assert.strictEqual(chunks[0].policy_source_id, "s0_m0", "summary links to medium block");
    ok("createSmallChunks: small table kept whole + summary");
    passed++;
  }

  // ── createSmallChunks: large table split into row batches + summary ─────
  {
    const header = "| Col1 | Col2 | Col3 |\n| --- | --- | --- |";
    const rows = Array.from({ length: 50 }, (_, i) => `| row_${i}_detailed_description_of_column_data | data_entry_${i}_value_field_with_extra_text | value_${i}_extended_metric_information |`);
    const tableContent = [header, ...rows].join("\n");
    const medBlock = {
      id: "s0_m0",
      section_id: "s0",
      doc_id: "d1",
      content: tableContent,
      block_type: "table",
      breadcrumbs: "Doc",
      token_count: estimateTokens(tableContent),
    };
    const chunks = createSmallChunks(medBlock, "s0", "d1");
    assert.ok(chunks.length > 2, `large table split into ${chunks.length} chunks (summary + batches)`);
    assert.strictEqual(chunks[0].retrieval_policy, "table_summary", "first chunk is table_summary");
    assert.ok(chunks[0].content.includes("Col1"), "summary contains column name");
    assert.ok(chunks[0].content.includes("50 rows"), "summary mentions row count");
    // Row batch chunks should contain the header
    for (let i = 1; i < chunks.length; i++) {
      assert.ok(chunks[i].content.includes("Col1"), "each table chunk includes header");
      assert.strictEqual(chunks[i].retrieval_policy, "micro_chunk", "batch chunks are micro_chunk");
    }
    ok("createSmallChunks: large table split with headers preserved + summary");
    passed++;
  }

  // ── generateTableSummary: extracts columns and row count ───────────────
  {
    const table = "| Name | Age | City |\n| --- | --- | --- |\n| Alice | 30 | NYC |\n| Bob | 25 | LA |\n| Carol | 35 | SF |";
    const summary = generateTableSummary(table, "Doc > Users");
    assert.ok(summary.includes("Name"), "summary contains column Name");
    assert.ok(summary.includes("Age"), "summary contains column Age");
    assert.ok(summary.includes("City"), "summary contains column City");
    assert.ok(summary.includes("3 rows"), "summary mentions 3 rows");
    assert.ok(summary.includes("Doc > Users"), "summary includes breadcrumbs");
    ok("generateTableSummary: extracts columns, row count, and context");
    passed++;
  }

  // ── generateTableSummary: empty table returns null ─────────────────────
  {
    assert.strictEqual(generateTableSummary(""), null, "empty string → null");
    assert.strictEqual(generateTableSummary("   \n   "), null, "whitespace only → null");
    ok("generateTableSummary: handles empty input");
    passed++;
  }

  // ── createSmallChunks: large code block split by AST boundaries ────────
  {
    const functions = Array.from({ length: 5 }, (_, i) =>
      `function fn${i}() {\n${"  // lots of code\n".repeat(30)}}`
    );
    const codeContent = "```javascript\n" + functions.join("\n\n") + "\n```";
    const medBlock = {
      id: "s0_m0",
      section_id: "s0",
      doc_id: "d1",
      content: codeContent,
      block_type: "code",
      breadcrumbs: "Doc",
      token_count: estimateTokens(codeContent),
    };
    const chunks = createSmallChunks(medBlock, "s0", "d1");
    assert.ok(chunks.length >= 5, `code split into ${chunks.length} chunks (expected ≥5 functions)`);
    ok("createSmallChunks: large code block split by function boundaries");
    passed++;
  }

  // ── createSmallChunks: sentence windowing with overlap ─────────────────
  {
    // Generate a paragraph with many sentences to trigger windowing
    const sentences = Array.from({ length: 20 }, (_, i) =>
      `This is sentence number ${i} which has a reasonable amount of words to fill up the token window.`
    );
    const paragraphContent = sentences.join(" ");
    const medBlock = {
      id: "s0_m0",
      section_id: "s0",
      doc_id: "d1",
      content: paragraphContent,
      block_type: "paragraph",
      breadcrumbs: "Doc",
      token_count: estimateTokens(paragraphContent),
    };
    const chunks = createSmallChunks(medBlock, "s0", "d1");
    assert.ok(chunks.length > 1, `paragraph split into ${chunks.length} sentence windows`);
    ok("createSmallChunks: long paragraph sentence windowing");
    passed++;
  }

  // ── buildTripleHierarchy: full pipeline ────────────────────────────────
  {
    const md = [
      "# Project Guide",
      "Overview paragraph with important info.",
      "",
      "## Installation",
      "Run `npm install` to get started.",
      "",
      "```bash",
      "npm install @lotargo/memory_plugin",
      "```",
      "",
      "## Configuration",
      "",
      "| Setting | Default |",
      "| --- | --- |",
      "| mode | only-local |",
      "| alpha | 0.5 |",
      "",
      "### Advanced",
      "Fine-tune the engine settings.",
    ].join("\n");

    const result = buildTripleHierarchy(md, "doc42", "My Project");
    assert.ok(result.sections.length >= 3, `sections: ${result.sections.length}`);
    assert.ok(result.mediumChunks.length >= 3, `medium chunks: ${result.mediumChunks.length}`);
    assert.ok(result.microChunks.length >= 3, `micro chunks: ${result.microChunks.length}`);
    assert.ok(result.toc, "TOC generated");
    const toc = JSON.parse(result.toc);
    assert.ok(toc.length >= 3, "TOC has entries for all sections");

    // Verify ID consistency
    for (const sec of result.sections) {
      assert.ok(sec.id.startsWith("doc42_s"), `section id: ${sec.id}`);
      assert.strictEqual(sec.doc_id, "doc42");
    }
    for (const mc of result.mediumChunks) {
      assert.ok(mc.doc_id === "doc42", "medium chunk doc_id");
    }
    for (const sc of result.microChunks) {
      assert.ok(sc.doc_id === "doc42", "micro chunk doc_id");
    }
    ok("buildTripleHierarchy: full pipeline with TOC");
    passed++;
  }

  // ── buildTripleHierarchy: heading-only document ────────────────────────
  {
    const md = "# Title\n## Sub\n### Deep";
    const result = buildTripleHierarchy(md, "doc0", "Headings Only");
    // Headings without content between them should still produce a valid result
    assert.ok(result.sections.length >= 0, "no crash on heading-only doc");
    assert.ok(result.toc, "TOC generated even for heading-only doc");
    ok("buildTripleHierarchy: heading-only document no crash");
    passed++;
  }

  console.log(`✅ ${passed} chunker assertions passed.`);
}

if (process.argv[1] && process.argv[1].endsWith("chunker.test.js")) {
  runChunkerTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
