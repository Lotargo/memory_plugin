import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { MEMORY_DIR, ensureDirSync } from "../memory.js";

const SECRETS_FILE = path.join(MEMORY_DIR, "auth_secrets.enc");

// Generate a deterministic hardware + system fingerprint
function getSystemFingerprint() {
  const parts = [
    os.hostname() || "localhost",
    os.userInfo()?.username || "default_user",
    os.platform() || "unknown",
    os.arch() || "unknown",
    // Fallback if network interfaces list is empty or can't be fetched
    JSON.stringify(os.networkInterfaces() || {}),
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
    console.error("Failed to decrypt or load cloud secrets:", err.message);
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
