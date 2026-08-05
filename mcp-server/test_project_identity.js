import assert from "node:assert";
import { rmSync, existsSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import * as mem from "./memory.js";
import { getDatabase } from "./db/database.js";
import { resolveProjectIdentity, registerAlias, listIdentities, upsertIdentity } from "./identity.js";

console.log("--- Running test_project_identity.js Regression Tests ---");

const ROOT = join(tmpdir(), `test_scoping_identity_${Date.now()}`);

try {
  // Setup temp directories simulating different machines/folders
  const dirA = join(ROOT, "machine1", "repo");
  const dirB = join(ROOT, "machine2", "repo");
  const nonGitDir = join(ROOT, "nongit");

  execSync(`git init "${dirA}"`);
  execSync(`git -C "${dirA}" remote add origin https://github.com/myorg/myrepo.git`);

  execSync(`git init "${dirB}"`);
  execSync(`git -C "${dirB}" remote add origin https://github.com/myorg/myrepo.git`);

  execSync(`mkdir -p "${nonGitDir}"`);

  // (1) One remote on different paths -> Same Key
  const keyA = await mem.projectKey(null, dirA);
  const keyB = await mem.projectKey(null, dirB);

  assert.strictEqual(keyA, keyB, "Different directories with same remote MUST resolve to same identity key");
  assert.strictEqual(keyA, "git:github.com/myorg/myrepo", "Key should match normalized URL");
  console.log("  [PASS] 1. One remote on different paths resolves to same key");

  // (2) Subfolder in repo -> Same key as toplevel
  const subfolder = join(dirA, "src", "components");
  execSync(`mkdir -p "${subfolder}"`);
  const keySub = await mem.projectKey(null, subfolder);
  assert.strictEqual(keySub, keyA, "Subfolder in repo should resolve to same toplevel key");
  console.log("  [PASS] 2. Subfolder in repo resolves to toplevel key");

  // (3) Non-git folder -> null key
  const keyNon = await mem.projectKey(null, nonGitDir);
  assert.strictEqual(keyNon, null, "Non-git folder should resolve to null key");
  console.log("  [PASS] 3. Non-git directory resolves to null project key");

  // (4) Link project memory
  const db = await getDatabase();
  const identity = await resolveProjectIdentity(dirA);
  assert(identity, "Should resolve identity");
  await mem.writeMemory(identity.key, ["- [2026-08-03 12:00] **Initial** — Old project fact"]);

  // Upsert project identity first
  await upsertIdentity(db, { key: identity.key, name: identity.name, primaryRemote: identity.primaryRemote });

  // Register alias and link
  await registerAlias(db, { alias: `path:${mem.canonicalPath(dirA)}`, identityKey: identity.key, kind: "path" });
  const ids = await listIdentities(db);
  assert(ids.some((id) => id.key === identity.key), "Identity should be present in Registry database");
  console.log("  [PASS] 4. Registry identity and alias registration succeeds");

} catch (err) {
  console.error("❌ test_project_identity.js FAILED:", err);
  process.exit(1);
} finally {
  try {
    rmSync(ROOT, { recursive: true, force: true });
  } catch (e) {}
}

console.log("✅ ALL PROJECT IDENTITY SCENARIOS PASSED SUCCESSFULLY!");
