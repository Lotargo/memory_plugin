import { MODELS_DIR } from "../db/database.js";
import { getConfig } from "../config/config_manager.js";
import { execSync } from "node:child_process";

let extractorInstance = null;
let loadedModelName = null;

let rerankerInstance = null;
let loadedRerankerName = null;

let activeDevice = "cpu";
let detectedProviders = null;
let gpuDetectionDone = false;
let gpuNameCache = undefined;

export function getActiveDevice() {
  return activeDevice;
}

/**
 * Detect available ONNX Runtime execution providers by importing onnxruntime-node directly
 * and using its `listSupportedBackends()` API. Caches the result — detection runs only once.
 *
 * Note: WebGPU is bundled in onnxruntime-node >= 1.18 but only works when
 * `navigator.gpu` is available (i.e. browser or Node.js with experimental WebGPU
 * enabled via `--experimental-webgpu`). In a plain Node.js process it's
 * unusable, so we filter it out unless explicitly requested.
 *
 * @returns {Promise<{bestProvider: string, available: string[]}>}
 */
async function detectAvailableProviders() {
  if (gpuDetectionDone && detectedProviders) {
    return detectedProviders;
  }

  const available = ["cpu"];
  const isNode = typeof process !== "undefined" && process?.release?.name === "node";
  const hasNavigatorGpu = typeof globalThis.navigator !== "undefined" && !!globalThis.navigator.gpu;

  try {
    const ort = await import("onnxruntime-node");
    const listBackends = ort.listSupportedBackends || ort.default?.listSupportedBackends;

    if (typeof listBackends === "function") {
      const backends = listBackends();
      const names = backends.map((b) => b.name);

      if (names.includes("dml")) available.unshift("dml");
      if (names.includes("cuda")) available.unshift("cuda");
      if (names.includes("webgpu") && (!isNode || hasNavigatorGpu)) {
        available.unshift("webgpu");
      }
    }
  } catch (importErr) {
    // onnxruntime-node not available — pure wasm/cpu fallback
  }

  const cfgDevice = getConfig().executionDevice || "auto";
  let bestProvider = "cpu";

  if (cfgDevice === "auto") {
    bestProvider = available[0];
  } else if (cfgDevice === "dml" || cfgDevice === "directml") {
    bestProvider = available.includes("dml") ? "dml" : "cpu";
  } else if (cfgDevice === "cpu") {
    bestProvider = "cpu";
  } else {
    bestProvider = available.includes(cfgDevice) ? cfgDevice : "cpu";
  }

  gpuDetectionDone = true;
  detectedProviders = { bestProvider, available };
  return detectedProviders;
}

function detectGpuName() {
  if (gpuNameCache !== undefined) return gpuNameCache;

  if (process.platform === "win32") {
    try {
      const out = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Where-Object {$_.Status -eq \'OK\' -and $_.Name -notlike \'*Microsoft*\'} | Select-Object -ExpandProperty Name -First 1"',
        { encoding: "utf8", timeout: 3000 }
      );
      gpuNameCache = out.trim() || null;
    } catch {
      gpuNameCache = null;
    }
  } else if (process.platform === "linux") {
    try {
      const out = execSync("lspci | grep -i vga | head -1 | sed 's/.*: //'", { encoding: "utf8", timeout: 3000 });
      gpuNameCache = out.trim() || null;
    } catch {
      gpuNameCache = null;
    }
  } else if (process.platform === "darwin") {
    // macOS — only reports "Apple M-series" for Metal, no specific GPU name
    gpuNameCache = null;
  } else {
    gpuNameCache = null;
  }

  return gpuNameCache;
}

/**
 * Inject execution providers into @xenova/transformers ONNX backend.
 * Tensor compat with onnxruntime-common >= 1.18 is handled by patch-package
 * (see patches/@xenova+transformers+2.17.2.patch).
 *
 * Also suppresses ONNX Runtime warnings about node assignments
 * (shape ops always run on CPU — this is normal).
 *
 * Must be called BEFORE any pipeline() call.
 */
