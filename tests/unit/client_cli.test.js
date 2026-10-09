import assert from "node:assert";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { nodeExecutable, resolveClientExecutable, runClientCli } from "../../mcp-server/client_cli.js";

export async function runClientCliTests() {
  console.log("--- Running Unit Tests: client_cli ---");
  const root = await mkdtemp(join(tmpdir(), "memory-client-cli-"));
  const binDir = join(root, "bin");
  const logPath = join(root, "calls.log");
  await mkdir(binDir, { recursive: true });

  try {
    const isWindows = process.platform === "win32";
    const executable = join(binDir, isWindows ? "fake-client.cmd" : "fake-client");
    const script = isWindows
      ? "@echo off\r\necho %*>>\"%MEMORY_PLUGIN_CLI_LOG%\"\r\nexit /b 0\r\n"
      : "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$MEMORY_PLUGIN_CLI_LOG\"\n";
    await writeFile(executable, script, "utf-8");
    if (!isWindows) await chmod(executable, 0o755);

    const env = {
      ...process.env,
      PATH: `${binDir}${delimiter}${process.env.PATH || ""}`,
      PATHEXT: ".CMD;.EXE;.BAT;.COM",
      MEMORY_PLUGIN_CLI_LOG: logPath,
    };
    assert.strictEqual(resolveClientExecutable("fake-client", { env }), executable);
    const result = runClientCli("fake-client", ["mcp", "remove", "--scope", "user", "memory-agent"], { env });
    assert.strictEqual(result.available, true);
    assert.strictEqual(result.ok, true, result.stderr || result.error?.message);
    assert.match(await readFile(logPath, "utf-8"), /mcp remove --scope user memory-agent/);

    assert.strictEqual(
      resolveClientExecutable("fake-client", { env: { ...env, MEMORY_PLUGIN_DISABLE_NATIVE_CLI: "1" } }),
      null
    );

    // A host binary (e.g. opencode-cli.exe) must resolve to a real Node, even
    // when native client CLIs are switched off.
    const nodeName = isWindows ? "node.exe" : "node";
    const nodePath = join(binDir, nodeName);
    await writeFile(nodePath, "", "utf-8");
    if (!isWindows) await chmod(nodePath, 0o755);
    const hostExe = join(root, isWindows ? "opencode-cli.exe" : "opencode-cli");
    const nodeEnv = { PATH: binDir, PATHEXT: ".EXE", MEMORY_PLUGIN_DISABLE_NATIVE_CLI: "1" };
    assert.strictEqual(nodeExecutable({ execPath: process.execPath, env: nodeEnv }), process.execPath);
    assert.strictEqual(nodeExecutable({ execPath: hostExe, env: nodeEnv }), nodePath);
    assert.strictEqual(nodeExecutable({ execPath: hostExe, env: { PATH: join(root, "empty"), PATHEXT: ".EXE" } }), hostExe);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
  console.log("✅ CROSS-PLATFORM CLIENT CLI ADAPTER TESTS PASSED!");
}

if (process.argv[1] && process.argv[1].endsWith("client_cli.test.js")) {
  runClientCliTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
