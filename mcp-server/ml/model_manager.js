import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { MODELS_DIR } from "../db/database.js";

let extractorInstance = null;
let loadedModelName = null;
let loadedDevice = null;

let rerankerInstance = null;
let loadedRerankerName = null;
let loadedRerankerDevice = null;

// Idle auto-unload state: models are dropped from RAM/VRAM after
// `modelUnloadTimeoutMinutes` of inactivity (0 = disabled). The timer is
// re-armed on every embedding/rerank call.
let lastModelActivity = null;
let unloadTimer = null;
let controlLoopTimer = null;
let lastHandledCommandId = null;

import { getConfig } from "../config/config_manager.js";
import { GpuMonitor, ExecutionTracer, getGpuMemoryInfoAsync } from "./gpu_monitor.js";
import {
  pollModelCommand,
  writeCommandAck,
  writeRuntimeState,
} from "./model_control.js";
export { GpuMonitor, ExecutionTracer };

// Resolve the configured execution device to a concrete ONNX backend.
export function resolveTargetDevice(rawDeviceValue = null) {
  const rawDevice = String(
    rawDeviceValue !== null && rawDeviceValue !== undefined
      ? rawDeviceValue
      : (getConfig().executionDevice || "cpu")
  ).toLowerCase();
  if (rawDevice === "webgpu" || rawDevice === "gpu" || rawDevice === "dml" || rawDevice === "cuda") {
    if (process.platform === "win32") return "dml";
    if (process.platform === "linux") return "cuda";
    return "webgpu";
  }
  return "cpu";
}

function getOptimalThreadCount() {
  const userSetting = getConfig().onnxThreads;
  if (typeof userSetting === "number" && userSetting > 0) {
    return userSetting;
  }
  const totalCores = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(totalCores, 8));
}

export function ensureValidModelDirectory() {
  try {
    if (!fs.existsSync(MODELS_DIR)) {
      fs.mkdirSync(MODELS_DIR, { recursive: true });
    }
    const testFile = path.join(MODELS_DIR, ".path_check");
    fs.writeFileSync(testFile, "ok");
    fs.unlinkSync(testFile);
    return MODELS_DIR;
  } catch (err) {
    console.warn(`[Self-Healing] Model directory path "${MODELS_DIR}" is inaccessible or invalid (${err.message}). Falling back to standard default model storage path...`);
    const fallbackDir = path.join(MODELS_DIR, "..", "models");
    try {
      fs.mkdirSync(fallbackDir, { recursive: true });
    } catch (e) {}
    return fallbackDir;
  }
}

