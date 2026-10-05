import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MEMORY_DIR, ensureDirSync } from "../memory.js";
import { atomicWrite } from '../storage/snapshot_lock.js';

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
  atomicWrite(filePath,JSON.stringify(data,null,2),{renameRetries:30});
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function sendModelCommand(cmd, payload = {}, { targetPid, expiresAt } = {}) {
  ensureControlDir();
  const id = crypto.randomUUID();
  const file = targetPid ? path.join(CONTROL_DIR, `command_${targetPid}.json`) : COMMAND_FILE;
  atomicWriteJson(file, { id, cmd, payload, targetPid, expiresAt, sentAt: new Date().toISOString() });
  return { id, file };
}

export function pollModelCommand(lastHandledId = null) {
  for (const file of [path.join(CONTROL_DIR, `command_${process.pid}.json`), COMMAND_FILE]) {
    const parsed = readJson(file);
    if (!parsed || !parsed.id || !parsed.cmd) continue;
    if (lastHandledId instanceof Set ? lastHandledId.has(parsed.id) : parsed.id === lastHandledId) continue;
    if (parsed.targetPid && parsed.targetPid !== process.pid || parsed.expiresAt && parsed.expiresAt < Date.now()) continue;
    return parsed;
  }
  return null;
}

export function writeCommandAck(id, result) {
  try {
    ensureControlDir();
    const ack = { id, result, serverPid: process.pid, handledAt: new Date().toISOString() };
    atomicWriteJson(path.join(CONTROL_DIR, `ack_${id}.json`), ack);
    atomicWriteJson(ACK_FILE, ack);
  } catch {}
}

export function readCommandAck(id = null) {
  return id ? readJson(path.join(CONTROL_DIR, `ack_${id}.json`)) || readJson(ACK_FILE) : readJson(ACK_FILE);
}

export async function waitForCommandAck(id, timeoutMs = 15000, pollMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ack = readCommandAck(id);
    if (ack && ack.id === id) return ack;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return null;
}

export function writeRuntimeState(state) {
  try {
    ensureControlDir();
    const snapshot = { ...state, updatedAt: new Date().toISOString() };
    if (state.controlProtocol === 2) atomicWriteJson(path.join(CONTROL_DIR, `runtime_${state.serverPid}.json`), snapshot);
    atomicWriteJson(STATE_FILE, snapshot);
  } catch {}
}

export function readRuntimeState() {
  return readJson(STATE_FILE);
}

// Includes the legacy single-owner receipt without claiming that it covers
// every process that might have loaded an ONNX session.
export function readRuntimeStates() {
  const states = new Map();
  for (const name of fs.existsSync(CONTROL_DIR) ? fs.readdirSync(CONTROL_DIR) : []) {
    if (!/^runtime_\d+\.json$/.test(name)) continue;
    const state = readJson(path.join(CONTROL_DIR, name));
    if (state && isProcessAlive(state.serverPid)) states.set(state.serverPid, state);
  }
  const legacy = readRuntimeState();
  if (legacy && isProcessAlive(legacy.serverPid) && !states.has(legacy.serverPid)) states.set(legacy.serverPid, legacy);
  return [...states.values()];
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
