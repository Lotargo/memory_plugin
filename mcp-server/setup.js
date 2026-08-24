import { readFile, writeFile, mkdir, cp, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { resolveClientPaths } from "./client_paths.js";
import { cliFailureMessage, runClientCli } from "./client_cli.js";
import { MEMORY_MCP_ENTRY, isMemoryMcpServerEntry, isMemoryPluginEntry, readJsonConfig } from "./client_registration.js";

async function configureJsonMcpClient({ label, cliName, cliArgs, configPath }) {
  let config = await readJsonConfig(configPath);
  const existing = config.mcpServers?.["memory-agent"];
  if (existing && !isMemoryMcpServerEntry(existing)) {
    throw new Error(`Existing mcpServers.memory-agent in ${configPath} is not owned by this plugin`);
  }
  if (existing) return { method: "existing", configPath };

  const native = runClientCli(cliName, cliArgs);
  if (native.ok) {
    config = await readJsonConfig(configPath);
    if (isMemoryMcpServerEntry(config.mcpServers?.["memory-agent"])) {
      return { method: "native", configPath };
    }
  }

  // Compatibility fallback for older/missing clients, and for wrappers that
  // report success without writing the expected user-scope configuration.
  config = await readJsonConfig(configPath);
  const afterNative = config.mcpServers?.["memory-agent"];
  if (afterNative && !isMemoryMcpServerEntry(afterNative)) {
    throw new Error(`Native ${label} setup created an unrecognized memory-agent entry in ${configPath}`);
  }
  if (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers)) {
    config.mcpServers = {};
  }
  config.mcpServers["memory-agent"] = MEMORY_MCP_ENTRY;
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return {
    method: "fallback",
    configPath,
    nativeReason: native.ok ? "native command did not create the expected entry" : cliFailureMessage(native),
  };
}

