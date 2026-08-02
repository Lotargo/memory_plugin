import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { encryptData, decryptData, saveSecrets, loadSecrets, deleteSecrets } from "./config/auth_store.js";
import { loginToCloud, logoutFromCloud } from "./admin/auth.js";
import { getConfig, updateConfig, resetConfig } from "./config/config_manager.js";

console.log("--- Starting Cloud & Auth Phase 1 Integration Tests ---");

try {
  // 1. Test AES-256-GCM encryption and decryption with hardware/fingerprint key KDF
  console.log("1. Testing AES-256-GCM and fingerprint KDF encryption...");
  const secretText = JSON.stringify({ token: "test-token-12345", dbUrl: "libsql://test.turso.io" });
  const encrypted = encryptData(secretText);

  assert(encrypted.includes(":"), "Encrypted payload must contain colon separators");
  assert.strictEqual(encrypted.split(":").length, 3, "Encrypted payload must contain 3 parts (iv, authTag, ciphertext)");

  const decrypted = decryptData(encrypted);
  assert.strictEqual(decrypted, secretText, "Decrypted text must match the original secret text");
  console.log("  [PASS] Encryption & Decryption OK");

  // 2. Test Secrets Storage Saving & Loading
  console.log("2. Testing saveSecrets and loadSecrets auth store methods...");
  const secretsObj = { token: "secret-token", dbUrl: "libsql://db.turso.io" };
  saveSecrets(secretsObj);

  const loaded = loadSecrets();
  assert.deepStrictEqual(loaded, secretsObj, "Loaded secrets must exactly match saved secrets");
  console.log("  [PASS] Save & Load Secrets OK");

  // 3. Test simulated loopback HTTP server login flow
  console.log("3. Testing simulated login to Turso Cloud using loopback server...");
  const simulatedParams = { token: "simulated-oauth-token-999", dbUrl: "libsql://simulated-db.turso.io" };

  const loginRes = await loginToCloud({
    customPort: 48905,
    simulated: true,
    simulatedParams,
  });

  assert.strictEqual(loginRes.token, simulatedParams.token, "Login token must match simulated token");
  assert.strictEqual(loginRes.dbUrl, simulatedParams.dbUrl, "Login db_url must match simulated db_url");

  const activeConfigAfterLogin = getConfig();
  assert.strictEqual(activeConfigAfterLogin.tursoUrl, simulatedParams.dbUrl, "Config tursoUrl should update after successful login");

  const loadedSecretsAfterLogin = loadSecrets();
  assert.strictEqual(loadedSecretsAfterLogin.token, simulatedParams.token, "Secret token should be written to auth_store after login");
  console.log("  [PASS] Cloud Login & Loopback HTTP Server OK");

  // 4. Test Cloud Logout
  console.log("4. Testing logoutFromCloud...");
  // Set mode to hybrid-sync first to test that logout resets it to only-local
  updateConfig({ mode: "hybrid-sync" });
  assert.strictEqual(getConfig().mode, "hybrid-sync", "Config mode should successfully update to hybrid-sync");

  const logoutRes = logoutFromCloud();
  assert.strictEqual(logoutRes, true, "logoutFromCloud should return true indicating the secret file was deleted");
  assert.strictEqual(loadSecrets(), null, "Secrets should be completely deleted from disk upon logout");

  const configAfterLogout = getConfig();
  assert.strictEqual(configAfterLogout.mode, "only-local", "Logout must revert operational mode to 'only-local'");
  assert.strictEqual(configAfterLogout.tursoUrl, "", "Logout must clear the tursoUrl config option");
  console.log("  [PASS] Cloud Logout & Config Reset OK");

  // Cleanup config back to defaults
  resetConfig();

  console.log("\n✅ ALL CLOUD & AUTH INTEGRATION TESTS PASSED SUCCESSFULLY!");
} catch (err) {
  console.error("\n❌ CLOUD & AUTH INTEGRATION TEST FAILED:", err);
  process.exit(1);
}
