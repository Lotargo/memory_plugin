import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

const root = mkdtempSync(join(tmpdir(), "memory-dashboard-"));
process.env.MEMORY_DIR = join(root, "memory");
process.env.OPENCODE_CONFIG_DIR = join(root, "opencode");
process.env.MEMORY_DISABLE_PERSONA_SYNC = "1";
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = "1";
const memory = await import("../../mcp-server/memory.js");
const service = await import("../../mcp-server/services/notebook_service.js");
const core = await import("../../mcp-server/tools/core/memory_core.js");
const { getDatabase, closeDatabase } = await import("../../mcp-server/db/database.js");
const { partitionMemoryEntries, formatInjectedFacts } = await import("../../opencode-plugin/index.js");
const { buildPersonaOverlayBlock } = await import("../../mcp-server/prompt_manager.js");
const { updateConfig, getConfig } = await import("../../mcp-server/config/config_manager.js");
const { startDashboard } = await import("../../mcp-server/dashboard/server.js");
const { CloudSnapshots } = await import("../../mcp-server/admin/cloud_snapshots.js");
const cloudCalls = [];
// Remote writes are spied here; real libSQL persistence is covered separately
// in cloud_snapshots.test.js. No credentials or network are used in UI tests.
const cloudSpy = { execute: async request => {
  const sql = typeof request === "string" ? request : request.sql;
  cloudCalls.push(sql);
  assert.ok(sql.startsWith("CREATE ") || sql.startsWith("INSERT INTO memory_snapshots"));
  return { rowsAffected: sql.startsWith("INSERT") ? 1 : 0, rows: [] };
} };
let app;
try {
  const key = "git:example.test/team/a", other = "git:example.test/team/b";
  const line = "- [2026-10-03 10:00] **Original** — same body <!-- id:same, tags:style, keep:1 -->";
  for (const target of ["global", key, other]) await memory.writeMemory(target, [line]);
  let doc = await service.readNotebook({ key });
  assert.equal(doc.records[0].kind, "directive", "legacy persona semantics");
  const edit = (fields, extra = {}) => service.mutateNotebook({ key, expectedVersion: doc.version, action: "update", ref: "id:same", fields, ...extra });
  await edit({ title: "Selected project", disabled: true });
  assert.deepEqual(await memory.readMemory("global"), [line]);
  assert.deepEqual(await memory.readMemory(other), [line]);
  await assert.rejects(edit({ body: "stale edit" }), { code: "CONFLICT" });
  const disabled = await memory.readMemory(key);
  assert.equal(buildPersonaOverlayBlock(disabled), "");
  assert.deepEqual(partitionMemoryEntries(disabled), { directives: [], facts: [] });
  assert.equal(formatInjectedFacts(disabled, 10), "");
  assert.match(await core.recallFacts({ scope: "project", project: key }), /DISABLED/);
  assert.match(await core.getFactById({ scope: "project", project: key, id: "same" }), /Selected project/);
  doc = await service.readNotebook({ key });
  await edit({ disabled: false });
  assert.match(buildPersonaOverlayBlock(await memory.readMemory(key)), /Selected project/);

  doc = await service.readNotebook({ key });
  await core.updateFactText({ scope: "project", project: key, id: "same", newText: "MCP changed body" });
  await assert.rejects(edit({ body: "UI stale" }), { code: "CONFLICT" });
  const stale = await memory.readMemory(key);
  const fresh = await memory.readMemory(key);
  fresh.push("- [2026-10-03 11:00] fresh");
  await memory.writeMemory(key, fresh);
  stale.push("- [2026-10-03 12:00] stale");
  await assert.rejects(memory.writeMemory(key, stale), { code: "CONFLICT" });
  doc = await service.readNotebook({ key });
  await assert.rejects(edit({}, { action: "delete", confirmDelete: true }), { code: "CONFIRMATION" });
  await edit({}, { action: "delete", confirmDelete: true, confirmProtected: true });
  doc = await service.readNotebook({ key });
  assert.equal(doc.records.length, 1);
  assert.equal(doc.records[0].id, null);
  const legacy = await service.mutateNotebook({ key, expectedVersion: doc.version, ref: "legacy:0", action: "update", fields: { title: "Legacy migrated", body: "preserved" } });
  assert.ok(legacy.notebook.records[0].id);
  doc = legacy.notebook;
  await assert.rejects(service.mutateNotebook({ key, expectedVersion: doc.version, action: "create", fields: { title: "Bad", body: "line one\n- [2026-10-03 00:00] injected" } }), { code: "INVALID" });
  await assert.rejects(service.mutateNotebook({ key, expectedVersion: doc.version, action: "create", fields: { title: "Bad", body: "x", tags: "id:spoof" } }), { code: "INVALID" });
  await assert.rejects(service.readNotebook({ key: "git:unknown" }), { code: "NOT_FOUND" });
  await assert.rejects(service.readNotebook({}), { code: "INVALID" });

  const db = await getDatabase();
  // Link guard must run even when a document's raw source is unavailable.
  await db.prepare("INSERT INTO documents (id, title, path, blob_hash, checksum, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("doc-1", "Source", "source.md", "hash", "hash", Date.now(), Date.now());
  await db.prepare("INSERT INTO knowledge_links (id, fact_key, fact_text, doc_id, relation_type, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("link-1", key, "preserved", "doc-1", "LINKS_TO", Date.now());
  const linkedRequest = { key, expectedVersion: doc.version, ref: doc.records[0].ref, action: "update", fields: { body: "break link" } };
  await assert.rejects(service.mutateNotebook(linkedRequest), { code: "UNSUPPORTED" });
  await assert.rejects(service.mutateNotebook({ ...linkedRequest, action: "delete", confirmDelete: true }), { code: "UNSUPPORTED" });
  assert.equal((await service.readNotebook({ key })).records[0].links.length, 1);

  app = await startDashboard();
  const token = new URL(app.url).hash.slice(1);
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(app.origin + "/api/overview")).status, 401);
  assert.equal((await fetch(app.origin + "/api/overview", { headers: { ...headers, Origin: "https://evil.example" } })).status, 403);
  const badHost = await new Promise((resolve, reject) => http.get(app.origin + "/api/overview", { headers: { ...headers, Host: "evil.example" } }, response => { response.resume(); resolve(response.statusCode); }).on("error", reject));
  assert.equal(badHost, 403);
  const overview = await (await fetch(app.origin + "/api/overview", { headers })).json();
  assert.equal(overview.targets.length, 3);
  const asset = await fetch(app.origin + "/");
  assert.match(asset.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.ok(!(await asset.text()).includes(token));
  const themeAsset = await fetch(app.origin + "/theme.js");
  assert.equal(themeAsset.status, 200);
  assert.match(themeAsset.headers.get("content-type"), /text\/javascript/);
  assert.match(themeAsset.headers.get("content-security-policy"), /script-src 'self'/);
  assert.ok(!(await themeAsset.text()).includes(token));
  const appAsset = await fetch(app.origin + '/app.js');
  assert.equal(appAsset.status, 200);
  const appSource = await appAsset.text();
  // Imported UI modules must be registered as JavaScript assets; otherwise the
  // browser cannot initialize even though the root document returns HTTP 200.
  for (const [, module] of appSource.matchAll(/from ['"]\.\/([^'"]+\.js)['"]/g)) {
    const response = await fetch(`${app.origin}/${module}`);
    assert.equal(response.status, 200, `Browser module ${module} must be served`);
    assert.match(response.headers.get('content-type'), /text\/javascript/);
  }
  assert.equal((await fetch(app.origin + "/api/notebook", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" })).status, 403);
  const requestHeaders = { ...headers, "Content-Type": "application/json", Origin: app.origin };
  const created = await fetch(app.origin + "/api/notebook", { method: "POST", headers: requestHeaders, body: JSON.stringify({ key, expectedVersion: doc.version, action: "create", fields: { title: "HTTP test", body: "<img src=x onerror=alert(1)>", kind: "fact" } }) });
  assert.equal(created.status, 200);
  assert.equal((await created.json()).status, "saved");
  const concurrent = await fetch(app.origin + "/api/notebook", { method: "POST", headers: requestHeaders, body: JSON.stringify({ key, expectedVersion: doc.version, action: "create", fields: { title: "Old version", body: "x" } }) });
  assert.equal(concurrent.status, 409);
  assert.equal((await fetch(app.origin + "/api/notebook", { method: "POST", headers: requestHeaders, body: "not-json" })).status, 400);
  assert.throws(() => updateConfig({ mode: "hybrid-sync" }), /has been removed/);
  updateConfig({ mode: "cloud-snapshots" });
  const snapshotOverview = await service.notebookOverview();
  assert.equal(snapshotOverview.readOnly, false);
  const snapshotNotebook = await service.readNotebook({ key });
  assert.equal(snapshotNotebook.readOnly, false);
  assert.equal((await getDatabase()).cloudClient, null, "snapshot panel stays local");
  await service.mutateNotebook({ key, expectedVersion: snapshotNotebook.version, action: "create", fields: { title: "Snapshot mode", body: "local edit" } });
  const snapshots = new CloudSnapshots({ client: cloudSpy });
  // Earlier link checks deliberately used an unavailable source. Supply a real
  // blob before testing full checkpoints, which correctly reject missing blobs.
  const { saveBlob } = await import("../../mcp-server/storage/blob_store.js");
  const source = await saveBlob("source for preserved link");
  await (await getDatabase()).prepare("UPDATE documents SET blob_hash = ?, checksum = ? WHERE id = ?").run(source.hash, source.hash, "doc-1");
  const firstUpload = await snapshots.upload();
  assert.equal(firstUpload.status, "uploaded");
  cloudCalls.length = 0;
  const beforeEdit = await service.readNotebook({ key });
  const uiEdit = await service.mutateNotebook({ key, expectedVersion: beforeEdit.version, action: "create", fields: { title: "Checkpoint contract", body: "web edit must reach snapshots", kind: "fact" } });
  await service.notebookOverview();
  await service.previewNotebookPersona({ key });
  assert.match(await core.recallFacts({ scope: "project", project: key }), /web edit must reach snapshots/);
  assert.equal(cloudCalls.length, 0, "UI read/write and MCP readback perform zero cloud calls");
  const payload = await snapshots.capture();
  assert.ok(payload.notebooks.some(store => store.content.includes("web edit must reach snapshots")));
  assert.ok(payload.tables.knowledge_links.some(link => link.id === "link-1"), "UI does not break snapshot links");
  const uploaded = await snapshots.upload();
  assert.equal(uploaded.status, "uploaded");
  assert.equal(cloudCalls.filter(sql => sql.startsWith("INSERT INTO memory_snapshots")).length, 1);
  cloudCalls.length = 0;
  await snapshots.upload();
  assert.equal(cloudCalls.length, 0, "unchanged UI state causes no cloud calls");
  const preview = await snapshots.restore({ id: firstUpload.snapshot.id, location: "local" });
  await snapshots.restore({ id: firstUpload.snapshot.id, location: "local", confirmToken: preview.confirmToken });
  const restored = await service.readNotebook({ key });
  assert.ok(!restored.records.some(record => record.body === "web edit must reach snapshots"));
  assert.equal(restored.records[0].links.length, 1);
  const restoreConflict = await fetch(app.origin + "/api/notebook", { method: "POST", headers: requestHeaders,
    body: JSON.stringify({ key, expectedVersion: uiEdit.notebook.version, action: "create", fields: { title: "Stale after restore", body: "must not overwrite" } }) });
  assert.equal(restoreConflict.status, 409, "snapshot restore invalidates open UI drafts");
  assert.equal(cloudCalls.length, 0, "local restoration and UI refresh do not query cloud");

  // Simulate a former only-cloud installation: reading must not change config,
  // expose its incomplete cache as editable, or fetch/merge remote memory.
  const configPath = join(memory.MEMORY_DIR, "config.json");
  const legacyConfig = JSON.stringify({ ...getConfig(), mode: "only-cloud" });
  writeFileSync(configPath, legacyConfig);
  const beforeBlocked = readFileSync(memory.storeFilePath(key), "utf8");
  const blocked = await (await fetch(app.origin + "/api/overview", { headers })).json();
  assert.equal(blocked.code, "MIGRATION_REQUIRED");
  assert.equal(blocked.readOnly, true);
  assert.deepEqual(blocked.targets, []);
  for (const path of ["/api/notebook", "/api/persona"]) {
    const response = await fetch(app.origin + path + "?key=" + encodeURIComponent(key), { headers });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "MIGRATION_REQUIRED");
  }
  const blockedWrite = await fetch(app.origin + "/api/notebook", { method: "POST", headers: requestHeaders,
    body: JSON.stringify({ key, expectedVersion: restored.version, action: "create", fields: { title: "Blocked", body: "must not write" } }) });
  assert.equal(blockedWrite.status, 409);
  assert.equal((await blockedWrite.json()).code, "MIGRATION_REQUIRED");
  assert.equal(readFileSync(memory.storeFilePath(key), "utf8"), beforeBlocked);
  assert.equal(readFileSync(configPath, "utf8"), legacyConfig);
  assert.equal(cloudCalls.length, 0);
  updateConfig({ legacyCloudBackupRequired: false, legacyCloudRestoreRequired: false });
  assert.throws(() => updateConfig({ mode: "only-cloud" }), /has been removed/);
  updateConfig({ mode: "only-local" });
  console.log("PASS dashboard: explicit scopes, protected deletion, version conflicts, links, directives, MCP/HTTP, zero cloud calls on UI edits, snapshot capture/upload/restore, stale drafts and migration status.");
} finally {
  if (app) await app.close();
  closeDatabase();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