export async function getExtractor(modelName = null, progressCallback = null) {
  const targetModel = modelName || getConfig().embeddingModel || "Xenova/multilingual-e5-small";

  // Resolve target device BEFORE cache check so comparison works correctly
  const targetDevice = resolveTargetDevice();

  if (extractorInstance && loadedModelName === targetModel && loadedDevice === targetDevice) {
    touchModelActivity();
    return extractorInstance;
  }

  // Ensure valid writable storage directory
  const cacheDir = ensureValidModelDirectory();

  const { pipeline, env } = await import("@huggingface/transformers");

  env.cacheDir = cacheDir;
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  env.remoteHost = "https://huggingface.co";
  env.remotePathTemplate = "{model}/resolve/{revision}/";
  env.sharp = false;

  const numThreads = getOptimalThreadCount();
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = numThreads;
  }

  const sessionOptions = {
    graphOptimizationLevel: "all",
    executionMode: targetDevice !== "cpu" ? "parallel" : "sequential",
  };

  if (targetDevice !== "cpu") {
    sessionOptions.enableCpuMemArena = false;
    sessionOptions.enableMemPattern = false;
    if (targetDevice === "dml") {
      sessionOptions.executionProviders = [{ name: "dml", device_id: 0 }];
    } else if (targetDevice === "cuda") {
      sessionOptions.executionProviders = [{ name: "cuda", device_id: 0 }];
    }
  }

  const pipelineOpts = {
    quantized: true,
    dtype: "q8",
    device: targetDevice,
    session_options: sessionOptions,
  };
  if (progressCallback) {
    pipelineOpts.progress_callback = progressCallback;
  }

  try {
    extractorInstance = await pipeline("feature-extraction", targetModel, pipelineOpts);
    loadedModelName = targetModel;
    loadedDevice = targetDevice;

    if (targetDevice !== "cpu") {
      try {
        await extractorInstance("GPU VRAM Warmup Init", { pooling: "mean", normalize: true });
      } catch {}
    }
  } catch (err) {
    const isNetworkError = err.message && (
      err.message.includes("fetch") ||
      err.message.includes("network") ||
      err.message.includes("ETIMEDOUT") ||
      err.message.includes("ENOTFOUND") ||
      err.message.includes("503") ||
      err.message.includes("502") ||
      err.message.includes("504")
    );

    if (isNetworkError) {
      console.warn(`[Model Manager] ⚠️ Network interruption while loading "${targetModel}": ${err.message}. Retrying / Resuming download...`);
    } else {
      console.warn(`[Model Manager] ⚠️ Unrecoverable file error for "${targetModel}": ${err.message}. Purging corrupted cache...`);
      deleteModelCache(targetModel);
    }

    if (targetDevice !== "cpu") {
      console.warn(`[GPU Engine] GPU initialization (${targetDevice}) failed. Retrying on CPU...`);
      pipelineOpts.device = "cpu";
      pipelineOpts.session_options.executionMode = "sequential";
      try {
        extractorInstance = await pipeline("feature-extraction", targetModel, pipelineOpts);
        loadedModelName = targetModel;
        loadedDevice = "cpu";
        touchModelActivity();
        return extractorInstance;
      } catch (err2) {
        if (!isNetworkError) deleteModelCache(targetModel);
      }
    }

    if (targetModel !== "Xenova/multilingual-e5-small") {
      console.warn(`[Fallback] Reverting to standard default model "Xenova/multilingual-e5-small"...`);
      resetExtractor();
      try {
        const fallbackOpts = {
          quantized: true,
          dtype: "q8",
          device: "cpu",
          session_options: { graphOptimizationLevel: "all", executionMode: "sequential" },
        };
        if (progressCallback) fallbackOpts.progress_callback = progressCallback;

        extractorInstance = await pipeline("feature-extraction", "Xenova/multilingual-e5-small", fallbackOpts);
        loadedModelName = "Xenova/multilingual-e5-small";
        loadedDevice = "cpu";
      } catch (err3) {
        console.error(`[Fatal] Could not load default fallback model: ${err3.message}`);
        throw err3;
      }
    } else {
      throw err;
    }
  }

  touchModelActivity();
  return extractorInstance;
}

// Best-effort release of an ONNX-backed pipeline/model instance. Different
// @huggingface/transformers versions expose different teardown surfaces, so
// probe defensively and swallow individual failures.
async function disposeInstance(instance) {
  if (!instance) return;
  const candidates = [
    instance,
    instance.model,
    instance.session,
    instance.tokenizer,
  ].filter(Boolean);
  for (const target of candidates) {
    if (typeof target.dispose === "function") {
      try { await target.dispose(); } catch {}
    } else if (typeof target.release === "function") {
      try { await target.release(); } catch {}
    }
  }
}

export async function unloadModels(reason = "manual") {
  const unloaded = [];
  let unloadedDevice = null;

  if (extractorInstance) {
    await disposeInstance(extractorInstance);
    unloaded.push({ type: "embedding", model: loadedModelName, device: loadedDevice });
    unloadedDevice = loadedDevice;
    extractorInstance = null;
    loadedModelName = null;
    loadedDevice = null;
  }

  if (rerankerInstance) {
    await disposeInstance(rerankerInstance);
    unloaded.push({ type: "reranker", model: loadedRerankerName, device: loadedRerankerDevice });
    if (!unloadedDevice) unloadedDevice = loadedRerankerDevice;
    rerankerInstance = null;
    loadedRerankerName = null;
    loadedRerankerDevice = null;
  }

  // Let the JS heap (and with it the ONNX WASM buffers) shrink back.
  if (global.gc) {
    try { global.gc(); } catch {}
  }

  return {
    unloaded,
    wasLoaded: unloaded.length > 0,
    reason,
    device: unloadedDevice,
    processRssMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    gpuMemory: await getGpuMemoryInfoAsync(),
  };
}

