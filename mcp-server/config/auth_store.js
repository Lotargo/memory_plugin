import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { execSync } from "node:child_process";
import { MEMORY_DIR, ensureDirSync } from "../memory.js";

const SECRETS_FILE = path.join(MEMORY_DIR, "auth_secrets.enc");

// ── Module-level caches ─────────────────────────────────────────────────────
// These avoid re-running expensive sync operations (execSync, PBKDF2, file I/O)
// on every CLI navigation or tool call.  invalidateAuthCache() must be called
// whenever secrets are deleted or the API key is removed.
let _cachedMachineId = undefined;  // undefined = not yet resolved
let _cachedFingerprint = null;
let _cachedEncryptionKey = null;
let _cachedSecrets = undefined;    // undefined = not loaded, null = no secrets, object = cached
let _cachedSecretsMtime = 0;

export function invalidateAuthCache() {
  _cachedSecrets = undefined;
  _cachedSecretsMtime = 0;
  // Keep machineId / fingerprint / key cached — they don't change per-session.
}

// Stable per-machine identifier. Must NOT rely on volatile values (e.g.
// os.networkInterfaces() — VPN adapters, hotspot IPs and IPv6 privacy
// addresses rotate constantly and would silently change the AES key).
function getMachineId() {
  if (_cachedMachineId !== undefined) return _cachedMachineId;
  let id = null;
  try {
    if (process.platform === "win32") {
      const out = execSync("reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/i);
      if (m) id = m[1].toLowerCase();
    } else if (process.platform === "linux") {
      for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
        try {
          const v = fs.readFileSync(p, "utf8").trim();
          if (v) { id = v; break; }
        } catch {}
      }
    } else if (process.platform === "darwin") {
      const out = execSync("ioreg -rd1 -c IOPlatformExpertDevice", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) id = m[1];
    }
  } catch {}
  _cachedMachineId = id;
  return _cachedMachineId;
}

// OWASP 2023 recommendation for PBKDF2-HMAC-SHA256.
const PBKDF2_ITERATIONS = 600000;
const LEGACY_PBKDF2_ITERATIONS = 10000;

// Generate a deterministic hardware fingerprint. Only STABLE components are used:
// hostname and username are volatile (renaming the machine or the account would
// permanently lock the user out of their own secrets), so they are excluded.
function getSystemFingerprint() {
  if (_cachedFingerprint !== null && _cachedFingerprint !== undefined) return _cachedFingerprint;
  const parts = [
    getMachineId() || "no-machine-id",
    os.platform() || "unknown",
    os.arch() || "unknown",
  ];
  _cachedFingerprint = parts.join("|");
  return _cachedFingerprint;
}

// Fingerprint used by <= 1.5.3 (included volatile hostname/username).
function getLegacyFingerprint() {
  return [
    getMachineId() || "no-machine-id",
    os.hostname() || "localhost",
    os.userInfo()?.username || "default_user",
    os.platform() || "unknown",
    os.arch() || "unknown",
  ].join("|");
}

function deriveKey(fingerprint, iterations) {
  const salt = crypto.createHash("sha256").update(fingerprint).digest();
  return crypto.pbkdf2Sync(fingerprint, salt, iterations, 32, "sha256");
}

// Derive a 256-bit (32 bytes) key using PBKDF2 with salt derived from fingerprint
function deriveEncryptionKey() {
  if (_cachedEncryptionKey) return _cachedEncryptionKey;
  _cachedEncryptionKey = deriveKey(getSystemFingerprint(), PBKDF2_ITERATIONS);
  return _cachedEncryptionKey;
}

// Keys accepted for DECRYPTION only, so secrets written by older versions keep
// working; they are transparently re-encrypted with the current key on read.
function legacyDecryptionKeys() {
  return [
    deriveKey(getLegacyFingerprint(), LEGACY_PBKDF2_ITERATIONS),
    deriveKey(getSystemFingerprint(), LEGACY_PBKDF2_ITERATIONS),
  ];
}

