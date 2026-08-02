import assert from "node:assert";
import http from "node:http";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `memory_test_phase1_cloud_${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });

// Isolate tests from the production memory directory (must be set before dynamic imports).
process.env.MEMORY_DIR = TEST_DIR;

// Pin the closest-location resolver so group creation is fully offline/deterministic.
process.env.TURSO_LOCATION = "test-loc";

// Minimal mock of the Turso Platform API so the full login flow runs offline.
function startMockTursoApi() {
  let databases = [];
  let organizations = [{ slug: "testorg", name: "Test Org" }];
  let groups = [];
  const recordedGroupLocations = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const parts = url.pathname.split("/").filter(Boolean);
      const send = (code, obj) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };

      if (req.method === "GET" && url.pathname === "/v1/current-user") {
        return send(200, { username: "testuser", name: "Test User" });
      }
      if (req.method === "GET" && url.pathname === "/v1/organizations") {
        return send(200, { organizations });
      }
      // GET /v1/organizations/:org/groups
      if (req.method === "GET" && parts[0] === "v1" && parts[1] === "organizations" && parts.length === 4 && parts[3] === "groups") {
        return send(200, { groups });
      }
      // POST /v1/organizations/:org/groups
      if (req.method === "POST" && parts[0] === "v1" && parts[1] === "organizations" && parts.length === 4 && parts[3] === "groups") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const parsed = JSON.parse(body || "{}");
          const group = { name: parsed.name, primary: parsed.location || "lhr" };
          recordedGroupLocations.push(parsed.location);
          groups.push(group);
          send(200, { group });
        });
        return;
      }
      // GET /v1/organizations/:org/databases
      if (req.method === "GET" && parts[0] === "v1" && parts[1] === "organizations" && parts.length === 4 && parts[3] === "databases") {
        return send(200, { databases });
      }
      // POST /v1/organizations/:org/databases
      if (req.method === "POST" && parts[0] === "v1" && parts[1] === "organizations" && parts.length === 4 && parts[3] === "databases") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const parsed = JSON.parse(body || "{}");
          if (groups.length === 0) {
            return send(400, { error: "group not found" });
          }
          const db = { name: parsed.name, hostname: `${parsed.name}-testorg.turso.io` };
          databases.push(db);
          send(200, { database: db });
        });
        return;
      }
      // POST /v1/organizations/:org/databases/:db/auth/tokens
      if (req.method === "POST" && parts[0] === "v1" && parts[1] === "organizations" && parts.length === 7 && parts[3] === "databases" && parts[5] === "auth" && parts[6] === "tokens") {
        return send(200, { jwt: `mock-db-jwt-${parts[4]}` });
      }
      send(404, { error: "Not found" });
    });

    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        setDatabases: (dbs) => { databases = dbs; },
        setOrganizations: (orgs) => { organizations = orgs; },
        setGroups: (gs) => { groups = gs; },
        recordedGroupLocations,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function runTests() {
  const { encryptData, decryptData, saveSecrets, loadSecrets } = await import("./config/auth_store.js");
  const { loginToCloud, logoutFromCloud } = await import("./admin/auth.js");
  const { getConfig, updateConfig, resetConfig } = await import("./config/config_manager.js");

  const mock = await startMockTursoApi();
  process.env.TURSO_API_BASE = mock.url;

  console.log("--- Starting Cloud & Auth Phase 1 Integration Tests ---");

  try {
    // 1. AES-256-GCM encryption + fingerprint KDF
    console.log("1. Testing AES-256-GCM and fingerprint KDF encryption...");
    const secretText = JSON.stringify({ token: "test-token-12345", dbUrl: "libsql://test.turso.io" });
    const encrypted = encryptData(secretText);

    assert(encrypted.includes(":"), "Encrypted payload must contain colon separators");
    assert.strictEqual(encrypted.split(":").length, 3, "Encrypted payload must contain 3 parts (iv, authTag, ciphertext)");

    const decrypted = decryptData(encrypted);
    assert.strictEqual(decrypted, secretText, "Decrypted text must match the original secret text");
    console.log("  [PASS] Encryption & Decryption OK");

    // 2. Secrets storage round-trip
    console.log("2. Testing saveSecrets and loadSecrets auth store methods...");
    const secretsObj = { token: "secret-token", dbUrl: "libsql://db.turso.io" };
    saveSecrets(secretsObj);

    const loaded = loadSecrets();
    assert.deepStrictEqual(loaded, secretsObj, "Loaded secrets must exactly match saved secrets");
    console.log("  [PASS] Save & Load Secrets OK");

    // 3. Full login flow against an EXISTING database
    console.log("3. Testing full login flow (OAuth loopback + Platform API) with existing database...");
    mock.setDatabases([{ name: "simulated-db" }]);

    const simulatedParams = { jwt: "simulated-oauth-token-999", username: "testuser" };
    const loginRes = await loginToCloud({
      customPort: 48905,
      simulated: true,
      simulatedParams,
    });

    assert.strictEqual(loginRes.token, "mock-db-jwt-simulated-db", "Login should persist the minted database JWT");
    assert.strictEqual(loginRes.dbUrl, "libsql://simulated-db-testorg.turso.io", "dbUrl must be constructed from db + org");
    assert.strictEqual(loginRes.username, "testuser", "Username must be persisted from OAuth profile");
    assert.strictEqual(loginRes.authorized, true, "Session must be marked as authorized");

    const activeConfigAfterLogin = getConfig();
    assert.strictEqual(activeConfigAfterLogin.tursoUrl, loginRes.dbUrl, "Config tursoUrl should update after successful login");
    assert.strictEqual(activeConfigAfterLogin.authorized, true, "Config should be marked authorized");

    const loadedSecretsAfterLogin = loadSecrets();
    assert.strictEqual(loadedSecretsAfterLogin.token, "mock-db-jwt-simulated-db", "Secret token should be the minted DB JWT");
    assert.strictEqual(loadedSecretsAfterLogin.dbUrl, loginRes.dbUrl, "Secret dbUrl should match");
    assert.strictEqual(loadedSecretsAfterLogin.db, "simulated-db", "Secret should record the database name");
    console.log("  [PASS] Full Login (existing DB) OK");

    // 4. Full login flow with AUTO-CREATED database (incl. group creation)
    console.log("4. Testing full login flow with auto-created database (fresh account, no group)...");
    mock.setDatabases([]);
    mock.setGroups([]);

    const loginResV2 = await loginToCloud({
      customPort: 48906,
      simulated: true,
      simulatedParams,
    });

    assert.strictEqual(loginResV2.dbUrl, "libsql://memory-testuser-testorg.turso.io", "Auto-created DB url should use memory-<username>");
    assert.strictEqual(loginResV2.token, "mock-db-jwt-memory-testuser", "Token should be minted for the auto-created DB");
    assert.strictEqual(mock.recordedGroupLocations[mock.recordedGroupLocations.length - 1], "test-loc", "Group must be created with an explicit location");
    console.log("  [PASS] Full Login (auto-created DB + group) OK");

    // 4b. Personal account fallback: empty /v1/organizations -> use username as org
    console.log("4b. Testing personal-account fallback (no organizations returned)...");
    mock.setOrganizations([]);
    mock.setDatabases([]);
    mock.setGroups([]);

    const loginResPersonal = await loginToCloud({
      customPort: 48907,
      simulated: true,
      simulatedParams,
    });

    assert.strictEqual(loginResPersonal.org, "testuser", "Org must fall back to the username for personal accounts");
    assert.strictEqual(loginResPersonal.dbUrl, "libsql://memory-testuser-testuser.turso.io", "DB url must use username as org namespace");
    assert.strictEqual(loginResPersonal.token, "mock-db-jwt-memory-testuser", "Token must be minted under the username org");
    console.log("  [PASS] Personal Account Fallback OK");

    // 5. Logout resets everything
    console.log("5. Testing logoutFromCloud...");
    updateConfig({ mode: "hybrid-sync" });
    assert.strictEqual(getConfig().mode, "hybrid-sync", "Config mode should successfully update to hybrid-sync");

    const logoutRes = logoutFromCloud();
    assert.strictEqual(logoutRes, true, "logoutFromCloud should return true indicating the secret file was deleted");
    assert.strictEqual(loadSecrets(), null, "Secrets should be completely deleted from disk upon logout");

    const configAfterLogout = getConfig();
    assert.strictEqual(configAfterLogout.mode, "only-local", "Mode must reset to only-local on logout");
    assert.strictEqual(configAfterLogout.authorized, false, "Authorized flag must reset to false on logout");
    assert.strictEqual(configAfterLogout.tursoUrl, "", "tursoUrl must be cleared on logout");
    console.log("  [PASS] Cloud Logout & Config Reset OK");

    resetConfig();
    console.log("\n✅ ALL CLOUD & AUTH INTEGRATION TESTS PASSED SUCCESSFULLY!");
  } catch (err) {
    console.error("\n❌ CLOUD & AUTH PHASE 1 INTEGRATION TEST FAILED:", err);
    process.exitCode = 1;
  } finally {
    await mock.close();
    delete process.env.TURSO_API_BASE;
    delete process.env.TURSO_LOCATION;
    if (existsSync(TEST_DIR)) {
      try {
        rmSync(TEST_DIR, { recursive: true, force: true });
      } catch {}
    }
  }
}

runTests();