export function getModelRuntimeStatus() {
  const config = getConfig();
  const unloadTimeoutMinutes = Number(config.modelUnloadTimeoutMinutes) || 0;
  return {
    configuredDevice: config.executionDevice || "cpu",
    resolvedDevice: resolveTargetDevice(),
    embedding: {
      configuredModel: config.embeddingModel || "Xenova/multilingual-e5-small",
      loaded: Boolean(extractorInstance),
      loadedModel: loadedModelName,
      device: loadedDevice,
    },
    reranker: {
      enabled: Boolean(config.rerankerEnabled),
      configuredModel: config.rerankerModel || "none",
      loaded: Boolean(rerankerInstance),
      loadedModel: loadedRerankerName,
      device: loadedRerankerDevice,
    },
    lastActivity: lastModelActivity ? new Date(lastModelActivity).toISOString() : null,
    idleForSeconds: lastModelActivity ? Math.round((Date.now() - lastModelActivity) / 1000) : null,
    unloadTimeoutMinutes,
    autoUnloadArmed: Boolean(unloadTimer),
    serverPid: process.pid,
    serverRssMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
  };
}

export function touchModelActivity() {
  lastModelActivity = Date.now();
  const timeoutMinutes = Number(getConfig().modelUnloadTimeoutMinutes) || 0;
  if (timeoutMinutes <= 0) return;
  if (unloadTimer) clearTimeout(unloadTimer);
  unloadTimer = setTimeout(async () => {
    unloadTimer = null;
    if (!extractorInstance && !rerankerInstance) return;
    const idleMs = Date.now() - (lastModelActivity || 0);
    if (idleMs < timeoutMinutes * 60 * 1000) {
      touchModelActivity();
      return;
    }
    console.error(`[Model Manager] Models idle for ${timeoutMinutes} min — auto-unloading from memory...`);
    await unloadModels("idle-timeout");
    publishRuntimeState();
  }, timeoutMinutes * 60 * 1000);
  if (typeof unloadTimer.unref === "function") unloadTimer.unref();
}

export function publishRuntimeState() {
  writeRuntimeState(getModelRuntimeStatus());
}

async function handleModelControlCommand(parsed) {
  const { id, cmd, payload = {} } = parsed;
  let result = { ok: false, error: `Unknown model command: ${cmd}` };

  try {
    if (cmd === "unload") {
      result = { ok: true, ...(await unloadModels(payload.reason || "cli-request")) };
    } else if (cmd === "load") {
      const { updateConfig } = await import("../config/config_manager.js");
      if (payload.device) updateConfig({ executionDevice: payload.device });
      await unloadModels("device-switch");
      const embedding = await getExtractor(null, null);
      let rerankerLoaded = false;
      const cfg = getConfig();
      if (cfg.rerankerEnabled && cfg.rerankerModel && cfg.rerankerModel !== "none") {
        rerankerLoaded = Boolean(await getReranker(cfg.rerankerModel));
      }
      result = {
        ok: Boolean(embedding),
        device: resolveTargetDevice(),
        embeddingLoaded: Boolean(extractorInstance),
        rerankerLoaded,
      };
    } else if (cmd === "apply-device") {
      const { updateConfig } = await import("../config/config_manager.js");
      if (payload.device) updateConfig({ executionDevice: payload.device });
      const hadLoaded = Boolean(extractorInstance || rerankerInstance);
      await unloadModels("device-switch");
      // If nothing was loaded, keep it lazy: the next inference will pick up
      // the new device without paying the model load cost right now.
      result = { ok: true, device: resolveTargetDevice(), reloaded: false, wasLoaded: hadLoaded };
    } else if (cmd === "status") {
      result = { ok: true, status: getModelRuntimeStatus() };
    }
  } catch (err) {
    result = { ok: false, error: err.message };
  }

  writeCommandAck(id, result);
  publishRuntimeState();
}

