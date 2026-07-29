import { MODELS_DIR } from "../db/database.js";

let extractorInstance = null;
let loadedModelName = null;

let rerankerInstance = null;
let loadedRerankerName = null;

export async function getExtractor(modelName = "Xenova/multilingual-e5-small") {
  if (extractorInstance && loadedModelName === modelName) {
    return extractorInstance;
  }

  const { pipeline, env } = await import("@xenova/transformers");

  env.cacheDir = MODELS_DIR;
  env.allowLocalModels = true;
  env.allowRemoteModels = true;

  try {
    // 1. Primary load from HuggingFace
    extractorInstance = await pipeline("feature-extraction", modelName, {
      quantized: true,
    });
    loadedModelName = modelName;
  } catch (err) {
    console.warn(`Primary HuggingFace model load failed/rate-limited for ${modelName}: ${err.message}. Attempting GitHub mirror fallback...`);
    try {
      // 2. Fallback load from GitHub mirror host
      env.remoteHost = "https://raw.githubusercontent.com/Lotargo/memory_pugin/main/models/";
      env.remotePathTemplate = "{model}/";
      extractorInstance = await pipeline("feature-extraction", modelName, {
        quantized: true,
      });
      loadedModelName = modelName;
    } catch (mirrorErr) {
      console.warn(`GitHub mirror fallback failed: ${mirrorErr.message}. Falling back to default Xenova/all-MiniLM-L6-v2...`);
      env.remoteHost = "https://huggingface.co";
      env.remotePathTemplate = "{model}/resolve/{revision}/";
      extractorInstance = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        quantized: true,
      });
      loadedModelName = "Xenova/all-MiniLM-L6-v2";
    }
  }

  return extractorInstance;
}

export async function embedText(text, isQuery = false, modelName = "Xenova/multilingual-e5-small") {
  const extractor = await getExtractor(modelName);
  const formattedText = isQuery ? `query: ${text}` : `passage: ${text}`;

  const output = await extractor(formattedText, {
    pooling: "mean",
    normalize: true,
  });

  return new Float32Array(output.data);
}

export async function getReranker(modelName = "Xenova/bge-reranker-base") {
  if (rerankerInstance && loadedRerankerName === modelName) {
    return rerankerInstance;
  }

  const { pipeline, env } = await import("@xenova/transformers");
  env.cacheDir = MODELS_DIR;

  try {
    rerankerInstance = await pipeline("text-classification", modelName, {
      quantized: true,
    });
    loadedRerankerName = modelName;
  } catch (err) {
    console.warn(`Failed to load reranker model ${modelName}: ${err.message}`);
    return null;
  }
  return rerankerInstance;
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
