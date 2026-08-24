import { homedir } from "node:os";
import { join } from "node:path";

export function resolveClientPaths({
  home = homedir(),
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const configHome = env.XDG_CONFIG_HOME || join(home, ".config");
  const cacheHome = env.XDG_CACHE_HOME || join(home, ".cache");
  const opencodeDir = env.OPENCODE_CONFIG_DIR || join(configHome, "opencode");
  const agentConfigDir = join(configHome, "memory-agent");
  const geminiDir = join(home, ".gemini");
  const antigravityConfigDir = join(geminiDir, "config");

  return {
    home,
    cwd,
    configHome,
    cacheHome,
    opencodeDir,
    opencodeConfigPath: join(opencodeDir, "opencode.json"),
    opencodeCachePackages: join(cacheHome, "opencode", "packages"),
    claudeConfigPath: join(home, ".claude.json"),
    geminiDir,
    geminiSettingsPath: join(geminiDir, "settings.json"),
    geminiPromptPath: join(geminiDir, "GEMINI.md"),
    geminiSkillsDir: join(geminiDir, "skills"),
    // Antigravity intentionally uses its own legacy layout. Keep these paths
    // separate from the real Gemini CLI settings above.
    antigravityConfigDir,
    antigravityMcpConfigPath: join(antigravityConfigDir, "mcp_config.json"),
    geminiConfigDir: antigravityConfigDir,
    geminiMcpConfigPath: join(antigravityConfigDir, "mcp_config.json"),
    localAgentsDir: join(cwd, ".agents"),
    localAgentsMcpConfigPath: join(cwd, ".agents", "mcp_config.json"),
    codexDir: join(home, ".codex"),
    codexConfigPath: join(home, ".codex", "config.toml"),
    agentConfigDir,
    promptFile: join(agentConfigDir, "prompt.md"),
    promptStateFile: join(agentConfigDir, "prompt-state.json"),
    promptBackupDir: join(agentConfigDir, "backups"),
  };
}