// Long-lived MCP servers call this once at startup. It polls the control
// directory so short-lived CLI processes (memory-cli models ...) can trigger
// unloads/reloads inside the process that actually owns the ONNX sessions.
export function startModelControlLoop(intervalMs = 2500) {
  if (controlLoopTimer) return;
  publishRuntimeState();
  controlLoopTimer = setInterval(async () => {
    try {
      const parsed = pollModelCommand(lastHandledCommandId);
      if (parsed) {
        lastHandledCommandId = parsed.id;
        await handleModelControlCommand(parsed);
      } else {
        publishRuntimeState();
      }
    } catch {}
  }, intervalMs);
  if (typeof controlLoopTimer.unref === "function") controlLoopTimer.unref();
}

export function resetExtractor() {
  extractorInstance = null;
  loadedModelName = null;
  loadedDevice = null;
}

export function deleteModelCache(modelName) {
  const info = getModelStorageInfo(modelName);
  if (info.status === "not_downloaded" || !fs.existsSync(info.dir)) {
    return { deleted: false, reason: "Model directory not found" };
  }

  resetExtractor();
  if (global.gc) {
    try { global.gc(); } catch (e) {}
  }

  try {
    fs.rmSync(info.dir, { recursive: true, force: true });
    const parentDir = path.dirname(info.dir);
    if (fs.existsSync(parentDir) && fs.readdirSync(parentDir).length === 0) {
      fs.rmdirSync(parentDir);
    }
    return { deleted: true, modelName, freedMB: info.sizeMB };
  } catch (err) {
    try {
      const corruptPath = `${info.dir}.corrupt_${Date.now()}`;
      fs.renameSync(info.dir, corruptPath);
      setTimeout(() => {
        try { fs.rmSync(corruptPath, { recursive: true, force: true }); } catch (e) {}
      }, 1000);
      return { deleted: true, modelName, freedMB: info.sizeMB };
    } catch (renameErr) {
      return { deleted: false, reason: `${err.message} (Rename fallback: ${renameErr.message})` };
    }
  }
}

export function formatInputText(text, isQuery = false, modelName = null, instruction = null) {
  if (!text) return "";
  const targetModel = modelName || getConfig().embeddingModel || "Xenova/multilingual-e5-small";
  const name = targetModel.toLowerCase();

  let cleanText = text.trim();
  if (cleanText.startsWith("passage: ")) {
    cleanText = cleanText.substring(9).trim();
  } else if (cleanText.startsWith("query: ")) {
    cleanText = cleanText.substring(7).trim();
  }

  // Safety trim long text to prevent ONNX tensor padding explosions (>4000 chars ~1000 tokens)
  if (cleanText.length > 4000) {
    cleanText = cleanText.substring(0, 4000);
  }

  // 1. E5 Model Family (multilingual-e5-small, multilingual-e5-large, etc.)
  if (name.includes("e5")) {
    const isInstructModel = name.includes("-instruct");
    if (isQuery) {
      if (instruction && instruction.trim() && isInstructModel) {
        return `Instruct: ${instruction.trim()}\nQuery: ${cleanText}`;
      }
      return `query: ${cleanText}`;
    }
    return `passage: ${cleanText}`;
  }

  // 2. BGE Model Family (bge-m3, bge-small-en-v1.5, etc.)
  if (name.includes("bge")) {
    if (isQuery) {
      if (instruction && instruction.trim()) {
        return `Represent this sentence for searching relevant passages: ${instruction.trim()} ${cleanText}`;
      }
      return `Represent this sentence for searching relevant passages: ${cleanText}`;
    }
    return cleanText;
  }

  // 3. MiniLM / Standard models (no prefixes)
  return cleanText;
}

