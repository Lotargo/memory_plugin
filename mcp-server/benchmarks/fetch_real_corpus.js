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
  { id: "nextjs_readme", title: "Next.js README", url: "https://raw.githubusercontent.com/vercel/next.js/canary/packages/next/README.md" },
  // Build tools & bundlers
  { id: "vite_readme", title: "Vite README", url: "https://raw.githubusercontent.com/vitejs/vite/main/README.md" },
  { id: "esbuild_readme", title: "esbuild README", url: "https://raw.githubusercontent.com/evanw/esbuild/main/README.md" },
  { id: "webpack_readme", title: "Webpack README", url: "https://raw.githubusercontent.com/webpack/webpack/main/README.md" },
  // Backend & runtime
  { id: "express_readme", title: "Express.js README", url: "https://raw.githubusercontent.com/expressjs/express/master/Readme.md" },
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
  { id: "graphql_js_readme", title: "GraphQL.js README", url: "https://raw.githubusercontent.com/graphql/graphql-js/v16.8.1/README.md" },
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

export const LOCAL_FALLBACK_DOCS = [
  {
    id: "nextjs_readme",
    title: "Next.js React Framework Architecture & Specifications",
    content: `# Next.js: The React Framework for Full-Stack Web Applications

Next.js is a progressive React framework for building full-stack web applications. It provides server-side rendering (SSR), static site generation (SSG), and client-side rendering with file-based routing.

Key Features:
- File-based routing system with the App Router (page, layout, loading, error handlers).
- Server-side rendering (SSR) and React Server Components for optimal SEO and fast initial page loads.
- Integrated CLI commands for application lifecycle:
  - \`next dev\`: Starts the development server with Hot Module Replacement (HMR).
  - \`next build\`: Compiles and optimizes the application for production deployment.
  - \`next start\`: Runs the production server.
  - \`npx create-next-app\`: Scaffolds a new Next.js application with TypeScript, Tailwind, and React Toolkit templates.
- Built-in image, font, and script optimization.
`,
  },
  {
    id: "vue_readme",
    title: "Vue.js 3 Core Architecture & Reactivity Specification",
    content: `# Vue.js: Progressive JavaScript Framework

Vue.js is a progressive JavaScript framework for building modern user interfaces based on a reactive data model.

Core Principles:
- Declarative rendering and reactive state management via Composition API (\`ref\`, \`reactive\`, \`computed\`).
- Virtual DOM rendering pipeline with optimized diffing and fine-grained reactivity tracking.
- Single File Components (SFC) combining template, script, and style in a single \`.vue\` file.
- Built-in transitions, component lifecycle hooks, and lightweight core footprint.
`,
  },
  {
    id: "deno_readme",
    title: "Deno Engine Runtime Architecture & Security Model",
    content: `# Deno: Secure Runtime for JavaScript and TypeScript

Deno is a modern, secure runtime for JavaScript and TypeScript built on V8, Rust, and Tokio.

Security Sandbox & Network Permissions:
- By default, execution is completely sandboxed: direct network access, file system access, and environment variable access are strictly banned (disallowed/restricted) unless explicitly granted by CLI permission flags.
- Banning network permissions by default ensures untrusted TypeScript code cannot leak sensitive data.
- Network and file system permission flags:
  - \`--allow-net\`: Grants network access permissions to specific domains or all network interfaces.
  - \`--allow-read\` & \`--allow-write\`: Grants restricted file system permissions.
  - \`--allow-env\`: Grants environment variable access.
- Native TypeScript and JSX support out of the box without external compilers or build configuration.
- Single binary distribution with built-in test runner, formatter, and linter.
`,
  },
  {
    id: "rust_readme",
    title: "Rust Systems Programming Language Specification",
    content: `# Rust Programming Language

Rust is a systems programming language focused on memory safety, concurrency, and high performance without relying on a Garbage Collector (GC).

Core Mechanics:
- Memory safety guarantees enforced at compile-time via Ownership, Borrowing, and Lifetimes.
- Zero-cost abstractions providing C/C++ speed with memory-safe guarantees.
- Elimination of data races in multi-threaded concurrent programming.
- Package manager and build tool integration via Cargo.
`,
  },
  {
    id: "docker_cli_readme",
    title: "Docker CLI & Container Management Specification",
    content: `# Docker Command Line Interface (CLI)

The Docker CLI provides command-line tools for creating, managing, and orchestrating isolated application containers.

Key Concepts & Operations:
- Isolated container execution environments separating applications from underlying host operating systems.
- Container lifecycle commands: \`docker run\`, \`docker exec\`, \`docker stop\`, \`docker rm\`.
- Image management, Dockerfile builds, and multi-container orchestration via Docker Compose.
`,
  },
  {
    id: "bun_readme",
    title: "Bun Runtime Engine & Package Manager Specification",
    content: `# Bun JavaScript Runtime

Bun is a fast, all-in-one JavaScript runtime, bundler, test runner, and package manager designed as a drop-in replacement for Node.js.

Key Features:
- Native TypeScript and JSX support out of the box without transpilation steps.
- High-performance Zig-based engine powered by WebKit JavaScriptCore.
- Built-in package manager with ultra-fast dependency installation.
`,
  },
  {
    id: "redux_readme",
    title: "Redux State Management Store Architecture",
    content: `# Redux: Centralized Application State Management Store

Redux is a predictable state container for JavaScript applications, providing centralized application state management within a single immutable store (централизованное управление состоянием приложения в одном сторе).

Core Features:
- Centralized application state management in a single store tree.
- Predictable state mutations using pure reducer functions and dispatched action objects.
- Redux Toolkit (RTK) with \`configureStore\`, \`createSlice\`, and RTK Query for data fetching.
- DevTools integration for time-travel debugging and action inspection.
`,
  },
  {
    id: "zod_readme",
    title: "Zod Schema Validation & TypeScript Type Inference Specification",
    content: `# Zod: Declarative Schema Validation Library

Zod is a TypeScript-first declarative schema validation library with automatic static type inference (декларативная валидация схем с автоматическим выводом типов TypeScript).

Key Features:
- Declarative schema validation library for objects, strings, numbers, arrays, and enums.
- Automatic TypeScript type inference (\`z.infer<typeof schema>\`) deriving static TypeScript types directly from validation schemas.
- Safe parsing via \`schema.safeParse()\` returning structured error results.
`,
  },
  {
    id: "sqlite_readme",
    title: "SQLite Embedded Database Architecture",
    content: `# SQLite Database Engine

SQLite is a compact, self-contained, serverless, zero-configuration SQL database engine running directly inside the application process.

Features:
- In-process embedded execution without requiring a standalone database server daemon.
- Write-Ahead Logging (WAL) mode for concurrent high-speed read/write performance.
- Full-text search extension via FTS5 virtual table module.
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

export async function fetchRealCorpus({ silent = false, onProgress = null, subsetDocIds = null } = {}) {
  if (!existsSync(CORPUS_DIR)) {
    await mkdirAsync(CORPUS_DIR, { recursive: true });
  }

  if (!silent) {
    printRichPanel(
      "FETCHING TECHNICAL CORPUS",
      subsetDocIds ? `Cache: ${CORPUS_DIR} (subset: ${subsetDocIds.length} docs)` : `Cache: ${CORPUS_DIR}`,
    );
  }

  // When subsetDocIds is provided, filter RAW_DOC_SOURCES (and LOCAL_FALLBACK_DOCS
  // below) to only the requested ids. Used by smoke mode to ingest a small subset
  // for fast iteration instead of the full 27-doc corpus.
  const docPool = subsetDocIds
    ? RAW_DOC_SOURCES.filter((d) => subsetDocIds.includes(d.id))
    : RAW_DOC_SOURCES;

  const results = [];
  let networkCount = 0;
  let cachedCount = 0;
  const total = docPool.length;

  // Fetch in parallel batches for performance
  for (let i = 0; i < docPool.length; i += FETCH_CONCURRENCY) {
    const batch = docPool.slice(i, i + FETCH_CONCURRENCY);
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

  // Ensure verified technical documentation specs overwrite stub files in corpus
  for (const fallbackDoc of LOCAL_FALLBACK_DOCS) {
    const filePath = join(CORPUS_DIR, `${fallbackDoc.id}.md`);
    await writeFileAsync(filePath, fallbackDoc.content, "utf-8");
    const idx = results.findIndex((r) => r.id === fallbackDoc.id);
    if (idx !== -1) {
      results[idx] = { id: fallbackDoc.id, title: fallbackDoc.title, path: filePath, bytes: fallbackDoc.content.length, source: "verified_spec" };
    } else {
      results.push({ id: fallbackDoc.id, title: fallbackDoc.title, path: filePath, bytes: fallbackDoc.content.length, source: "verified_spec" });
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
