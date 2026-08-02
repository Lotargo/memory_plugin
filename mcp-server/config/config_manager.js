import fs from "fs";
import path from "path";
import { MEMORY_DIR, ensureDirSync } from "../memory.js";

const CONFIG_FILE = path.join(MEMORY_DIR, "config.json");

export const DEFAULT_CONFIG = {
  fusionAlgorithm: "rsf", // "rsf" | "rrf" | "semantic_only" | "lexical_only"
  alpha: 0.5,             // Weight for vector similarity in RSF [0.0 - 1.0] (50/50 balance)
  embeddingModel: "Xenova/multilingual-e5-small",
  rerankerModel: "none",   // "none" | "Xenova/bge-reranker-base" | custom HF model
  rerankerEnabled: false,
  batchSize: 12,           // Ingestion vector batch size [1 - 256] (default 12)
  gpuAttentionBudget: 2000000, // GPU micro-batch attention budget [1M - 16M] (default 2.0M ~1.5GB VRAM)
  onnxThreads: 0,          // ONNX WASM threads: 0 = auto-detect CPU cores, or 1-16
  executionDevice: "cpu",  // "cpu" | "webgpu"
  mode: "only-local",     // "only-local" | "only-cloud" | "hybrid-sync"
  tursoUrl: "",           // Connection endpoint URL for Turso DB
};

let cachedConfig = null;

export function getConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  ensureDirSync();

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      cachedConfig = Object.freeze({ ...DEFAULT_CONFIG, ...parsed });
      return cachedConfig;
    } catch (err) {
      console.warn("Failed to read config file, falling back to defaults:", err.message);
    }
  }

  cachedConfig = Object.freeze({ ...DEFAULT_CONFIG });
  saveConfig(cachedConfig);
  return cachedConfig;
}

export function saveConfig(newConfig) {
  ensureDirSync();
  cachedConfig = Object.freeze({ ...DEFAULT_CONFIG, ...newConfig });
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cachedConfig, null, 2), "utf-8");
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