export async function embedText(text, isQuery = false, modelName = null, progressCallback = null, instruction = null, vectorDimension = null) {
  const targetModel = modelName || getConfig().embeddingModel || "Xenova/multilingual-e5-small";
  const extractor = await getExtractor(targetModel, progressCallback);
  const formattedText = formatInputText(text, isQuery, targetModel, instruction);

  const isBgeM3 = targetModel.toLowerCase().includes("bge-m3");
  const maxLen = isBgeM3 ? 1024 : 512;

  const output = await extractor(formattedText, {
    pooling: "mean",
    normalize: true,
    truncation: true,
    max_length: maxLen,
  });

  const result = applyFixedDimension(output.data.slice(), vectorDimension);
  if (typeof output.dispose === 'function') {
    output.dispose();
  }
  return result;
}

export async function embedBatch(texts, isQuery = false, modelName = null, progressCallback = null, instruction = null, traceOptions = {}, vectorDimension = null) {
  if (!texts || texts.length === 0) return [];
  const targetModel = modelName || getConfig().embeddingModel || "Xenova/multilingual-e5-small";
  
  const rawDevice = (getConfig().executionDevice || "cpu").toLowerCase();
  const isGpu = rawDevice === "webgpu" || rawDevice === "gpu" || rawDevice === "dml" || rawDevice === "cuda";
  
  const tracer = traceOptions.enableTrace ? new ExecutionTracer(`Embed Batch (${texts.length} items)`) : null;
  const monitor = (isGpu && traceOptions.enableMonitor) ? new GpuMonitor(50) : null;
  if (monitor) monitor.start();

  try {
    if (tracer) tracer.startStage("Model Initialization & Session", "CPU");
    const extractor = await getExtractor(targetModel, progressCallback);

    if (tracer) tracer.startStage("Text Formatting & Tokenization Preprocessing", "CPU");
    const formattedTexts = texts.map((text) => formatInputText(text, isQuery, targetModel, instruction));

    const userBatch = getConfig().batchSize || 12;
    const isBgeM3 = targetModel.toLowerCase().includes("bge-m3");
    const isLarge = isBgeM3 || targetModel.toLowerCase().includes("large");

    // DYNAMIC ATTENTION BUDGET SAMPLER (PyTorch-style Token Budgeting):
    // Attention memory scales quadratically O(seq_len^2).
    // Target max GPU attention budget per ONNX pass: ~2,000,000 token-squared units (~1.5 GB VRAM peak).
    // Short texts (50 tokens) dynamically scale UP to full userBatch (32-64 items per pass) for max GPU compute.
    // Long texts (1000 tokens) dynamically scale DOWN to 2-4 items per pass, keeping VRAM strictly <1.5 GB.
    const configuredBudget = getConfig().gpuAttentionBudget || 2000000;
    const maxAttentionBudget = isGpu
      ? (isLarge ? Math.min(configuredBudget, 2000000) : configuredBudget)
      : 32000000;

    const CHAR_TO_TOKEN = 3.5;
    const subBatches = [];
    let currentSubBatch = [];
    let currentSubBatchCost = 0;

    for (const text of formattedTexts) {
      const estimatedTokens = Math.max(1, Math.ceil(text.length / CHAR_TO_TOKEN));
      const cost = estimatedTokens * estimatedTokens;

      if (
        currentSubBatch.length > 0 &&
        (currentSubBatch.length >= userBatch || currentSubBatchCost + cost > maxAttentionBudget)
      ) {
        subBatches.push(currentSubBatch);
        currentSubBatch = [];
        currentSubBatchCost = 0;
      }

      currentSubBatch.push(text);
      currentSubBatchCost += cost;
    }

    if (currentSubBatch.length > 0) {
      subBatches.push(currentSubBatch);
    }

    if (tracer) tracer.startStage("ONNX Model Tensor Execution", isGpu ? "GPU" : "CPU");

    const allResults = [];
    const maxLen = isBgeM3 ? 1024 : 512;

    for (const batchTexts of subBatches) {
      const output = await extractor(batchTexts, {
        pooling: "mean",
        normalize: true,
        truncation: true,
        padding: isGpu ? "max_length" : true,
        max_length: maxLen,
      });

      const dims = output.dims;
      const batchSize = dims[0];
      const vectorDim = dims[dims.length - 1];
      const rawData = output.data;

      for (let i = 0; i < batchSize; i++) {
        const byteOffset = i * vectorDim;
        allResults.push(applyFixedDimension(rawData.slice(byteOffset, byteOffset + vectorDim), vectorDimension));
      }

      if (typeof output.dispose === 'function') {
        output.dispose();
      }

      if (isGpu && global.gc) {
        global.gc({ type: 'minor' });
      }
    }

    if (tracer) tracer.endStage();

    const gpuStats = monitor ? monitor.stop() : null;

    if (tracer && traceOptions.verboseTrace) {
      tracer.printTraceReport(gpuStats);
    }

    return allResults;
  } catch (err) {
    if (monitor) monitor.stop();
    throw err;
  }
}

