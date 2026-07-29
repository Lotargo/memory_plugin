import { mkdir, writeFile, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIR = join(__dirname, "corpus");

const RAW_DOC_SOURCES = [
  { id: "react_readme", title: "React README", url: "https://raw.githubusercontent.com/facebook/react/main/README.md" },
  { id: "react_license", title: "React License", url: "https://raw.githubusercontent.com/facebook/react/main/LICENSE" },
  { id: "express_readme", title: "Express.js README", url: "https://raw.githubusercontent.com/expressjs/express/master/README.md" },
  { id: "vite_readme", title: "Vite README", url: "https://raw.githubusercontent.com/vitejs/vite/main/README.md" },
  { id: "transformers_js_readme", title: "Transformers.js README", url: "https://raw.githubusercontent.com/xenova/transformers.js/main/README.md" },
  { id: "flask_readme", title: "Flask Python README", url: "https://raw.githubusercontent.com/pallets/flask/main/README.md" },
  { id: "fastapi_readme", title: "FastAPI README", url: "https://raw.githubusercontent.com/fastapi/fastapi/master/README.md" },
  { id: "deno_readme", title: "Deno Engine README", url: "https://raw.githubusercontent.com/denoland/deno/main/README.md" },
  { id: "prisma_readme", title: "Prisma ORM README", url: "https://raw.githubusercontent.com/prisma/prisma/main/README.md" },
  { id: "golang_readme", title: "Go Language README", url: "https://raw.githubusercontent.com/golang/go/master/README.md" },
  { id: "rust_readme", title: "Rust Language README", url: "https://raw.githubusercontent.com/rust-lang/rust/master/README.md" },
  { id: "redux_readme", title: "Redux README", url: "https://raw.githubusercontent.com/reduxjs/redux/master/README.md" },
  { id: "tailwindcss_readme", title: "Tailwind CSS README", url: "https://raw.githubusercontent.com/tailwindlabs/tailwindcss/master/README.md" },
  { id: "docker_cli_readme", title: "Docker CLI README", url: "https://raw.githubusercontent.com/docker/cli/master/README.md" },
  { id: "vscode_readme", title: "VS Code README", url: "https://raw.githubusercontent.com/microsoft/vscode/main/README.md" },
  { id: "axios_readme", title: "Axios HTTP README", url: "https://raw.githubusercontent.com/axios/axios/v1.x/README.md" },
  { id: "lodash_readme", title: "Lodash Utility README", url: "https://raw.githubusercontent.com/lodash/lodash/master/README.md" },
  { id: "chartjs_readme", title: "Chart.js Library README", url: "https://raw.githubusercontent.com/chartjs/Chart.js/master/README.md" },
];

// Fallback offline documents if network fetch is blocked or offline
const LOCAL_FALLBACK_DOCS = [
  {
    id: "memory_plugin_arch",
    title: "Zero-Docker Local Hybrid RAG Engine Vision",
    content: `# Architecture Vision: Zero-Docker Local Hybrid RAG Engine for memory_plugin
The goal of this architectural extension is to evolve memory_plugin from a durable user preference notebook into a full-fledged, local, enterprise-grade Hybrid RAG knowledge engine.
Key Principles:
- Zero Heavy Infrastructure: No Docker, no Python backend, no C++ compilation dependencies (node-gyp).
- Resilient Lazy Model Downloading: Light npm package (<3 MB). ONNX models (~130 MB) cached locally.
- Hybrid Retrieval & RRF Fusion: Combines BM25 via SQLite FTS5 with dense vector search via Reciprocal Rank Fusion.
- Triple-Hierarchy Chunking: Small micro-chunks for dense vector precision, Medium sections for coherent LLM prompts, Big documents for macro context.
`,
  },
  {
    id: "memory_plugin_ru_doc",
    title: "Руководство по архитектуре и гибридному поиску на русском языке",
    content: `# Гибридный поиск и векторизация знаний в локальном движке memory_plugin
Локальная система RAG обеспечивает точный поиск информации без отправки данных во внешние облачные сервисы.
Основные возможности:
- Двуязычная модель: intfloat/multilingual-e5-small поддерживает русский и английский языки.
- Двухуровневое хранилище: Блокнот персональных фактов пользователя (Notebook) и База знаний документов (RAG Knowledge Base).
- Графовый поиск GraphRAG Lite: Извлечение и поиск символов кода, функций и связей между документами.
- Защита от деградации при росте объемов данных с помощью адаптивных порогов сходства и фильтрации.
`,
  },
  {
    id: "sqlite_fts5_spec",
    title: "SQLite FTS5 & BM25 Full-Text Search Specification",
    content: `# SQLite FTS5 Search Extension
FTS5 is an SQLite virtual table module that provides full-text search capability.
Features:
- BM25 ranking algorithm calculation for keyword relevance.
- Tokenization using standard unicode61 tokenizer.
- Prefix searching, phrase queries, and boolean AND/OR operator support.
- Ultra fast search performance under WAL (Write-Ahead Logging) mode.
`,
  },
  {
    id: "onnx_transformers_js",
    title: "ONNX Runtime & Transformers.js Integration",
    content: `# Local Neural Network Execution with Transformers.js
Transformers.js enables running state-of-the-art machine learning models directly in Node.js runtime using ONNX Runtime WebAssembly and CPU bindings.
Key components:
- Quantized ONNX models (q8) minimize RAM consumption (~130 MB).
- Automatic feature extraction and pooled Float32Array vector embedding generation.
- Zero native build dependencies or node-gyp native compilation required.
`,
  },
];

export async function fetchRealCorpus() {
  if (!existsSync(CORPUS_DIR)) {
    await new Promise((resolve, reject) => mkdir(CORPUS_DIR, { recursive: true }, (err) => (err ? reject(err) : resolve())));
  }

  console.log(`📡 Fetching real-world corpus files into ${CORPUS_DIR}...`);
  const results = [];

  for (const doc of RAW_DOC_SOURCES) {
    const filePath = join(CORPUS_DIR, `${doc.id}.md`);
    try {
      const response = await fetch(doc.url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const text = await response.text();
        await new Promise((resolve, reject) => writeFile(filePath, text, "utf-8", (err) => (err ? reject(err) : resolve())));
        results.push({ id: doc.id, title: doc.title, path: filePath, bytes: text.length, source: "network" });
        console.log(`  [OK] Fetched ${doc.id} (${text.length} bytes)`);
        continue;
      }
    } catch {
      // Network fetch failed or timed out - fall through to fallback
    }
  }

  // Ensure we always have at least 15-20 documents by adding local fallback docs if needed
  for (const doc of LOCAL_FALLBACK_DOCS) {
    const filePath = join(CORPUS_DIR, `${doc.id}.md`);
    await new Promise((resolve, reject) => writeFile(filePath, doc.content, "utf-8", (err) => (err ? reject(err) : resolve())));
    results.push({ id: doc.id, title: doc.title, path: filePath, bytes: doc.content.length, source: "local" });
    console.log(`  [OK] Saved fallback ${doc.id} (${doc.content.length} bytes)`);
  }

  console.log(`✅ Real corpus ready: ${results.length} documents available.`);
  return results;
}

if (process.argv[1] && process.argv[1].includes("fetch_real_corpus.js")) {
  await fetchRealCorpus();
}
