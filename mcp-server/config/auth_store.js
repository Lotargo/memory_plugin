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

// Save secrets securely
export function saveSecrets(secrets) {
  ensureDirSync();
  const plainText = JSON.stringify(secrets);
  const encrypted = encryptData(plainText);
  fs.writeFileSync(SECRETS_FILE, encrypted, "utf-8");
}

// Load secrets securely
export function loadSecrets() {
  if (!fs.existsSync(SECRETS_FILE)) {
    return null;
  }
  try {
    const encrypted = fs.readFileSync(SECRETS_FILE, "utf-8").trim();
    if (!encrypted) return null;
    const decrypted = decryptData(encrypted);
    return JSON.parse(decrypted);
  } catch (err) {
    console.error(
      "Failed to decrypt or load cloud secrets:",
      err.message,
      "— the file was encrypted with a different machine key. Re-run login to recreate it."
    );
    return null;
  }
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
