import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "memory-web-command-"));
const cwd = fileURLToPath(new URL("../../", import.meta.url));
process.env.MEMORY_DIR = join(root, "memory");
process.env.OPENCODE_CONFIG_DIR = join(root, "opencode");
process.env.MEMORY_DISABLE_PERSONA_SYNC = "1";
const { parseWebCommand, parseWebPort } = await import("../../mcp-server/dashboard/options.js");
const { getConfig, updateConfig } = await import("../../mcp-server/config/config_manager.js");
const { startDashboard, runDashboard } = await import("../../mcp-server/dashboard/server.js");
const children = new Set();
const run = (entry, args) => spawnSync(process.execPath, [entry, ...args], { cwd, env: process.env, encoding: "utf8", timeout: 15000 });

async function launch(entry, args) {
  const child = spawn(process.execPath, [entry, ...args], { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  children.add(child);
  let output = "", errors = "";
  child.stderr.on("data", bytes => { errors += bytes; });
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Web did not start: ${errors}`)), 15000);
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.on("exit", code => { clearTimeout(timeout); reject(new Error(`Web exited ${code}: ${errors}`)); });
    child.stdout.on("data", bytes => {
      output += bytes;
      const match = /http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]{64})/.exec(output);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
  });
  const origin = new URL(url).origin;
  const response = await fetch(origin + "/api/overview", { headers: { Authorization: `Bearer ${new URL(url).hash.slice(1)}` } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mode, "cloud-snapshots");
  return { child, origin };
}

async function stop(child) {
  if (child.exitCode === null && child.signalCode === null) {
    const ended = new Promise(resolve => child.once("exit", resolve));
    child.kill();
    await ended;
  }
  children.delete(child);
}

let occupied;
try {
  assert.deepEqual(parseWebCommand([]), { action: "start" });
  for (const value of ["0", "1", "65535"]) assert.equal(parseWebPort(value), Number(value));
  for (const value of ["-1", "65536", "1.5", "", "Infinity", "9007199254740993", "0x100", "12abc"]) assert.throws(() => parseWebPort(value));
  for (const args of [["--port"], ["--port", "0", "--port", "1"], ["--port", "uninstall"], ["port", "123", "--yes"], ["setup"], ["--help", "uninstall"], ["--version"], ["--unknown"]]) assert.throws(() => parseWebCommand(args));
  for (const entry of ["mcp-server/boot.js", "mcp-server/cli_boot.js", "mcp-server/index.js", "mcp-server/cli.js"]) {
    for (const name of ["web", "dashboard"]) {
      const help = run(entry, [name, "--help"]);
      assert.equal(help.status, 0, help.stderr);
      assert.match(help.stdout, /memory-plugin web/);
      const bad = run(entry, [name, "--port", "uninstall"]);
      assert.equal(bad.status, 1, bad.stderr);
      assert.match(bad.stderr, /Web port/);
    }
  }
  assert.ok(!existsSync(join(process.env.MEMORY_DIR, "config.json")), "help and invalid arguments do not initialize storage");
  assert.equal(getConfig().webPort, 0);
  assert.equal(run("mcp-server/cli_boot.js", ["web", "port", "0"]).status, 0);
  assert.match(run("mcp-server/boot.js", ["web", "port"]).stdout, /Web port: 0 \(automatic\)/);
  const configFile = join(process.env.MEMORY_DIR, "config.json");
  const beforeInvalid = readFileSync(configFile, "utf8");
  assert.throws(() => updateConfig({ webPort: 65536 }));
  assert.equal(run("mcp-server/cli_boot.js", ["web", "port", "-1"]).status, 1);
  assert.equal(readFileSync(configFile, "utf8"), beforeInvalid);

  updateConfig({ mode: "cloud-snapshots", snapshotSyncMode: "scheduled", snapshotIntervalHours: 24,
    tursoUrl: "http://127.0.0.1:1", authorized: true });
  occupied = await startDashboard();
  const port = new URL(occupied.origin).port;
  const saved = run("mcp-server/cli_boot.js", ["web", "port", port]);
  assert.equal(saved.status, 0, saved.stderr);
  const savedConfig = readFileSync(configFile, "utf8");
  for (const entry of ["mcp-server/boot.js", "mcp-server/cli_boot.js"]) {
    const busy = run(entry, ["web", "--foreground"]);
    assert.equal(busy.status, 1, busy.stderr);
    assert.match(busy.stderr, /already in use.*--port 0/);
    assert.ok(!busy.stderr.includes(" at "), "address conflict is reported without a stack trace");
    assert.equal(readFileSync(configFile, "utf8"), savedConfig);
  }
  const automatic = await launch("mcp-server/boot.js", ["web", "--port", "0"]);
  assert.notEqual(automatic.origin, occupied.origin);
  assert.equal(readFileSync(configFile, "utf8"), savedConfig, "one-run override does not persist");
  await stop(automatic.child);
  await occupied.close(); occupied = null;
  for (const [entry, name] of [["mcp-server/boot.js", "web"], ["mcp-server/cli_boot.js", "web"], ["mcp-server/boot.js", "dashboard"]]) {
    const app = await launch(entry, [name, "--foreground"]);
    assert.equal(new URL(app.origin).port, port, "saved port applies to all launchers");
    await stop(app.child);
  }
  // Configured schedules now run in the panel too. No cloud attempt is due.
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  assert.equal(pkg.bin["memory-plugin"], "mcp-server/boot.js");

  // Exercise graceful signal cleanup without relying on Windows child.kill(),
  // which terminates a process instead of delivering a catchable SIGTERM.
  updateConfig({ webPort: 0 });
  const sigint = process.listenerCount("SIGINT"), sigterm = process.listenerCount("SIGTERM");
  const originalLog = console.log;
  let url;
  console.log = message => { url = /http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]{64})/.exec(message)?.[0]; };
  try {
    const running = runDashboard();
    while (!url) await new Promise(resolve => setTimeout(resolve, 10));
    process.emit("SIGINT");
    await running;
    const schedule = JSON.parse(readFileSync(join(process.env.MEMORY_DIR, "storage", "snapshots", "state.json"), "utf8"));
    assert.ok(schedule.nextDueAt > Date.now(), "foreground panel initializes the explicitly configured schedule");
    assert.equal(schedule.lastUploadedId, null, "opening a panel does not upload before its configured deadline");
    assert.equal(process.listenerCount("SIGINT"), sigint);
    assert.equal(process.listenerCount("SIGTERM"), sigterm);
    const reused = await startDashboard({ port: Number(new URL(url).port) });
    await reused.close();
  } finally { console.log = originalLog; }
  console.log("PASS web commands: aliases, strict routing, ports, local launch, explicit scheduling without early upload and graceful shutdown.");
} finally {
  for (const child of children) await stop(child);
  if (occupied) await occupied.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
