import { MODELS_DIR } from "../db/database.js";

let extractorInstance = null;
let currentModelName = "Xenova/multilingual-e5-small";

export async function getExtractor(modelName = currentModelName) {
  if (extractorInstance) {
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
  } catch (err) {
    console.warn(`Primary HuggingFace model load failed/rate-limited: ${err.message}. Attempting GitHub mirror fallback...`);
    try {
      // 2. Fallback load from GitHub mirror host
      env.remoteHost = "https://raw.githubusercontent.com/Lotargo/memory_pugin/main/models/";
      env.remotePathTemplate = "{model}/";
      extractorInstance = await pipeline("feature-extraction", modelName, {
        quantized: true,
      });
    } catch (mirrorErr) {
      console.warn(`GitHub mirror fallback failed: ${mirrorErr.message}. Attempting fallback model...`);
      env.remoteHost = "https://huggingface.co";
      env.remotePathTemplate = "{model}/resolve/{revision}/";
      extractorInstance = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        quantized: true,
      });
    }
  }

  return extractorInstance;
}

export async function embedText(text, isQuery = false, modelName = currentModelName) {
  const extractor = await getExtractor(modelName);
  const formattedText = isQuery ? `query: ${text}` : `passage: ${text}`;

  const output = await extractor(formattedText, {
    pooling: "mean",
    normalize: true,
  });

  return new Float32Array(output.data);
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
