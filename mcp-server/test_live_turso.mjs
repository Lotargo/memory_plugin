// LIVE TURSO smoke test. Requires a completed real login (cloud secrets in the real
// MEMORY_DIR), otherwise it fails at the "secrets present" assertion.
//
// Copies the real config.json + auth_secrets.enc into a temp MEMORY_DIR so the real
// local store is never touched. Writes/reads/deletes against the real Turso cloud DB,
// then cleans up the temporary notebooks it created in the cloud.
import { mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REAL_DIR = "C:/Users/etotm/.config/opencode/memory";
const TEST_DIR = join(tmpdir(), `live_turso_${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });

copyFileSync(join(REAL_DIR, "config.json"), join(TEST_DIR, "config.json"));
copyFileSync(join(REAL_DIR, "auth_secrets.enc"), join(TEST_DIR, "auth_secrets.enc"));

process.env.MEMORY_DIR = TEST_DIR;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (await import("node:assert")).default;

const { getDatabase, closeDatabase } = await import("./db/database.js");
const { readMemory, writeMemory } = await import("./memory.js");
const { updateConfig } = await import("./config/config_manager.js");
const { loadSecrets } = await import("./config/auth_store.js");
const { ingestDocument, deleteDocument } = await import("./ingest/pipeline.js");

async function waitForQueueDrain(db, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await db.prepare("SELECT COUNT(*) AS c FROM sync_queue;").get();
    if (!rows || rows.c === 0) return true;
    await sleep(250);
  }
  return false;
}

const secrets = loadSecrets();
console.log("secrets present:", !!secrets, "| endpoint:", secrets?.dbUrl);
assert.ok(secrets && secrets.token && secrets.dbUrl, "No cloud secrets found — run login first.");

try {
  // ===== 1. HYBRID-SYNC live replication =====
  console.log("\n=== 1. HYBRID-SYNC live test ===");
  updateConfig({ mode: "hybrid-sync" });
  const dbH = await getDatabase();
  assert.strictEqual(dbH.mode, "hybrid-sync", "db should open in hybrid-sync mode");
  assert.ok(dbH.cloudClient, "hybrid-sync should have a cloudClient");
  console.log("[OK] hybrid-sync db opened (cloudClient present)");

  const key = "live_hybrid_test";
  await writeMemory(key, ["- [2026-08-02 20:00] Hybrid sync live test fact <!-- id:livehs1, keep:1 -->"]);
  console.log("[OK] memory written locally");

  const drained = await waitForQueueDrain(dbH);
  assert.ok(drained, "sync_queue should drain after background replication");
  console.log("[OK] background sync drained the queue");

  // Verify from the cloud side with a separate only-cloud connection
  closeDatabase();
  updateConfig({ mode: "only-cloud" });
  const dbCloud = await getDatabase();
  assert.ok(dbCloud.cloudClient, "only-cloud should have a cloudClient");
  const row = await dbCloud.cloudClient.execute({ sql: "SELECT content FROM notebooks WHERE key = ?;", args: [key] });
  assert.strictEqual(row.rows.length, 1, "notebook should exist in the real Turso cloud DB");
  assert.ok(row.rows[0].content.includes("Hybrid sync live test fact"), "replicated content should match");
  console.log("[OK] notebook replicated to real Turso cloud and verified");

  // ===== 2. ONLY-CLOUD write + read =====
  console.log("\n=== 2. ONLY-CLOUD live test ===");
  const key2 = "live_cloud_test";
  await writeMemory(key2, ["- [2026-08-02 20:05] Only-cloud live test fact <!-- id:livecl1, keep:1 -->"]);
  assert.ok(!existsSync(join(TEST_DIR, `${key2}.md`)), "only-cloud must NOT create a local markdown file");
  const readBack = await readMemory(key2);
  assert.ok(Array.isArray(readBack) && readBack.length >= 1, "should read the cloud notebook back");
  console.log("[OK] only-cloud write+read via real Turso, no local file created");

  // ===== 3. only-cloud ingest + delete =====
  console.log("\n=== 3. only-cloud ingest + delete ===");
  const ingestRes = await ingestDocument({
    content: "# Live Cloud Doc\nThis document is ingested directly into the real Turso cloud.",
    type: "text",
    title: "Live Cloud Doc",
    path: "live/cloud-doc.md",
    customDb: dbCloud,
    generateEmbeddings: false,
  });
  assert.ok(ingestRes.docId, "should return a docId");
  const docRow = await dbCloud.cloudClient.execute({ sql: "SELECT title FROM documents WHERE id = ?;", args: [ingestRes.docId] });
  assert.strictEqual(docRow.rows.length, 1, "doc should exist in the cloud");
  assert.strictEqual(docRow.rows[0].title, "Live Cloud Doc", "cloud doc title should match");
  console.log("[OK] document ingested into real Turso cloud:", ingestRes.docId);

  await deleteDocument(ingestRes.docId, dbCloud);
  const afterDelete = await dbCloud.cloudClient.execute({ sql: "SELECT id FROM documents WHERE id = ?;", args: [ingestRes.docId] });
  assert.strictEqual(afterDelete.rows.length, 0, "doc should be deleted from the cloud");
  console.log("[OK] document deleted from real Turso cloud");

  // ===== cleanup cloud test notebooks =====
  await dbCloud.cloudClient.execute({ sql: "DELETE FROM notebooks WHERE key IN (?, ?);", args: [key, key2] });
  console.log("[OK] cloud test notebooks cleaned up");

  console.log("\n✅ ALL LIVE TURSO TESTS PASSED");
} catch (err) {
  console.error("\n❌ LIVE TURSO TEST FAILED:", err);
  process.exitCode = 1;
} finally {
  closeDatabase();
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}
}
