import { readFile, readdir, stat, rm, mkdir as mkdirAsync, writeFile as writeFileAsync } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MEMORY_DIR } from "../memory.js";

export const CORPUS_DIR = join(MEMORY_DIR, "cache", "benchmark_corpus");
const PANEL_WIDTH = 58;

function printRichPanel(title, subtitle = "") {
  const line = "─".repeat(PANEL_WIDTH - 2);
  console.log(`\x1b[36m╭${line}╮\x1b[0m`);
  console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37m${title.padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[36m│\x1b[0m`);
  if (subtitle) {
    console.log(`\x1b[36m│\x1b[0m  \x1b[90m${subtitle.padEnd(PANEL_WIDTH - 6)}\x1b[0m  \x1b[36m│\x1b[0m`);
  }
  console.log(`\x1b[36m╰${line}╯\x1b[0m`);
}

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
const FETCH_CONCURRENCY = 6;

async function fetchSingleDoc(doc, targetDir) {
  const filePath = join(targetDir, `${doc.id}.md`);

  // Use cached file if it already exists
  if (existsSync(filePath)) {
    try {
      const content = await readFile(filePath, "utf-8");
      if (content.length > 0) {
        return { id: doc.id, title: doc.title, path: filePath, bytes: content.length, source: "cached" };
      }
    } catch {
      // Cache read failed, re-fetch below
    }
  }

  // Fetch from network
  const response = await fetch(doc.url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const text = await response.text();
  await writeFileAsync(filePath, text, "utf-8");
  return { id: doc.id, title: doc.title, path: filePath, bytes: text.length, source: "network" };
}

export async function fetchRealCorpus({ silent = false, onProgress = null } = {}) {
  if (!existsSync(CORPUS_DIR)) {
    await mkdirAsync(CORPUS_DIR, { recursive: true });
  }

  if (!silent) {
    printRichPanel("FETCHING TECHNICAL CORPUS", `Cache: ${CORPUS_DIR}`);
  }

  const results = [];
  let networkCount = 0;
  let cachedCount = 0;
  const total = RAW_DOC_SOURCES.length;

  // Fetch in parallel batches for performance
  for (let i = 0; i < RAW_DOC_SOURCES.length; i += FETCH_CONCURRENCY) {
    const batch = RAW_DOC_SOURCES.slice(i, i + FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((doc) => fetchSingleDoc(doc, CORPUS_DIR))
    );

    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(result.value);
        if (result.value.source === "network") {
          networkCount++;
          if (!silent) console.log(`  [OK] Fetched ${result.value.id} (${result.value.bytes} bytes)`);
        } else if (result.value.source === "cached") {
          cachedCount++;
        }
      }
    }

    if (onProgress) onProgress({ phase: "fetch", current: Math.min(i + FETCH_CONCURRENCY, total), total });
  }

  // Add fallback docs if not enough real documents available
  if (results.length < MIN_REAL_DOCS_BEFORE_FALLBACK) {
    if (!silent) {
      console.log(`  [FALLBACK] Only ${results.length} docs available, adding ${LOCAL_FALLBACK_DOCS.length} local docs...`);
    }
    for (const doc of LOCAL_FALLBACK_DOCS) {
      const filePath = join(CORPUS_DIR, `${doc.id}.md`);
      await writeFileAsync(filePath, doc.content, "utf-8");
      results.push({ id: doc.id, title: doc.title, path: filePath, bytes: doc.content.length, source: "local_fallback" });
    }
  }

  if (!silent) {
    console.log(`\n  [OK] Corpus ready: ${results.length} documents (${networkCount} fetched, ${cachedCount} cached, ${results.length - networkCount - cachedCount} fallback).\n`);
  }
  return results;
}

/**
 * Returns the total size of the benchmark corpus cache in bytes,
 * or 0 if the cache directory doesn't exist.
 */
export async function getCorpusCacheSize() {
  if (!existsSync(CORPUS_DIR)) return 0;
  let totalBytes = 0;
  try {
    const files = await readdir(CORPUS_DIR);
    const stats = await Promise.all(
      files.map(async (f) => {
        try {
          const s = await stat(join(CORPUS_DIR, f));
          return s.isFile() ? s.size : 0;
        } catch {
          return 0;
        }
      })
    );
    totalBytes = stats.reduce((sum, s) => sum + s, 0);
  } catch {
    // Directory read failed
  }
  return totalBytes;
}

/**
 * Deletes the entire benchmark corpus cache directory.
 */
export async function clearCorpusCache() {
  if (!existsSync(CORPUS_DIR)) return false;
  await rm(CORPUS_DIR, { recursive: true, force: true });
  return true;
}

if (process.argv[1] && process.argv[1].includes("fetch_real_corpus.js")) {
  await fetchRealCorpus();
}
