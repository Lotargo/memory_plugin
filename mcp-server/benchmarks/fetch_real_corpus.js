import { mkdir, writeFile, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIR = join(__dirname, "corpus");

const RAW_DOC_SOURCES = [
  // Frontend frameworks & libraries
  { id: "react_readme", title: "React README", url: "https://raw.githubusercontent.com/facebook/react/main/README.md" },
  { id: "react_license", title: "React License", url: "https://raw.githubusercontent.com/facebook/react/main/LICENSE" },
  { id: "vue_readme", title: "Vue.js README", url: "https://raw.githubusercontent.com/vuejs/core/main/README.md" },
  { id: "svelte_readme", title: "Svelte README", url: "https://raw.githubusercontent.com/sveltejs/svelte/main/README.md" },
  { id: "nextjs_readme", title: "Next.js README", url: "https://raw.githubusercontent.com/vercel/next.js/canary/README.md" },
  // Build tools & bundlers
  { id: "vite_readme", title: "Vite README", url: "https://raw.githubusercontent.com/vitejs/vite/main/README.md" },
  { id: "esbuild_readme", title: "esbuild README", url: "https://raw.githubusercontent.com/evanw/esbuild/main/README.md" },
  { id: "webpack_readme", title: "Webpack README", url: "https://raw.githubusercontent.com/webpack/webpack/main/README.md" },
  // Backend & runtime
  { id: "express_readme", title: "Express.js README", url: "https://raw.githubusercontent.com/expressjs/express/master/README.md" },
  { id: "fastapi_readme", title: "FastAPI README", url: "https://raw.githubusercontent.com/fastapi/fastapi/master/README.md" },
  { id: "flask_readme", title: "Flask Python README", url: "https://raw.githubusercontent.com/pallets/flask/main/README.md" },
  { id: "deno_readme", title: "Deno Engine README", url: "https://raw.githubusercontent.com/denoland/deno/main/README.md" },
  { id: "bun_readme", title: "Bun Runtime README", url: "https://raw.githubusercontent.com/oven-sh/bun/main/README.md" },
  // Languages
  { id: "golang_readme", title: "Go Language README", url: "https://raw.githubusercontent.com/golang/go/master/README.md" },
  { id: "rust_readme", title: "Rust Language README", url: "https://raw.githubusercontent.com/rust-lang/rust/master/README.md" },
  { id: "typescript_readme", title: "TypeScript README", url: "https://raw.githubusercontent.com/microsoft/TypeScript/main/README.md" },
  // State management & data
  { id: "redux_readme", title: "Redux README", url: "https://raw.githubusercontent.com/reduxjs/redux/master/README.md" },
  { id: "prisma_readme", title: "Prisma ORM README", url: "https://raw.githubusercontent.com/prisma/prisma/main/README.md" },
  { id: "graphql_js_readme", title: "GraphQL.js README", url: "https://raw.githubusercontent.com/graphql/graphql-js/main/README.md" },
  // Databases
  { id: "sqlite_readme", title: "SQLite README", url: "https://raw.githubusercontent.com/sqlite/sqlite/master/README.md" },
  // CSS & styling
  { id: "tailwindcss_readme", title: "Tailwind CSS README", url: "https://raw.githubusercontent.com/tailwindlabs/tailwindcss/master/README.md" },
  // Testing
  { id: "playwright_readme", title: "Playwright README", url: "https://raw.githubusercontent.com/microsoft/playwright/main/README.md" },
  // Networking & HTTP
  { id: "axios_readme", title: "Axios HTTP README", url: "https://raw.githubusercontent.com/axios/axios/v1.x/README.md" },
  // Utilities
  { id: "lodash_readme", title: "Lodash Utility README", url: "https://raw.githubusercontent.com/lodash/lodash/master/README.md" },
  { id: "zod_readme", title: "Zod Validation README", url: "https://raw.githubusercontent.com/colinhacks/zod/master/packages/zod/README.md" },
  // Visualization
  { id: "chartjs_readme", title: "Chart.js Library README", url: "https://raw.githubusercontent.com/chartjs/Chart.js/master/README.md" },
  { id: "threejs_readme", title: "Three.js README", url: "https://raw.githubusercontent.com/mrdoob/three.js/dev/README.md" },
  // ML / AI
  { id: "transformers_js_readme", title: "Transformers.js README", url: "https://raw.githubusercontent.com/xenova/transformers.js/main/README.md" },
  // Infrastructure
  { id: "docker_cli_readme", title: "Docker CLI README", url: "https://raw.githubusercontent.com/docker/cli/master/README.md" },
  // Editor
  { id: "vscode_readme", title: "VS Code README", url: "https://raw.githubusercontent.com/microsoft/vscode/main/README.md" },
];

// Fallback offline documents if network fetch is blocked or offline
// Fallback tech-spec docs — only used when few real documents fetched (network issues).
// These describe real, independently-existing technologies; none reference this plugin.
const LOCAL_FALLBACK_DOCS = [
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
    id: "onnx_runtime_spec",
    title: "ONNX Runtime Inference Engine Specification",
    content: `# ONNX Runtime: Cross-Platform Machine Learning Model Accelerator
ONNX Runtime is a cross-platform inference engine for machine learning models in the Open Neural Network Exchange (ONNX) format.
Key components:
- Quantized ONNX models (q8, q4) minimize RAM consumption.
- Hardware-accelerated inference via CPU (MLAS), GPU (CUDA, DirectML, ROCm).
- Node.js bindings via onnxruntime-node and onnxruntime-web packages.
`,
  },
];

