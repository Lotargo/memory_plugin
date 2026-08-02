import assert from "node:assert";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import xlsx from "xlsx";
import mammoth from "mammoth";
import { getDatabase } from "./db/database.js";
import { extractSymbolsFromContent } from "./graph/graph_extractor.js";
import { normalizeContent } from "./ingest/normalizer.js";
import { ingestDocument } from "./ingest/pipeline.js";

const TEST_DIR = join(tmpdir(), `memory_test_expanded_${Date.now()}`);
const TEST_DB_PATH = join(TEST_DIR, "test_memory_expanded.sqlite");

console.log("--- Starting Expanded Multilingual & Document Parsing Tests ---");

if (!existsSync(TEST_DIR)) {
  try {
    import("node:fs").then(fs => fs.mkdirSync(TEST_DIR, { recursive: true }));
  } catch {}
}

try {
  // 1. Multilingual Symbol Extractor Tests
  console.log("1. Testing Expanded Multilingual Symbol Extractor...");

  // JavaScript / TypeScript
  const jsContent = `
    class UserManager {
      constructor() { this.users = []; }
      async registerUser(username) {
        const newUser = { username };
        return newUser;
      }
    }
  `;
  const jsSymbols = extractSymbolsFromContent(jsContent);
  assert(jsSymbols.includes("UserManager"), "JS: Should extract class UserManager");
  assert(jsSymbols.includes("registerUser"), "JS: Should extract method registerUser");
  assert(!jsSymbols.includes("const"), "JS: Should not extract keyword 'const'");

  // Python
  const pyContent = `
    class DatabaseConnection:
      def __init__(self, dsn):
        self.dsn = dsn

      async def execute_query(self, sql):
        pass
  `;
  const pySymbols = extractSymbolsFromContent(pyContent);
  assert(pySymbols.includes("DatabaseConnection"), "Python: Should extract class DatabaseConnection");
  assert(pySymbols.includes("execute_query"), "Python: Should extract method execute_query");
  assert(!pySymbols.includes("def"), "Python: Should not extract keyword 'def'");

  // Go
  const goContent = `
    package main
    type PaymentGateway struct {
      ApiKey string
    }
    type Gateway interface {
      Process(amount float64) bool
    }
    func (p *PaymentGateway) Process(amount float64) bool {
      return true
    }
  `;
  const goSymbols = extractSymbolsFromContent(goContent);
  assert(goSymbols.includes("PaymentGateway"), "Go: Should extract struct PaymentGateway");
  assert(goSymbols.includes("Gateway"), "Go: Should extract interface Gateway");
  assert(goSymbols.includes("Process"), "Go: Should extract method/function Process");

  // Rust
  const rustContent = `
    pub struct WebServer {
      port: u16,
    }
    pub trait Handler {
      async fn handle_request(&self) -> Response;
    }
  `;
  const rustSymbols = extractSymbolsFromContent(rustContent);
  assert(rustSymbols.includes("WebServer"), "Rust: Should extract struct WebServer");
  assert(rustSymbols.includes("Handler"), "Rust: Should extract trait Handler");
  assert(rustSymbols.includes("handle_request"), "Rust: Should extract fn handle_request");

  // C++
  const cppContent = `
    namespace MathUtils {
      class Calculator {
        public:
          int add(int a, int b) const {
            return a + b;
          }
      };
    }
  `;
  const cppSymbols = extractSymbolsFromContent(cppContent);
  assert(cppSymbols.includes("MathUtils"), "C++: Should extract namespace MathUtils");
  assert(cppSymbols.includes("Calculator"), "C++: Should extract class Calculator");
  assert(cppSymbols.includes("add"), "C++: Should extract method add");

  // Java & Kotlin
  const javaContent = `
    public class OrderProcessor {
      private static final int MAX_RETRIES = 3;
      public synchronized boolean dispatchOrder(Order order) throws IOException {
        return true;
      }
    }
  `;
  const javaSymbols = extractSymbolsFromContent(javaContent);
  assert(javaSymbols.includes("OrderProcessor"), "Java: Should extract class OrderProcessor");
  assert(javaSymbols.includes("dispatchOrder"), "Java: Should extract method dispatchOrder");

  const kotlinContent = `
    fun calculateDiscount(price: Double): Double {
      return price * 0.1
    }
  `;
  const kotlinSymbols = extractSymbolsFromContent(kotlinContent);
  assert(kotlinSymbols.includes("calculateDiscount"), "Kotlin: Should extract fun calculateDiscount");

  // C#
  const csharpContent = `
    namespace Shop {
      public interface IDiscountService {
        decimal ApplyDiscount(decimal total);
      }
    }
  `;
  const csharpSymbols = extractSymbolsFromContent(csharpContent);
  assert(csharpSymbols.includes("Shop"), "C#: Should extract namespace Shop");
  assert(csharpSymbols.includes("IDiscountService"), "C#: Should extract interface IDiscountService");
  assert(csharpSymbols.includes("ApplyDiscount"), "C#: Should extract method ApplyDiscount");

  // PHP
  const phpContent = `
    <?php
    namespace App\\Services;
    trait Loggable {
      public function logMessage($msg) { echo $msg; }
    }
  `;
  const phpSymbols = extractSymbolsFromContent(phpContent);
  assert(phpSymbols.includes("Loggable"), "PHP: Should extract trait Loggable");
  assert(phpSymbols.includes("logMessage"), "PHP: Should extract function logMessage");

  // Ruby
  const rubyContent = `
    module Authentication
      class SessionController
        def create_session!(user_id)
          Session.new(user_id)
        end
      end
    end
  `;
  const rubySymbols = extractSymbolsFromContent(rubyContent);
  assert(rubySymbols.includes("Authentication"), "Ruby: Should extract module Authentication");
  assert(rubySymbols.includes("SessionController"), "Ruby: Should extract class SessionController");
  assert(rubySymbols.includes("create_session!"), "Ruby: Should extract def create_session!");

  console.log("  [PASS] Expanded Multilingual Symbol Extractor OK");

  // 2. Document Normalizer Tests (PDF, DOCX, XLSX, CSV)
  console.log("2. Testing Document Normalization...");

  // XLSX parsing & Hybrid representation
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet([
    ["Employee ID", "Full Name", "Department"],
    ["E101", "John Doe", "Engineering"],
    ["E102", "Jane Smith", "Marketing"]
  ]);
  xlsx.utils.book_append_sheet(wb, ws, "Staff");
  const xlsxBuffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

  const xlsxNormalized = await normalizeContent({
    content: xlsxBuffer,
    type: "file",
    path: "staff_directory.xlsx"
  });

  assert(xlsxNormalized.markdown.includes("## Sheet: Staff"), "XLSX: Output should include sheet header");
  assert(xlsxNormalized.markdown.includes("| Employee ID | Full Name | Department |"), "XLSX: Output should include Markdown table header");
  assert(xlsxNormalized.markdown.includes("| E101 | John Doe | Engineering |"), "XLSX: Output should include Markdown table rows");
  assert(xlsxNormalized.markdown.includes("### Searchable Records"), "XLSX: Output should include Searchable Records header");
  assert(xlsxNormalized.markdown.includes("Record 1 from sheet Staff:"), "XLSX: Output should include record markers");
  assert(xlsxNormalized.markdown.includes("- Employee ID: E101"), "XLSX: Output should include row key-value data");

  // CSV parsing & Hybrid representation
  const csvContent = "Product,Price,InStock\nWidget A,19.99,true\nWidget B,49.50,false";
  const csvNormalized = await normalizeContent({
    content: csvContent,
    type: "file",
    path: "inventory.csv"
  });

  assert(csvNormalized.markdown.includes("| Product | Price | InStock |"), "CSV: Output should include Markdown table header");
  assert(csvNormalized.markdown.includes("- Product: Widget A"), "CSV: Output should include key-value row representation");
  assert(csvNormalized.markdown.includes("Record 2 from sheet Sheet1:"), "CSV: Output should include default sheet row marker");

  // PDF Ingestion with valid minimal PDF bytes
  const minimalPdfBuffer = Buffer.from(
    "%PDF-1.4\n" +
    "1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n" +
    "2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj\n" +
    "3 0 obj <</Type /Page /Parent 2 0 R /Resources <</Font <</F1 <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>>>>> /MediaBox [0 0 612 792] /Contents 4 0 R>> endobj\n" +
    "4 0 obj <</Length 44>> stream\n" +
    "BT\n" +
    "/F1 12 Tf\n" +
    "72 712 Td\n" +
    "(Hello PDF World) Tj\n" +
    "ET\n" +
    "endstream\n" +
    "endobj\n" +
    "xref\n" +
    "0 5\n" +
    "0000000000 65535 f\n" +
    "0000000009 00000 n\n" +
    "0000000056 00000 n\n" +
    "0000000111 00000 n\n" +
    "0000000301 00000 n\n" +
    "trailer <</Size 5 /Root 1 0 R>>\n" +
    "startxref\n" +
    "396\n" +
    "%%EOF"
  );
  const pdfNormalized = await normalizeContent({
    content: minimalPdfBuffer,
    type: "file",
    path: "sample.pdf"
  });
  assert(pdfNormalized.markdown.includes("Hello PDF World"), "PDF: Output should extract text cleanly");

  // DOCX Ingestion with Mammoth stubbed
  const originalConvert = mammoth.convertToMarkdown;
  mammoth.convertToMarkdown = async (options) => {
    return { value: "# Mammoth DOCX Title\nThis is converted from docx." };
  };

  try {
    const docxNormalized = await normalizeContent({
      content: Buffer.from("dummy zip data"),
      type: "file",
      path: "sample.docx"
    });
    assert(docxNormalized.markdown.includes("Mammoth DOCX Title"), "DOCX: Output should extract content via Mammoth");
  } finally {
    mammoth.convertToMarkdown = originalConvert;
  }

  console.log("  [PASS] Document Normalization OK");

  // 3. End-to-End Ingestion Integration Test
  console.log("3. Testing End-to-End Spreadsheet Ingestion & Retrieval...");
  const db = getDatabase(TEST_DB_PATH);

  const ingestRes = await ingestDocument({
    content: csvContent,
    type: "file",
    path: "inventory.csv",
    title: "Inventory Log",
    customDb: db,
    generateEmbeddings: false // faster mock vectors
  });

  assert(ingestRes.doc_id, "E2E: Should return doc_id");
  assert(ingestRes.micro_chunks_count > 0, "E2E: Should generate chunks");

  // Verify DB entries
  const docRow = db.prepare("SELECT * FROM documents WHERE id = ?").get(ingestRes.doc_id);
  assert.strictEqual(docRow.title, "Inventory Log", "E2E: DB Document title match");

  const ftsHits = db.prepare("SELECT * FROM micro_chunks_fts WHERE micro_chunks_fts MATCH 'Widget A';").all();
  assert(ftsHits.length >= 1, "E2E: FTS query should find Widget A");

  const microChunkRow = db.prepare("SELECT content FROM micro_chunks WHERE doc_id = ?").all(ingestRes.doc_id);
  const rowContentText = microChunkRow.map(r => r.content).join("\n");
  assert(rowContentText.includes("- Product: Widget A"), "E2E: Record contents must exist in RAG database");

  db.close();
  console.log("  [PASS] End-to-End Ingestion Integration OK");

  console.log("\n✅ ALL EXPANDED PARSING & DOCUMENT RETRIEVAL TESTS PASSED SUCCESSFULLY!");
} catch (err) {
  console.error("\n❌ EXPANDED PARSING TEST FAILED:", err);
  process.exit(1);
} finally {
  if (existsSync(TEST_DIR)) {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore Windows temp locks
    }
  }
}
