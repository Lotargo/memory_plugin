import { updateConfig, getConfig } from "../config/config_manager.js";
import { getExtractor, embedBatch, resetExtractor } from "../ml/model_manager.js";
import { GpuMonitor, ExecutionTracer } from "../ml/gpu_monitor.js";

async function runSinglePass(device, modelName, batchSize, totalItems, onProgress) {
  updateConfig({ executionDevice: device, embeddingModel: modelName, batchSize });
  resetExtractor();

  await getExtractor(modelName);

  const allTexts = Array.from({ length: totalItems }, (_, i) =>
    `High throughput parallel matrix multiplication on GPU using DirectML execution provider. Micro-chunk block #${i + 1} for dense vector embedding computation.`
  );

  const isGpu = device !== "cpu";
  const monitor = isGpu ? new GpuMonitor(50) : null;
  if (monitor) monitor.start();

  const start = Date.now();
  let totalComputed = 0;

  for (let i = 0; i < allTexts.length; i += batchSize) {
    const batch = allTexts.slice(i, i + batchSize);
    const batchVecs = await embedBatch(batch, false, modelName, null, null, {
      enableTrace: false,
      enableMonitor: false,
    });
    totalComputed += batchVecs.length;
    if (onProgress) onProgress({ current: totalComputed, total: totalItems, device });
  }

  const duration = Date.now() - start;
  const gpuStats = monitor ? monitor.stop() : null;

  global.gc?.({ type: "major" });

  return {
    device,
    totalComputed,
    durationMs: duration,
    throughput: totalComputed / (duration / 1000),
    avgMsPerItem: duration / totalComputed,
    gpuStats,
  };
}

export async function runCpuVsGpuComparison(options = {}) {
  const modelName = options.modelName || getConfig().embeddingModel || "Xenova/bge-m3";
  const batchSize = options.batchSize || 32;
  const totalItems = options.totalItems || 512;

  console.log(`\n===============================================================`);
  console.log(`  CPU vs GPU INFERENCE COMPARISON BENCHMARK`);
  console.log(`===============================================================`);
  console.log(`  Model:       ${modelName}`);
  console.log(`  Batch Size:  ${batchSize}`);
  console.log(`  Items:       ${totalItems}`);
  console.log(`  GC Exposed:  ${typeof global.gc === "function" ? "YES" : "NO"}`);
  console.log(`===============================================================\n`);

  console.log(`  [1/2] Running CPU pass...`);
  const cpuResult = await runSinglePass("cpu", modelName, batchSize, totalItems, options.onProgress);
  console.log(`         CPU: ${cpuResult.throughput.toFixed(1)} emb/s, ${cpuResult.avgMsPerItem.toFixed(2)} ms/item, ${cpuResult.durationMs}ms total\n`);

  console.log(`  [2/2] Running GPU pass (DirectML)...`);
  const gpuResult = await runSinglePass("webgpu", modelName, batchSize, totalItems, options.onProgress);
  console.log(`         GPU: ${gpuResult.throughput.toFixed(1)} emb/s, ${gpuResult.avgMsPerItem.toFixed(2)} ms/item, ${gpuResult.durationMs}ms total\n`);

  const speedup = cpuResult.durationMs / gpuResult.durationMs;
  const gpuPeak = gpuResult.gpuStats ? gpuResult.gpuStats.peak : null;
  const gpuAvg = gpuResult.gpuStats ? gpuResult.gpuStats.avg : null;

  console.log(`===============================================================`);
  console.log(`  COMPARISON RESULTS`);
  console.log(`===============================================================`);
  console.log(`  Metric                 CPU              GPU`);
  console.log(`  ─────────────────────────────────────────────────────────`);
  console.log(`  Duration               ${String(cpuResult.durationMs + "ms").padEnd(17)}${gpuResult.durationMs}ms`);
  console.log(`  Throughput             ${String(cpuResult.throughput.toFixed(1) + " emb/s").padEnd(17)}${gpuResult.throughput.toFixed(1)} emb/s`);
  console.log(`  Avg per item           ${String(cpuResult.avgMsPerItem.toFixed(2) + " ms").padEnd(17)}${gpuResult.avgMsPerItem.toFixed(2)} ms`);
  if (gpuPeak !== null) {
    console.log(`  GPU Peak               -                ${gpuPeak}%`);
    console.log(`  GPU Average            -                ${gpuAvg}%`);
  }
  console.log(`  ─────────────────────────────────────────────────────────`);
  console.log(`  Speedup:               ${speedup.toFixed(2)}x ${speedup > 1 ? "(GPU faster)" : speedup < 1 ? "(CPU faster)" : "(equal)"}`);
  console.log(`===============================================================\n`);

  return { cpu: cpuResult, gpu: gpuResult, speedup };
}

