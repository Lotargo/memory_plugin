import assert from "node:assert";
import http from "node:http";
import { spawn } from "node:child_process";
import { rmSync, mkdirSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const TEST_DIR = join(tmpdir(), `memory_test_phase1_cloud_${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });
const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));

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
  const { encryptData, decryptData, saveSecrets, loadSecrets, resolveEnvSecrets, getSecretsSource } = await import("./config/auth_store.js");
  const { loginToCloud, logoutFromCloud, loginWithApiToken, loginWithDatabaseToken, loginFromEnv, getAuthStatus, resolveCloudSecrets, setApiKey, clearApiKey } = await import("./admin/auth.js");
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

    // 6. Environment/.env secret resolution (headless: Docker, Jules, VPS)
    console.log("6. Testing environment secret resolution (Docker / Jules / VPS)...");
    process.env.TURSO_DB_URL = "libsql://env-db-envorg.turso.io";
    process.env.TURSO_DB_TOKEN = "env-token-abc";
    process.env.TURSO_ORG = "envorg";
    process.env.TURSO_DATABASE = "env-db";
    process.env.TURSO_USERNAME = "envuser";

    const envResolved = resolveEnvSecrets();
    assert.strictEqual(envResolved.dbUrl, "libsql://env-db-envorg.turso.io", "resolveEnvSecrets must pick up TURSO_DB_URL");
    assert.strictEqual(envResolved.token, "env-token-abc", "resolveEnvSecrets must pick up TURSO_DB_TOKEN");
    assert.strictEqual(envResolved.apiToken, null, "No API token should be resolved when unset");
    assert.strictEqual(getSecretsSource(), "env", "Secrets source must report env while env vars are set");

    const envLoaded = loadSecrets();
    assert.strictEqual(envLoaded.token, "env-token-abc", "loadSecrets must prefer the env DB token");
    assert.strictEqual(envLoaded.dbUrl, "libsql://env-db-envorg.turso.io", "loadSecrets must prefer the env DB url");
    assert.strictEqual(envLoaded.source, "env", "Env-loaded secrets must be tagged with source=env");
    assert.strictEqual(envLoaded.authorized, true, "Env secrets are implicitly authorized");

    delete process.env.TURSO_DB_URL;
    delete process.env.TURSO_DB_TOKEN;
    delete process.env.TURSO_ORG;
    delete process.env.TURSO_DATABASE;
    delete process.env.TURSO_USERNAME;
    assert.strictEqual(loadSecrets(), null, "After logout + clearing env, no secrets remain");
    console.log("  [PASS] Environment Secret Resolution OK");

    // 7. Headless login with an account API token (no browser, no loopback)
    console.log("7. Testing loginWithApiToken (headless account API token)...");
    mock.setOrganizations([]);
    mock.setDatabases([{ name: "token-db" }]);

    const apiLogin = await loginWithApiToken({ token: "account-api-token-123" });
    assert.strictEqual(apiLogin.token, "mock-db-jwt-token-db", "API-token login must mint a DB JWT for the selected database");
    assert.strictEqual(apiLogin.dbUrl, "libsql://token-db-testuser.turso.io", "Personal-account fallback org must be used");
    assert.strictEqual(apiLogin.username, "testuser", "Username must come from the validated current-user");
    assert.strictEqual(apiLogin.authorized, true, "Session must be marked authorized");

    const storeAfterApi = loadSecrets();
    assert.strictEqual(storeAfterApi.token, "mock-db-jwt-token-db", "API-token login must persist the minted DB token");
    assert.strictEqual(storeAfterApi.apiToken, "account-api-token-123", "API-token login must persist the account API token verbatim");

    const statusAfterApi = getAuthStatus();
    assert.strictEqual(statusAfterApi.source, "api-key", "Auth status source must report api-key");
    assert.strictEqual(statusAfterApi.authorized, true, "Auth status must report authorized");
    assert.strictEqual(statusAfterApi.hasApiKey, true, "Auth status must report the API key as set");
    assert.strictEqual(statusAfterApi.database, "token-db", "Auth status must report the database name");
    console.log("  [PASS] API Token Login OK");

    // 7b. API-key session priority + env cache reuse
    console.log("7b. Testing API-key session priority and env reuse of the stored api-key session...");
    assert.strictEqual(getSecretsSource(), "api-key", "Stored api-key session must be the active source");

    process.env.TURSO_API_TOKEN = "account-api-token-123"; // same as the stored session
    const cachedFromEnv = loadSecrets();
    assert.strictEqual(cachedFromEnv.source, "api-key", "Matching env token must reuse the stored api-key session");
    assert.strictEqual(cachedFromEnv.dbUrl, "libsql://token-db-testuser.turso.io", "Reused session must keep its dbUrl");
    assert.strictEqual(cachedFromEnv.needsResolution, undefined, "Reused session needs no resolution");
    assert.strictEqual(getSecretsSource(), "env", "Source reporting must stay env while TURSO_API_TOKEN is set");
    delete process.env.TURSO_API_TOKEN;
    console.log("  [PASS] API-Key Session Priority & Env Reuse OK");

    // 7c. Unresolved env API token (no matching stored session) -> needsResolution
    console.log("7c. Testing unresolved env API token (no matching stored session)...");
    process.env.TURSO_API_TOKEN = "brand-new-env-token-555";
    const pending = loadSecrets();
    assert.strictEqual(pending.needsResolution, true, "Unknown env API token must be flagged for resolution");
    assert.strictEqual(pending.source, "env", "Pending env token must be tagged source=env");
    assert.strictEqual(pending.token, "brand-new-env-token-555", "Pending record must carry the env token as token");
    assert.strictEqual(pending.dbUrl, "", "Pending record must have no dbUrl yet");
    delete process.env.TURSO_API_TOKEN;
    console.log("  [PASS] Unresolved Env API Token OK");

    // 7d. resolveCloudSecrets mints a DB session from an env API token WITHOUT touching the store
    console.log("7d. Testing resolveCloudSecrets (env API token -> resolved session, store untouched)...");
    process.env.TURSO_API_TOKEN = "brand-new-env-token-555";
    const resolved = await resolveCloudSecrets();
    assert.strictEqual(resolved.token, "mock-db-jwt-token-db", "resolveCloudSecrets must mint a DB JWT from the env token");
    assert.strictEqual(resolved.dbUrl, "libsql://token-db-testuser.turso.io", "Resolved session must have a dbUrl");
    assert.strictEqual(resolved.source, "env", "Resolved session must stay tagged source=env");
    assert.strictEqual(resolved.needsResolution, undefined, "Resolved session must clear needsResolution");

    delete process.env.TURSO_API_TOKEN;
    const storeAfterResolve = loadSecrets();
    assert.strictEqual(storeAfterResolve.apiToken, "account-api-token-123", "Env resolution must NOT overwrite the stored api-key session");
    assert.strictEqual(storeAfterResolve.token, "mock-db-jwt-token-db", "Stored session must be preserved after env resolution");
    console.log("  [PASS] resolveCloudSecrets OK");

    // 7e. setApiKey replaces the current session and marks it as api-key
    console.log("7e. Testing setApiKey (TUI helper) replaces the session...");
    const setRes = await setApiKey("second-api-key-777");
    assert.strictEqual(setRes.ok, true, "setApiKey must report success");
    assert.strictEqual(loadSecrets().apiToken, "second-api-key-777", "setApiKey must replace the stored apiToken");
    assert.strictEqual(getSecretsSource(), "api-key", "Source must be api-key after setApiKey");
    assert.strictEqual(getAuthStatus().hasApiKey, true, "Auth status must show the API key set");
    assert.strictEqual(getAuthStatus().source, "api-key", "Auth status source must be api-key");
    console.log("  [PASS] setApiKey OK");

    // 7f. clearApiKey keeps the minted DB session behind it
    console.log("7f. Testing clearApiKey keeps the DB session...");
    const clearRes = clearApiKey();
    assert.strictEqual(clearRes.removed, true, "clearApiKey must report removal");
    assert.strictEqual(clearRes.keptDbSession, true, "The DB session must be kept when a dbUrl exists");
    const afterClear = loadSecrets();
    assert.strictEqual(afterClear.apiToken, undefined, "apiToken must be gone after clearApiKey");
    assert.strictEqual(afterClear.token, "mock-db-jwt-token-db", "Minted DB token must remain");
    assert.strictEqual(getSecretsSource(), "store", "Source must fall back to store after clearApiKey");
    assert.strictEqual(getAuthStatus().hasApiKey, false, "Auth status must report no API key");
    console.log("  [PASS] clearApiKey OK");

    // 8. Direct database URL + token login (no Platform API calls)
    console.log("8. Testing loginWithDatabaseToken (direct endpoint + token)...");
    const dbLogin = await loginWithDatabaseToken({
      token: "direct-db-token-999",
      dbUrl: "libsql://my-notes-myorg.turso.io",
      username: "jules",
      validate: false,
    });
    assert.strictEqual(dbLogin.token, "direct-db-token-999", "DB-token login must persist the given token verbatim");
    assert.strictEqual(dbLogin.dbUrl, "libsql://my-notes-myorg.turso.io", "DB-token login must persist the given URL verbatim");
    assert.strictEqual(dbLogin.org, "myorg", "DB-token login must derive the org from the endpoint host");
    assert.strictEqual(dbLogin.db, "my-notes", "DB-token login must derive the database name from the endpoint host");

    const storeAfterDb = loadSecrets();
    assert.strictEqual(storeAfterDb.token, "direct-db-token-999", "Store must contain the direct DB token");
    assert.strictEqual(storeAfterDb.dbUrl, "libsql://my-notes-myorg.turso.io", "Store must contain the direct DB URL");
    console.log("  [PASS] Database URL + Token Login OK");

    // 9. loginFromEnv headless branches (db-token env vars and account API token)
    console.log("9. Testing loginFromEnv (TURSO_DB_URL/TURSO_DB_TOKEN and TURSO_API_TOKEN)...");
    process.env.TURSO_DB_URL = "libsql://env-run-envorg.turso.io";
    process.env.TURSO_DB_TOKEN = "env-run-token";
    process.env.TURSO_ORG = "envorg";
    process.env.TURSO_DATABASE = "env-run";
    process.env.TURSO_USERNAME = "envuser";
    const envLogin = await loginFromEnv({ persist: false });
    assert.strictEqual(envLogin.ok, true, "loginFromEnv must succeed for DB-token env vars");
    assert.strictEqual(envLogin.source, "env", "loginFromEnv must tag the result as env");
    assert.strictEqual(envLogin.secrets.token, "env-run-token", "loginFromEnv must import TURSO_DB_TOKEN");
    assert.strictEqual(envLogin.secrets.dbUrl, "libsql://env-run-envorg.turso.io", "loginFromEnv must import TURSO_DB_URL");
    assert.strictEqual(envLogin.secrets.authorized, true, "Env login must be authorized");
    delete process.env.TURSO_DB_URL;
    delete process.env.TURSO_DB_TOKEN;
    delete process.env.TURSO_ORG;
    delete process.env.TURSO_DATABASE;
    delete process.env.TURSO_USERNAME;
    const storeAfterEnvLogin = loadSecrets();
    assert.strictEqual(storeAfterEnvLogin.token, "direct-db-token-999", "persist:false env login must not overwrite the store");

    process.env.TURSO_API_TOKEN = "env-api-token-999";
    process.env.TURSO_DATABASE = "token-db"; // matches the existing mock database
    const envApiLogin = await loginFromEnv({ persist: false });
    assert.strictEqual(envApiLogin.ok, true, "loginFromEnv must succeed for TURSO_API_TOKEN");
    assert.strictEqual(envApiLogin.source, "env", "API-token env login must be tagged env");
    assert.strictEqual(envApiLogin.secrets.apiToken, "env-api-token-999", "Result must carry the env API token");
    assert.strictEqual(envApiLogin.secrets.token, "mock-db-jwt-token-db", "Result must mint a DB JWT");
    assert.strictEqual(envApiLogin.secrets.dbUrl, "libsql://token-db-testuser.turso.io", "Result must resolve an endpoint");
    delete process.env.TURSO_API_TOKEN;
    delete process.env.TURSO_DATABASE;
    const storeAfterEnvApiLogin = loadSecrets();
    assert.strictEqual(storeAfterEnvApiLogin.token, "direct-db-token-999", "persist:false API-token env login must not touch the store");

    process.env.TURSO_DB_URL = "libsql://env-persist-persistorg.turso.io";
    process.env.TURSO_DB_TOKEN = "env-persist-token";
    const envPersist = await loginFromEnv({ persist: true });
    assert.strictEqual(envPersist.ok, true, "persist:true env login must succeed");
    delete process.env.TURSO_DB_URL;
    delete process.env.TURSO_DB_TOKEN;
    const storeAfterEnvPersist = loadSecrets();
    assert.strictEqual(storeAfterEnvPersist.token, "env-persist-token", "persist:true must persist env secrets to the store");
    assert.strictEqual(storeAfterEnvPersist.dbUrl, "libsql://env-persist-persistorg.turso.io", "persist:true must persist the env db url");
    console.log("  [PASS] loginFromEnv OK");

    // 10. resolveCloudSecrets short-circuit (store sessions that need no resolution)
    console.log("10. Testing resolveCloudSecrets for already-resolved sessions...");
    saveSecrets({ token: "plain-token", dbUrl: "libsql://plain-x.turso.io", authorized: true });
    const plainResolved = await resolveCloudSecrets();
    assert.strictEqual(plainResolved.token, "plain-token", "resolveCloudSecrets must return the plain store session as-is");
    assert.strictEqual(plainResolved.dbUrl, "libsql://plain-x.turso.io", "resolveCloudSecrets must keep the store dbUrl");

    saveSecrets({ token: "minted-token", dbUrl: "libsql://resolved-y.turso.io", apiToken: "stored-key", authorized: true });
    const apiKeyResolved = await resolveCloudSecrets();
    assert.strictEqual(apiKeyResolved.apiToken, "stored-key", "resolveCloudSecrets must keep the stored API token");
    assert.strictEqual(apiKeyResolved.token, "minted-token", "resolveCloudSecrets must NOT re-mint for a stored api-key session");
    assert.strictEqual(apiKeyResolved.source, "api-key", "resolveCloudSecrets must keep the api-key source tag");
    console.log("  [PASS] resolveCloudSecrets Short-Circuit OK");

    // 11. clearApiKey with no resolvable DB session -> full removal
    console.log("11. Testing clearApiKey without a DB session...");
    saveSecrets({ apiToken: "only-api-token", authorized: true });
    const clearNoDb = clearApiKey();
    assert.strictEqual(clearNoDb.removed, true, "clearApiKey must report removal");
    assert.strictEqual(clearNoDb.keptDbSession, false, "clearApiKey must report keptDbSession=false when no dbUrl");
    assert.strictEqual(loadSecrets(), null, "Secrets file must be deleted when no DB session can be kept");
    console.log("  [PASS] clearApiKey (no DB session) OK");

    // 12. getAuthStatus edge case — nothing configured at all
    console.log("12. Testing getAuthStatus with no credentials...");
    logoutFromCloud();
    resetConfig();
    const noneStatus = getAuthStatus();
    assert.strictEqual(noneStatus.source, "none", "Auth status source must be none");
    assert.strictEqual(noneStatus.configured, false, "Auth status must report not configured");
    assert.strictEqual(noneStatus.authorized, false, "Auth status must report not authorized");
    assert.strictEqual(noneStatus.hasApiKey, false, "Auth status must report no API key");
    assert.strictEqual(noneStatus.dbUrl, "", "Auth status must have an empty endpoint");
    assert.strictEqual(noneStatus.mode, "only-local", "Auth status must default to only-local");
    console.log("  [PASS] getAuthStatus Edge OK");

    // 13. MEMORY_DIR/.env file loading (Docker / CI) + process.env precedence
    console.log("13. Testing MEMORY_DIR/.env file loading...");
    const envFilePath = join(TEST_DIR, ".env");
    writeFileSync(envFilePath, 'TURSO_DB_URL="libsql://dotenv-x.turso.io"\nTURSO_DB_TOKEN=dotenv-token\nTURSO_ORG=dotorg\n# comment line\n', "utf-8");
    const dotEnvResolved = resolveEnvSecrets();
    assert.strictEqual(dotEnvResolved.dbUrl, "libsql://dotenv-x.turso.io", ".env TURSO_DB_URL must be loaded");
    assert.strictEqual(dotEnvResolved.token, "dotenv-token", ".env TURSO_DB_TOKEN must be loaded");
    assert.strictEqual(dotEnvResolved.org, "dotorg", ".env TURSO_ORG must be loaded");
    assert.strictEqual(dotEnvResolved.apiToken, null, ".env must not invent an API token");
    assert.strictEqual(getSecretsSource(), "env", "Source must be env while .env exists");
    const dotEnvLoaded = loadSecrets();
    assert.strictEqual(dotEnvLoaded.token, "dotenv-token", "loadSecrets must use the .env token");
    assert.strictEqual(dotEnvLoaded.dbUrl, "libsql://dotenv-x.turso.io", "loadSecrets must use the .env db url");
    process.env.TURSO_DB_URL = "libsql://override.turso.io";
    assert.strictEqual(resolveEnvSecrets().dbUrl, "libsql://override.turso.io", "process.env must override the .env file");
    delete process.env.TURSO_DB_URL;
    unlinkSync(envFilePath);
    assert.strictEqual(resolveEnvSecrets(), null, "After removing .env no env secrets must remain");
    console.log("  [PASS] .env File Loading OK");

    // 14. CLI wiring end-to-end (isolated child processes against index.js dispatch)
    console.log("14. Testing CLI commands (login --api-key / auth-status / logout --api-key / setup)...");
    const runCli = async (args, { cwdDir, homeDir } = {}) => {
      const childEnv = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (!k.startsWith("TURSO_")) childEnv[k] = v;
      }
      childEnv.MEMORY_DIR = cwdDir;
      childEnv.TURSO_API_BASE = mock.url;
      childEnv.TURSO_LOCATION = "test-loc";
      if (homeDir) {
        childEnv.USERPROFILE = homeDir;
        childEnv.HOME = homeDir;
        childEnv.OPENCODE_CONFIG_DIR = homeDir;
      }
      const child = spawn(process.execPath, [join(SCRIPT_DIR, "index.js"), ...args], {
        cwd: cwdDir,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      const code = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          resolve("timeout");
        }, 60000);
        child.on("error", (err) => {
          clearTimeout(timer);
          resolve(`spawn-error: ${err.message} (code=${err.code}, syscall=${err.syscall}, cwd=${err.cwd}, path=${err.path})`);
        });
        child.on("exit", (c) => {
          clearTimeout(timer);
          resolve(c);
        });
      });
      const strip = (s) => (s || "").replace(/\x1b\[[0-9;]*m/g, "");
      return {
        code: typeof code === "number" ? code : null,
        error: typeof code === "string" && code.startsWith("spawn-error") ? code : null,
        timeout: code === "timeout",
        stdout: strip(stdout),
        stderr: strip(stderr),
        out: strip(stdout) + strip(stderr),
      };
    };
    const CLI_DIR = join(TEST_DIR, "cli");
    const SETUP_DIR = join(TEST_DIR, "setup");
    const SETUP_HOME = join(TEST_DIR, "setup-home");
    mkdirSync(CLI_DIR, { recursive: true });
    mkdirSync(SETUP_DIR, { recursive: true });
    mkdirSync(SETUP_HOME, { recursive: true });
    mock.setDatabases([{ name: "cli-db" }]);
    mock.setOrganizations([]);

    const loginCli = await runCli(["login", "--api-key", "cli-api-token-123"], { cwdDir: CLI_DIR });
    assert.strictEqual(loginCli.code, 0, `login --api-key must exit 0 (error=${loginCli.error}, timeout=${loginCli.timeout}, stderr=${loginCli.stderr})`);
    assert(loginCli.out.includes("Successfully signed in"), "login --api-key must print the success message");
    assert(loginCli.out.includes("libsql://cli-db-testuser.turso.io"), "login --api-key must print the resolved endpoint");

    const statusCli = await runCli(["auth-status"], { cwdDir: CLI_DIR });
    assert.strictEqual(statusCli.code, 0, `auth-status must exit 0 (stderr: ${statusCli.stderr})`);
    assert(statusCli.out.includes("Source:        api-key"), "auth-status must report api-key source");
    assert(statusCli.out.includes("Authorized:    YES"), "auth-status must report authorized");
    assert(statusCli.out.includes("API Key:       SET"), "auth-status must report the API key set");
    assert(statusCli.out.includes("Endpoint:      libsql://cli-db-testuser.turso.io"), "auth-status must print the endpoint");

    const logoutCli = await runCli(["logout", "--api-key"], { cwdDir: CLI_DIR });
    assert.strictEqual(logoutCli.code, 0, `logout --api-key must exit 0 (stderr: ${logoutCli.stderr})`);
    assert(logoutCli.out.includes("API token removed"), "logout --api-key must confirm the token removal");
    assert(logoutCli.out.includes("database session is kept"), "logout --api-key must keep the resolved DB session");

    const statusAfterLogout = await runCli(["auth-status"], { cwdDir: CLI_DIR });
    assert.strictEqual(statusAfterLogout.code, 0, `auth-status after logout must exit 0 (stderr: ${statusAfterLogout.stderr})`);
    assert(statusAfterLogout.out.includes("API Key:       not set"), "auth-status after logout must show no API key");
    assert(statusAfterLogout.out.includes("Authorized:    YES"), "The kept DB session must stay authorized");
    console.log("  [PASS] CLI login/auth-status/logout OK");

    const setupCli = await runCli(["setup", "--api-key", "cli-api-token-123", "--mode", "only-cloud"], {
      cwdDir: SETUP_DIR,
      homeDir: SETUP_HOME,
    });
    assert.strictEqual(setupCli.code, 0, `setup must exit 0 (error=${setupCli.error}, timeout=${setupCli.timeout}, stderr: ${setupCli.stderr})`);
    assert(setupCli.out.includes("Cloud: authorized as"), "setup must authorize via the API key");
    assert(setupCli.out.includes("Setup complete"), "setup must finish");
    const setupStatus = await runCli(["auth-status"], { cwdDir: SETUP_DIR, homeDir: SETUP_HOME });
    assert(setupStatus.out.includes("Source:        api-key"), "setup must persist the api-key session");
    assert(setupStatus.out.includes("Mode:          only-cloud"), "setup --mode only-cloud must persist the mode");
    console.log("  [PASS] CLI setup OK");

    // Cleanup so the final reset starts from a clean state
    logoutFromCloud();

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
