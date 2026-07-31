import { readFile, writeFile, mkdir, cp, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

export async function runSetup() {
  const args = process.argv.slice(2);
  const hasSpecificFlag = args.some((a) =>
    ["--opencode", "--claude", "--codex", "--antigravity", "--gemini"].includes(a.toLowerCase())
  );

  const doOpenCode = !hasSpecificFlag || args.includes("--opencode");
  const doClaude = !hasSpecificFlag || args.includes("--claude");
  const doAntigravity = !hasSpecificFlag || args.includes("--antigravity") || args.includes("--gemini");
  const doCodex = !hasSpecificFlag || args.includes("--codex");

  console.log("\nSetting up @lotargo/memory_plugin...\n");
  const home = homedir();
  let configuredCount = 0;

  // 1. OpenCode (~/.config/opencode/opencode.json)
  if (doOpenCode) {
    try {
      const opencodeDir = process.env.OPENCODE_CONFIG_DIR || join(home, ".config", "opencode");
      const opencodeConfigPath = join(opencodeDir, "opencode.json");
      await mkdir(opencodeDir, { recursive: true });

      let config = {};
      if (existsSync(opencodeConfigPath)) {
        try {
          config = JSON.parse(await readFile(opencodeConfigPath, "utf-8"));
        } catch (e) {}
      }
      if (!Array.isArray(config.plugin)) config.plugin = [];
      // Clean up legacy / obsolete / duplicate entries of OUR plugin only
      const obsoleteNames = ["opencode-memory-plugin", "memory_plugin", "memory-plugin", "@lotargo/memory_plugin"];
      config.plugin = config.plugin.filter((p) => {
        if (typeof p !== "string") return true;
        if (obsoleteNames.includes(p)) return false;
        const normalized = p.replace(/\\/g, "/").toLowerCase();
        if (normalized.endsWith("/memory") || normalized.endsWith("/memory_plugin") || normalized.endsWith("/memory-plugin")) {
          return false;
        }
        return true;
      });
      config.plugin.push("@lotargo/memory_plugin");
      // Clean up legacy mcp-helper.js standalone file plugin if present
      const legacyPluginFile = join(opencodeDir, "plugins", "mcp-helper.js");
      if (existsSync(legacyPluginFile)) {
        try { const { unlink } = await import("fs/promises"); await unlink(legacyPluginFile); } catch (e) {}
      }

      // Purge stale OpenCode package cache for memory plugin so OpenCode downloads latest version
      const opencodeCachePackages = join(home, ".cache", "opencode", "packages");
      if (existsSync(opencodeCachePackages)) {
        try {
          const { rm } = await import("fs/promises");
          const targets = ["@lotargo", "memory_plugin", "memory_plugin@latest", "opencode-memory-plugin", "opencode-memory-plugin@latest"];
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

  // 2. Claude Code (~/.claude.json)
  if (doClaude) {
    try {
      const claudePath = join(home, ".claude.json");
      let config = {};
      if (existsSync(claudePath)) {
        try {
          config = JSON.parse(await readFile(claudePath, "utf-8"));
        } catch (e) {}
      }
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers["memory-agent"] = {
        command: "npx",
        args: ["-y", "@lotargo/memory_plugin"],
      };
      await writeFile(claudePath, JSON.stringify(config, null, 2));
      console.log("  [OK] Claude Code: configured MCP server in ~/.claude.json");
      configuredCount++;
    } catch (err) {
      console.log("  [SKIP] Claude Code setup skipped:", err.message);
    }
  }

  // 3. Antigravity / Gemini CLI (~/.gemini/config/mcp_config.json & .agents/mcp_config.json)
  if (doAntigravity) {
    try {
      // Global Antigravity config
      const geminiConfigDir = join(home, ".gemini", "config");
      await mkdir(geminiConfigDir, { recursive: true });
      const geminiConfigFile = join(geminiConfigDir, "mcp_config.json");

      let config = {};
      if (existsSync(geminiConfigFile)) {
        try {
          config = JSON.parse(await readFile(geminiConfigFile, "utf-8"));
        } catch (e) {}
      }
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers["memory-agent"] = {
        command: "npx",
        args: ["-y", "@lotargo/memory_plugin"],
      };
      await writeFile(geminiConfigFile, JSON.stringify(config, null, 2));

      // Local workspace config (.agents/mcp_config.json) only if .agents exists or --local flag is set
      const cwd = process.cwd();
      const hasAgentsDir = existsSync(join(cwd, ".agents"));
      const isLocalRequested = args.includes("--local");

      if (hasAgentsDir || isLocalRequested) {
        const localAgentsDir = join(cwd, ".agents");
        await mkdir(localAgentsDir, { recursive: true });
        const localMcpFile = join(localAgentsDir, "mcp_config.json");
        let localConfig = {};
        if (existsSync(localMcpFile)) {
          try {
            localConfig = JSON.parse(await readFile(localMcpFile, "utf-8"));
          } catch (e) {}
        }
        if (!localConfig.mcpServers) localConfig.mcpServers = {};
        localConfig.mcpServers["memory-agent"] = {
          command: "npx",
          args: ["-y", "@lotargo/memory_plugin"],
        };
        await writeFile(localMcpFile, JSON.stringify(localConfig, null, 2));
        console.log("  [OK] Antigravity: configured MCP server in ~/.gemini/config/mcp_config.json and .agents/mcp_config.json");
      } else {
        console.log("  [OK] Antigravity: configured MCP server in ~/.gemini/config/mcp_config.json");
      }
      configuredCount++;
    } catch (err) {
      console.log("  [SKIP] Antigravity setup skipped:", err.message);
    }
  }

  // 4. Codex (~/.codex/config.toml)
  if (doCodex) {
    try {
      const codexDir = join(home, ".codex");
      const codexConfig = join(codexDir, "config.toml");
      if (existsSync(codexDir)) {
        let content = existsSync(codexConfig) ? await readFile(codexConfig, "utf-8") : "";
        if (!content.includes("memory-agent")) {
          const tomlSnippet = `\n[mcp_servers.memory-agent]\ncommand = "npx"\nargs = ["-y", "@lotargo/memory_plugin"]\n`;
          content += tomlSnippet;
          await writeFile(codexConfig, content);
          console.log("  [OK] Codex: added mcp_servers.memory-agent to ~/.codex/config.toml");
          configuredCount++;
        } else {
          console.log("  [INFO] Codex: already configured");
        }
      }
    } catch (err) {
      console.log("  [SKIP] Codex setup skipped:", err.message);
    }
  }

  // 5. Global Prompt Instructions (Antigravity, Codex, Claude Code)
  try {
    const { enableGlobalPrompt } = await import("./prompt_manager.js");
    const promptResults = await enableGlobalPrompt();
    promptResults.forEach((r) => {
      if (r.status === "enabled") {
        console.log(`  [OK] ${r.name}: enabled global prompt instruction in ${r.filePath}`);
      }
    });
  } catch (err) {
    console.log("  [SKIP] Global prompt setup skipped:", err.message);
  }

  // 6. Global & Local Skill Installation (Antigravity, Codex, Claude Code)
  try {
    const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
    const packageSkillsDir = join(packageDir, "skills");
    if (existsSync(packageSkillsDir)) {
      const opencodeDir = process.env.OPENCODE_CONFIG_DIR || join(home, ".config", "opencode");
      const targets = [
        { name: "OpenCode", dir: join(opencodeDir, "skills") },
        { name: "Antigravity", dir: join(home, ".gemini", "config", "skills") },
        { name: "Codex", dir: join(home, ".codex", "skills") },
        { name: "Claude Code", dir: join(home, ".claude", "skills") },
      ];
      const cwd = process.cwd();
      if (existsSync(join(cwd, ".agents"))) {
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

