import { getConfig, updateConfig } from "../config/config_manager.js";
import {
  sendModelCommand,
  waitForCommandAck,
  readRuntimeState,
  isProcessAlive,
} from "../ml/model_control.js";
import { getGpuMemoryInfoAsync, getProcessMemoryMB } from "../ml/gpu_monitor.js";

// Non-interactive model lifecycle commands for humans and AI agents:
//   memory-cli models status [--json]
//   memory-cli models unload
//   memory-cli models load [--device cpu|gpu]
//   memory-cli models device cpu|gpu
//   memory-cli models timer off|<minutes>
//
// `status`, `device` and `timer` work purely via config/state files. `unload`
// and `load` are forwarded to the running MCP server over the file-based
// control channel, because only the server process holds the ONNX sessions.

const ACK_WAIT_UNLOAD_MS = 12000;
const ACK_WAIT_LOAD_MS = 180000;

function flagValue(args, name) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}

function normalizeDeviceArg(raw) {
  if (!raw) return null;
  const v = String(raw).toLowerCase();
  if (v === "cpu" || v === "ram") return "cpu";
  if (v === "gpu" || v === "vram" || v === "webgpu" || v === "dml" || v === "cuda") return "webgpu";
  return undefined;
}

function getServerSnapshot() {
  const state = readRuntimeState();
  if (state && isProcessAlive(state.serverPid)) return state;
  return null;
}

function printStatus(state, config, gpu) {
  const devLabel = (d) => (d && d !== "cpu" ? `${d.toUpperCase()} (GPU/VRAM)` : "CPU (RAM)");
  console.log("\n  [MODELS] Runtime status:");
  console.log(`    Configured device:  ${devLabel(state?.resolvedDevice || "cpu")} (setting: ${config.executionDevice || "cpu"})`);
  console.log(`    Auto-unload timer:  ${(config.modelUnloadTimeoutMinutes || 0) > 0 ? `${config.modelUnloadTimeoutMinutes} min` : "OFF"}`);
  if (!state) {
    console.log("    MCP server:         not running (no live models loaded anywhere)");
    console.log("    Note: models load lazily inside the MCP server on first use.");
  } else {
    const emb = state.embedding || {};
    const rrk = state.reranker || {};
    console.log(`    MCP server:         running (pid ${state.serverPid}, RSS ${state.serverRssMB} MB)`);
    console.log(`    Embedding model:    ${emb.loaded ? `LOADED: ${emb.loadedModel} on ${devLabel(emb.device)}` : `not loaded (${emb.configuredModel})`}`);
    console.log(`    Reranker model:     ${rrk.loaded ? `LOADED: ${rrk.loadedModel} on ${devLabel(rrk.device)}` : (rrk.enabled ? `not loaded (${rrk.configuredModel})` : "disabled")}`);
    if (state.lastActivity) {
      console.log(`    Last model use:     ${state.lastActivity} (idle ${state.idleForSeconds}s)`);
    }
  }
  if (gpu) {
    console.log(`    GPU VRAM:           ${gpu.usedMB} / ${gpu.totalMB} MB used`);
  } else {
    console.log("    GPU VRAM:           unavailable (no nvidia-smi)");
  }
  console.log("");
}

async function cmdStatus(args) {
  const config = getConfig();
  const state = getServerSnapshot();
  const gpu = await getGpuMemoryInfoAsync();
  if (args.includes("--json")) {
    console.log(JSON.stringify({ config: { executionDevice: config.executionDevice, modelUnloadTimeoutMinutes: config.modelUnloadTimeoutMinutes || 0 }, server: state, gpuMemory: gpu }, null, 2));
    return;
  }
  printStatus(state, config, gpu);
}

async function dispatchToServer(cmd, payload, timeoutMs) {
  const { id } = sendModelCommand(cmd, payload);
  const ack = await waitForCommandAck(id, timeoutMs);
  if (!ack) return null;
  return ack.result;
}