async function configureOnnxBackend(provider) {
  try {
    const backends = await import("@xenova/transformers/src/backends/onnx.js");

    if (backends.executionProviders) {
      backends.executionProviders.length = 0;
      if (provider === "dml") {
        backends.executionProviders.push("dml", "cpu");
      } else if (provider === "cuda") {
        backends.executionProviders.push("cuda", "cpu");
      } else {
        backends.executionProviders.push("cpu");
      }
    }

    const ort = await import("onnxruntime-node");
    const ortEnv = ort.env || ort.default?.env;
    if (ortEnv && ortEnv.logLevel !== "error") {
      ortEnv.logLevel = "error";
    }
  } catch (e) {
    // If we can't access the backend module directly, fall through
  }
}

export async function getExtractor(modelName = null, progressCallback = null) {
  const targetModel = modelName || getConfig().embeddingModel || "Xenova/multilingual-e5-small";

  if (extractorInstance && loadedModelName === targetModel) {
    return extractorInstance;
  }

  // IMPORTANT: `configureOnnxBackend` must run BEFORE `import("@xenova/transformers")`
  // because the package re-exports from `utils/tensor.js` which captures `ONNX.Tensor`
  // at import time. If we patch Tensor after the import, the patch is bypassed.
  const { bestProvider, available } = await detectAvailableProviders();
  await configureOnnxBackend(bestProvider);

  const { pipeline, env } = await import("@xenova/transformers");

  env.cacheDir = MODELS_DIR;
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  env.remoteHost = "https://huggingface.co";
  env.remotePathTemplate = "{model}/resolve/{revision}/";

  const pipelineOpts = { quantized: true };
  if (progressCallback) {
    pipelineOpts.progress_callback = progressCallback;
  }

  try {
    extractorInstance = await pipeline("feature-extraction", targetModel, pipelineOpts);
    loadedModelName = targetModel;
    activeDevice = bestProvider;
  } catch (gpuErr) {
    if (bestProvider !== "cpu") {
      console.warn(
        `GPU provider '${bestProvider}' failed: ${gpuErr.message}. Falling back to CPU...`
      );
      await configureOnnxBackend("cpu");
      try {
        extractorInstance = await pipeline("feature-extraction", targetModel, pipelineOpts);
        loadedModelName = targetModel;
        activeDevice = "cpu";
      } catch (err) {
        if (targetModel !== "Xenova/multilingual-e5-small") {
          extractorInstance = await pipeline(
            "feature-extraction",
            "Xenova/multilingual-e5-small",
            pipelineOpts
          );
          loadedModelName = "Xenova/multilingual-e5-small";
          activeDevice = "cpu";
        } else {
          throw err;
        }
      }
    } else {
      throw gpuErr;
    }
  }

  return extractorInstance;
}

export function formatInputText(text, isQuery = false, modelName = null, instruction = null) {
  if (!text) return "";
  const targetModel = modelName || getConfig().embeddingModel || "Xenova/multilingual-e5-small";
  const name = targetModel.toLowerCase();

  // 1. E5 Model Family (multilingual-e5-small, multilingual-e5-large, etc.)
  if (name.includes("e5")) {
    if (isQuery) {
      if (instruction && instruction.trim()) {
        return `Instruct: ${instruction.trim()}\nQuery: ${text}`;
      }
      return `query: ${text}`;
    }
    return `passage: ${text}`;
  }

  // 2. BGE Model Family (bge-m3, bge-small-en-v1.5, etc.)
  if (name.includes("bge")) {
    if (isQuery) {
      if (instruction && instruction.trim()) {
        return `Represent this sentence for searching relevant passages: ${instruction.trim()} ${text}`;
      }
      return `Represent this sentence for searching relevant passages: ${text}`;
    }
    return text;
  }

  // 3. MiniLM / Standard models (no prefixes)
  return text;
}

export async function embedText(text, isQuery = false, modelName = null, progressCallback = null, instruction = null) {
  const targetModel = modelName || getConfig().embeddingModel || "Xenova/multilingual-e5-small";
  const extractor = await getExtractor(targetModel, progressCallback);
  const formattedText = formatInputText(text, isQuery, targetModel, instruction);

  const output = await extractor(formattedText, {
    pooling: "mean",
    normalize: true,
  });

  return new Float32Array(output.data);
}

