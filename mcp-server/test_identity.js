import assert from "node:assert";
import { normalizeRemoteUrl, detectGitToplevel, getRemoteUrls, resolveProjectIdentity } from "./identity.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { rmSync, existsSync } from "node:fs";

console.log("--- Running test_identity.js Unit Tests ---");

// Test normalizeRemoteUrl
assert.strictEqual(normalizeRemoteUrl("https://github.com/lotargo/memory_plugin.git"), "github.com/lotargo/memory_plugin");
assert.strictEqual(normalizeRemoteUrl("git@github.com:lotargo/memory_plugin.git"), "github.com/lotargo/memory_plugin");
assert.strictEqual(normalizeRemoteUrl("ssh://git@github.com:22/lotargo/memory_plugin.git"), "github.com/lotargo/memory_plugin");
assert.strictEqual(normalizeRemoteUrl("https://user:password@bitbucket.org/owner/repo.git/"), "bitbucket.org/owner/repo");
assert.strictEqual(normalizeRemoteUrl(""), "");

// Test detectGitToplevel on actual repo (this repo)
const repoToplevel = await detectGitToplevel(process.cwd());
assert(repoToplevel, "Should detect process.cwd() as git toplevel");
assert(existsSync(join(repoToplevel, ".git")), "process.cwd() .git should exist");

// Let's create a temp fake git repo without remote
const tempRepoDir = join(tmpdir(), `fake_repo_${Date.now()}`);
execSync(`git init "${tempRepoDir}"`);

const fakeToplevel = await detectGitToplevel(tempRepoDir);
assert.strictEqual(fakeToplevel, tempRepoDir, "Should detect temp dir as git toplevel");

const remotesBefore = await getRemoteUrls(tempRepoDir);
assert.strictEqual(remotesBefore.length, 0, "Fake repo should have no remotes initially");

const identityLocal = await resolveProjectIdentity(tempRepoDir);
assert.strictEqual(identityLocal.key, `git:local:${join(tempRepoDir, "..") ? tempRepoDir.split(/[\\/]/).pop() : "default"}`);

// Add remote
execSync(`git -C "${tempRepoDir}" remote add origin https://github.com/dummy/fake-repo.git`);
const remotesAfter = await getRemoteUrls(tempRepoDir);
assert.strictEqual(remotesAfter.length, 1, "Fake repo should have 1 remote");
assert.strictEqual(normalizeRemoteUrl(remotesAfter[0]), "github.com/dummy/fake-repo");

// Cleanup cache
import { bustIdentityCache } from "./identity.js";
bustIdentityCache();

const identityRemote = await resolveProjectIdentity(tempRepoDir);
assert.strictEqual(identityRemote.key, "git:github.com/dummy/fake-repo");

console.log("✅ All identity unit tests passed successfully!");

// Cleanup temp repo
rmSync(tempRepoDir, { recursive: true, force: true });
