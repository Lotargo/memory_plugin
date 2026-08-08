import { updateConfig } from "../../config/config_manager.js";
import { getModelStorageInfo } from "../../ml/model_manager.js";
import {
  EMBEDDING_PRESETS,
  RERANKER_PRESETS,
  downloadModelWithProgress,
  selectSimpleMenu,
  adjustAlphaMenu,
  readTextInput,
  waitForEnter,
} from "../ui.js";

export async function handleEngineAction(value, config) {
  switch (value) {
    case "algo": {
      const algoItems = [
        { label: "RSF (Relative Score Fusion)", value: "rsf", info: "Normalized Score Scaling (Recommended)" },
        { label: "RRF (Reciprocal Rank Fusion)", value: "rrf", info: "Rank-based Fusion (1/(k + rank))" },
        { label: "Pure Semantic Search", value: "semantic_only", info: "Vector Search Only (Cosine Similarity)" },
        { label: "Pure Lexical Search", value: "lexical_only", info: "BM25 Text Search Only (SQLite FTS5)" },
      ];
      const initialAlgoIdx = Math.max(0, algoItems.findIndex((i) => i.value === config.fusionAlgorithm));
      const subRes = await selectSimpleMenu({
        title: "SELECT FUSION ALGORITHM",
        subtitle: "Choose how vector and keyword search scores are combined",
        items: algoItems,
        initialIndex: initialAlgoIdx,
      });

      if (subRes.action === "select") {
        updateConfig({ fusionAlgorithm: subRes.value });
      }
      break;
    }
    case "alpha": {
      const alphaRes = await adjustAlphaMenu(config.alpha);
      if (alphaRes.action === "save") {
        updateConfig({ alpha: alphaRes.value });
      }
      break;
    }
    case "embedding": {
      const embItems = EMBEDDING_PRESETS.map((m) => {
        const info = getModelStorageInfo(m);
        let badge = "NOT DOWNLOADED";
        if (info.status === "downloaded") badge = `READY (${info.sizeMB} MB)`;
        else if (info.status === "partial") badge = `INCOMPLETE (${info.sizeMB} MB)`;
        return { label: m, badge, value: m, info: `Model: ${m} [${badge}]` };
      });
      embItems.push({ label: "Custom HuggingFace Model...", value: "custom", info: "Specify custom HF model string" });
      const initialEmbIdx = Math.max(0, embItems.findIndex((i) => i.value === config.embeddingModel));

      const subRes = await selectSimpleMenu({
        title: "SELECT EMBEDDING MODEL",
        subtitle: "Dense vector extraction model via @huggingface/transformers",
        items: embItems,
        initialIndex: initialEmbIdx,
      });

      if (subRes.action === "select") {
        let chosenModel = subRes.value;
        if (subRes.value === "custom") {
          const inputRes = await readTextInput("Enter HuggingFace Model ID", "Xenova/all-MiniLM-L6-v2");
          if (inputRes.action === "submit" && inputRes.value) {
            chosenModel = inputRes.value;
          } else {
            break;
          }
        }
        await downloadModelWithProgress(chosenModel, "embedding");
        updateConfig({ embeddingModel: chosenModel });
        await waitForEnter();
      }
      break;
    }
    case "reranker": {
      const rkItems = [
        { label: "Disable Reranker", value: "none", info: "No cross-encoder re-ranking" },
        ...RERANKER_PRESETS.filter((r) => r !== "none").map((r) => {
          const info = getModelStorageInfo(r);
          let badge = "NOT DOWNLOADED";
          if (info.status === "downloaded") badge = `READY (${info.sizeMB} MB)`;
          else if (info.status === "partial") badge = `INCOMPLETE (${info.sizeMB} MB)`;
          return { label: r, badge, value: r, info: `Reranker: ${r} [${badge}]` };
        }),
        { label: "Custom Reranker Model...", value: "custom", info: "Specify custom HuggingFace cross-encoder model" },
      ];
      const currentRk = config.rerankerEnabled ? config.rerankerModel : "none";
      const initialRkIdx = Math.max(0, rkItems.findIndex((i) => i.value === currentRk));

      const subRes = await selectSimpleMenu({
        title: "CONFIGURE RERANKER MODEL",
        subtitle: "Cross-Encoder candidate re-ranking pass",
        items: rkItems,
        initialIndex: initialRkIdx,
      });

      if (subRes.action === "select") {
        if (subRes.value === "none") {
          updateConfig({ rerankerEnabled: false, rerankerModel: "none" });
        } else {
          let chosenRk = subRes.value;
          if (subRes.value === "custom") {
            const inputRes = await readTextInput("Enter HuggingFace Reranker Model ID", "Xenova/bge-reranker-base");
            if (inputRes.action === "submit" && inputRes.value) {
              chosenRk = inputRes.value;
            } else {
              break;
            }
          }
          await downloadModelWithProgress(chosenRk, "reranker");
          updateConfig({ rerankerEnabled: true, rerankerModel: chosenRk });
          await waitForEnter();
        }
      }
      break;
    }
    case "vector_dim": {
      const dimItems = [
        { label: "0 - Auto (Detect from Model)", value: 0, info: "Use the vector dimension produced by the embedding model (Recommended)" },
        { label: "384", value: 384, info: "MiniLM-L6 / multilingual-e5-small" },
        { label: "512", value: 512, info: "Compact embedding models" },
        { label: "768", value: 768, info: "e5-large / bge-base / MiniLM-L12" },
        { label: "1024", value: 1024, info: "bge-m3 / modern multilingual models" },
        { label: "1536", value: 1536, info: "OpenAI text-embedding-3-small (for compatible local models)" },
        { label: "3072", value: 3072, info: "OpenAI text-embedding-3-large (for compatible local models)" },
        { label: "Custom Dimension...", value: "custom", info: "Specify any dimension not listed here" },
      ];
      const currentDim = config.vectorDimension || 0;
      const initialDimIdx = Math.max(0, dimItems.findIndex((i) => i.value === currentDim));

      const subRes = await selectSimpleMenu({
        title: "SELECT VECTOR DIMENSION",
        subtitle: "Force a fixed embedding size (pads/truncates model output for consistent matching)",
        items: dimItems,
        initialIndex: initialDimIdx,
      });

      if (subRes.action === "select") {
        let chosenDim = subRes.value;
        if (subRes.value === "custom") {
          const inputRes = await readTextInput("Enter Vector Dimension (positive integer)", "768");
          if (inputRes.action === "submit" && inputRes.value) {
            const parsed = Number.parseInt(inputRes.value, 10);
            if (!Number.isInteger(parsed) || parsed <= 0) {
              console.log(`\x1b[31mInvalid dimension: "${inputRes.value}". Expected a positive integer.\x1b[0m`);
              await waitForEnter();
              break;
            }
            chosenDim = parsed;
          } else {
            break;
          }
        }
        updateConfig({ vectorDimension: chosenDim });
      }
      break;
    }
    case "batch_size": {
      const batchItems = [
        { label: "Batch Size 1 (Single Item)", value: 1, info: "Process micro-chunks strictly 1 by 1" },
        { label: "Batch Size 4", value: 4, info: "Small CPU batch size" },
        { label: "Batch Size 8 (CPU Sweet Spot)", value: 8, info: "Optimal for CPU L3 cache" },
        { label: "Batch Size 12 (Default)", value: 12, info: "Balanced CPU throughput" },
        { label: "Batch Size 16", value: 16, info: "High throughput batch size" },
        { label: "Batch Size 32 (Standard GPU)", value: 32, info: "Standard GPU batching" },
        { label: "Batch Size 48 (High GPU)", value: 48, info: "High throughput GPU batching" },
        { label: "Batch Size 64 (Ultra GPU)", value: 64, info: "Ultra-fast GPU parallel tensor execution" },
        { label: "Batch Size 128 (Extreme GPU)", value: 128, info: "Massive GPU parallelism" },
        { label: "Batch Size 256 (Max GPU)", value: 256, info: "Maximum batch capacity for dedicated VRAM" },
      ];
      const currentBatch = config.batchSize || 12;
      const initialBatchIdx = Math.max(0, batchItems.findIndex((i) => i.value === currentBatch));
      const subRes = await selectSimpleMenu({
        title: "SELECT VECTOR BATCH SIZE",
        subtitle: "Number of micro-chunks vectorized per ONNX inference pass",
        items: batchItems,
        initialIndex: initialBatchIdx,
      });
      if (subRes.action === "select") {
        updateConfig({ batchSize: subRes.value });
      }
      break;
    }
    case "gpu_budget": {
      const budgetItems = [
        { label: "1.0M Units (Conservative ~0.8 GB VRAM)", value: 1000000, info: "Ultra-safe for 4GB-6GB GPUs or heavy background multitasking" },
        { label: "2.0M Units (Balanced ~1.5 GB VRAM - Default)", value: 2000000, info: "Optimal balance between GPU throughput & safe VRAM ceiling" },
        { label: "4.0M Units (Aggressive ~2.5 GB VRAM)", value: 4000000, info: "Higher GPU parallel compute for dedicated 8GB+ GPUs" },
        { label: "8.0M Units (High Parallelism ~4.5 GB VRAM)", value: 8000000, info: "Maximum batching throughput for 12GB-16GB VRAM GPUs" },
        { label: "16.0M Units (Extreme ~8.0 GB VRAM)", value: 16000000, info: "Uncapped micro-batching for 24GB+ VRAM workstation GPUs" },
      ];
      const currentBudget = config.gpuAttentionBudget || 2000000;
      const initialIdx = Math.max(0, budgetItems.findIndex((i) => i.value === currentBudget));
      const subRes = await selectSimpleMenu({
        title: "SELECT GPU MICRO-BATCH ATTENTION BUDGET",
        subtitle: "Controls dynamic O(seq_len^2) sub-batching to prevent VRAM overflow",
        items: budgetItems,
        initialIndex: initialIdx,
      });
      if (subRes.action === "select") {
        updateConfig({ gpuAttentionBudget: subRes.value });
      }
      break;
    }
    case "onnx_threads": {
      const threadItems = [
        { label: "0 - Auto (Detect CPU Cores)", value: 0, info: "Automatically match physical CPU cores (up to 8)" },
        { label: "1 Thread (Single-Threaded)", value: 1, info: "Restrict ONNX WASM to 1 thread" },
        { label: "2 Threads", value: 2, info: "Use 2 WASM threads" },
        { label: "4 Threads", value: 4, info: "Use 4 WASM threads" },
        { label: "8 Threads", value: 8, info: "Use 8 WASM threads" },
        { label: "16 Threads", value: 16, info: "Use 16 WASM threads" },
      ];
      const currentThreads = config.onnxThreads || 0;
      const initialThreadIdx = Math.max(0, threadItems.findIndex((i) => i.value === currentThreads));
      const subRes = await selectSimpleMenu({
        title: "SELECT CPU ONNX WASM THREADS",
        subtitle: "Number of WASM worker threads for ONNX Runtime",
        items: threadItems,
        initialIndex: initialThreadIdx,
      });
      if (subRes.action === "select") {
        updateConfig({ onnxThreads: subRes.value });
      }
      break;
    }
    case "execution_device": {
      const devItems = [
        {
          label: "CPU (AVX2 / WASM SIMD - RECOMMENDED)",
          value: "cpu",
          info: "Standard multi-threaded CPU execution via ONNX native AVX2 (Optimal speed, stability & zero VRAM overhead)",
        },
        {
          label: "\x1b[31m[EXPERIMENTAL]\x1b[0m GPU (DirectML / WebGPU)",
          value: "webgpu",
          info: "⚠️ EXPERIMENTAL: DirectML GPU tensor execution. High JS FFI & zero-padding overhead; CPU AVX2 is recommended for local Node.js.",
        },
      ];
      const currentDev = config.executionDevice || "cpu";
      const initialDevIdx = Math.max(0, devItems.findIndex((i) => i.value === currentDev));
      const subRes = await selectSimpleMenu({
        title: "SELECT EXECUTION HARDWARE DEVICE",
        subtitle: "CPU AVX2 (Recommended) vs Experimental DirectML GPU Hardware Mode",
        items: devItems,
        initialIndex: initialDevIdx,
      });
      if (subRes.action === "select") {
        updateConfig({ executionDevice: subRes.value });
      }
      break;
    }
  }
}
