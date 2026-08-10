import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function getGpuUtilizationAsync() {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", 
      ["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
      { timeout: 1000 }
    );
    const val = parseInt(stdout.trim(), 10);
    if (!isNaN(val)) return val;
  } catch {}

  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("powershell", 
        ["-NoProfile", "-Command", "(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Measure-Object -Property UtilizationPercentage -Sum).Sum"],
        { timeout: 1500 }
      );
      const val = parseInt(stdout.trim(), 10);
      if (!isNaN(val)) return Math.min(100, val);
    } catch {}
  }

  return null;
}

export class GpuMonitor {
  constructor(sampleIntervalMs = 100) {
    this.intervalMs = sampleIntervalMs;
    this.samples = [];
    this.timer = null;
    this.isMonitoring = false;
  }

  start() {
    this.samples = [];
    this.isMonitoring = true;
    this.sample();

    this.timer = setInterval(() => {
      if (this.isMonitoring) {
        this.sample();
      }
    }, this.intervalMs);
  }

  async sample() {
    const util = await getGpuUtilizationAsync();
    if (util !== null) {
      this.samples.push(util);
    }
  }

  stop() {
    this.isMonitoring = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.samples.length === 0) {
      return { avg: null, peak: null, samplesCount: 0 };
    }

    const max = Math.max(...this.samples);
    const sum = this.samples.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / this.samples.length);

    return {
      avg,
      peak: max,
      samplesCount: this.samples.length,
      samples: this.samples,
    };
  }
}

export class ExecutionTracer {
  constructor(name = "Batch Inference") {
    this.name = name;
    this.stages = [];
    this.currentStage = null;
    this.startTime = Date.now();
  }

  startStage(stageName, category = "CPU") {
    const now = performance.now();
    if (this.currentStage) {
      this.currentStage.duration = now - this.currentStage.startTime;
      this.stages.push(this.currentStage);
    }
    this.currentStage = {
      name: stageName,
      category, // "CPU" or "GPU"
      startTime: now,
      duration: 0,
    };
  }

  endStage() {
    const now = performance.now();
    if (this.currentStage) {
      this.currentStage.duration = now - this.currentStage.startTime;
      this.stages.push(this.currentStage);
      this.currentStage = null;
    }
  }

  getSummary(gpuStats = null) {
    this.endStage();
    const totalMs = this.stages.reduce((sum, s) => sum + s.duration, 0);

    const breakdown = this.stages.map((s) => ({
      name: s.name,
      category: s.category,
      durationMs: parseFloat(s.duration.toFixed(2)),
      pct: totalMs > 0 ? parseFloat(((s.duration / totalMs) * 100).toFixed(1)) : 0,
    }));

    const cpuTime = this.stages.filter((s) => s.category === "CPU").reduce((sum, s) => sum + s.duration, 0);
    const gpuTime = this.stages.filter((s) => s.category === "GPU").reduce((sum, s) => sum + s.duration, 0);

    return {
      name: this.name,
      totalMs: parseFloat(totalMs.toFixed(2)),
      cpuMs: parseFloat(cpuTime.toFixed(2)),
      gpuMs: parseFloat(gpuTime.toFixed(2)),
      cpuPct: totalMs > 0 ? parseFloat(((cpuTime / totalMs) * 100).toFixed(1)) : 0,
      gpuPct: totalMs > 0 ? parseFloat(((gpuTime / totalMs) * 100).toFixed(1)) : 0,
      breakdown,
      gpuStats,
    };
  }

  printTraceReport(gpuStats = null, minGpuThreshold = 0) {
    const summary = this.getSummary(gpuStats);
    const line = "─".repeat(65);
    // stderr, never stdout: stdout is the MCP JSON-RPC channel and any stray
    // write there corrupts the protocol stream.
    const out = (msg) => console.error(msg);

    out(`\n┌${line}┐`);
    out(`│ CPU/GPU OPERATION TRACE & BOTTLENECK PROFILE: ${summary.name.padEnd(16)} │`);
    out(`├${line}┤`);

    for (const b of summary.breakdown) {
      const icon = b.category === "GPU" ? "⚡ [GPU]" : "💻 [CPU]";
      const label = `${icon} ${b.name}`.padEnd(42);
      const timeStr = `${b.durationMs.toFixed(1)}ms (${b.pct.toFixed(1)}%)`.padStart(18);
      out(`│ ${label}${timeStr} │`);
    }

    out(`├${line}┤`);
    out(`│ Total Batch Time: ${summary.totalMs.toFixed(1)}ms | CPU Time: ${summary.cpuMs.toFixed(1)}ms (${summary.cpuPct}%) | GPU Engine Time: ${summary.gpuMs.toFixed(1)}ms (${summary.gpuPct}%) │`);

    if (gpuStats && gpuStats.peak !== null) {
      const statsBadge = `Peak: ${gpuStats.peak}%, Avg: ${gpuStats.avg}%`;
      out(`│ GPU Hardware Load: ${statsBadge.padEnd(44)} │`);
      out(`└${line}┘\n`);
    } else {
      out(`└${line}┘\n`);
    }

    return summary;
  }
}
