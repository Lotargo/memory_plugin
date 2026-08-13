import assert from "node:assert";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, readdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export async function runMcpToolsTests() {
  console.log("--- Running Integration Tests: mcp_tools ---");
  const temp = mkdtempSync(join(tmpdir(), "mcp-tools-"));
  const MEMORY_DIR = join(temp, "mem");
  const GIT_CMD = process.platform === "win32" ? "git.exe" : "git";
  execFileSync(GIT_CMD, ["init"], { cwd: temp, stdio: "ignore" });

  let id = 0;
  const pending = new Map();
  let child;
  let buf = "";
  let output = [];

  function send(obj) {
    child.stdin.write(JSON.stringify(obj) + "\n");
  }

  function request(method, params) {
    return new Promise((resolve2, reject2) => {
      const rid = ++id;
      pending.set(rid, { resolve: resolve2, reject: reject2 });
      send({ jsonrpc: "2.0", id: rid, method, params });
    });
  }

  function onLine(line) {
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  }

  function toolResult(result) {
    const text = (result?.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    return text;
  }

  function withTimeout(p, ms, what) {
    return Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout waiting for ${what}`)), ms)),
    ]);
  }

  const ok = (name) => {
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  };

  function waitExit(c) {
    return new Promise((res) => {
      if (c.exitCode !== null) res();
      else c.once("exit", res);
    });
  }

  function attach(c) {
    c.stdout.setEncoding("utf8");
    c.stderr.setEncoding("utf8");
    c.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim()) {
          try {
            onLine(line);
          } catch (e) {
            output.push(`[PARSE ERR] ${line}: ${e.message}`);
          }
        }
      }
    });
    c.stderr.on("data", (d) => {
      output.push(`[stderr] ${d.trim()}`);
    });
    c.on("error", (e) => output.push(`[spawn error] ${e.message}`));
    c.on("exit", (code, signal) => output.push(`[exit] code=${code} signal=${signal}`));
  }

  child = spawn(process.execPath, [join(ROOT, "mcp-server/index.js")], {
    cwd: temp,
    env: { ...process.env, MEMORY_DIR },
    stdio: ["pipe", "pipe", "pipe"],
  });
  attach(child);

  try {
    await withTimeout(request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "hermetic-test", version: "1.0.0" },
    }), 15000, "initialize");
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

    const r1 = toolResult(await request("tools/call", { name: "remember", arguments: { scope: "project", fact: "alpha prefers vanilla ice cream" } }));
    assert.ok(r1.includes("Memory updated"), r1);
    ok("remember: plain fact");

    const storeFile = join(MEMORY_DIR, readdirSync(MEMORY_DIR).find((f) => f.endsWith(".md") && f !== "global.md"));

    const r2 = toolResult(await request("tools/call", { name: "remember", arguments: { scope: "project", fact: "alpha workspace uses ESM", ttl: "30d", keep: true, tags: "setup,pref" } }));
    assert.ok(r2.includes("Memory updated"), r2);
    ok("remember: ttl + keep + tags");

    const r3 = toolResult(await request("tools/call", { name: "remember", arguments: { scope: "project", fact: "alpha uses ESM (v2)", supersedes: "alpha workspace uses ESM" } }));
    assert.ok(r3.includes("superseded"), r3);
    ok("remember: supersedes marks target");

    appendFileSync(storeFile, "- [2025-01-01 00:00] **Legacy Preference** — legacy preference without metadata\n");
    const legacySupersede = toolResult(await request("tools/call", {
      name: "remember",
      arguments: { scope: "project", fact: "legacy preference replacement", supersedes: "legacy preference without metadata" },
    }));
    assert.ok(legacySupersede.includes("superseded"), legacySupersede);
    const legacyLines = readFileSync(storeFile, "utf8").split("\n").filter((line) => line.includes("legacy preference"));
    const legacyTargetId = legacyLines[0].match(/\bid:([^\s]+)\b/)?.[1];
    const legacyReplacementId = legacyLines[1].match(/\bid:([^\s]+)\b/)?.[1];
    assert.ok(legacyTargetId && legacyReplacementId && legacyTargetId !== legacyReplacementId, JSON.stringify(legacyLines));
    await request("tools/call", { name: "forget", arguments: { scope: "project", query: "legacy preference", force: true } });
    ok("remember: legacy supersede assigns distinct IDs");

    const rec = toolResult(await request("tools/call", { name: "recall", arguments: { scope: "project" } }));
    assert.ok(rec.includes("alpha prefers vanilla ice cream"), rec);
    assert.ok(rec.includes("alpha uses ESM (v2)"), rec);
    assert.ok(!rec.includes("[SUPERSEDED]"), rec);
    assert.ok(rec.includes("Store file: "), rec);
    ok("recall: excludes superseded history by default + shows store path");

    const recHistory = toolResult(await request("tools/call", { name: "recall", arguments: { scope: "project", includeSuperseded: true } }));
    assert.ok(recHistory.includes("[SUPERSEDED]"), recHistory);
    ok("recall: includeSuperseded exposes version history explicitly");

    const recQ = toolResult(await request("tools/call", { name: "recall", arguments: { scope: "project", query: "vanilla" } }));
    assert.ok(recQ.includes("vanilla") && !recQ.includes("ESM"), recQ);
    ok("recall: query filter");

    const recT = toolResult(await request("tools/call", { name: "recall", arguments: { scope: "project", tags: "pref", includeSuperseded: true } }));
    assert.ok(recT.includes("ESM") && !recT.includes("vanilla"), recT);
    ok("recall: tags filter");

    const u1 = toolResult(await request("tools/call", { name: "update_fact", arguments: { scope: "project", id: "alpha prefers vanilla ice cream", newText: "alpha prefers matcha ice cream" } }));
    assert.ok(u1.includes("Fact updated"), u1);
    const storeAfterUpdate = readFileSync(storeFile, "utf8");
    assert.ok(storeAfterUpdate.includes("**alpha prefers vanilla ice cream** — alpha prefers matcha ice cream"), storeAfterUpdate);
    assert.ok(!storeAfterUpdate.includes("**alpha prefers vanilla ice cream** — alpha prefers vanilla ice cream"), storeAfterUpdate);
    ok("update_fact: rewrites body, preserves title/date/meta");

    const f1 = toolResult(await request("tools/call", { name: "forget", arguments: { scope: "project", query: "alpha workspace uses ESM" } }));
    assert.ok(f1.includes("protected"), f1);
    assert.ok(readFileSync(storeFile, "utf8").includes("alpha workspace uses ESM"), "keep fact must remain");
    ok("forget: keep-protected fact skipped");

    const f2 = toolResult(await request("tools/call", { name: "forget", arguments: { scope: "project", query: "alpha workspace uses ESM", force: true } }));
    assert.ok(f2.includes("Memory updated"), f2);
    assert.ok(!readFileSync(storeFile, "utf8").includes("alpha workspace uses ESM"));
    ok("forget: force removes keep-protected fact");

    const f3 = toolResult(await request("tools/call", { name: "forget", arguments: { scope: "project", query: "matcha" } }));
    assert.ok(f3.includes("Memory updated"), f3);
    assert.ok(!readFileSync(storeFile, "utf8").includes("matcha"));
    ok("forget: normal fact removed");

    const mi = toolResult(await request("tools/call", { name: "memory_info", arguments: {} }));
    assert.ok(mi.includes("Version:"), mi);
    assert.ok(mi.includes("MEMORY_DIR: " + MEMORY_DIR), mi);
    assert.ok(mi.includes("SQLite DB:"), mi);
    assert.ok(mi.includes("Registry:"), mi);
    assert.ok(mi.includes("RAG:"), mi);
    ok("memory_info: version, paths, RAG stats");

    const lines = readFileSync(storeFile, "utf8").split("\n").filter((l) => l.startsWith("- ["));
    assert.equal(lines.length, 1, JSON.stringify(lines));
    ok("store file left with exactly 1 fact (superseding v2)");

    // B2.4: remember(scope:"project") must error when cwd is not a git repo
    child.kill();
    await waitExit(child);
    buf = "";
    output = [];
    const nonGitDir = mkdtempSync(join(tmpdir(), "mcp-nongit-"));
    child = spawn(process.execPath, [join(ROOT, "mcp-server/index.js")], {
      cwd: nonGitDir,
      env: { ...process.env, MEMORY_DIR: join(nonGitDir, "mem") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    attach(child);
    await withTimeout(request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "hermetic-test", version: "1.0.0" },
    }), 15000, "initialize");
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    const neg = toolResult(await request("tools/call", { name: "remember", arguments: { scope: "project", fact: "must fail outside git" } }));
    assert.ok(!neg.includes("Memory updated") && /git/i.test(neg), neg);
    ok("remember: project scope errors outside a git repo (B2.4)");
  } finally {
    child.kill();
    try {
      await new Promise((res) => {
        if (child.exitCode !== null) res();
        else child.once("exit", res);
      });
    } catch (e) {}
    try {
      rmSync(temp, { recursive: true, force: true });
    } catch (e) {
      output.push(`[cleanup] ${e.message}`);
    }
  }

  console.log("✅ ALL MCP TOOLS TESTED AND VERIFIED!");
}

if (process.argv[1] && process.argv[1].endsWith("mcp_tools.test.js")) {
  runMcpToolsTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
