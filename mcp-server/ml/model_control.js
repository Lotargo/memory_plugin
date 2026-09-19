import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MEMORY_DIR, ensureDirSync } from "../memory.js";

// File-based control channel between short-lived CLI processes and the
// long-lived MCP server process. The CLI drops a command file; the server
// polls it, executes the model operation in its own address space (where the
// ONNX sessions actually live), and writes back an acknowledgement plus a
// runtime state snapshot that any process can read for status reporting.

export const CONTROL_DIR = path.join(MEMORY_DIR, "control");
const COMMAND_FILE = path.join(CONTROL_DIR, "model_command.json");
const ACK_FILE = path.join(CONTROL_DIR, "model_command_ack.json");
const STATE_FILE = path.join(CONTROL_DIR, "model_runtime_state.json");

function ensureControlDir() {
  ensureDirSync();
  if (!fs.existsSync(CONTROL_DIR)) {
    fs.mkdirSync(CONTROL_DIR, { recursive: true });
  }
}

function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp_${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function sendModelCommand(cmd, payload = {}) {
  ensureControlDir();
  const id = crypto.randomUUID();
  atomicWriteJson(COMMAND_FILE, { id, cmd, payload, sentAt: new Date().toISOString() });
  return { id, file: COMMAND_FILE };
}

export function pollModelCommand(lastHandledId = null) {
  const parsed = readJson(COMMAND_FILE);
  if (!parsed || !parsed.id || !parsed.cmd) return null;
  if (parsed.id === lastHandledId) return null;
  return parsed;
}

export function writeCommandAck(id, result) {
  try {
    ensureControlDir();
    atomicWriteJson(ACK_FILE, { id, result, handledAt: new Date().toISOString() });
  } catch {}
}

export function readCommandAck() {
  return readJson(ACK_FILE);
}

export async function waitForCommandAck(id, timeoutMs = 15000, pollMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ack = readCommandAck();
    if (ack && ack.id === id) return ack;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return null;
}

export function writeRuntimeState(state) {
  try {
    ensureControlDir();
    atomicWriteJson(STATE_FILE, { ...state, updatedAt: new Date().toISOString() });
  } catch {}
}

export function readRuntimeState() {
  return readJson(STATE_FILE);
}

export function isProcessAlive(pid) {
  if (!pid || typeof pid !== "number" || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return err && err.code === "EPERM";
  }
}
