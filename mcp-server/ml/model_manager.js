import { MODELS_DIR } from "../db/database.js";

let extractorInstance = null;
let loadedModelName = null;

let rerankerInstance = null;
let loadedRerankerName = null;

import { getConfig } from "../config/config_manager.js";

export async function getExtractor(modelName = null, progressCallback = null) {
  const targetModel = modelName || getConfig().embeddingModel || "Xenova/multilingual-e5-small";

  if (extractorInstance && loadedModelName === targetModel) {
    return extractorInstance;
  }

  const { pipeline, env } = await import("@xenova/transformers");

  // Fix ONNX Runtime Node.js WASM execution provider warning
  try {
    const { executionProviders } = await import("@xenova/transformers/src/backends/onnx.js");
    const wasmIdx = executionProviders.indexOf("wasm");
    if (wasmIdx !== -1) {
      executionProviders.splice(wasmIdx, 1);
    }
  } catch {}

  env.cacheDir = MODELS_DIR;
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  env.remoteHost = "https://huggingface.co";
  env.remotePathTemplate = "{model}/resolve/{revision}/";
  env.sharp = false;

  const pipelineOpts = { quantized: true };
  if (progressCallback) {
    pipelineOpts.progress_callback = progressCallback;
  }

  try {
    extractorInstance = await pipeline("feature-extraction", targetModel, pipelineOpts);
    loadedModelName = targetModel;
  } catch (err) {
    console.warn(`HuggingFace model load failed for ${targetModel}: ${err.message}. Falling back to default Xenova/multilingual-e5-small...`);
    if (targetModel !== "Xenova/multilingual-e5-small") {
      extractorInstance = await pipeline("feature-extraction", "Xenova/multilingual-e5-small", pipelineOpts);
      loadedModelName = "Xenova/multilingual-e5-small";
    } else {
      throw err;
    }
  }

  return extractorInstance;
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

  const { pipeline, env } = await import("@xenova/transformers");
  env.cacheDir = MODELS_DIR;
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  env.remoteHost = "https://huggingface.co";
  env.remotePathTemplate = "{model}/resolve/{revision}/";
  env.sharp = false;

  const pipelineOpts = { quantized: true };
  if (progressCallback) {
    pipelineOpts.progress_callback = progressCallback;
  }

  try {
    rerankerInstance = await pipeline("text-classification", modelName, pipelineOpts);
    loadedRerankerName = modelName;
  } catch (err) {
    console.warn(`Failed to load reranker model ${modelName}: ${err.message}`);
    return null;
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
