import fs from "fs";
import path from "path";
import { MEMORY_DIR, ensureDirSync } from "../memory.js";
import { atomicWrite } from "../storage/snapshot_lock.js";

const CONFIG_FILE = path.join(MEMORY_DIR, "config.json");
export const STORAGE_MODES = Object.freeze(["only-local", "cloud-snapshots"]);

export function assertStorageMode(mode) {
  if (["hybrid-sync", "only-cloud"].includes(mode)) {
    throw new Error(`${mode} has been removed. Run memory-cli snapshots enable to preserve local/cloud copies; former only-cloud installations then require an explicit snapshot restore.`);
  }
  if (!STORAGE_MODES.includes(mode)) throw new Error(`Unknown storage mode ${mode}. Allowed: ${STORAGE_MODES.join(", ")}`);
}

export function assertLocalMemoryReady(config = getConfig()) {
  if (config.legacyCloudRestoreRequired) {
    throw Object.assign(new Error("Former only-cloud memory requires migration. Run memory-cli snapshots enable to download a verified cloud backup, then explicitly restore that local archive. Local cache contents are incomplete until restoration."), { code: "MIGRATION_REQUIRED" });
  }
}

let legacyWarningShown = false;
function normalizeLoadedConfig(parsed) {
  const config = { ...DEFAULT_CONFIG, ...parsed };
  // Keep the on-disk config and old queue intact until an explicit transition.
  // The flag survives unrelated config writes and a failed cloud backup.
  if (["hybrid-sync", "only-cloud"].includes(config.mode)) {
    const legacyMode = config.mode;
    config.mode = "only-local";
    config.legacyCloudBackupRequired = true;
    if (legacyMode === "only-cloud") config.legacyCloudRestoreRequired = true;
    if (!legacyWarningShown) {
      console.warn(`[memory] ${legacyMode} has been removed; live cloud access is disabled. Run memory-cli snapshots enable to preserve both copies.${config.legacyCloudRestoreRequired ? " Then explicitly restore the downloaded archive before using memory." : " Local memory remains available."}`);
      legacyWarningShown = true;
    }
  }
  delete config.conflictStrategy;
  delete config.failoverUrl;
  assertStorageMode(config.mode);
  return Object.freeze(config);
}

export const DEFAULT_CONFIG = {
  fusionAlgorithm: "rsf", // "rsf" | "rrf" | "semantic_only" | "lexical_only"
  alpha: 0.5,             // Weight for vector similarity in RSF [0.0 - 1.0] (50/50 balance)
  embeddingModel: "Xenova/multilingual-e5-small",
  vectorDimension: 0,     // Fixed embedding dimension (0 = auto-detect from model output)
  rerankerModel: "none",   // "none" | "SugoLabs/mmarco-mMiniLMv2-L12-H384-v1" (multilingual, recommended) | "Xenova/bge-reranker-base" | custom HF cross-encoder
  rerankerEnabled: false,
  rerankerTopN: 20,       // Head of the fused list rescored per query [1 - 100] (one batched ONNX pass)
  batchSize: 12,           // Ingestion vector batch size [1 - 256] (default 12)
  vectorScanLimit: 50000,  // Max micro-chunks scanned per vector query (0 = unlimited)
  gpuAttentionBudget: 2000000, // GPU micro-batch attention budget [1M - 16M] (default 2.0M ~1.5GB VRAM)
  onnxThreads: 0,          // ONNX WASM threads: 0 = auto-detect CPU cores, or 1-16
  executionDevice: "cpu",  // "cpu" | "webgpu"
  modelUnloadTimeoutMinutes: 0, // Idle auto-unload for ML models (0 = never unload)
  mode: "only-local",     // "only-local" | "cloud-snapshots"
  snapshotSyncMode: "manual", // manual | scheduled | off; only cloud-snapshots schedules uploads
  snapshotIntervalHours: 24, // Any positive finite number, e.g. 0.5 or 168
  legacyCloudBackupRequired: false, // Pending read-only cloud backup after removal of live sync
  legacyCloudRestoreRequired: false, // Former cloud-only installations need an explicit restore
  tursoUrl: "",           // Connection endpoint URL for Turso DB
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
    let parsed;
    try {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn("Failed to read config file, falling back to defaults:", err.message);
    }
    if (parsed) {
      cachedConfig = normalizeLoadedConfig(parsed);
      cachedMtimeMs = fs.statSync(CONFIG_FILE).mtimeMs;
      return cachedConfig;
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
  assertStorageMode(newConfig.mode ?? DEFAULT_CONFIG.mode);
  ensureDirSync();
  const next = normalizeLoadedConfig(newConfig);
  atomicWrite(CONFIG_FILE, JSON.stringify(next, null, 2));
  cachedMtimeMs = fs.statSync(CONFIG_FILE).mtimeMs;
  cachedConfig = next;
  return cachedConfig;
}

export function updateConfig(partialConfig) {
  const current = getConfig();
  const updated = { ...current, ...partialConfig };
  return saveConfig(updated);
}

export function resetConfig() {
  const current = getConfig();
  const migration = current.legacyCloudBackupRequired || current.legacyCloudRestoreRequired;
  return saveConfig({ ...DEFAULT_CONFIG, ...(migration ? {
    legacyCloudBackupRequired: current.legacyCloudBackupRequired,
    legacyCloudRestoreRequired: current.legacyCloudRestoreRequired,
    tursoUrl: current.tursoUrl,
  } : {}) });
}