export const DEFAULT_RERANKER_MODEL = "SugoLabs/mmarco-mMiniLMv2-L12-H384-v1";

export async function getReranker(modelName = DEFAULT_RERANKER_MODEL, progressCallback = null) {
  const targetDevice = resolveTargetDevice();

  if (rerankerInstance && loadedRerankerName === modelName && loadedRerankerDevice === targetDevice) {
    touchModelActivity();
    return rerankerInstance;
  }

  // Device or model changed: drop the previous session before loading a new one.
  if (rerankerInstance) {
    await disposeInstance(rerankerInstance);
    rerankerInstance = null;
    loadedRerankerName = null;
    loadedRerankerDevice = null;
  }

  const cacheDir = ensureValidModelDirectory();

  const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import("@huggingface/transformers");
  env.cacheDir = cacheDir;
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  env.remoteHost = "https://huggingface.co";
  env.remotePathTemplate = "{model}/resolve/{revision}/";
  env.sharp = false;

  const sessionOptions = {
    graphOptimizationLevel: "all",
  };

  if (targetDevice !== "cpu") {
    sessionOptions.enableCpuMemArena = true;
    sessionOptions.enableMemPattern = true;
    if (targetDevice === "dml") {
      sessionOptions.executionProviders = [{ name: "dml", device_id: 0 }];
    } else if (targetDevice === "cuda") {
      sessionOptions.executionProviders = [{ name: "cuda", device_id: 0 }];
    }
  }

  const modelOpts = {
    quantized: true,
    dtype: "q8",
    device: targetDevice,
    session_options: sessionOptions,
  };
  if (progressCallback) {
    modelOpts.progress_callback = progressCallback;
  }

  try {
    // NOTE: no text-classification pipeline here on purpose. The pipeline
    // applies softmax + top_k=1, which saturates single-logit cross-encoders
    // to score 1.0 for every candidate and makes reranking a no-op.
    // Raw sequence-classification logits are the actual ranking signal.
    const tokenizer = await AutoTokenizer.from_pretrained(modelName, progressCallback ? { progress_callback: progressCallback } : {});
    const model = await AutoModelForSequenceClassification.from_pretrained(modelName, modelOpts);
    rerankerInstance = { tokenizer, model };
    loadedRerankerName = modelName;
    loadedRerankerDevice = targetDevice;
  } catch (err) {
    console.warn(`Failed to load reranker model ${modelName}: ${err.message}. Purging corrupt files...`);
    deleteModelCache(modelName);
    return null;
  }
  touchModelActivity();
  return rerankerInstance;
}

export async function preloadModel(modelName, type = "embedding", progressCallback = null) {
  if (type === "reranker") {
    return await getReranker(modelName, progressCallback);
  }
  return await getExtractor(modelName, progressCallback);
}