export async function runGpuProfileBenchmark(options = {}) {
  const modelName = options.modelName || "Xenova/bge-small-en-v1.5";
  const batchSize = options.batchSize || 256;
  const totalItems = options.totalItems || 1024;
  const minGpuThreshold = options.minGpuThreshold || 25;

  console.log(`\n===============================================================`);
  console.log(` ⚡ GPU HARDWARE INFERENCE & BOTTLENECK PROFILER BENCHMARK`);
  console.log(`===============================================================`);
  console.log(` Target Model:          ${modelName}`);
  console.log(` Batch Size:            ${batchSize} items/batch`);
  console.log(` Total Items:           ${totalItems}`);
  console.log(`===============================================================\n`);

  updateConfig({ executionDevice: "webgpu", embeddingModel: modelName, batchSize });
  resetExtractor();

  console.log("1. Initializing GPU DirectML Engine...");
  await getExtractor(modelName);
  console.log("   [OK] Engine Loaded & Initialized on GPU (DirectML)\n");

  console.log("2. Sampling GPU Utilization & Profiling Operations...");
  const allTexts = Array.from({ length: totalItems }, (_, i) =>
    `High throughput parallel matrix multiplication on GPU using DirectML execution provider. Micro-chunk block #${i + 1} for dense vector embedding computation.`
  );

  const monitor = new GpuMonitor(30);
  monitor.start();

  const tracer = new ExecutionTracer(`GPU Execution (${totalItems} items, batch ${batchSize})`);
  const start = Date.now();
  let totalComputed = 0;

  for (let i = 0; i < allTexts.length; i += batchSize) {
    const batch = allTexts.slice(i, i + batchSize);

    tracer.startStage(`Batch ${i / batchSize + 1} Preprocessing (CPU)`, "CPU");
    const formatted = batch.map((t) => t.trim());

    tracer.startStage(`Batch ${i / batchSize + 1} Tensor Inference (GPU)`, "GPU");
    const batchVecs = await embedBatch(formatted, false, modelName, null, null, {
      enableTrace: false,
      enableMonitor: false,
    });
    totalComputed += batchVecs.length;
  }
  tracer.endStage();

  const duration = Date.now() - start;
  const gpuStats = monitor.stop();

  const summary = tracer.printTraceReport(gpuStats, minGpuThreshold);

  console.log(`=== BENCHMARK SUMMARY & METRICS ===`);
  console.log(` - Total Throughput:     ${(totalComputed / (duration / 1000)).toFixed(1)} embeddings / second`);
  console.log(` - Average Per-Item:     ${(duration / totalComputed).toFixed(2)} ms / item`);
  console.log(` - Peak GPU Load:        ${gpuStats.peak}%`);
  console.log(` - Average GPU Load:     ${gpuStats.avg}%`);
  console.log(` - GPU Time Share:       ${summary.gpuMs.toFixed(1)}ms (${summary.gpuPct}% of total time)`);
  console.log(` - CPU Time Share:       ${summary.cpuMs.toFixed(1)}ms (${summary.cpuPct}% of total time)`);
  console.log(`===============================================================\n`);

  return {
    totalComputed,
    durationMs: duration,
    throughput: totalComputed / (duration / 1000),
    gpuStats,
    summary,
  };
}

if (process.argv[1]?.includes("gpu_profile_benchmark.js")) {
  const args = process.argv.slice(2);
  const fn = args.includes("--compare") ? runCpuVsGpuComparison : runGpuProfileBenchmark;
  fn().catch((err) => {
    console.error("\n❌ BENCHMARK ABORTED:", err.message);
    process.exit(1);
  });
}
