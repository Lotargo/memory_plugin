import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { execSync } from "node:child_process";
import { MEMORY_DIR, ensureDirSync } from "../memory.js";

const SECRETS_FILE = path.join(MEMORY_DIR, "auth_secrets.enc");

// Stable per-machine identifier. Must NOT rely on volatile values (e.g.
// os.networkInterfaces() — VPN adapters, hotspot IPs and IPv6 privacy
// addresses rotate constantly and would silently change the AES key).
function getMachineId() {
  try {
    if (process.platform === "win32") {
      const out = execSync("reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/i);
      if (m) return m[1].toLowerCase();
    } else if (process.platform === "linux") {
      for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
        try {
          const v = fs.readFileSync(p, "utf8").trim();
          if (v) return v;
        } catch {}
      }
    } else if (process.platform === "darwin") {
      const out = execSync("ioreg -rd1 -c IOPlatformExpertDevice", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

// Generate a deterministic hardware + system fingerprint (stable across reboots,
// network changes and user sessions on the same machine).
function getSystemFingerprint() {
  const parts = [
    getMachineId() || "no-machine-id",
    os.hostname() || "localhost",
    os.userInfo()?.username || "default_user",
    os.platform() || "unknown",
    os.arch() || "unknown",
  ];
  return parts.join("|");
}

// Derive a 256-bit (32 bytes) key using PBKDF2 with salt derived from fingerprint
function deriveEncryptionKey() {
  const fingerprint = getSystemFingerprint();
  const salt = crypto.createHash("sha256").update(fingerprint).digest();
  // PBKDF2 with 10,000 iterations to derive a secure 32-byte key
  return crypto.pbkdf2Sync(fingerprint, salt, 10000, 32, "sha256");
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
  const key = deriveEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

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
  if (!fs.existsSync(SECRETS_FILE)) return null;
  try {
    const encrypted = fs.readFileSync(SECRETS_FILE, "utf-8").trim();
    if (!encrypted) return null;
    return JSON.parse(decryptData(encrypted));
  } catch (err) {
    console.error(
      "Failed to decrypt or load cloud secrets:",
      err.message,
      "— the file was encrypted with a different machine key. Re-run login to recreate it."
    );
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
export function saveSecrets(secrets) {
  ensureDirSync();
  const plainText = JSON.stringify(secrets);
  const encrypted = encryptData(plainText);
  fs.writeFileSync(SECRETS_FILE, encrypted, "utf-8");
}

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
      return true;
    } catch (err) {
      console.error("Failed to delete secrets file:", err.message);
    }
  }
  return false;
}