export async function getReranker(modelName = "Xenova/bge-reranker-base", progressCallback = null) {
  if (rerankerInstance && loadedRerankerName === modelName) {
    return rerankerInstance;
  }

  // Patch Tensor constructor BEFORE importing @xenova/transformers (which re-exports
  // utils/tensor.js, capturing ONNX.Tensor at import time).
  const { bestProvider } = await detectAvailableProviders();
  await configureOnnxBackend(bestProvider);

  const { pipeline, env } = await import("@xenova/transformers");
  env.cacheDir = MODELS_DIR;

  const pipelineOpts = { quantized: true };
  if (progressCallback) {
    pipelineOpts.progress_callback = progressCallback;
  }

  try {
    rerankerInstance = await pipeline("text-classification", modelName, pipelineOpts);
    loadedRerankerName = modelName;
  } catch (err) {
    if (bestProvider !== "cpu") {
      console.warn(`Reranker GPU load failed: ${err.message}. Falling back to CPU...`);
      await configureOnnxBackend("cpu");
      try {
        rerankerInstance = await pipeline("text-classification", modelName, pipelineOpts);
        loadedRerankerName = modelName;
      } catch (cpuErr) {
        console.warn(`Failed to load reranker model ${modelName}: ${cpuErr.message}`);
        return null;
      }
    } else {
      console.warn(`Failed to load reranker model ${modelName}: ${err.message}`);
      return null;
    }
  }
  return rerankerInstance;
}

export async function preloadModel(modelName, type = "embedding", progressCallback = null) {
  if (type === "reranker") {
    return await getReranker(modelName, progressCallback);
  }
  return await getExtractor(modelName, progressCallback);
}

export async function rerankHits(query, hits, rerankerModelName = "Xenova/bge-reranker-base") {
  if (!hits || hits.length === 0) return hits;
  const classifier = await getReranker(rerankerModelName);
  if (!classifier) return hits;

  const reranked = [];
  for (const hit of hits) {
    try {
      const input = `${query} | ${hit.content}`;
      const res = await classifier(input);
      const score = res && res[0] ? res[0].score : hit.rsf_score || hit.rrf_score || 0;
      reranked.push({
        ...hit,
        rerank_score: score,
      });
    } catch (err) {
      reranked.push(hit);
    }
  }

  reranked.sort((a, b) => (b.rerank_score || 0) - (a.rerank_score || 0));
  return reranked;
}

/**
 * Get detailed device/GPU information for diagnostics and CLI display.
 * @returns {Promise<{activeDevice: string, availableProviders: string[], isGpuActive: boolean, displayName: string, configuredDevice: string, detectedBest: string, status: string}>}
 */
export async function getDeviceInfo() {
  const { bestProvider, available } = await detectAvailableProviders();
  const gpuName = detectGpuName();

  const deviceBaseLabels = {
    dml: "DirectML",
    webgpu: "WebGPU",
    cuda: "CUDA",
    cpu: "CPU",
    wasm: "WASM",
  };

  const deviceLabel = deviceBaseLabels[bestProvider] || bestProvider.toUpperCase();
  const gpuSuffix = (bestProvider === "dml" || bestProvider === "cuda") && gpuName
    ? ` (${gpuName})`
    : "";

  const hasLoaded = activeDevice !== "cpu" || extractorInstance !== null || rerankerInstance !== null;
  const effective = hasLoaded ? activeDevice : bestProvider;

  return {
    activeDevice: activeDevice,
    configuredDevice: getConfig().executionDevice || "auto",
    detectedBest: bestProvider,
    availableProviders: available,
    isGpuActive: effective !== "cpu" && effective !== "wasm",
    displayName: `${deviceLabel}${gpuSuffix}`,
    gpuName: gpuName || null,
    status: hasLoaded ? "active" : "available (loads on first use)",
  };
}

export function vectorToBuffer(float32Array) {
  return Buffer.from(float32Array.buffer, float32Array.byteOffset, float32Array.byteLength);
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
