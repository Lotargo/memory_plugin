import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";

const root = fs.mkdtempSync(path.join(tmpdir(), "only-cloud-migration-"));
const memoryDir = path.join(root, "memory");
const remoteDir = path.join(root, "old-cloud-source");
const remoteBlobs = path.join(root, "old-cloud-blobs");
fs.mkdirSync(memoryDir); fs.mkdirSync(remoteDir);
process.env.MEMORY_DIR = memoryDir;
process.env.OPENCODE_CONFIG_DIR = path.join(root, "opencode");
// Setup's marketplace guard must inspect this fixture, not the user's plugin.
process.env.CODEX_HOME = path.join(root, 'codex');
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = "1";
process.env.MEMORY_DISABLE_PERSONA_SYNC = "1";
const configPath = path.join(memoryDir, "config.json");
const original = JSON.stringify({ mode: "only-cloud", tursoUrl: "https://unreachable.invalid", failoverUrl: "https://unused.invalid" });
fs.writeFileSync(configPath, original);
const { getConfig, updateConfig, resetConfig } = await import("../../mcp-server/config/config_manager.js");
const { getDatabase, getMigrationDatabase, closeDatabase, BLOBS_DIR } = await import("../../mcp-server/db/database.js");
const { readMemory, writeMemory, listProjectStores, buildMemoryContent, slugify } = await import("../../mcp-server/memory.js");
const { ingestNote } = await import("../../mcp-server/ingest/pipeline.js");
const { readBlob } = await import("../../mcp-server/storage/blob_store.js");
const { readKnowledgeDocument } = await import("../../mcp-server/tools/core/knowledge_read_core.js");
const { captureLocal, stateHash } = await import("../../mcp-server/admin/full_snapshot.js");
const { CloudSnapshots } = await import("../../mcp-server/admin/cloud_snapshots.js");
const { getQuickStats } = await import("../../mcp-server/cli/quick_stats.js");
const { notebookOverview } = await import("../../mcp-server/services/notebook_service.js");
let local, api, client;
try {
  assert.equal(getConfig().mode, "only-local");
  assert.equal(getConfig().legacyCloudRestoreRequired, true);
  assert.equal(getConfig().failoverUrl, undefined);
  assert.equal(fs.readFileSync(configPath, "utf8"), original);
  await assert.rejects(getDatabase(), { code: "MIGRATION_REQUIRED" });
  await assert.rejects(readMemory("global"), { code: "MIGRATION_REQUIRED" });
  await assert.rejects(writeMemory("global", ["- [test] cache is incomplete"]), { code: "MIGRATION_REQUIRED" });
  await assert.rejects(listProjectStores(), { code: "MIGRATION_REQUIRED" });
  assert.equal((await getQuickStats()).factCount, null, "incomplete cache is not reported as empty memory");
  assert.match((await notebookOverview()).unavailable, /requires migration/);
  assert.throws(() => updateConfig({ mode: "only-cloud" }), /removed/);
  await assert.rejects(getDatabase(path.join(root, "forbidden.sqlite"), "only-cloud"), /removed/);
  assert.equal(fs.existsSync(path.join(root, "forbidden.sqlite")), false);
  for (const entry of ["mcp-server/boot.js", "mcp-server/index.js"]) {
    const result = spawnSync(process.execPath, [entry, "setup", "--mode", "only-cloud", "--codex"], {
      env: { ...process.env, TURSO_API_TOKEN: "" }, encoding: "utf8", timeout: 30_000,
    });
    assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /only-cloud has been removed/);
    assert.equal(fs.readFileSync(configPath, "utf8"), original);
  }
  resetConfig();
  assert.equal(getConfig().legacyCloudRestoreRequired, true, "resetting settings does not erase migration intent");
  assert.equal(getConfig().legacyCloudBackupRequired, true);
  updateConfig({ alpha: 0.6 });

  // Seed an isolated historical cloud schema without using a cloud working mode.
  const remotePath = path.join(root, "old-cloud.sqlite");
  const source = await getDatabase(remotePath, "only-local");
  const project = "git:example.com/old-project";
  const notebooks = new Map([
    ["global", buildMemoryContent("global", ["- [2026-10-03 10:00] **Cloud fact** — original cloud body <!-- id:cloud -->"])],
    [project, buildMemoryContent(project, ["- [2026-10-03 10:00] **Project fact** — project body <!-- id:project -->"])],
  ]);
  for (const [key, content] of notebooks) {
    source.localDb.prepare("INSERT INTO notebooks VALUES (?,?,?)").run(key, content, Date.now());
    fs.writeFileSync(path.join(remoteDir, `${slugify(key)}.md`), content);
  }
  const note = await ingestNote({ title: "Portable cloud note", content: "RAW_CLOUD_SOURCE survives an explicit migration.",
    kind: "handoff", tags: ["migration"], customDb: source, customBlobDir: remoteBlobs, generateEmbeddings: false });
  const raw = await readBlob(note.blobHash, remoteBlobs);
  const chunks = source.localDb.prepare("SELECT id FROM micro_chunks WHERE doc_id=?").all(note.docId);
  source.localDb.prepare("UPDATE micro_chunks SET vector=? WHERE id=?").run(Buffer.from(new Float32Array([0.2, 0.7]).buffer), chunks[0].id);
  source.localDb.prepare("INSERT INTO rag_blobs VALUES (?,?,?,?)").run(note.blobHash, gzipSync(raw).toString("base64"), Buffer.byteLength(raw), Date.now());
  source.localDb.prepare("INSERT INTO project_identities VALUES (?,?,?,?,?)").run(project, "old-project", "example.com/old-project", 1, 1);
  source.localDb.prepare("INSERT INTO project_aliases VALUES (?,?,?,?)").run("remote:example.com/old-project", project, "remote", 1);
  source.localDb.prepare("INSERT INTO document_scopes VALUES (?,?,?)").run(note.docId, project, 1);
  source.localDb.prepare("INSERT INTO knowledge_links VALUES (?,?,?,?,?,?,?,?,?,?)").run("legacy-link", "global", "original cloud body", note.docId, null, null, null, "SUPPORTS", null, 1);
  const expected = captureLocal(source, remoteDir, remoteBlobs, getConfig());
  source.close();
  client = createClient({ url: `file:${remotePath}` });
  local = await getMigrationDatabase();
  fs.writeFileSync(path.join(memoryDir, "global.md"), "# Local cache\n\n- [2026-10-03 10:00] incomplete local cache\n");
  const initialCache = stateHash(captureLocal(local, memoryDir, BLOBS_DIR, getConfig()));
  let calls = 0, interrupted = true;
  const cloud = {
    execute: request => { calls++; return client.execute(request); },
    transaction: async mode => {
      assert.equal(mode, "read");
      const tx = await client.transaction(mode);
      return { execute: request => {
        calls++;
        if (interrupted && /SELECT .*FROM micro_chunks/.test(request.sql || request)) throw new Error("Network interrupted");
        return tx.execute(request);
      }, commit: () => tx.commit(), rollback: () => tx.rollback(), close: () => tx.close() };
    }, close() {},
  };
  api = new CloudSnapshots({ db: local, client: cloud });
  await assert.rejects(api.enable(), /Network interrupted/);
  assert.equal(getConfig().legacyCloudBackupRequired, true);
  assert.equal(getConfig().legacyCloudRestoreRequired, true);
  assert.equal(stateHash(captureLocal(local, memoryDir, BLOBS_DIR, getConfig())), initialCache);
  assert.ok(api.state().records.some(r => r.source === "migration-local" && r.pinned));

  interrupted = false;
  const prepared = await api.enable();
  assert.equal(prepared.status, "restore-required");
  assert.equal(getConfig().mode, "only-local");
  assert.equal(getConfig().legacyCloudBackupRequired, false);
  assert.equal(getConfig().legacyCloudRestoreRequired, true);
  assert.equal(stateHash(captureLocal(local, memoryDir, BLOBS_DIR, getConfig())), initialCache, "download never applies cloud data automatically");
  assert.equal(stateHash((await api.load(prepared.cloudBackupId)).payload), stateHash(expected));
  const afterDownload = calls;
  assert.equal((await api.enable()).cloudBackupId, prepared.cloudBackupId);
  assert.equal(calls, afterDownload, "repeat enable reuses the verified download without cloud traffic");
  await assert.rejects(api.upload(), /migration is pending/);
  updateConfig({ mode: "cloud-snapshots", snapshotSyncMode: "scheduled" });
  assert.equal((await api.tick()).status, "disabled");
  updateConfig({ mode: "only-local" });
  await assert.rejects(readMemory("global"), { code: "MIGRATION_REQUIRED" });
  await assert.rejects(api.restore({ id: prepared.localBackupId }), /verified cloudBackupId/);
  const archivePath = api.archivePath(prepared.cloudBackupId);
  const bytes = fs.readFileSync(archivePath);
  fs.writeFileSync(archivePath, Buffer.alloc(bytes.length));
  await assert.rejects(api.restore({ id: prepared.cloudBackupId }), /checksum/);
  assert.equal(getConfig().legacyCloudRestoreRequired, true);
  fs.writeFileSync(archivePath, bytes);

  const preview = await api.restore({ id: prepared.cloudBackupId });
  assert.equal(preview.status, "preview");
  assert.equal(preview.replacement.notebookStores, 2);
  assert.equal(preview.replacement.documents, 1);
  assert.equal(stateHash(captureLocal(local, memoryDir, BLOBS_DIR, getConfig())), initialCache);
  // A crash after the SQLite commit must finish configuration via the journal.
  api.saveConfig = () => { throw new Error("Configuration interrupted after restore commit"); };
  await assert.rejects(api.restore({ id: prepared.cloudBackupId, confirmToken: preview.confirmToken }), /Configuration interrupted/);
  assert.equal(getConfig().legacyCloudRestoreRequired, true);
  assert.ok(api.state().restoreJournal);
  api.saveConfig = updateConfig;
  await api.recover();
  assert.equal(getConfig().mode, "cloud-snapshots");
  assert.equal(getConfig().snapshotSyncMode, "manual");
  assert.equal(getConfig().legacyCloudRestoreRequired, false);
  assert.equal(getConfig().legacyCloudBackupRequired, false);
  assert.equal(api.state().restoreJournal, undefined);
  assert.equal(stateHash(captureLocal(local, memoryDir, BLOBS_DIR, getConfig())), stateHash(expected));
  assert.match((await readMemory("global"))[0], /original cloud body/);
  assert.ok((await readKnowledgeDocument({ docId: note.docId, scope: "global" })).content.includes("RAW_CLOUD_SOURCE"));
  assert.equal(calls, afterDownload, "preview, restoration and recovery are entirely local");
  assert.equal((await getDatabase()).cloudClient, null);
  assert.equal((await client.execute("SELECT name FROM sqlite_master WHERE name='memory_snapshots'")).rows.length, 0);
  assert.equal((await client.execute("SELECT count(*) n FROM documents")).rows[0].n, 1, "legacy cloud data remains intact");

  // Exercise real entrypoints too: they open migration storage themselves.
  api.close(); local.close(); closeDatabase();
  fs.writeFileSync(configPath, JSON.stringify({ mode: "only-cloud", tursoUrl: `file:${remotePath}` }));
  const runCli = args => {
    const result = spawnSync(process.execPath, ["mcp-server/boot.js", "snapshots", ...args], {
      env: process.env, encoding: "utf8", timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const cliPrepared = runCli(["enable"]);
  assert.equal(cliPrepared.status, "restore-required");
  const cliPreview = runCli(["restore", cliPrepared.cloudBackupId, "--location", "local"]);
  assert.equal(cliPreview.status, "preview");
  assert.equal(runCli(["status"]).legacyCloudRestoreRequired, true);
  const cliRestored = runCli(["restore", cliPrepared.cloudBackupId, "--location", "local", "--confirm", cliPreview.confirmToken]);
  assert.equal(cliRestored.status, "restored");
  assert.equal(runCli(["status"]).legacyCloudRestoreRequired, false);
  console.log("PASS: Cloud-only migration checks full Notebook/RAG/vector data, interruptions, explicit restore and local journal recovery.");
} finally {
  api?.close(); client?.close(); local?.close(); closeDatabase();
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch (error) { if (!["EPERM", "EBUSY"].includes(error.code)) throw error; }
}