const MIN_REAL_DOCS_BEFORE_FALLBACK = 15;

export async function fetchRealCorpus() {
  if (!existsSync(CORPUS_DIR)) {
    await new Promise((resolve, reject) => mkdir(CORPUS_DIR, { recursive: true }, (err) => (err ? reject(err) : resolve())));
  }

  console.log(`📡 Fetching real-world corpus files into ${CORPUS_DIR}...`);
  const results = [];
  let networkSuccesses = 0;

  for (const doc of RAW_DOC_SOURCES) {
    const filePath = join(CORPUS_DIR, `${doc.id}.md`);
    try {
      const response = await fetch(doc.url, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const text = await response.text();
        await new Promise((resolve, reject) => writeFile(filePath, text, "utf-8", (err) => (err ? reject(err) : resolve())));
        results.push({ id: doc.id, title: doc.title, path: filePath, bytes: text.length, source: "network" });
        networkSuccesses++;
        console.log(`  [OK] Fetched ${doc.id} (${text.length} bytes)`);
        continue;
      }
    } catch {
      // Network fetch failed or timed out - fall through
    }
  }

  // Only add local fallback docs when network fetches are sparse (offline / blocked)
  if (networkSuccesses < MIN_REAL_DOCS_BEFORE_FALLBACK) {
    console.log(`  [FALLBACK] Only ${networkSuccesses} network docs fetched (threshold: ${MIN_REAL_DOCS_BEFORE_FALLBACK}), adding ${LOCAL_FALLBACK_DOCS.length} local docs...`);
    for (const doc of LOCAL_FALLBACK_DOCS) {
      const filePath = join(CORPUS_DIR, `${doc.id}.md`);
      await new Promise((resolve, reject) => writeFile(filePath, doc.content, "utf-8", (err) => (err ? reject(err) : resolve())));
      results.push({ id: doc.id, title: doc.title, path: filePath, bytes: doc.content.length, source: "local_fallback" });
      console.log(`  [OK] Saved fallback ${doc.id} (${doc.content.length} bytes)`);
    }
  }

  console.log(`✅ Corpus ready: ${results.length} documents (${networkSuccesses} network, ${results.length - networkSuccesses} local).`);
  return results;
}

if (process.argv[1] && process.argv[1].includes("fetch_real_corpus.js")) {
  await fetchRealCorpus();
}
