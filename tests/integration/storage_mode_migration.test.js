import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";

const root = fs.mkdtempSync(path.join(tmpdir(), "memory-mode-migration-"));
const memoryDir = path.join(root, "memory");
process.env.MEMORY_DIR = memoryDir;
process.env.OPENCODE_CONFIG_DIR = path.join(root, "opencode");
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = "1";
process.env.MEMORY_DISABLE_PERSONA_SYNC = "1";
fs.mkdirSync(memoryDir);
const configPath = path.join(memoryDir, "config.json");
const original = JSON.stringify({ mode: "hybrid-sync", conflictStrategy: "merge", tursoUrl: "https://unreachable.invalid" });
fs.writeFileSync(configPath, original);

const { getConfig, updateConfig, saveConfig, STORAGE_MODES } = await import("../../mcp-server/config/config_manager.js");
const { getDatabase, closeDatabase } = await import("../../mcp-server/db/database.js");
const { readMemory, writeMemory } = await import("../../mcp-server/memory.js");
const { CloudSnapshots } = await import("../../mcp-server/admin/cloud_snapshots.js");
const client = createClient({ url: `file:${path.join(root, "legacy-cloud.sqlite")}` });
let api;
try {
  assert.deepEqual(STORAGE_MODES, ["only-local", "cloud-snapshots"]);
  assert.equal(getConfig().mode, "only-local");
  assert.equal(getConfig().legacyCloudBackupRequired, true);
  assert.equal(getConfig().conflictStrategy, undefined);
  assert.equal(fs.readFileSync(configPath, "utf8"), original, "loading leaves the old configuration recoverable");
  const db = await getDatabase();
  assert.equal(db.cloudClient, null, "legacy configuration never opens a cloud connection");
  db.localDb.exec("CREATE TABLE sync_queue(id INTEGER PRIMARY KEY, payload TEXT); INSERT INTO sync_queue VALUES (1, 'old pending change')");
  await writeMemory("global", ["- [2026-10-03 10:00] **Local fact** — local content <!-- id:local -->"]);
  assert.equal((await readMemory("global")).length, 1);
  assert.equal(db.localDb.prepare("SELECT count(*) n FROM sync_queue").get().n, 1, "local edits leave the old backlog untouched");
  assert.equal(db.cloudClient, null);
  const beforeRejectedWrite = fs.readFileSync(configPath, "utf8");
  assert.throws(() => updateConfig({ mode: "hybrid-sync" }), /removed.*snapshots enable/);
  assert.throws(() => saveConfig({ mode: "hybrid-sync" }), /removed/);
  await assert.rejects(getDatabase(path.join(root, "forbidden.sqlite"), "hybrid-sync"), /removed/);
  assert.equal(fs.existsSync(path.join(root, "forbidden.sqlite")), false);
  assert.equal(fs.readFileSync(configPath, "utf8"), beforeRejectedWrite);

  // Setup rejects a retired mode before authentication or client registration.
  for (const entry of ["mcp-server/boot.js", "mcp-server/index.js"]) {
    const result = spawnSync(process.execPath, [entry, "setup", "--mode", "hybrid-sync", "--codex"], {
      env: { ...process.env, TURSO_API_TOKEN: "" }, encoding: "utf8", timeout: 30_000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /hybrid-sync has been removed/);
    assert.equal(fs.readFileSync(configPath, "utf8"), beforeRejectedWrite);
  }
  updateConfig({ alpha: 0.7 });
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).legacyCloudBackupRequired, true, "unrelated settings preserve migration intent");

  api = new CloudSnapshots({ db, client: { execute: async () => { throw new Error("Cloud unavailable"); }, close() {} } });
  await assert.rejects(api.enable(), /Cloud unavailable/);
  assert.equal(getConfig().mode, "only-local");
  assert.equal(getConfig().legacyCloudBackupRequired, true);
  assert.ok(api.state().records.some(record => record.source === "migration-local" && record.pinned));
  await assert.rejects(api.upload(), /snapshots enable/);
  updateConfig({ mode: "cloud-snapshots", snapshotSyncMode: "scheduled" });
  assert.equal((await api.tick()).status, "disabled", "pending legacy backup blocks automatic upload too");
  updateConfig({ mode: "only-local" });

  await client.execute("CREATE TABLE notebooks(key TEXT PRIMARY KEY,content TEXT,updated_at INTEGER)");
  await client.execute({ sql: "INSERT INTO notebooks VALUES (?,?,?)", args: ["global", "# Global Memory\n\n- [2026-10-03 10:00] cloud-only fact\n", Date.now()] });
  api.close();
  api = new CloudSnapshots({ db, client });
  const result = await api.enable();
  assert.equal(getConfig().mode, "cloud-snapshots");
  assert.equal(getConfig().snapshotSyncMode, "manual");
  assert.equal(getConfig().legacyCloudBackupRequired, false);
  assert.ok(result.localBackupId && result.cloudBackupId);
  const local = await api.load(result.localBackupId, "local");
  const cloud = await api.load(result.cloudBackupId, "local");
  assert.match(local.payload.notebooks.find(n => n.file === "global.md").content, /local content/);
  assert.match(cloud.payload.notebooks.find(n => n.file === "global.md").content, /cloud-only fact/);
  assert.ok(local.record.pinned && cloud.record.pinned);
  assert.equal((await readMemory("global")).some(line => line.includes("cloud-only fact")), false);
  assert.deepEqual((await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(r => r.name), ["notebooks"], "transition never migrates or writes legacy cloud tables");
  assert.equal(db.localDb.prepare("SELECT count(*) n FROM sync_queue").get().n, 1);
  console.log("PASS: Retired mode is offline; rejected setup, failed migration and separate pinned backups preserve both copies.");
} finally {
  api?.close(); client.close(); closeDatabase();
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch (error) { if (!["EPERM", "EBUSY"].includes(error.code)) throw error; }
}
