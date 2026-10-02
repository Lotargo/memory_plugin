import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";
import JSZip from "jszip";

const temp = fs.mkdtempSync(path.join(tmpdir(), "memory-full-snapshots-"));
process.env.MEMORY_DIR = path.join(temp, "memory");
process.env.OPENCODE_CONFIG_DIR = path.join(temp, "opencode");
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = "1";
process.env.MEMORY_DISABLE_PERSONA_SYNC = "1";
const { getDatabase, closeDatabase, BLOBS_DIR } = await import("../../mcp-server/db/database.js");
const { updateConfig, getConfig } = await import("../../mcp-server/config/config_manager.js");
const { writeMemory, MEMORY_DIR } = await import("../../mcp-server/memory.js");
const { rememberNote } = await import("../../mcp-server/tools/core/note_core.js");
const { CloudSnapshots, isSnapshotQuotaError } = await import("../../mcp-server/admin/cloud_snapshots.js");
const { captureLocal, stateHash, packPayload, unpackPayload, sha256 } = await import("../../mcp-server/admin/full_snapshot.js");
const { olderThan, snapshotDate } = await import("../../mcp-server/cli/snapshot_commands.js");
const { registerSnapshotTools } = await import("../../mcp-server/tools/snapshot_tools.js");
const client = createClient({ url: `file:${path.join(temp, "cloud.sqlite")}` });
const calls = []; let failure = null;
const spy = {
  execute: async request => {
    const sql = typeof request === "string" ? request : request.sql;
    calls.push({ sql, args: request.args });
    if (failure && sql.startsWith("INSERT INTO memory_snapshots")) throw failure;
    return client.execute(request);
  },
  transaction: mode => client.transaction(mode), close() {},
};
let clock = 1_800_000_000_000;
let settings = { ...getConfig(), mode: "cloud-snapshots" };
let api;
try {
  updateConfig({ mode: "cloud-snapshots" });
  const db = await getDatabase();
  db.localDb.exec("PRAGMA foreign_keys=ON");
  api = new CloudSnapshots({ db, client: spy, now: () => clock, config: () => settings,
    saveConfig: partial => { settings = { ...settings, ...partial }; return settings; } });
  await writeMemory("global", ["- [rule] Simple to complex", `- [fixture] ${"repeat text ".repeat(5000)}`]);
  await writeMemory("git:example.com/project-one", ["- [a] durable project fact"]);
  await writeMemory("git:example.com/project-two", ["- [b] second project"]);
  const note = await rememberNote({ title: "Snapshot source", content: "Useful source material for restoration. ".repeat(12), scope: "global", generateEmbeddings: false });
  const doc = db.localDb.prepare("SELECT * FROM documents").get();
  assert.ok(doc, JSON.stringify(note));
  const section = db.localDb.prepare("SELECT * FROM sections").get();
  const chunk = db.localDb.prepare("SELECT * FROM micro_chunks").get();
  db.localDb.prepare("UPDATE micro_chunks SET vector=? WHERE id=?").run(Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer), chunk.id);
  db.localDb.prepare("INSERT INTO project_identities VALUES (?,?,?,?,?)").run("git:example.com/project-one", "one", "example.com/project-one", clock, clock);
  db.localDb.prepare("INSERT INTO project_aliases VALUES (?,?,?,?)").run("path:F:/one", "git:example.com/project-one", "path", clock);
  db.localDb.prepare("INSERT INTO document_scopes VALUES (?,?,?)").run(doc.id, "git:example.com/project-one", clock);
  db.localDb.prepare("INSERT INTO knowledge_links VALUES (?,?,?,?,?,?,?,?,?,?)").run("link", "git:example.com/project-one", "durable project fact", doc.id, section.id, 1, 2, "SUPPORTS", null, clock);
  db.localDb.prepare("INSERT INTO graph_edges VALUES (?,?,?,?,?)").run(doc.id, "fact:a", "SUPPORTS", "{}", clock);
  db.localDb.prepare("INSERT INTO rag_document_tombstones VALUES (?,?,?)").run("old-deleted", "old:path", clock);

  const original = captureLocal(db, MEMORY_DIR, BLOBS_DIR, settings);
  const sent = await api.upload();
  assert.equal(sent.status, "uploaded");
  assert.equal(calls.filter(c => c.sql.startsWith("INSERT INTO memory_snapshots")).length, 1);
  assert.equal((await client.execute("SELECT count(*) n FROM memory_snapshots")).rows[0].n, 1);
  assert.ok(sent.snapshot.size < Buffer.byteLength(JSON.stringify(original)) / 4, "fixture is compressed using DEFLATE");
  const beforeSkip = calls.length;
  clock += 1000; assert.equal((await api.upload()).status, "unchanged");
  assert.equal(calls.length, beforeSkip, "unchanged state has zero cloud calls");
  const loaded = await api.load(sent.snapshot.id, "cloud");
  assert.equal(stateHash(loaded.payload), stateHash(original));
  assert.ok(calls.at(-1).sql.includes("WHERE id=?"), "fetch selected archive via PK");
  calls.length = 0;
  await api.list({ location: "cloud" });
  assert.equal(calls.length, 1); assert.ok(!calls[0].sql.includes("payload_zip"), "metadata list never reads BLOB");
  assert.deepEqual((await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(r => r.name), ["memory_snapshots"], "snapshot mode does not create legacy cloud tables");

  await writeMemory("global", ["- [new] changed"]);
  await writeMemory("git:extra", ["- [extra] must be removed"]);
  await rememberNote({ title: "Extra document", content: "Do not retain this when restoring the old complete state.", scope: "global", generateEmbeddings: false });
  let preview = await api.restore({ id: sent.snapshot.id, location: "cloud" });
  assert.equal(preview.status, "preview");
  assert.equal(db.localDb.prepare("SELECT count(*) n FROM documents").get().n, 2, "preview is read only");
  await writeMemory("global", ["- [new] changed after preview"]);
  await assert.rejects(api.restore({ id: sent.snapshot.id, location: "cloud", confirmToken: preview.confirmToken }), /stale/);
  preview = await api.restore({ id: sent.snapshot.id, location: "cloud" });
  db.localDb.exec("CREATE TABLE sync_queue(id INTEGER PRIMARY KEY, task_type TEXT); INSERT INTO sync_queue(task_type) VALUES ('delete_document')");
  const restored = await api.restore({ id: sent.snapshot.id, location: "cloud", confirmToken: preview.confirmToken });
  assert.equal(restored.status, "restored");
  assert.equal(stateHash(captureLocal(db, MEMORY_DIR, BLOBS_DIR, settings)), stateHash(original), "exact Notebook, RAG, vectors, scopes, links and identities round-trip");
  assert.equal(db.localDb.prepare("SELECT count(*) n FROM sync_queue").get().n, 0);
  assert.equal(db.localDb.prepare("SELECT count(*) n FROM micro_chunks_fts WHERE micro_chunks_fts MATCH 'restoration'").get().n > 0, true);
  assert.equal(api.state().records.find(r => r.id === restored.backupId).pinned, 1);
  const resent = await api.upload(); assert.notEqual(resent.snapshot.id, sent.snapshot.id, "restore creates a new checkpoint");

  failure = Object.assign(new Error("HTTP 429 rate limit"), { status: 429 });
  await writeMemory("global", ["- [quota] first pending version"]); clock += 1000;
  calls.length = 0;
  const failed = await api.upload(); assert.equal(failed.status, "local-only");
  assert.equal(calls.length, 1, "quota failure is attempted once");
  assert.equal(api.state().pendingId, failed.snapshot.id);
  await writeMemory("global", ["- [quota] most current pending version"]); clock += 1000;
  const latest = await api.upload({ automatic: true });
  assert.equal(calls.length, 1, "quota suspension does not hit cloud");
  assert.notEqual(latest.snapshot.id, failed.snapshot.id);
  assert.equal(api.state().pendingId, latest.snapshot.id, "pending is replaced, not queued");
  failure = null;
  assert.equal((await api.upload()).status, "uploaded");
  assert.equal((await client.execute({ sql: "SELECT count(*) n FROM memory_snapshots WHERE id=?", args: [failed.snapshot.id] })).rows[0].n, 0, "old failed archive is never sent later");
  assert.equal(api.state().pendingId, null);

  await api.configure({ syncMode: "scheduled", intervalHours: 0.5 });
  assert.equal((await api.tick()).status, "not-due");
  clock += 10 * 3600_000;
  await writeMemory("global", ["- [schedule] after downtime"]);
  calls.length = 0; assert.equal((await api.tick()).status, "uploaded");
  assert.equal(calls.length, 1, "missed intervals send exactly once");
  assert.equal((await api.tick()).status, "not-due");
  assert.equal(api.state().nextDueAt, clock + 0.5 * 3600_000);
  await api.configure({ syncMode: "scheduled", intervalHours: 168 });
  const restarted = new CloudSnapshots({ db, client: spy, now: () => clock, config: () => settings, saveConfig: p => { settings = { ...settings, ...p }; } });
  assert.equal((await restarted.tick()).status, "not-due", "deadline persists across instances");
  await assert.rejects(api.configure({ syncMode: "scheduled", intervalHours: 0 }), /positive/);
  await assert.rejects(api.configure({ syncMode: "scheduled", intervalHours: Infinity }), /positive/);

  await writeMemory("global", ["- [network] changes"]);
  failure = Object.assign(new Error("network unavailable"), { code: "ECONNRESET" });
  clock += 168 * 3600_000; const network = await api.tick();
  assert.equal(network.status, "local-only"); assert.equal(api.state().quotaBlocked, false);
  const attempts = calls.length;
  await api.upload({ automatic: true }); assert.equal(calls.length, attempts, "network backoff does not spin");
  failure = Object.assign(new Error("monthly quota exhausted"), { code: "BLOCKED" });
  await api.upload(); assert.equal(api.state().quotaBlocked, true);
  failure = null; await api.upload();
  await api.configure({ syncMode: "off" });
  assert.equal((await api.tick()).status, "disabled");

  await api.pin({ id: sent.snapshot.id, location: "cloud" });
  calls.length = 0;
  const deletion = await api.prune({ location: "both", from: 0, to: clock + 1 });
  assert.ok(deletion.cloud.count >= 1); assert.ok(deletion.local.count >= 1);
  assert.ok(calls.every(c => !c.sql.includes("payload_zip")), "pruning previews metadata only");
  const removed = await api.prune({ location: "both", from: 0, to: clock + 1, confirmToken: deletion.confirmToken });
  assert.equal(removed.status, "deleted");
  assert.equal(calls.filter(c => c.sql.startsWith("DELETE FROM memory_snapshots")).length, 1, "whole cloud period is one DELETE");
  assert.ok((await api.list({ location: "cloud" })).some(r => r.id === sent.snapshot.id), "pinned checkpoint protected");
  assert.ok(api.state().records.some(r => r.id === restored.backupId), "local pre-restore backup protected");
  const override = await api.prune({ location: "both", from: 0, to: clock + 1, includeProtected: true });
  await api.pin({ id: sent.snapshot.id, location: "cloud", pinned: false });
  await assert.rejects(api.prune({ location: "both", from: 0, to: clock + 1, includeProtected: true, confirmToken: override.confirmToken }), /stale/);

  const validBytes = await packPayload(original);
  await assert.rejects(unpackPayload(Buffer.from("corrupt"), sha256(validBytes), stateHash(original)), /checksum/);
  await assert.rejects(unpackPayload(validBytes, sha256(validBytes), stateHash(original), 100), /safety limit/);
  const invalid = structuredClone(original); invalid.notebooks[0].file = "../escape.md";
  await assert.rejects(packPayload(invalid), /Notebook/);
  const extraZip = new JSZip(); extraZip.file("memory.json", JSON.stringify(original)); extraZip.file("bad.txt", "extra");
  const extraBytes = await extraZip.generateAsync({ type: "nodebuffer" });
  await assert.rejects(unpackPayload(extraBytes, sha256(extraBytes), stateHash(original)), /Unexpected/);
  const broken = structuredClone(original); broken.tables.sections[0].doc_id = "missing";
  const state = api.state(); const brokenRecord = await api.store(broken, state, { force: true });
  const beforeBroken = stateHash(await api.capture());
  const brokenPreview = await api.restore({ id: brokenRecord.id });
  await assert.rejects(api.restore({ id: brokenRecord.id, confirmToken: brokenPreview.confirmToken }), /FOREIGN KEY|relational/);
  await api.recover(); assert.equal(stateHash(await api.capture()), beforeBroken, "failed restore keeps original state");

  // Recover a crash between filesystem mutation and SQLite commit.
  const recoveryState = api.state();
  const recoveryBackup = await api.store(await api.capture(), recoveryState, { force: true, pinned: true });
  recoveryState.restoreJournal = { backupId: recoveryBackup.id, marker: "uncommitted", settings: original.settings }; api.save(recoveryState);
  fs.writeFileSync(path.join(MEMORY_DIR, "global.md"), "partially restored");
  await api.recover(); assert.equal(stateHash(await api.capture()), beforeBroken);

  assert.equal(new Date(olderThan("1m", Date.parse("2026-03-31T12:00:00Z"))).toISOString(), "2026-02-28T12:00:00.000Z");
  assert.equal(new Date(olderThan("1y", Date.parse("2024-02-29T12:00:00Z"))).toISOString(), "2023-02-28T12:00:00.000Z");
  assert.throws(() => olderThan("0d"));
  assert.equal(snapshotDate("2026-10-03T12:30:00"), Date.parse("2026-10-03T12:30:00Z"), "zone-free ISO timestamps always use UTC");
  assert.equal(snapshotDate("2026-10-03T12:30:00+09:00"), Date.parse("2026-10-03T03:30:00Z"));
  assert.equal(snapshotDate("2026-10-03"), Date.parse("2026-10-03T00:00:00Z"));
  for (const invalidDate of ["2026-02-30", "2026-10-03T24:00:00", "10/03/2026", undefined]) assert.throws(() => snapshotDate(invalidDate), /Invalid/);
  const catalogBeforeBadCli = fs.readFileSync(api.stateFile, "utf8");
  for (const entry of ["mcp-server/index.js", "mcp-server/boot.js", "mcp-server/cli_boot.js"]) {
    for (const badArgs of [
      ["delete", "--form", "2026-01-01", "--to", "2027-01-01", "--yes"],
      ["delete", "--to", "2027-01-01", "--yes"],
      ["delete", "--older-than", "1d", "--location", "local", "--location", "cloud", "--yes"],
      ["delete", "--older-than", "1d", "extra", "--yes"],
      ["delete", "--older-than", "1d", "uninstall", "--yes"],
      ["delete", "--older-than", "1d", "setup", "--yes"],
      ["delete", "--older-than", "1d", "--version", "--yes"],
      ["delete", "--older-than", "1d", "--yes", "--confirm", "token"],
    ]) {
      const result = spawnSync(process.execPath, [entry, "snapshots", ...badArgs], { env: process.env, encoding: "utf8", timeout: 30_000 });
      assert.equal(result.status, 1, `${entry}: ${badArgs.join(" ")} must report failure`);
      assert.match(result.stderr, /Snapshots:/);
      assert.equal(fs.readFileSync(api.stateFile, "utf8"), catalogBeforeBadCli, "invalid CLI arguments leave snapshot history intact");
    }
    const help = execFileSync(process.execPath, [entry, "snapshots", "--help"], { env: process.env, encoding: "utf8", timeout: 30_000 });
    assert.ok(help.includes("Snapshot commands (all projects"));
  }
  assert.equal(isSnapshotQuotaError({ code: "SERVER_ERROR", message: "Server returned HTTP status 429" }), true);
  assert.equal(isSnapshotQuotaError({ cause: { statusCode: 402 } }), true);
  assert.equal(isSnapshotQuotaError({ cause: { code: "BLOCKED" } }), true);
  assert.equal(isSnapshotQuotaError({ code: "ECONNRESET" }), false);
  let registration;
  registerSnapshotTools({ registerTool: (name, def, handler) => { registration = { name, def, handler }; } });
  assert.equal(registration.name, "manage_snapshots");
  assert.equal(registration.def.inputSchema.safeParse({ action: "configure", intervalHours: "24" }).success, false);
  assert.equal(registration.def.inputSchema.safeParse({ action: "delete", includeProtected: "false" }).success, false);
  const cli = execFileSync(process.execPath, ["mcp-server/index.js", "snapshots", "list"], { cwd: path.resolve("."), env: process.env, encoding: "utf8", timeout: 30_000 });
  assert.ok(cli.includes("state_hash"), "CLI routes snapshots instead of starting stdio server");
  const { default: pluginV2, MemoryPlugin } = await import("../../opencode-plugin/main.js");
  const nativeTools = new Map();
  await pluginV2.setup({ location: { directory: temp }, session: { hook() {} }, tool: { transform: fn => fn({ add: def => nativeTools.set(def.name, def) }) } });
  assert.ok(nativeTools.has("manage_snapshots"));
  const native = JSON.parse((await nativeTools.get("manage_snapshots").execute({ action: "list" })).content);
  assert.ok(Array.isArray(native));
  const pluginV1 = await MemoryPlugin({ directory: temp, worktree: temp, client: {} });
  assert.ok(pluginV1.tool.manage_snapshots);
  assert.ok(Array.isArray(JSON.parse(await pluginV1.tool.manage_snapshots.execute({ action: "list" }))));

  // Legacy migration retains both copies, uses a read-only cloud transaction,
  // and never merges a remote-only fact into local authoritative memory.
  const tx = await client.transaction("write");
  await tx.execute("CREATE TABLE notebooks(key TEXT PRIMARY KEY, content TEXT, updated_at INTEGER)");
  await tx.execute({ sql: "INSERT INTO notebooks VALUES (?,?,?)", args: ["global", "# Global Memory\n\n- [legacy] cloud-only fact\n", clock] });
  await tx.commit(); tx.close();
  settings.mode = "hybrid-sync";
  const migrated = await api.enable();
  assert.equal(settings.mode, "cloud-snapshots");
  assert.ok(migrated.cloudBackupId);
  const legacy = await api.load(migrated.cloudBackupId);
  assert.ok(legacy.payload.notebooks[0].content.includes("cloud-only fact"));
  assert.equal(stateHash(await api.capture()), beforeBroken, "migration never merges cloud into local");
  assert.equal((await client.execute("SELECT count(*) n FROM notebooks")).rows[0].n, 1, "legacy cloud remains intact");
  console.log("Cloud ZIP snapshots: round-trip, quotas, scheduling, restore, migration, period cleanup and CLI PASS");
} finally {
  api?.close(); client.close(); closeDatabase();
  try { fs.rmSync(temp, { recursive: true, force: true }); }
  catch (error) {
    if (process.platform !== "win32" || error.code !== "EPERM") throw error;
    // The unified runner removes the entire isolated suite directory after
    // this process exits and libSQL releases its Windows native handles.
    console.warn("Deferred native libSQL temp cleanup until process exit:", temp);
  }
}