export async function rerankHits(query, hits, rerankerModelName = DEFAULT_RERANKER_MODEL, options = {}) {
  if (!hits || hits.length === 0) return hits;
  // Bound latency: cross-encoder scores pairs one ONNX pass per batch, so
  // only the head of the fused list is reranked; the tail keeps its order.
  const topN = Math.max(1, Number(options.topN ?? getConfig().rerankerTopN ?? 20) || 20);
  const head = hits.slice(0, topN);
  const tail = hits.slice(topN);
  let reranker = null;
  try {
    reranker = await getReranker(rerankerModelName);
  } catch {
    reranker = null;
  }
  if (!reranker?.tokenizer || !reranker?.model) return hits;

  try {
    const { tokenizer, model } = reranker;
    const inputs = tokenizer(
      head.map(() => query),
      {
        text_pair: head.map((hit) => hit.content),
        padding: true,
        truncation: true,
        max_length: 512,
      }
    );
    const outputs = await model(inputs);
    const data = Array.from(outputs.logits.data, Number);
    const perRow = data.length / head.length;
    if (!Number.isInteger(perRow) || perRow <= 0) return hits;
    const scored = head.map((hit, i) => ({
      ...hit,
      // Single-logit models (bge-reranker-base, mmarco MiniLM): the only
      // logit. Two-label models: the positive-class logit.
      rerank_score: data[i * perRow + (perRow - 1)],
    }));
    scored.sort((a, b) => (b.rerank_score || 0) - (a.rerank_score || 0));
    return [...scored, ...tail];
  } catch {
    return hits;
  }
}

export function vectorToBuffer(float32Array) {
  return Buffer.from(float32Array.buffer, float32Array.byteOffset, float32Array.byteLength);
}

export function resizeVector(float32Array, targetDim) {
  const dim = Number(targetDim);
  if (!dim || dim <= 0 || !float32Array || float32Array.length === dim) return float32Array;
  const out = new Float32Array(dim);
  out.set(float32Array.subarray(0, Math.min(float32Array.length, dim)));
  return out;
}

function applyFixedDimension(float32Array, overrideDim = null) {
  const dim = overrideDim !== null && overrideDim !== undefined ? overrideDim : (getConfig().vectorDimension || 0);
  return resizeVector(float32Array, dim);
}

export function bufferToVector(buffer) {
  return new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
}

export function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function getModelStorageInfo(modelName) {
  if (!modelName || modelName === "none") return { status: "not_downloaded", sizeMB: "0.00", bytes: 0 };
  const parts = modelName.split("/");
  const modelDir = path.join(MODELS_DIR, ...parts);

  if (!fs.existsSync(modelDir)) {
    return { status: "not_downloaded", sizeMB: "0.00", bytes: 0, dir: modelDir };
  }

  let totalBytes = 0;
  let hasConfig = false;
  let hasTokenizer = false;
  let hasOnnxWeights = false;

  function scan(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          totalBytes += stat.size;
          if (entry.name === "config.json") hasConfig = true;
          if (entry.name.includes("tokenizer")) hasTokenizer = true;
          // ONNX weights must be substantial (>5MB) or external data (.onnx_data)
          if ((entry.name.endsWith(".onnx") || entry.name.endsWith(".onnx_data")) && stat.size > 5 * 1024 * 1024) {
            hasOnnxWeights = true;
          }
        }
      }
    } catch {}
  }

  scan(modelDir);

  const sizeMB = (totalBytes / (1024 * 1024)).toFixed(2);

  if (totalBytes === 0) {
    return { status: "not_downloaded", sizeMB: "0.00", bytes: 0, dir: modelDir };
  }

  // Model is ready only if it has config, tokenizer, ONNX weights >5MB, and total folder size >10MB
  if (hasConfig && hasTokenizer && hasOnnxWeights && totalBytes > 10 * 1024 * 1024) {
    return { status: "downloaded", sizeMB, bytes: totalBytes, dir: modelDir };
  }

  return { status: "partial", sizeMB, bytes: totalBytes, dir: modelDir };
}

export function listAllCachedModels() {
  const result = [];
  if (!fs.existsSync(MODELS_DIR)) return result;

  try {
    const orgs = fs.readdirSync(MODELS_DIR, { withFileTypes: true });
    for (const org of orgs) {
      if (org.isDirectory()) {
        const orgDir = path.join(MODELS_DIR, org.name);
        const models = fs.readdirSync(orgDir, { withFileTypes: true });
        for (const model of models) {
          if (model.isDirectory()) {
            const modelName = `${org.name}/${model.name}`;
            const info = getModelStorageInfo(modelName);
            result.push({ modelName, ...info });
          }
        }
      }
    }
  } catch {}

  return result;
}
