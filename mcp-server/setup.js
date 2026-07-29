import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

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
      if (!config.plugin.includes("@lotargo/memory_plugin")) {
        config.plugin.push("@lotargo/memory_plugin");
        await writeFile(opencodeConfigPath, JSON.stringify(config, null, 2));
        console.log("  [OK] OpenCode: added plugin to ~/.config/opencode/opencode.json");
      } else {
        console.log("  [INFO] OpenCode: already configured");
      }
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

  // 3. Antigravity / Gemini CLI (~/.gemini/antigravity-ide/mcp/memory-agent.json)
  if (doAntigravity) {
    try {
      const geminiMcpDir = join(home, ".gemini", "antigravity-ide", "mcp");
      await mkdir(geminiMcpDir, { recursive: true });
      const geminiMcpFile = join(geminiMcpDir, "memory-agent.json");
      const config = {
        command: "npx",
        args: ["-y", "@lotargo/memory_plugin"],
      };
      await writeFile(geminiMcpFile, JSON.stringify(config, null, 2));
      console.log("  [OK] Antigravity: configured MCP server in ~/.gemini/antigravity-ide/mcp/");
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

  console.log(`\nSetup complete. Configured ${configuredCount} environment(s).\n`);
}
