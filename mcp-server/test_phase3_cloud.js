import assert from "node:assert";
import { rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `memory_test_phase3_cloud_${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });

// Set process.env.MEMORY_DIR to isolate tests
process.env.MEMORY_DIR = TEST_DIR;

const BAD_CLOUD_DB_PATH = `file:${join(TEST_DIR, "nonexistent_bad_cloud.sqlite")}`;
const GOOD_FAILOVER_DB_PATH = `file:${join(TEST_DIR, "good_failover.sqlite")}`;

async function runTests() {
  const { getDatabase, closeDatabase } = await import("./db/database.js");
  const { updateConfig, resetConfig } = await import("./config/config_manager.js");

  console.log("--- Starting Cloud Failover & Circuit Breaker Phase 3 Integration Tests ---");

  try {
    // 1. Initial configuration
    updateConfig({
      mode: "only-cloud",
      tursoUrl: BAD_CLOUD_DB_PATH,
      failoverUrl: GOOD_FAILOVER_DB_PATH,
    });

    // 2. Setup the good failover database schema first so it's ready when switched to
    console.log("Setting up failover database schema...");
    const failoverSetupDb = await getDatabase(GOOD_FAILOVER_DB_PATH.replace("file:", ""), "only-local");
    await failoverSetupDb.exec(`
      CREATE TABLE IF NOT EXISTS notebooks (
          key TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          updated_at INTEGER NOT NULL
      );
    `);
    failoverSetupDb.close();

    // 3. Instantiate the cloud client with a bad primary URL and a good failover URL
    const db = await getDatabase();
    assert.strictEqual(db.mode, "only-cloud", "Database mode should be only-cloud");
    assert(db.failoverClient, "failoverClient should be initialized");

    // Capture console.warn messages to verify switching warnings are logged
    const originalWarn = console.warn;
    let switchWarningLogged = false;
    console.warn = (...args) => {
      const msg = args.join(" ");
      if (msg.includes("[WARN] Turso is temporarily unreachable. Switching to LiteFS failover replica...")) {
        switchWarningLogged = true;
      }
      originalWarn(...args);
    };

    // 4. Intentionally disrupt/stub the primary cloud client to simulate query failure
    // This triggers retries and eventual circuit breaker failover
    db.cloudClient.execute = async () => {
      throw new Error("Simulated Turso network timeout/unreachable error");
    };

    console.log("Triggering cloud write to initiate failover retries and circuit breaker fallback...");
    const prepStmt = db.prepare(`
      INSERT INTO notebooks (key, content, updated_at)
      VALUES (?, ?, ?);
    `);

    // Execute multiple times to hit consecutive failures threshold (3)
    let errCount = 0;
    try {
      await prepStmt.run("project_key", "test failover", Date.now());
    } catch (e) {
      errCount++;
    }

    try {
      await prepStmt.run("project_key", "test failover", Date.now());
    } catch (e) {
      errCount++;
    }

    // This 3rd call should trigger the consecutiveFailures >= 3 fallback to the good failover client
    console.log("Executing 3rd query to trigger circuit breaker switch...");
    const res = await prepStmt.run("project_key_failover", "test content", Date.now());

    // Restore original console.warn
    console.warn = originalWarn;

    // Validate outcomes
    assert(switchWarningLogged, "Failover warning MUST be logged to console");
    assert(db.usingFailover, "usingFailover flag should be set to true");
    assert.strictEqual(res.changes, 1, "Write should succeed on the failover database");

    // Let's verify we can read the data from the failover client now
    const readPrep = db.prepare("SELECT * FROM notebooks WHERE key = ?;");
    const retrieved = await readPrep.get("project_key_failover");
    assert(retrieved, "Should retrieve key-value pair from failover database");
    assert.strictEqual(retrieved.content, "test content", "Content should match what was written");

    closeDatabase();
    resetConfig();

    console.log("\n✅ ALL CLOUD FAILOVER & CIRCUIT BREAKER TESTS PASSED SUCCESSFULLY!");
  } catch (err) {
    console.error("\n❌ CLOUD FAILOVER & CIRCUIT BREAKER TESTS FAILED:", err);
    process.exit(1);
  } finally {
    if (existsSync(TEST_DIR)) {
      try {
        rmSync(TEST_DIR, { recursive: true, force: true });
      } catch {}
    }
  }
}

runTests();
