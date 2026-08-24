import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCodexMemoryAgentSection } from "../../mcp-server/codex_config.js";
import {
  PERSONA_END_MARKER,
  PERSONA_START_MARKER,
  PROMPT_BLOCK,
} from "../../mcp-server/prompt_manager.js";
import {
  assertSafePurgeTarget,
  discoverOpenCodeCacheTargets,
  isMemoryMcpServerEntry,
  isMemoryPluginEntry,
  isOwnedSkillDir,
  openCodeCacheTargets,
} from "../../mcp-server/uninstall.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BOOT = join(ROOT, "mcp-server", "boot.js");
const PACKAGED_SKILL = join(ROOT, "skills", "using-memory");

function runUninstall(args, { cwd, env }) {
  return spawnSync(process.execPath, [BOOT, "uninstall", ...args], {
    cwd,
    env,
    encoding: "utf-8",
    timeout: 30_000,
  });
}

function runSetup(args, { cwd, env }) {
  return spawnSync(process.execPath, [BOOT, "setup", ...args], {
    cwd,
    env,
    encoding: "utf-8",
    timeout: 30_000,
  });
}

export async function runUninstallTests() {
  console.log("--- Running Unit Tests: uninstall ---");

  assert.strictEqual(isMemoryPluginEntry("@lotargo/memory_plugin"), true);
  assert.strictEqual(isMemoryPluginEntry("@lotargo/memory_plugin@1.6.6"), true);
  assert.strictEqual(isMemoryPluginEntry({ package: "@lotargo/memory_plugin@latest", options: {} }), true);
  assert.strictEqual(isMemoryPluginEntry("@lotargo/memory_plugin-extra"), false);
  assert.strictEqual(
    isMemoryPluginEntry("file:///C:/projects/memory-dashboard/opencode-plugin/main.js"),
    false,
    "unrelated file plugins must not be claimed"
  );
  assert.strictEqual(isMemoryMcpServerEntry({ command: "npx", args: ["-y", "@lotargo/memory_plugin"] }), true);
  assert.strictEqual(isMemoryMcpServerEntry({ command: "node", args: ["foreign-memory-agent.js"] }), false);
  assert.strictEqual(isMemoryMcpServerEntry({ command: "C:/tools/memory_plugin_trojan.exe", args: [] }), false);

  const root = await mkdtemp(join(tmpdir(), "memory-uninstall-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const xdgConfig = join(root, "xdg", "config");
  const xdgCache = join(root, "xdg", "cache");
  const opencodeDir = join(xdgConfig, "opencode");
  const memoryDir = join(root, "data", "memory");
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_CACHE_HOME: xdgCache,
    OPENCODE_CONFIG_DIR: opencodeDir,
    MEMORY_DIR: memoryDir,
    MEMORY_PLUGIN_DISABLE_NATIVE_CLI: "1",
  };

  try {
    await mkdir(workspace, { recursive: true });
    assert.throws(() => assertSafePurgeTarget(parse(root).root), /filesystem root|broad top-level/);
    assert.throws(() => assertSafePurgeTarget(home, { protectedPaths: [home] }), /protected path/);
    assert.strictEqual(
      assertSafePurgeTarget(memoryDir, { protectedPaths: [home, workspace] }),
      memoryDir
    );
    assert.ok(openCodeCacheTargets(join(xdgCache, "opencode", "packages")).every((path) => path !== join(xdgCache, "opencode", "packages", "@lotargo")));

    const skillCopy = join(root, "skill-copy");
    await cp(PACKAGED_SKILL, skillCopy, { recursive: true });
    assert.strictEqual(await isOwnedSkillDir(skillCopy), true);
    await writeFile(join(skillCopy, "custom.txt"), "user customization\n", "utf-8");
    assert.strictEqual(await isOwnedSkillDir(skillCopy), false, "modified skills must not be deleted");

    const codexDir = join(home, ".codex");
    const claudeDir = join(home, ".claude");
    const agentStateDir = join(xdgConfig, "memory-agent");
    await mkdir(codexDir, { recursive: true });
    await mkdir(claudeDir, { recursive: true });
    await mkdir(agentStateDir, { recursive: true });

    const codexUserText = "# Codex user instructions\n\n\n\nKeep this exact content.";
    const claudeUserText = "# Claude user instructions\n\nNever touch this file.\n";
    const personaBlock = `${PERSONA_START_MARKER}\n[PERSONAL AGENT OVERLAY]\n${PERSONA_END_MARKER}`;
    const codexPromptPath = join(codexDir, "AGENTS.md");
    const claudePromptPath = join(claudeDir, "CLAUDE.md");
    await writeFile(codexPromptPath, `${codexUserText}\n\n${PROMPT_BLOCK}\n\n${personaBlock}\n`, "utf-8");
    await writeFile(claudePromptPath, claudeUserText, "utf-8");
    await writeFile(
      join(codexDir, "config.toml"),
      `${buildCodexMemoryAgentSection({ nodePath: process.execPath, bootPath: BOOT })}\n`,
      "utf-8"
    );
    await writeFile(
      join(agentStateDir, "prompt-state.json"),
      JSON.stringify({
        [codexPromptPath]: { hash: "old", existedBefore: true },
        [claudePromptPath]: { hash: "keep", existedBefore: true },
      }, null, 2),
      "utf-8"
    );
    await mkdir(join(codexDir, "skills"), { recursive: true });
    await cp(PACKAGED_SKILL, join(codexDir, "skills", "using-memory"), { recursive: true });

    const codexResult = runUninstall(["--codex"], { cwd: workspace, env });
    assert.strictEqual(codexResult.status, 0, codexResult.stderr || codexResult.stdout);
    assert.strictEqual(await readFile(codexPromptPath, "utf-8"), `${codexUserText}\n`);
    assert.strictEqual(await readFile(claudePromptPath, "utf-8"), claudeUserText);
    const promptState = JSON.parse(await readFile(join(agentStateDir, "prompt-state.json"), "utf-8"));
    assert.strictEqual(promptState[codexPromptPath], undefined, "selected prompt state must be removed");
    assert.deepStrictEqual(promptState[claudePromptPath], { hash: "keep", existedBefore: true });

    await mkdir(opencodeDir, { recursive: true });
    const unrelatedFilePlugin = "file:///C:/projects/memory-dashboard/opencode-plugin/main.js";
    await writeFile(
      join(opencodeDir, "opencode.json"),
      JSON.stringify({ plugin: [unrelatedFilePlugin, "@lotargo/memory_plugin", "@vendor/keep"] }, null, 2),
      "utf-8"
    );
    const cacheRoot = join(xdgCache, "opencode", "packages");
    const memoryCache = join(cacheRoot, "@lotargo", "memory_plugin@latest");
    const versionedMemoryCache = join(cacheRoot, "@lotargo", "memory_plugin@1.6.6");
    const otherCache = join(cacheRoot, "@lotargo", "other-plugin");
    await mkdir(memoryCache, { recursive: true });
    await mkdir(versionedMemoryCache, { recursive: true });
    await mkdir(otherCache, { recursive: true });
    await writeFile(join(memoryCache, "remove.txt"), "remove\n", "utf-8");
    await writeFile(join(versionedMemoryCache, "remove.txt"), "remove version\n", "utf-8");
    await writeFile(join(otherCache, "keep.txt"), "keep\n", "utf-8");

    const opencodeResult = runUninstall(["--opencode"], { cwd: workspace, env });
    assert.strictEqual(opencodeResult.status, 0, opencodeResult.stderr || opencodeResult.stdout);
    const opencodeConfig = JSON.parse(await readFile(join(opencodeDir, "opencode.json"), "utf-8"));
    assert.deepStrictEqual(opencodeConfig.plugin, [unrelatedFilePlugin, "@vendor/keep"]);
    assert.strictEqual(
      await readFile(join(memoryCache, "remove.txt"), "utf-8"),
      "remove\n",
      "normal uninstall must preserve the host package cache"
    );
    assert.strictEqual(await readFile(join(otherCache, "keep.txt"), "utf-8"), "keep\n");
    assert.ok((await discoverOpenCodeCacheTargets(cacheRoot)).includes(versionedMemoryCache));

    const cachePurge = runUninstall(["--opencode", "--purge-cache"], { cwd: workspace, env });
    assert.strictEqual(cachePurge.status, 0, cachePurge.stderr || cachePurge.stdout);
    await assert.rejects(readFile(join(memoryCache, "remove.txt")), /ENOENT/);
    await assert.rejects(readFile(join(versionedMemoryCache, "remove.txt")), /ENOENT/);
    assert.strictEqual(await readFile(join(otherCache, "keep.txt"), "utf-8"), "keep\n");

    const antigravityConfig = join(home, ".gemini", "config", "mcp_config.json");
    await mkdir(join(home, ".gemini", "config"), { recursive: true });
    await writeFile(
      antigravityConfig,
      JSON.stringify({ mcpServers: { "memory-agent": { command: "foreign", args: ["keep"] } } }, null, 2) + "\n",
      "utf-8"
    );

    const geminiSetup = runSetup(["--gemini"], { cwd: workspace, env });
    assert.strictEqual(geminiSetup.status, 0, geminiSetup.stderr || geminiSetup.stdout);
    const geminiSettings = join(home, ".gemini", "settings.json");
    const configuredGemini = JSON.parse(await readFile(geminiSettings, "utf-8"));
    assert.strictEqual(isMemoryMcpServerEntry(configuredGemini.mcpServers["memory-agent"]), true);
    assert.ok(existsSync(join(home, ".gemini", "GEMINI.md")));
    assert.ok(existsSync(join(home, ".gemini", "skills", "using-memory", "SKILL.md")));

    const geminiUninstall = runUninstall(["--gemini"], { cwd: workspace, env });
    assert.strictEqual(geminiUninstall.status, 0, geminiUninstall.stderr || geminiUninstall.stdout);
    const cleanedGemini = JSON.parse(await readFile(geminiSettings, "utf-8"));
    assert.strictEqual(cleanedGemini.mcpServers["memory-agent"], undefined);
    assert.strictEqual(
      JSON.parse(await readFile(antigravityConfig, "utf-8")).mcpServers["memory-agent"].command,
      "foreign",
      "--gemini must not touch the separate Antigravity configuration"
    );
    await assert.rejects(readFile(join(home, ".gemini", "skills", "using-memory", "SKILL.md")), /ENOENT/);

    await writeFile(
      geminiSettings,
      JSON.stringify({ mcpServers: { "memory-agent": { command: "foreign-agent", args: ["keep"] } } }, null, 2) + "\n",
      "utf-8"
    );
    const foreignGemini = runUninstall(["--gemini"], { cwd: workspace, env });
    assert.strictEqual(foreignGemini.status, 0, foreignGemini.stderr || foreignGemini.stdout);
    assert.strictEqual(
      JSON.parse(await readFile(geminiSettings, "utf-8")).mcpServers["memory-agent"].command,
      "foreign-agent",
      "foreign Gemini registrations must never be removed"
    );

    const nativeBin = join(root, "native-bin");
    const nativeLog = join(root, "native-calls.log");
    await mkdir(nativeBin, { recursive: true });
    const fakeGemini = join(nativeBin, process.platform === "win32" ? "gemini.cmd" : "gemini");
    await writeFile(
      fakeGemini,
      process.platform === "win32"
        ? "@echo off\r\necho %*>>\"%MEMORY_PLUGIN_CLI_LOG%\"\r\nexit /b 0\r\n"
        : "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$MEMORY_PLUGIN_CLI_LOG\"\n",
      "utf-8"
    );
    if (process.platform !== "win32") await chmod(fakeGemini, 0o755);
    const nativeEnv = {
      ...env,
      MEMORY_PLUGIN_DISABLE_NATIVE_CLI: "0",
      PATH: `${nativeBin}${delimiter}${process.env.PATH || ""}`,
      PATHEXT: ".CMD;.EXE;.BAT;.COM",
      MEMORY_PLUGIN_CLI_LOG: nativeLog,
    };
    await writeFile(geminiSettings, "{}\n", "utf-8");
    const nativeSetup = runSetup(["--gemini"], { cwd: workspace, env: nativeEnv });
    assert.strictEqual(nativeSetup.status, 0, nativeSetup.stderr || nativeSetup.stdout);
    assert.match(await readFile(nativeLog, "utf-8"), /mcp add --scope user memory-agent npx -- -y @lotargo\/memory_plugin/);
    const nativeUninstall = runUninstall(["--gemini"], { cwd: workspace, env: nativeEnv });
    assert.strictEqual(nativeUninstall.status, 0, nativeUninstall.stderr || nativeUninstall.stdout);
    assert.match(await readFile(nativeLog, "utf-8"), /mcp remove --scope user memory-agent/);
    assert.strictEqual(
      JSON.parse(await readFile(geminiSettings, "utf-8")).mcpServers["memory-agent"],
      undefined,
      "ownership-checked fallback must finish cleanup when a native CLI reports success without changing config"
    );

    const sentinel = join(home, "must-survive.txt");
    await writeFile(sentinel, "safe\n", "utf-8");
    const unsafePurge = runUninstall(["--purge", "--yes", "--opencode"], {
      cwd: workspace,
      env: { ...env, MEMORY_DIR: home },
    });
    assert.notStrictEqual(unsafePurge.status, 0, "unsafe purge must fail closed");
    assert.strictEqual(await readFile(sentinel, "utf-8"), "safe\n");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }

  console.log("✅ SAFE CROSS-PLATFORM UNINSTALL TESTS PASSED!");
}

if (process.argv[1] && process.argv[1].endsWith("uninstall.test.js")) {
  runUninstallTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
