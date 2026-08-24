#!/usr/bin/env node
import readline from "readline";
import { getConfig } from "./config/config_manager.js";
import { selectCategoryMenu, selectSimpleMenu } from "./cli/ui.js";
import { getQuickStats, invalidateQuickStats } from "./cli/quick_stats.js";
import { handleDirectCommands } from "./cli/direct_commands.js";
import { handleEngineAction } from "./cli/handlers/engine_actions.js";
import { handleStorageAction } from "./cli/handlers/storage_actions.js";
import { handleCloudAction } from "./cli/handlers/cloud_actions.js";
import { handlePromptAction } from "./cli/handlers/prompt_actions.js";
import { handleDiagnosticsAction } from "./cli/handlers/diagnostics_actions.js";

export async function runCli() {
  const cliArgs = process.argv.slice(2);

  if (cliArgs.includes("uninstall") || cliArgs.includes("--uninstall")) {
    const { runUninstall } = await import("./uninstall.js");
    await runUninstall();
    return;
  }

  if (cliArgs.includes("--help") || cliArgs.includes("-h") || cliArgs[0] === "help") {
    console.log(`memory-cli — interactive control panel for @lotargo/memory_plugin

Usage:
  memory-cli                         Launch the interactive TUI
  memory-cli login [--from-env|--api-token|--db-url <URL>]
  memory-cli logout [--api-key]
  memory-cli auth-status
  memory-cli link|unlink|relink|identity [--dir <path>] [--remote <url>]
  memory-cli migrate_titles [--key <key>]
  memory-cli dev-link                Link the working repository for local development
  memory-cli sync-persona            Synchronize global directives into client prompts
  memory-cli migrate-persona [--dry-run]
                                     Mark legacy global persona entries as directives
  memory-cli enable-prompt | disable-prompt
  memory-cli uninstall [--purge] [--purge-cache] [--dry-run] [--yes] [--opencode|--claude|--codex|--gemini|--antigravity]
  memory-cli doctor --codex

Options:
  -h, --help                         Show this help text`);
    return;
  }

  const handled = await handleDirectCommands(cliArgs);
  if (handled) return;

  readline.emitKeypressEvents(process.stdin);

  let running = true;
  let selectedCategory = 0;

  while (running) {
    let config = getConfig();
    const stats = await getQuickStats();
    const semPct = Math.round(config.alpha * 100);
    const lexPct = 100 - semPct;

    const categories = [
      {
        label: "ENGINE & HYBRID SEARCH SETTINGS",
        value: "engine",
        hint: `${config.fusionAlgorithm.toUpperCase()} | ${semPct}% Sem / ${lexPct}% Lex | ${config.embeddingModel.split("/").pop()}`,
        info: "Configure search algorithm, embedding models, batch sizes, and hardware",
      },
      {
        label: "KNOWLEDGE BASE & STORAGE MANAGEMENT",
        value: "storage",
        hint: `${stats.docCount} Docs | ${stats.chunkCount} Chunks | ${stats.factCount} Facts`,
        info: "Manage facts, RAG documents, snapshots, models, and database",
      },
      {
        label: "CLOUD SYNCHRONIZATION & TURSO",
        value: "cloud",
        hint: config.mode.toUpperCase(),
        info: "Login, logout, API keys, operational mode, and conflict strategy",
      },
      {
        label: "GLOBAL PROMPT & INTEGRATION MANAGEMENT",
        value: "prompt",
        info: "Enable or disable memory instructions in client configs",
      },
      {
        label: "DIAGNOSTICS & SYSTEM ACTIONS",
        value: "diagnostics",
        info: "Search verification, graph/notebook linking checks, and config reset",
      },
      {
        label: "EXIT",
        value: "exit",
        info: "Save configuration and exit to terminal",
      },
    ];

    const res = await selectCategoryMenu({
      title: "MEMORY PLUGIN RAG ENGINE CONTROL PANEL",
      stats,
      categories,
      initialIndex: selectedCategory,
    });

    if (res.action === "back" || res.value === "exit") {
      running = false;
      console.clear();
      console.log("Exiting CLI. Configuration saved.");
      break;
    }

    selectedCategory = res.index;

    let categoryRunning = true;
    let categoryItemIndex = 0;

    while (categoryRunning) {
      config = getConfig();
      invalidateQuickStats();
      const currentStats = await getQuickStats();
      const catRes = await showCategorySubmenu(res.value, config, currentStats, categoryItemIndex);

      if (catRes.action === "back") {
        categoryRunning = false;
        break;
      }

      categoryItemIndex = catRes.index;
    }
  }
}