async function cmdUnload(args) {
  const beforeGpu = await getGpuMemoryInfoAsync();
  const stateBefore = getServerSnapshot();
  const rssBefore = stateBefore ? await getProcessMemoryMB(stateBefore.serverPid) : null;

  if (!stateBefore) {
    const gpuAfter = await getGpuMemoryInfoAsync();
    console.log("\n  [MODELS] No running MCP server detected — nothing is holding models in memory.");
    if (gpuAfter) console.log(`  [OK] VRAM currently used: ${gpuAfter.usedMB} / ${gpuAfter.totalMB} MB`);
    console.log("");
    return;
  }

  console.log("\n  [MODELS] Sending unload request to the MCP server...");
  const result = await dispatchToServer("unload", { reason: "cli-request" }, ACK_WAIT_UNLOAD_MS);
  if (!result) {
    console.error("  [ERROR] MCP server did not acknowledge the unload request in time. Is it running an up-to-date plugin version?\n");
    process.exitCode = 1;
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 400));
  const rssAfter = await getProcessMemoryMB(stateBefore.serverPid);
  const gpuAfter = await getGpuMemoryInfoAsync();

  if (result.wasLoaded) {
    for (const m of result.unloaded) {
      console.log(`  [OK] Unloaded ${m.type} model "${m.model}" (was on ${m.device || "cpu"})`);
    }
  } else {
    console.log("  [*] Server had no models loaded — nothing to unload.");
  }

  console.log("\n  [MEMORY] Verification:");
  if (rssBefore !== null && rssAfter !== null) {
    const delta = rssBefore - rssAfter;
    console.log(`    Server RAM (RSS): ${rssBefore} MB -> ${rssAfter} MB${delta > 0 ? ` (freed ~${delta} MB)` : ""}`);
  }
  if (beforeGpu && gpuAfter) {
    const vramDelta = beforeGpu.usedMB - gpuAfter.usedMB;
    console.log(`    GPU VRAM used:    ${beforeGpu.usedMB} MB -> ${gpuAfter.usedMB} MB${vramDelta > 0 ? ` (freed ~${vramDelta} MB)` : ""}`);
  } else if (gpuAfter) {
    console.log(`    GPU VRAM used:    ${gpuAfter.usedMB} / ${gpuAfter.totalMB} MB`);
  }
  console.log("");
}

async function cmdLoad(args) {
  const device = normalizeDeviceArg(flagValue(args, "--device") || args[2]);
  const config = getConfig();

  if (device) {
    updateConfig({ executionDevice: device });
    console.log(`\n  [MODELS] Execution device set to ${device === "cpu" ? "CPU (RAM)" : "GPU (DirectML/WebGPU)"}.`);
  }

  if (!getServerSnapshot()) {
    console.log("  [*] MCP server is not running right now.");
    console.log(`  [OK] Preference saved: models will load on ${device ? (device === "cpu" ? "CPU/RAM" : "GPU/VRAM") : (config.executionDevice === "cpu" ? "CPU/RAM" : "GPU/VRAM")} on first use.\n`);
    return;
  }

  console.log("  [MODELS] Loading models inside the running MCP server (this can take a while on first download)...");
  const result = await dispatchToServer("load", { device: device || undefined }, ACK_WAIT_LOAD_MS);
  if (!result) {
    console.error("  [ERROR] MCP server did not acknowledge the load request in time.\n");
    process.exitCode = 1;
    return;
  }
  if (!result.ok) {
    console.error(`  [ERROR] Model load failed: ${result.error || "unknown error"}\n`);
    process.exitCode = 1;
    return;
  }
  const where = result.device === "cpu" ? "CPU (RAM)" : `${String(result.device).toUpperCase()} (GPU/VRAM)`;
  console.log(`  [OK] Embedding model loaded on ${where}.`);
  if (getConfig().rerankerEnabled) {
    console.log(result.rerankerLoaded
      ? `  [OK] Reranker model loaded on ${where}.`
      : "  [WARN] Reranker is enabled but failed to load (check logs).");
  }
  const gpu = await getGpuMemoryInfoAsync();
  if (gpu) console.log(`  [VRAM] GPU memory in use: ${gpu.usedMB} / ${gpu.totalMB} MB`);
  console.log("");
}

