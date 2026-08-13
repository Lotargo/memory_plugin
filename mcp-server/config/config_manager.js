import fs from "fs";
import path from "path";
import { MEMORY_DIR, ensureDirSync } from "../memory.js";

const CONFIG_FILE = path.join(MEMORY_DIR, "config.json");

export const DEFAULT_CONFIG = {
  fusionAlgorithm: "rsf", // "rsf" | "rrf" | "semantic_only" | "lexical_only"
  alpha: 0.5,             // Weight for vector similarity in RSF [0.0 - 1.0] (50/50 balance)
  embeddingModel: "Xenova/multilingual-e5-small",
  vectorDimension: 0,     // Fixed embedding dimension (0 = auto-detect from model output)
  rerankerModel: "none",   // "none" | "Xenova/bge-reranker-base" | custom HF model
  rerankerEnabled: false,
  batchSize: 12,           // Ingestion vector batch size [1 - 256] (default 12)
  vectorScanLimit: 50000,  // Max micro-chunks scanned per vector query (0 = unlimited)
  gpuAttentionBudget: 2000000, // GPU micro-batch attention budget [1M - 16M] (default 2.0M ~1.5GB VRAM)
  onnxThreads: 0,          // ONNX WASM threads: 0 = auto-detect CPU cores, or 1-16
  executionDevice: "cpu",  // "cpu" | "webgpu"
  mode: "only-local",     // "only-local" | "only-cloud" | "hybrid-sync"
  conflictStrategy: "merge", // "merge" | "cloud-wins" | "local-wins"
  tursoUrl: "",           // Connection endpoint URL for Turso DB
  failoverUrl: "",        // Failover connection endpoint URL (Fly.io + LiteFS)
  authorized: false,      // True once the user completed cloud login (token stored encrypted)
  username: "",           // Account username from the Turso OAuth profile
  ingestAllowedPaths: [], // Extra directories ingest_document(type:"file") may read from
  ingestAllowAnyPath: false, // Escape hatch: allow reading ANY path from disk (unsafe)
  policyExpansion: true,    // Expand table_summary/code_signature policy chunks (boosts recall, slight MRR trade-off)
};

let cachedConfig = null;
let cachedMtimeMs = 0;

function loadConfigFromDisk() {
  ensureDirSync();

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      cachedConfig = Object.freeze({ ...DEFAULT_CONFIG, ...parsed });
      cachedMtimeMs = fs.statSync(CONFIG_FILE).mtimeMs;
      return cachedConfig;
    } catch (err) {
      console.warn("Failed to read config file, falling back to defaults:", err.message);
    }
  }

  cachedConfig = Object.freeze({ ...DEFAULT_CONFIG });
  saveConfig(cachedConfig);
  return cachedConfig;
}

export function getConfig() {
  try {
    const mtimeMs = fs.statSync(CONFIG_FILE).mtimeMs;
    if (cachedConfig && mtimeMs === cachedMtimeMs) {
      return cachedConfig;
    }
  } catch (err) {
    // Config file missing — fall through to load/create.
  }
  return loadConfigFromDisk();
}

export function saveConfig(newConfig) {
  ensureDirSync();
  cachedConfig = Object.freeze({ ...DEFAULT_CONFIG, ...newConfig });
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cachedConfig, null, 2), "utf-8");
    cachedMtimeMs = fs.statSync(CONFIG_FILE).mtimeMs;
  } catch (err) {
    console.error("Failed to write config file:", err.message);
  }
  return cachedConfig;
}

export function updateConfig(partialConfig) {
  const current = getConfig();
  const updated = { ...current, ...partialConfig };
  return saveConfig(updated);
}

export function resetConfig() {
  return saveConfig(DEFAULT_CONFIG);
}