export async function runSetup() {
  const args = process.argv.slice(2);
  const lowerArgs = args.map((arg) => String(arg).toLowerCase());
  const hasSpecificFlag = lowerArgs.some((a) =>
    ["--opencode", "--claude", "--codex", "--antigravity", "--gemini"].includes(a.toLowerCase())
  );

  const doOpenCode = !hasSpecificFlag || lowerArgs.includes("--opencode");
  const doClaude = !hasSpecificFlag || lowerArgs.includes("--claude");
  const doAntigravity = !hasSpecificFlag || lowerArgs.includes("--antigravity");
  const doGemini = !hasSpecificFlag || lowerArgs.includes("--gemini");
  const doCodex = !hasSpecificFlag || lowerArgs.includes("--codex");

  // Headless cloud setup: --api-key <TURSO_API_TOKEN> and/or --mode <only-local|only-cloud|hybrid-sync>
  const VALID_MODES = ["only-local", "only-cloud", "hybrid-sync"];
  const apiKeyArg = flagValue(args, "--api-key");
  const modeArg = flagValue(args, "--mode");
  if (modeArg && !VALID_MODES.includes(modeArg)) {
    console.log(`  [WARN] Unknown --mode "${modeArg}". Allowed: ${VALID_MODES.join(", ")}`);
  }

  console.log("\nSetting up @lotargo/memory_plugin...\n");
  const clientPaths = resolveClientPaths();
  const { home } = clientPaths;
  let configuredCount = 0;

  // 0. Headless cloud authentication (Google Jules / CI / VPS)
  if (apiKeyArg || process.env.TURSO_API_TOKEN) {
    try {
      const { resolveSecret } = await import("./cli/secret_input.js");
      const apiKey = await resolveSecret({
        argvValue: apiKeyArg,
        envKeys: ["TURSO_API_TOKEN"],
        promptLabel: "Turso API token",
        interactive: false,
      });
      if (!apiKey) throw new Error("Missing API token. Set TURSO_API_TOKEN or pass --api-key <TOKEN>.");
      const { loginWithApiToken } = await import("./admin/auth.js");
      const secrets = await loginWithApiToken({ token: apiKey });
      if (modeArg && VALID_MODES.includes(modeArg)) {
        const { updateConfig } = await import("./config/config_manager.js");
        updateConfig({ mode: modeArg });
      }
      console.log(`  [OK] Cloud: authorized as "${secrets.username}" via API token. Endpoint: ${secrets.dbUrl}`);
      configuredCount++;
    } catch (err) {
      console.log("  [FAIL] Cloud setup failed:", err.message);
    }
  } else if (modeArg && VALID_MODES.includes(modeArg)) {
    try {
      const { updateConfig } = await import("./config/config_manager.js");
      updateConfig({ mode: modeArg });
      console.log(`  [OK] Cloud: sync mode set to "${modeArg}"`);
    } catch (err) {
      console.log("  [SKIP] Cloud mode update skipped:", err.message);
    }
  }

  // 1. OpenCode (~/.config/opencode/opencode.json)
  if (doOpenCode) {
    try {
      const { opencodeDir, opencodeConfigPath } = clientPaths;
      await mkdir(opencodeDir, { recursive: true });

      const config = await readJsonConfig(opencodeConfigPath);
      if (!Array.isArray(config.plugin)) config.plugin = [];
      // Clean up legacy / obsolete / duplicate entries of OUR plugin only
      config.plugin = config.plugin.filter((entry) => !isMemoryPluginEntry(entry));
      config.plugin.push("@lotargo/memory_plugin");
      // Clean up legacy mcp-helper.js standalone file plugin if present
      const legacyPluginFile = join(opencodeDir, "plugins", "mcp-helper.js");
      if (existsSync(legacyPluginFile)) {
        try { const { unlink } = await import("fs/promises"); await unlink(legacyPluginFile); } catch (e) {}
      }

      // Purge stale OpenCode package cache for memory plugin so OpenCode downloads latest version
      const opencodeCachePackages = clientPaths.opencodeCachePackages;
      if (existsSync(opencodeCachePackages)) {
        try {
          const { rm } = await import("fs/promises");
          const targets = [
            join("@lotargo", "memory_plugin"),
            join("@lotargo", "memory_plugin@latest"),
            "memory_plugin",
            "memory_plugin@latest",
            "opencode-memory-plugin",
            "opencode-memory-plugin@latest",
          ];
          for (const t of targets) {
            const p = join(opencodeCachePackages, t);
            if (existsSync(p)) await rm(p, { recursive: true, force: true });
          }
        } catch (e) {}
      }

      await writeFile(opencodeConfigPath, JSON.stringify(config, null, 2));
      console.log("  [OK] OpenCode: configured plugin in ~/.config/opencode/opencode.json and cleared stale cache");
      configuredCount++;
    } catch (err) {
      console.log("  [SKIP] OpenCode setup skipped:", err.message);
    }
  }

  // 2. Claude Code (native user-scope MCP lifecycle, JSON fallback)
  if (doClaude) {
    try {
      const result = await configureJsonMcpClient({
        label: "Claude Code",
        cliName: "claude",
        cliArgs: ["mcp", "add", "--scope", "user", "memory-agent", "--", "npx", "-y", "@lotargo/memory_plugin"],
        configPath: clientPaths.claudeConfigPath,
      });
      console.log(`  [OK] Claude Code: configured MCP server via ${result.method === "native" ? "claude mcp add" : result.method === "existing" ? "existing owned registration" : "ownership-checked JSON fallback"}`);
      if (result.nativeReason) console.log(`  [INFO] Claude Code fallback: ${result.nativeReason}`);
      configuredCount++;
    } catch (err) {
      console.log("  [SKIP] Claude Code setup skipped:", err.message);
    }
  }

  // 3. Antigravity (~/.gemini/config/mcp_config.json & .agents/mcp_config.json)
  if (doAntigravity) {
    try {
      // Global Antigravity config
      const geminiConfigDir = clientPaths.geminiConfigDir;
      await mkdir(geminiConfigDir, { recursive: true });
      const geminiConfigFile = join(geminiConfigDir, "mcp_config.json");

      const config = await readJsonConfig(geminiConfigFile);
      if (!config.mcpServers) config.mcpServers = {};
      const existingGlobal = config.mcpServers["memory-agent"];
      if (existingGlobal && !isMemoryMcpServerEntry(existingGlobal)) {
        throw new Error(`Existing Antigravity mcpServers.memory-agent in ${geminiConfigFile} is not owned by this plugin`);
      }
      config.mcpServers["memory-agent"] = MEMORY_MCP_ENTRY;
      await writeFile(geminiConfigFile, JSON.stringify(config, null, 2) + "\n", "utf-8");

      // Local workspace config (.agents/mcp_config.json) only if .agents exists or --local flag is set
      const cwd = clientPaths.cwd;
      const hasAgentsDir = existsSync(join(cwd, ".agents"));
      const isLocalRequested = args.includes("--local");

      if (hasAgentsDir || isLocalRequested) {
        const localAgentsDir = join(cwd, ".agents");
        await mkdir(localAgentsDir, { recursive: true });
        const localMcpFile = join(localAgentsDir, "mcp_config.json");
        const localConfig = await readJsonConfig(localMcpFile);
        if (!localConfig.mcpServers) localConfig.mcpServers = {};
        const existingLocal = localConfig.mcpServers["memory-agent"];
        if (existingLocal && !isMemoryMcpServerEntry(existingLocal)) {
          throw new Error(`Existing Antigravity mcpServers.memory-agent in ${localMcpFile} is not owned by this plugin`);
        }
        localConfig.mcpServers["memory-agent"] = MEMORY_MCP_ENTRY;
        await writeFile(localMcpFile, JSON.stringify(localConfig, null, 2) + "\n", "utf-8");
        console.log("  [OK] Antigravity: configured MCP server in ~/.gemini/config/mcp_config.json and .agents/mcp_config.json");
      } else {
        console.log("  [OK] Antigravity: configured MCP server in ~/.gemini/config/mcp_config.json");
      }
      configuredCount++;
    } catch (err) {
      console.log("  [SKIP] Antigravity setup skipped:", err.message);
    }
  }

  // 4. Gemini CLI (native user-scope MCP lifecycle, settings.json fallback)
  if (doGemini) {
    try {
      const result = await configureJsonMcpClient({
        label: "Gemini CLI",
        cliName: "gemini",
        cliArgs: ["mcp", "add", "--scope", "user", "memory-agent", "npx", "--", "-y", "@lotargo/memory_plugin"],
        configPath: clientPaths.geminiSettingsPath,
      });
      console.log(`  [OK] Gemini CLI: configured MCP server via ${result.method === "native" ? "gemini mcp add" : result.method === "existing" ? "existing owned registration" : "ownership-checked settings.json fallback"}`);
      if (result.nativeReason) console.log(`  [INFO] Gemini CLI fallback: ${result.nativeReason}`);
      configuredCount++;
    } catch (err) {
      console.log("  [SKIP] Gemini CLI setup skipped:", err.message);
    }
  }

  // 5. Codex (~/.codex/config.toml)
  if (doCodex) {
    try {
      const {
        updateCodexMemoryAgentConfig,
        validateCodexRuntime,
      } = await import("./codex_config.js");
      const codexDir = clientPaths.codexDir;
      const codexConfig = clientPaths.codexConfigPath;
      const nodePath = process.execPath;
      const bootPath = fileURLToPath(new URL("./boot.js", import.meta.url));
      const runtime = validateCodexRuntime({ nodePath, nodeVersion: process.versions.node, bootPath });
      if (!runtime.ok) {
        throw new Error(`Codex direct launcher validation failed: ${runtime.errors.join("; ")}`);
      }

      await mkdir(codexDir, { recursive: true });
      let content = existsSync(codexConfig) ? await readFile(codexConfig, "utf-8") : "";
      let update = updateCodexMemoryAgentConfig(content, { nodePath, bootPath });
      if (update.status === "conflict") {
        throw new Error(update.reason);
      }
      let nativeReason = null;
      if (update.status === "added") {
        const native = runClientCli("codex", ["mcp", "add", "memory-agent", "--", nodePath, bootPath]);
        if (native.ok) {
          content = existsSync(codexConfig) ? await readFile(codexConfig, "utf-8") : "";
          update = updateCodexMemoryAgentConfig(content, { nodePath, bootPath });
          if (update.status === "conflict") throw new Error(update.reason);
        } else {
          nativeReason = cliFailureMessage(native);
        }
      }
      if (update.changed) {
        await writeFile(codexConfig, update.content, "utf-8");
        console.log(
          update.status === "added"
            ? "  [OK] Codex: added direct Node.js memory-agent launcher via ownership-checked TOML fallback"
            : "  [OK] Codex: normalized memory-agent registration after native setup"
        );
      } else {
        console.log("  [INFO] Codex: direct Node.js memory-agent launcher configured via codex mcp add or already present");
      }
      if (nativeReason) console.log(`  [INFO] Codex fallback: ${nativeReason}`);
      configuredCount++;
    } catch (err) {
      console.log("  [FAIL] Codex setup failed:", err.message);
    }
  }

  // 6. Global Prompt Instructions
  try {
    const { enableGlobalPrompt } = await import("./prompt_manager.js");
    const promptTargets = [];
    if (doAntigravity) promptTargets.push("Antigravity");
    if (doGemini) promptTargets.push("Gemini CLI");
    if (doCodex) promptTargets.push("Codex");
    if (doClaude) promptTargets.push("Claude Code");
    const promptResults = await enableGlobalPrompt(promptTargets);
    promptResults.forEach((r) => {
      if (r.status === "enabled") {
        console.log(`  [OK] ${r.name}: enabled global prompt instruction in ${r.filePath}`);
      } else if (r.status === "created_new_file") {
        console.log(`  [OK] ${r.name}: created ${r.filePath} with global prompt instruction`);
      } else if (r.status === "up_to_date") {
        console.log(`  [OK] ${r.name}: global prompt already up to date (${r.filePath})`);
      } else if (r.status === "failed") {
        console.log(`  [WARN] ${r.name}: failed to enable global prompt (${r.error})`);
      }
    });
  } catch (err) {
    console.log("  [SKIP] Global prompt setup skipped:", err.message);
  }

  // 7. Global & Local Skill Installation
  try {
    const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
    const packageSkillsDir = join(packageDir, "skills");
    if (existsSync(packageSkillsDir)) {
      const opencodeDir = clientPaths.opencodeDir;
      const targets = [];
      if (doOpenCode) targets.push({ name: "OpenCode", dir: join(opencodeDir, "skills") });
      if (doAntigravity) targets.push({ name: "Antigravity", dir: join(home, ".gemini", "config", "skills") });
      if (doGemini) targets.push({ name: "Gemini CLI", dir: clientPaths.geminiSkillsDir });
      if (doCodex) {
        targets.push({ name: "Codex", dir: join(home, ".codex", "skills") });
        targets.push({ name: "Codex shared agents", dir: join(home, ".agents", "skills") });
      }
      if (doClaude) targets.push({ name: "Claude Code", dir: join(home, ".claude", "skills") });
      const cwd = clientPaths.cwd;
      if (doAntigravity && existsSync(join(cwd, ".agents"))) {
        targets.push({ name: "Antigravity (local)", dir: join(cwd, ".agents", "skills") });
      }

      for (const target of targets) {
        try {
          await mkdir(target.dir, { recursive: true });
          const entries = await readdir(packageSkillsDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const src = join(packageSkillsDir, entry.name);
              const dest = join(target.dir, entry.name);
              await cp(src, dest, { recursive: true });
            }
          }
          console.log(`  [OK] ${target.name}: installed skills to ${target.dir}`);
        } catch (e) {
          console.log(`  [SKIP] ${target.name} skill installation skipped:`, e.message);
        }
      }
    }
  } catch (err) {
    console.log("  [SKIP] Skill installation skipped:", err.message);
  }

  console.log(`\nSetup complete. Configured ${configuredCount} environment(s).\n`);
}

// Read the value following --flag, or null when absent / followed by another flag.
function flagValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return null;
  const value = args[idx + 1];
  if (value.startsWith("--")) return null;
  return value;
}