async function cmdDevice(args) {
  const device = normalizeDeviceArg(args[2] || flagValue(args, "--device"));
  if (!device) {
    console.error("  [ERROR] Usage: memory-cli models device cpu|gpu\n");
    process.exitCode = 1;
    return;
  }
  const previous = getConfig().executionDevice || "cpu";
  updateConfig({ executionDevice: device });
  const label = device === "cpu" ? "CPU (RAM)" : "GPU (DirectML/WebGPU)";
  console.log(`\n  [MODELS] Execution device: ${previous} -> ${device} (${label}).`);

  if (getServerSnapshot()) {
    const result = await dispatchToServer("apply-device", { device }, ACK_WAIT_UNLOAD_MS);
    if (result?.ok) {
      console.log(result.wasLoaded
        ? "  [OK] Server unloaded the old model instances; they will reload on the new device on next use."
        : "  [OK] Server had no loaded models; the new device applies on next use.");
    } else {
      console.log("  [WARN] Server did not confirm the switch; the new device still applies to future loads.");
    }
  } else {
    console.log("  [*] MCP server not running; the new device applies on next launch/use.");
  }
  console.log("");
}

async function cmdTimer(args) {
  const raw = args[2] || flagValue(args, "--minutes");
  if (raw === null || raw === undefined || raw === "") {
    console.error("  [ERROR] Usage: memory-cli models timer off|<minutes>   (e.g. \"timer 10\")\n");
    process.exitCode = 1;
    return;
  }
  let minutes = 0;
  if (!["off", "none", "0", "disable", "disabled"].includes(String(raw).toLowerCase())) {
    minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
      console.error(`  [ERROR] Invalid timer value "${raw}". Use "off" or minutes between 1 and 1440.\n`);
      process.exitCode = 1;
      return;
    }
    minutes = Math.round(minutes);
  }
  updateConfig({ modelUnloadTimeoutMinutes: minutes });
  console.log(minutes === 0
    ? "\n  [MODELS] Auto-unload timer disabled. Models stay loaded until manually unloaded.\n"
    : `\n  [MODELS] Auto-unload armed: models unload after ${minutes} min of inactivity (applies on next model use in the MCP server).\n`);
}

export async function handleModelCommands(args) {
  const sub = args[1] || "status";
  switch (sub) {
    case "status":
      await cmdStatus(args);
      return true;
    case "unload":
      await cmdUnload(args);
      return true;
    case "load":
    case "preload":
      await cmdLoad(args);
      return true;
    case "device":
      await cmdDevice(args);
      return true;
    case "timer":
    case "auto-unload":
      await cmdTimer(args);
      return true;
    case "--help":
    case "-h":
    case "help":
      console.log(`memory-cli models — ML model lifecycle control

Usage:
  memory-cli models status [--json]          Show where models live (CPU/RAM vs GPU/VRAM), VRAM usage, timer state
  memory-cli models unload                   Unload embedding + reranker from the running MCP server and report freed RAM/VRAM
  memory-cli models load [--device cpu|gpu]  Preload models into the running server (optionally switching device first)
  memory-cli models device cpu|gpu           Set execution device; loaded models reload on the new device
  memory-cli models timer off|<minutes>      Idle auto-unload timeout (0/off = never)`);
      return true;
    default:
      console.error(`  [ERROR] Unknown models command: ${sub}. Run "memory-cli models help".\n`);
      process.exitCode = 1;
      return true;
  }
}