async function showCategorySubmenu(category, config, stats, initialIndex = 0) {
  const semPct = Math.round(config.alpha * 100);
  const lexPct = 100 - semPct;

  let items = [];

  switch (category) {
    case "engine":
      items = [
        {
          label: "Fusion Algorithm",
          badge: config.fusionAlgorithm.toUpperCase(),
          value: "algo",
          info: "Choose how vector similarity and BM25 text ranks are fused",
        },
        {
          label: "RSF Alpha Balance",
          badge: `${semPct}% Sem / ${lexPct}% Lex`,
          value: "alpha",
          info: `Current Alpha: ${config.alpha.toFixed(2)}. Adjust ratio of Vector vs BM25 Keyword score`,
        },
        {
          label: "Embedding Model",
          badge: config.embeddingModel.split("/").pop(),
          value: "embedding",
          info: `Model: ${config.embeddingModel}. ONNX Feature Extraction via @huggingface/transformers`,
        },
        {
          label: "Vector Dimension",
          badge: config.vectorDimension > 0 ? `${config.vectorDimension}D FIXED` : "AUTO",
          value: "vector_dim",
          info: config.vectorDimension > 0
            ? `Override embedding dimension to ${config.vectorDimension} (pads/truncates model output for consistency)`
            : "Auto-detect vector dimension from embedding model output",
        },
        {
          label: "Reranker Model",
          badge: config.rerankerEnabled ? config.rerankerModel.split("/").pop() : "DISABLED",
          value: "reranker",
          info: config.rerankerEnabled ? `Reranker active: ${config.rerankerModel}` : "Optional Cross-Encoder re-ranking pass",
        },
        {
          label: "Vector Batch Size",
          badge: `${config.batchSize || 12} Chunks`,
          value: "batch_size",
          info: `Ingestion batch size: ${config.batchSize || 12} micro-chunks per ONNX pass`,
        },
        {
          label: "GPU Attention Budget",
          badge: `${((config.gpuAttentionBudget || 2000000) / 1000000).toFixed(1)}M Units`,
          value: "gpu_budget",
          info: `Micro-batch tensor budget: ${((config.gpuAttentionBudget || 2000000) / 1000000).toFixed(1)}M quadratic units (controls max peak VRAM usage on GPU)`,
        },
        {
          label: "CPU WASM Threads",
          badge: config.onnxThreads > 0 ? `${config.onnxThreads} Threads` : "AUTO (CPU Cores)",
          value: "onnx_threads",
          info: config.onnxThreads > 0 ? `ONNX execution threads manually set to ${config.onnxThreads}` : "Auto-detect optimal physical CPU threads",
        },
        {
          label: "Execution Hardware",
          badge: (config.executionDevice || "cpu").toUpperCase() === "WEBGPU" || (config.executionDevice || "cpu").toUpperCase() === "GPU" ? "\x1b[31mGPU (EXPERIMENTAL)\x1b[0m" : "CPU (AVX2)",
          value: "execution_device",
          info: config.executionDevice === "webgpu" || config.executionDevice === "gpu"
            ? "⚠️ EXPERIMENTAL: ONNX DirectML GPU execution (high VRAM/padding overhead, CPU AVX2 recommended)"
            : "CPU inference via AVX2 / WASM SIMD (Recommended for stability & speed)",
        },
      ];
      break;

    case "storage":
      items = [
        {
          label: "[NOTEBOOK] Layer 1 Facts",
          badge: `${stats.factCount} Facts Saved`,
          value: "notebook",
          info: "Inspect & delete durable user identity facts (global & project)",
        },
        {
          label: "[PROJECT IDENTITY] Manage Git Link & Aliases",
          value: "git_identity",
          info: "Link directory to Git project identity, unlink, relink, or view aliases",
        },
        {
          label: "[FACTS] Migrate Titles to Legacy Facts",
          value: "migrate_titles",
          info: "Mass-stamp auto titles onto facts that lack a **Title** prefix",
        },
        {
          label: "[RAG DOCS] Layer 2 RAG Base",
          badge: `${stats.docCount} Docs / ${stats.chunkCount} Chunks`,
          value: "rag_docs",
          info: "Inspect ingested Markdown/code docs & delete chunks from SQLite",
        },
        {
          label: "[REINDEX] Re-Embed Documents with Current Model",
          badge: `${stats.docCount} Docs`,
          value: "reindex_embeddings",
          info: "Recompute all stored vectors with the active embedding model & vector dimension (use after switching model/dimension). Preserves facts, links, FTS & graph edges",
        },
        {
          label: "[SNAPSHOT EXPORT] Export RAG Base Snapshot",
          value: "export_snapshot",
          info: "Export full RAG database, vectors & blobs into a snapshot file (.json or .json.gz)",
        },
        {
          label: "[SNAPSHOT IMPORT] Import RAG Base Snapshot",
          value: "import_snapshot",
          info: "Import RAG database, vectors & blobs from a snapshot file (.json or .json.gz)",
        },
        {
          label: "[MODELS] Manage & Purge ML Model Cache",
          value: "manage_models",
          info: "Inspect cached ONNX models on disk, check status (Ready / Partial / Not Downloaded) & delete models to free disk space",
        },
        {
          label: "[HARD RESET] Purge RAG Base & Blob Storage",
          value: "hard_reset",
          info: "Permanently delete all documents, sections, vectors, FTS indexes, and blobs",
        },
      ];
      break;

    case "cloud":
      items = [
        {
          label: "[CLOUD] Login to Turso Cloud",
          value: "cloud_login",
          info: "Browser OAuth, account API token, database URL+token, or import from environment (.env) — token/env methods work headless in Docker, Google Jules and VPS",
        },
        {
          label: "[CLOUD] Logout",
          value: "cloud_logout",
          info: "Sign out, purge encrypted secrets, and revert mode to only-local",
        },
        {
          label: "[API KEY] Set / Replace Account API Token",
          value: "cloud_api_set",
          info: "Paste a Turso account API token to authorize headless (Docker, Google Jules, VPS) — validated and persisted",
        },
        {
          label: "[API KEY] Remove Account API Token",
          value: "cloud_api_clear",
          info: "Delete the stored API token; the resolved database session is kept",
        },
        {
          label: "Operational Mode",
          badge: config.mode.toUpperCase(),
          value: "cloud_mode",
          info: "Choose Operational Mode: only-local | only-cloud | hybrid-sync",
        },
        {
          label: "Conflict Strategy",
          badge: (config.conflictStrategy || "merge").toUpperCase(),
          value: "conflict_strategy",
          info: "How hybrid-sync resolves differing local vs cloud stores: merge | cloud-wins | local-wins",
        },
      ];
      break;

    case "prompt":
      items = [
        {
          label: "[PROMPT ENABLE] Enable Global Prompt (Gemini / Antigravity / Codex / Claude)",
          value: "enable_prompt",
          info: "Inject managed memory instructions into each supported client's global prompt file",
        },
        {
          label: "[PROMPT DISABLE] Disable Global Prompt",
          value: "disable_prompt",
          info: "Remove memory instructions from global AGENTS.md / CLAUDE.md files",
        },
      ];
      break;

    case "diagnostics":
      items = [
        {
          label: "[SEARCH] Run Search Verification Query",
          value: "test",
          info: "Execute hybrid search query and display result hit scores",
        },
        {
          label: "[GRAPH] Graph & Notebook Linking Verification",
          value: "graph_test",
          info: "Ingest sample doc + save Notebook fact linked to line range + verify recall & raw document reader",
        },
        {
          label: "[RESET] Reset Config to Factory Defaults",
          value: "reset",
          info: "Reset RSF alpha to 50/50 and restore factory default config",
        },
      ];
      break;
  }

  items.push({ label: "< Back to Main Menu", value: "back" });

  const titles = {
    engine: "ENGINE & HYBRID SEARCH SETTINGS",
    storage: "KNOWLEDGE BASE & STORAGE MANAGEMENT",
    cloud: "CLOUD SYNCHRONIZATION & TURSO",
    prompt: "GLOBAL PROMPT & INTEGRATION MANAGEMENT",
    diagnostics: "DIAGNOSTICS & SYSTEM ACTIONS",
  };

  const subRes = await selectSimpleMenu({
    title: titles[category],
    subtitle: "↑ / ↓ Navigate  •  ENTER Select  •  BACKSPACE Back",
    items,
    initialIndex,
  });

  if (subRes.action === "back" || subRes.value === "back") {
    return { action: "back" };
  }

  await handleSubmenuItem(subRes.value, config, stats);
  return { action: "select", index: subRes.index };
}

async function handleSubmenuItem(value, config, stats) {
  await handleEngineAction(value, config);
  await handleStorageAction(value, config, stats);
  await handleCloudAction(value, config);
  await handlePromptAction(value);
  await handleDiagnosticsAction(value, config, stats);
}

if (process.argv[1] && process.argv[1].includes("cli.js")) {
  if (typeof global.gc !== "function") {
    const { spawn } = await import("node:child_process");
    const args = ["--expose-gc", ...process.argv.slice(1)];
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("exit", (code) => process.exit(code));
  } else {
    runCli().catch((err) => console.error("CLI error:", err));
  }
}
