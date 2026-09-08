import assert from "node:assert";
import http from "node:http";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `memory_test_phase1_cloud_${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });

process.env.MEMORY_DIR = TEST_DIR;
process.env.TURSO_LOCATION = "test-loc";

function startMockTursoApi() {
  let databases = [];
  let organizations = [{ slug: "testorg", name: "Test Org" }];
  let groups = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
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
      if (req.method === "GET" && url.pathname === "/v1/organizations/testorg/groups") {
        return send(200, { groups });
      }
      if (req.method === "POST" && url.pathname === "/v1/organizations/testorg/groups") {
        return send(200, { group: { name: "default", locations: ["test-loc"] } });
      }
      if (req.method === "GET" && url.pathname === "/v1/organizations/testorg/databases") {
        return send(200, { databases });
      }
      if (req.method === "POST" && url.pathname === "/v1/organizations/testorg/databases") {
        let bodyStr = "";
        req.on("data", (chunk) => (bodyStr += chunk));
        req.on("end", () => {
          const body = JSON.parse(bodyStr);
          const newDb = {
            name: body.name,
            DbId: `db-id-${body.name}`,
            Hostname: `${body.name}-testorg.turso.io`,
          };
          databases.push(newDb);
          send(200, { database: newDb });
        });
        return;
      }
      if (req.method === "POST" && url.pathname.includes("/auth/tokens")) {
        return send(200, { jwt: "mock-jwt-token-123" });
      }
      send(404, { error: "Not found" });
    });

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

export async function runPhase1CloudTests() {
  console.log("--- Running Cloud Tests: phase1_cloud ---");
  const mockApi = await startMockTursoApi();

  // Redirect all Turso Platform API calls to our mock server
  process.env.TURSO_API_BASE = mockApi.baseUrl;

  const { loadSecrets, saveSecrets, deleteSecrets } = await import("../../mcp-server/config/auth_store.js");
  const { getConfig, resetConfig } = await import("../../mcp-server/config/config_manager.js");
  const { browserLaunchSpec, createAuthLoopbackServer, loginWithApiToken, logoutFromCloud, getAuthStatus } = await import("../../mcp-server/admin/auth.js");

  try {
    // 1. Secrets Vault round-trip & encryption
    console.log("1. Secrets Vault encryption & stability...");
    deleteSecrets();
    assert.strictEqual(getAuthStatus().authorized, false, "Should start unauthorized");

    const secretsToSave = {
      apiToken: "pat_test_12345",
      token: "jwt_test_67890",
      dbUrl: "libsql://memory-testorg.turso.io",
    };
    saveSecrets(secretsToSave);

    assert.strictEqual(getAuthStatus().authorized, true, "Should be authorized after saving secrets");
    const encFile = join(TEST_DIR, "auth_secrets.enc");
    assert.strictEqual(existsSync(encFile), true, "auth_secrets.enc file must exist");

    const loaded = loadSecrets();
    assert.strictEqual(loaded.apiToken, secretsToSave.apiToken, "Decrypted apiToken match");
    assert.strictEqual(loaded.token, secretsToSave.token, "Decrypted token match");
    assert.strictEqual(loaded.dbUrl, secretsToSave.dbUrl, "Decrypted dbUrl match");
    console.log("  [PASS]");

    // 2. Browser OAuth loopback must preserve state and the full Windows URL.
    console.log("2. Browser OAuth loopback and Windows URL handling...");
    const oauthUrl = "https://api.turso.tech/?port=48900&redirect=true&state=abc123&type=cli";
    const winLaunch = browserLaunchSpec(oauthUrl, "win32");
    assert.strictEqual(winLaunch.command, "rundll32.exe", "Windows browser launch must avoid cmd.exe");
    assert.deepStrictEqual(winLaunch.args, ["url.dll,FileProtocolHandler", oauthUrl], "Windows browser launch must preserve the full query string");

    const expectedState = "state-ok";
    const loopback = await createAuthLoopbackServer(0, expectedState);
    assert.ok(loopback.port > 0, "OAuth loopback should bind an available port before browser launch");
    const callbackResponse = await new Promise((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${loopback.port}/?jwt=test-oauth-jwt&username=testuser&state=${expectedState}`,
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        }
      );
      req.on("error", reject);
    });
    assert.strictEqual(callbackResponse, 200, "Matching OAuth state should be accepted");
    const callbackResult = await loopback.result;
    assert.strictEqual(callbackResult.token, "test-oauth-jwt");
    assert.strictEqual(callbackResult.username, "testuser");

    const mismatchLoopback = await createAuthLoopbackServer(0, expectedState);
    const mismatchResult = mismatchLoopback.result.then(
      () => null,
      (err) => err
    );
    const mismatchStatus = await new Promise((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${mismatchLoopback.port}/?jwt=test-oauth-jwt&username=testuser&state=wrong-state`,
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        }
      );
      req.on("error", reject);
    });
    assert.strictEqual(mismatchStatus, 400, "Mismatched OAuth state should be rejected");
    const mismatchError = await mismatchResult;
    assert.match(mismatchError?.message || "", /state parameter mismatch/i);

    // Real Turso CLI callbacks redirect to /?jwt=<JWT>&username=<USERNAME>
    // without echoing `state` — this must be accepted (token is validated
    // against the API afterwards), not rejected.
    const noStateLoopback = await createAuthLoopbackServer(0, expectedState);
    const noStateStatus = await new Promise((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${noStateLoopback.port}/?jwt=test-oauth-jwt&username=testuser`,
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        }
      );
      req.on("error", reject);
    });
    assert.strictEqual(noStateStatus, 200, "Missing OAuth state (real Turso behavior) should be accepted");
    const noStateResult = await noStateLoopback.result;
    assert.strictEqual(noStateResult.token, "test-oauth-jwt");
    console.log("  [PASS]");

    // 3. Headless API-Token Login (loginWithApiToken)
    console.log("3. Headless API-Token Login Workflow...");
    deleteSecrets();
    resetConfig();

    // loginWithApiToken validates the token against Turso Platform API,
    // resolves org/database, mints a per-database JWT, and persists secrets.
    const loginRes = await loginWithApiToken({
      token: "mock-api-token-abcxyz",
      autoCreate: true,
    });

    assert.ok(loginRes.token, "Login must return a database token");
    assert.ok(loginRes.dbUrl, "Login must return a database URL");
    assert.strictEqual(loginRes.username, "testuser", "Login username match");

    const status = getAuthStatus();
    assert.strictEqual(status.authorized, true, "Auth status authorized match");
    assert.strictEqual(status.username, "testuser", "Auth status username match");
    console.log("  [PASS]");

    // 4. Logout Workflow (logoutFromCloud)
    console.log("4. Logout Workflow...");
    logoutFromCloud();
    assert.strictEqual(getAuthStatus().authorized, false, "Post-logout isAuthorized is false");
    assert.strictEqual(getConfig().mode, "only-local", "Mode reverts to only-local on logout");
    console.log("  [PASS]");

    console.log("✅ ALL PHASE 1 CLOUD TESTS PASSED SUCCESSFULLY!");
  } finally {
    mockApi.server.close();
    delete process.env.TURSO_API_BASE;
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {}
  }
}

if (process.argv[1] && process.argv[1].endsWith("phase1_cloud.test.js")) {
  runPhase1CloudTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
