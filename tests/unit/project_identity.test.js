import assert from "node:assert";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

export async function runProjectIdentityTests() {
  console.log("--- Running Unit Tests: project_identity ---");

  const ROOT = join(tmpdir(), `test_scoping_identity_${Date.now()}`);
  process.env.MEMORY_DIR = join(ROOT, "mem");

  const mem = await import("../../mcp-server/memory.js");
  const { getDatabase } = await import("../../mcp-server/db/database.js");
  const {
    resolveProjectIdentity,
    registerAlias,
    unregisterAlias,
    lookupByCandidates,
    listIdentities,
    upsertIdentity,
  } = await import("../../mcp-server/identity.js");

  let db;

  try {
    const machine1 = join(ROOT, "machine1");
    const machine2 = join(ROOT, "machine2");
    const nonGitDir = join(ROOT, "nongit");
    mkdirSync(machine1, { recursive: true });
    mkdirSync(machine2, { recursive: true });
    mkdirSync(nonGitDir, { recursive: true });

    const dirA = join(machine1, "repo");
    const dirB = join(machine2, "repo");

    const GIT_CMD = process.platform === "win32" ? "git.exe" : "git";
    execFileSync(GIT_CMD, ["init", dirA], { stdio: "ignore" });
    execFileSync(GIT_CMD, ["-C", dirA, "remote", "add", "origin", "https://github.com/myorg/myrepo.git"], { stdio: "ignore" });

    execFileSync(GIT_CMD, ["init", dirB], { stdio: "ignore" });
    execFileSync(GIT_CMD, ["-C", dirB, "remote", "add", "origin", "https://github.com/myorg/myrepo.git"], { stdio: "ignore" });

    // (1) One remote on different paths -> Same Key
    const keyA = await mem.projectKey(null, dirA);
    const keyB = await mem.projectKey(null, dirB);

    assert.strictEqual(keyA, keyB, "Different directories with same remote MUST resolve to same identity key");
    assert.strictEqual(keyA, "git:github.com/myorg/myrepo", "Key should match normalized URL");
    console.log("  [PASS] 1. One remote on different paths resolves to same key");

    // (2) Subfolder in repo -> Same key as toplevel
    const subfolder = join(dirA, "src", "components");
    mkdirSync(subfolder, { recursive: true });
    const keySub = await mem.projectKey(null, subfolder);
    assert.strictEqual(keySub, keyA, "Subfolder in repo should resolve to same toplevel key");
    console.log("  [PASS] 2. Subfolder in repo resolves to toplevel key");

    // (3) Non-git folder -> null key
    const keyNon = await mem.projectKey(null, nonGitDir);
    assert.strictEqual(keyNon, null, "Non-git folder should resolve to null key");
    console.log("  [PASS] 3. Non-git directory resolves to null project key");

    // (4) Link project memory
    db = await getDatabase();
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

    // (5) lookup via alias, then unregister alias keeps identity
    const pathAlias = `path:${mem.canonicalPath(dirA)}`;
    const lookedUp = await lookupByCandidates(db, [pathAlias, "git:github.com/myorg/myrepo"]);
    assert.strictEqual(lookedUp, identity.key, "Alias should resolve to identity key via lookupByCandidates");
    await unregisterAlias(db, pathAlias);
    const afterUnlink = await lookupByCandidates(db, [pathAlias]);
    assert.strictEqual(afterUnlink, null, "After unregistering alias, path lookup returns null");
    const idsStill = await listIdentities(db);
    assert(idsStill.some((id) => id.key === identity.key), "Identity retained after alias removal (unlink keeps identity)");
    console.log("  [PASS] 5. Unregister alias removes mapping but keeps identity");

  } finally {
    try {
      if (db && typeof db.close === "function") db.close();
    } catch (e) {}
    try {
      rmSync(ROOT, { recursive: true, force: true });
    } catch (e) {}
  }

  console.log("✅ ALL PROJECT IDENTITY SCENARIOS PASSED SUCCESSFULLY!");
}

if (process.argv[1] && process.argv[1].endsWith("project_identity.test.js")) {
  runProjectIdentityTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
