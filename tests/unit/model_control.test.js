import assert from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "memory-model-control-"));
process.env.MEMORY_DIR = root;

const {
  sendModelCommand,
  pollModelCommand,
  writeCommandAck,
  waitForCommandAck,
  writeRuntimeState,
  readRuntimeState,
  isProcessAlive,
} = await import("../../mcp-server/ml/model_control.js");

const { updateConfig, getConfig } = await import("../../mcp-server/config/config_manager.js");

export async function runModelControlTests() {
  console.log("--- Running Unit Tests: model_control ---");

  try {
    // 1. Config default: idle auto-unload disabled, CPU is the default device.
    const cfg = getConfig();
    assert.strictEqual(cfg.modelUnloadTimeoutMinutes, 0, "auto-unload defaults to OFF");
    assert.strictEqual(cfg.executionDevice, "cpu", "execution device defaults to cpu");

    // 2. Command channel round-trip: send -> poll once -> ack -> wait.
    const { id } = sendModelCommand("unload", { reason: "test" });
    const first = pollModelCommand(null);
    assert.ok(first, "polled command exists");
    assert.strictEqual(first.id, id);
    assert.strictEqual(first.cmd, "unload");
    assert.strictEqual(first.payload.reason, "test");
    assert.strictEqual(pollModelCommand(id), null, "same command id is not re-delivered");

    writeCommandAck(id, { ok: true, wasLoaded: false });
    const ack = await waitForCommandAck(id, 2000, 50);
    assert.ok(ack, "ack received");
    assert.strictEqual(ack.result.ok, true);

    // 3. Runtime state round-trip + liveness check.
    writeRuntimeState({
      serverPid: process.pid,
      embedding: { loaded: false, loadedModel: null, device: null },
      reranker: { loaded: false, loadedModel: null, device: null },
    });
    const state = readRuntimeState();
    assert.strictEqual(state.serverPid, process.pid);
    assert.ok(state.updatedAt, "state carries updatedAt timestamp");
    assert.strictEqual(isProcessAlive(process.pid), true, "own pid is alive");
    assert.strictEqual(isProcessAlive(null), false, "null pid is not alive");

    // 4. Device resolution honours platform mapping and persists config.
    const { resolveTargetDevice, getModelRuntimeStatus } = await import("../../mcp-server/ml/model_manager.js");
    assert.strictEqual(resolveTargetDevice("cpu"), "cpu");
    assert.strictEqual(resolveTargetDevice("nonsense"), "cpu");
    const gpuResolved = resolveTargetDevice("webgpu");
    if (process.platform === "win32") assert.strictEqual(gpuResolved, "dml");
    else if (process.platform === "linux") assert.strictEqual(gpuResolved, "cuda");
    else assert.strictEqual(gpuResolved, "webgpu");

    updateConfig({ modelUnloadTimeoutMinutes: 10 });
    assert.strictEqual(getConfig().modelUnloadTimeoutMinutes, 10, "timer persists to config");
    updateConfig({ modelUnloadTimeoutMinutes: 0 });

    // 5. Runtime status shape used by `memory-cli models status`.
    const status = getModelRuntimeStatus();
    assert.strictEqual(status.configuredDevice, "cpu");
    assert.strictEqual(status.embedding.loaded, false);
    assert.strictEqual(status.reranker.loaded, false);
    assert.strictEqual(status.unloadTimeoutMinutes, 0);
    assert.strictEqual(status.serverPid, process.pid);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }

  console.log("✅ MODEL CONTROL CHANNEL TESTS PASSED!");
}

if (process.argv[1] && process.argv[1].endsWith("model_control.test.js")) {
  runModelControlTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