// Encrypt data using AES-256-GCM
export function encryptData(plainText) {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV is standard for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  // Format as: iv_hex:auth_tag_hex:encrypted_hex
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

// Decrypt data using AES-256-GCM
export function decryptData(encryptedStr) {
  const parts = encryptedStr.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format. Expected iv:tag:ciphertext");
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const tryKey = (key) => {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  };

  try {
    return tryKey(deriveEncryptionKey());
  } catch (err) {
    for (const legacyKey of legacyDecryptionKeys()) {
      try {
        const plain = tryKey(legacyKey);
        _needsReEncrypt = true;
        return plain;
      } catch {}
    }
    throw err;
  }
}

// Set when a secret was decrypted with a legacy key so it can be rewritten
// under the current derivation parameters.
let _needsReEncrypt = false;

// Load a KEY=VALUE .env file from MEMORY_DIR (global environment override for
// headless / Docker / CI deployments). Values may optionally be quoted.
function loadEnvFile() {
  const envFile = path.join(MEMORY_DIR, ".env");
  if (!fs.existsSync(envFile)) return {};
  try {
    const out = {};
    const raw = fs.readFileSync(envFile, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

const ENV_DB_URL_KEYS = ["TURSO_DB_URL", "TURSO_URL"];
const ENV_DB_TOKEN_KEYS = ["TURSO_DB_TOKEN", "TURSO_TOKEN"];

function firstDefined(source, keys) {
  for (const k of keys) {
    const v = source[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return null;
}

// Resolve cloud credentials from the environment (process.env) or a
// MEMORY_DIR/.env file — the headless alternative to browser OAuth login.
// Supported vars: TURSO_DB_URL / TURSO_URL, TURSO_DB_TOKEN / TURSO_TOKEN,
// TURSO_API_TOKEN, TURSO_ORG, TURSO_DATABASE / TURSO_DB_NAME, TURSO_USERNAME.
// Returns null when no cloud secrets are present at all.
export function resolveEnvSecrets() {
  const fileVars = loadEnvFile();
  const merged = { ...fileVars, ...process.env };
  const dbUrl = firstDefined(merged, ENV_DB_URL_KEYS);
  const token = firstDefined(merged, ENV_DB_TOKEN_KEYS);
  const apiToken = firstDefined(merged, ["TURSO_API_TOKEN"]);
  const org = firstDefined(merged, ["TURSO_ORG"]);
  const database = firstDefined(merged, ["TURSO_DATABASE", "TURSO_DB_NAME"]);
  const username = firstDefined(merged, ["TURSO_USERNAME"]);
  if (!dbUrl && !token && !apiToken) return null;
  return { dbUrl, token, apiToken, org, database, username, source: "env" };
}

// Read the encrypted store file ONLY (no environment merge). Returns the raw
// parsed record, or null when the file is missing / undecryptable.
function readStoredSecrets() {
  try {
    if (fs.existsSync(SECRETS_FILE)) {
      const mtime = fs.statSync(SECRETS_FILE).mtimeMs;
      if (_cachedSecrets !== undefined && mtime === _cachedSecretsMtime) {
        return _cachedSecrets;
      }
      _cachedSecretsMtime = mtime;
    } else {
      // File doesn't exist — clear cache
      if (_cachedSecrets !== undefined && _cachedSecrets === null) return null;
      _cachedSecrets = null;
      _cachedSecretsMtime = 0;
      return null;
    }
  } catch {}
  try {
    const encrypted = fs.readFileSync(SECRETS_FILE, "utf-8").trim();
    if (!encrypted) { _cachedSecrets = null; return null; }
    _needsReEncrypt = false;
    _cachedSecrets = JSON.parse(decryptData(encrypted));
    if (_needsReEncrypt) {
      _needsReEncrypt = false;
      try {
        writeSecretsFile(encryptData(JSON.stringify(_cachedSecrets)));
        _cachedSecretsMtime = fs.statSync(SECRETS_FILE).mtimeMs;
      } catch {}
    }
    return _cachedSecrets;
  } catch (err) {
    console.error(
      "Failed to decrypt or load cloud secrets:",
      err.message,
      "— the file was encrypted with a different machine key. Re-run login to recreate it."
    );
    _cachedSecrets = null;
    return null;
  }
}

// Where are cloud credentials coming from right now?
//   "env"     — TURSO_API_TOKEN / TURSO_DB_URL + TURSO_DB_TOKEN from env or .env
//   "api-key" — a stored Turso account API-token session (takes priority over browser)
//   "store"   — a stored browser OAuth / database-token session
//   null      — nothing configured
export function getSecretsSource() {
  const envSecrets = resolveEnvSecrets();
  if (envSecrets && (envSecrets.apiToken || envSecrets.dbUrl)) return "env";
  const stored = readStoredSecrets();
  if (stored) return stored.apiToken ? "api-key" : "store";
  return null;
}

// Save secrets securely
// Write the secrets file with owner-only permissions (0600). On Linux/macOS a
// default 0644 would let any other local user read auth_secrets.enc.
function writeSecretsFile(encrypted) {
  fs.writeFileSync(SECRETS_FILE, encrypted, { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(SECRETS_FILE, 0o600);
  } catch {}
}

export function saveSecrets(secrets) {
  ensureDirSync();
  const plainText = JSON.stringify(secrets);
  const encrypted = encryptData(plainText);
  writeSecretsFile(encrypted);
  _cachedSecrets = undefined;  // invalidate so readStoredSecrets re-reads
  _cachedSecretsMtime = 0;
  if (typeof _onSecretsChanged === "function") _onSecretsChanged();
}

let _onSecretsChanged = null;
export function onSecretsChanged(cb) { _onSecretsChanged = cb; }

// Load secrets securely. Priority (highest first):
//   1. Env account API token (TURSO_API_TOKEN) — reused from the store when a
//      session was already minted for this exact token, else returned with
//      needsResolution: true so callers can mint a DB JWT asynchronously.
//   2. Env database URL + token (TURSO_DB_URL + TURSO_DB_TOKEN).
//   3. Encrypted store: an API-key session beats a browser/database-token session.
// The env sources let Docker, Google Jules and VPS deployments work without
// any interactive login step.
export function loadSecrets() {
  const envSecrets = resolveEnvSecrets();
  if (envSecrets && envSecrets.apiToken) {
    const stored = readStoredSecrets();
    if (stored && stored.apiToken === envSecrets.apiToken && stored.dbUrl) {
      return { ...stored, source: "api-key" };
    }
    return {
      token: envSecrets.apiToken,
      apiToken: envSecrets.apiToken,
      dbUrl: envSecrets.dbUrl || "",
      org: envSecrets.org || "",
      db: envSecrets.database || "",
      username: envSecrets.username || "",
      authorized: true,
      source: "env",
      needsResolution: true,
    };
  }
  if (envSecrets && envSecrets.dbUrl && envSecrets.token) {
    return {
      token: envSecrets.token,
      dbUrl: envSecrets.dbUrl,
      org: envSecrets.org || "",
      db: envSecrets.database || "",
      username: envSecrets.username || "",
      authorized: true,
      source: "env",
    };
  }
  const stored = readStoredSecrets();
  if (stored) {
    if (stored.apiToken) return { ...stored, source: "api-key" };
    return stored;
  }
  return null;
}

// Delete secrets from disk
export function deleteSecrets() {
  if (fs.existsSync(SECRETS_FILE)) {
    try {
      fs.unlinkSync(SECRETS_FILE);
      _cachedSecrets = null;
      _cachedSecretsMtime = 0;
      return true;
    } catch (err) {
      console.error("Failed to delete secrets file:", err.message);
    }
  }
  return false;
}
