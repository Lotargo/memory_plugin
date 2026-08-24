import assert from "node:assert/strict";
import * as xlsx from "xlsx";
import { normalizeContent, parseSpreadsheet } from "../../mcp-server/ingest/normalizer.js";

function buildWorkbookBuffer() {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.aoa_to_sheet([
    ["Name", "Value"],
    ["alpha", 42],
    ["beta", "ok"],
  ]);
  xlsx.utils.book_append_sheet(workbook, worksheet, "Data");
  return xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
}

async function main() {
  const buffer = buildWorkbookBuffer();

  const markdown = parseSpreadsheet(buffer, "sample.xlsx");
  assert.match(markdown, /## Sheet: Data/);
  assert.match(markdown, /\| Name \| Value \|/);
  assert.match(markdown, /- Name: alpha/);
  assert.match(markdown, /- Value: 42/);

  const normalized = await normalizeContent({
    content: buffer,
    type: "file",
    path: "sample.xlsx",
  });
  assert.equal(normalized.title, "sample.xlsx");
  assert.match(normalized.markdown, /Record 1 from sheet Data:/);
  assert.match(normalized.markdown, /- Name: beta/);
  assert.match(normalized.markdown, /- Value: ok/);

  const csv = "Name,Value\ngamma,7\n";
  const csvMarkdown = parseSpreadsheet(csv, "sample.csv", true);
  assert.match(csvMarkdown, /- Name: gamma/);
  assert.match(csvMarkdown, /- Value: 7/);

  console.log("spreadsheet_parser tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
