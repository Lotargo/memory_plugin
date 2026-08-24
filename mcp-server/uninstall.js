import { readFile, writeFile, mkdir, rm, realpath, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, join, parse, relative, resolve } from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { resolveClientPaths } from "./client_paths.js";
import { isMemoryMcpServerEntry, isMemoryPluginEntry, readJsonConfig } from "./client_registration.js";
import { cliFailureMessage, runClientCli } from "./client_cli.js";

export { isMemoryMcpServerEntry, isMemoryPluginEntry } from "./client_registration.js";

export function openCodeCacheTargets(cachePackages) {
  return [
    join(cachePackages, "@lotargo", "memory_plugin"),
    join(cachePackages, "@lotargo", "memory_plugin@latest"),
    join(cachePackages, "memory_plugin"),
    join(cachePackages, "memory_plugin@latest"),
    join(cachePackages, "opencode-memory-plugin"),
    join(cachePackages, "opencode-memory-plugin@latest"),
  ];
}

export async function discoverOpenCodeCacheTargets(cachePackages) {
  const targets = new Set(openCodeCacheTargets(cachePackages));
  const locations = [
    { dir: cachePackages, match: /^(?:memory_plugin|opencode-memory-plugin)(?:@[^/]+)?$/i },
    { dir: join(cachePackages, "@lotargo"), match: /^memory_plugin(?:@[^/]+)?$/i },
  ];
  for (const location of locations) {
    try {
      const entries = await readdir(location.dir, { withFileTypes: true });
      for (const entry of entries) {
        if ((entry.isDirectory() || entry.isSymbolicLink()) && location.match.test(entry.name)) {
          targets.add(join(location.dir, entry.name));
        }
      }
    } catch {}
  }
  return [...targets];
}

const PACKAGED_SKILL_FILE = fileURLToPath(new URL("../skills/using-memory/SKILL.md", import.meta.url));

export async function isOwnedSkillDir(skillDir) {
  try {
    const entries = await readdir(skillDir, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0].isFile() || entries[0].name !== "SKILL.md") return false;
    const [installed, packaged] = await Promise.all([
      readFile(join(skillDir, "SKILL.md")),
      readFile(PACKAGED_SKILL_FILE),
    ]);
    return installed.equals(packaged);
  } catch {
    return false;
  }
}

function isSameOrAncestor(candidate, protectedPath) {
  const rel = relative(candidate, protectedPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function assertSafePurgeTarget(target, { protectedPaths = [] } = {}) {
  if (!target || !String(target).trim()) throw new Error("Refusing to purge an empty path");
  const resolved = resolve(String(target));
  const root = parse(resolved).root;
  if (resolved === root) throw new Error(`Refusing to purge filesystem root: ${resolved}`);
  const depth = relative(root, resolved).split(/[\\/]+/).filter(Boolean).length;
  if (depth < 2) throw new Error(`Refusing to purge broad top-level path: ${resolved}`);
  for (const protectedPath of protectedPaths.filter(Boolean)) {
    const protectedResolved = resolve(String(protectedPath));
    if (isSameOrAncestor(resolved, protectedResolved)) {
      throw new Error(`Refusing to purge ${resolved}; it contains protected path ${protectedResolved}`);
    }
  }
  return resolved;
}

function parseArgs(rawArgs) {
  const args = rawArgs.map((a) => String(a));
  const lower = args.map((a) => a.toLowerCase());
  const has = (name) => lower.includes(name.toLowerCase());
  const hasSpecificFlag = ["--opencode", "--claude", "--codex", "--antigravity", "--gemini"].some((f) => has(f));
  const doOpenCode = !hasSpecificFlag || has("--opencode");
  const doClaude = !hasSpecificFlag || has("--claude");
  const doAntigravity = !hasSpecificFlag || has("--antigravity");
  const doGemini = !hasSpecificFlag || has("--gemini");
  const doCodex = !hasSpecificFlag || has("--codex");
  const purge = has("--purge") || has("--hard") || has("--with-data") || has("--purge-data") || has("--hard-purge");
  const purgeCache = has("--purge-cache");
  const dryRun = has("--dry-run") || has("--dry");
  const yes = has("--yes") || has("-y") || has("--force") || has("-f") || has("--assume-yes");
  const help = has("--help") || has("-h") || has("help");
  return { args, lower, has, hasSpecificFlag, doOpenCode, doClaude, doAntigravity, doGemini, doCodex, purge, purgeCache, dryRun, yes, help };
}

function printHelp() {
  console.log(`
memory_plugin uninstall — remove @lotargo/memory_plugin from all clients

Usage:
  memory_plugin uninstall [options]
  memory_plugin setup --uninstall [options]
  memory-cli uninstall [options]
  npx @lotargo/memory_plugin uninstall [options]

Options:
  --opencode            Only remove OpenCode plugin entry
  --claude              Only remove Claude Code MCP entry
  --codex               Only remove Codex MCP entry
  --antigravity         Only remove Antigravity MCP entry
  --gemini              Only remove Gemini CLI MCP entry
  (no flag)             Remove from all detected clients
  --purge               Also delete local data (MEMORY_DIR, memory-agent prompt state, blobs, SQLite)
                        Without --purge, Notebook facts / RAG / models are kept on disk.
                        Unsafe broad targets are rejected even with --yes.
  --purge-cache         Also delete only this plugin's OpenCode package-cache directories
  --dry-run             Preview what would be removed without writing
  --yes, -y, --force    Skip confirmation prompt for --purge
  -h, --help            Show this help

What is removed by default (without --purge):
  • OpenCode:   plugin entry from ~/.config/opencode/opencode.json (incl. file:// dev link)
  • Claude:     mcpServers.memory-agent from ~/.claude.json
  • Gemini CLI: mcpServers.memory-agent from ~/.gemini/settings.json
  • Antigravity: mcpServers.memory-agent from ~/.gemini/config/mcp_config.json + .agents/mcp_config.json
  • Codex:      [mcp_servers.memory-agent] from ~/.codex/config.toml (only if owned by this plugin)
  • Prompts:    managed blocks from Codex, Claude, Gemini CLI, and Antigravity global instruction files
  • Skills:     using-memory skill from each client's skills/ directory

With --purge also removes:
  • Local Notebook & RAG storage (MEMORY_DIR) and prompt state (XDG_CONFIG_HOME/memory-agent)
With --purge-cache also removes:
  • Exact OpenCode cache directories belonging to @lotargo/memory_plugin

The npm package itself is removed separately:
  npm uninstall -g @lotargo/memory_plugin

Examples:
  memory_plugin uninstall --dry-run
  memory_plugin uninstall --purge --yes
  memory_plugin uninstall --opencode --purge-cache
  memory_plugin uninstall --opencode --claude
`);
}

async function confirmPurge(yes, targets = []) {
  if (yes) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    const targetList = targets.map((target) => `\n    - ${target}`).join("");
    rl.question(`  This will PERMANENTLY delete:${targetList}\n  Continue? [y/N] `, (a) => {
      rl.close();
      resolve(String(a).trim().toLowerCase());
    });
  });
  return answer === "y" || answer === "yes";
}

async function removeJsonMcpClient({ label, configPath, cliName, cliArgs, dry }) {
  if (!existsSync(configPath)) return { status: "not_found" };
  let config = await readJsonConfig(configPath);
  const entry = config.mcpServers?.["memory-agent"];
  if (!entry) return { status: "not_found" };
  if (!isMemoryMcpServerEntry(entry)) return { status: "conflict" };
  if (dry) return { status: "removed", method: "preview" };

  const native = runClientCli(cliName, cliArgs);
  if (native.ok) {
    config = await readJsonConfig(configPath);
    if (!config.mcpServers?.["memory-agent"]) {
      return { status: "removed", method: "native" };
    }
    if (!isMemoryMcpServerEntry(config.mcpServers["memory-agent"])) {
      return { status: "conflict", reason: `native ${label} command left an unrecognized entry` };
    }
  }

  config = await readJsonConfig(configPath);
  const afterNative = config.mcpServers?.["memory-agent"];
  if (!afterNative) return { status: "removed", method: "native" };
  if (!isMemoryMcpServerEntry(afterNative)) return { status: "conflict" };
  delete config.mcpServers["memory-agent"];
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return {
    status: "removed",
    method: "fallback",
    nativeReason: native.ok ? "native command did not remove the expected entry" : cliFailureMessage(native),
  };
}

export async function runUninstall() {
  const rawArgs = process.argv.slice(2);
  // strip leading "uninstall" / "setup" / "--uninstall" tokens so parsing is uniform
  // e.g. ["uninstall","--purge"] or ["setup","--uninstall","--purge"] or ["--uninstall"]
  const filtered = rawArgs.filter((a, idx) => {
    const low = String(a).toLowerCase();
    if (low === "uninstall" || low === "--uninstall") return false;
    if (low === "setup" && idx === 0) return false;
    if (low === "install" && idx === 0) return false;
    return true;
  });
  const opts = parseArgs(filtered);

  if (opts.help) {
    printHelp();
    return;
  }

  const clientPaths = resolveClientPaths();
  const { home } = clientPaths;
  const dry = opts.dryRun;
  const tag = dry ? "[DRY-RUN]" : "[OK]";

  let purgeDirs = [];
  if (opts.purge) {
    const { MEMORY_DIR } = await import("./memory.js");
    const candidates = [
      { path: MEMORY_DIR, label: "Local data (MEMORY_DIR)" },
      { path: clientPaths.agentConfigDir, label: "Prompt state (memory-agent config)" },
    ];
    const seen = new Set();
    for (const candidate of candidates) {
      const protectedPaths = [home, clientPaths.cwd, clientPaths.configHome, clientPaths.opencodeDir, clientPaths.cacheHome];
      let safePath = assertSafePurgeTarget(candidate.path, { protectedPaths });
      if (existsSync(safePath)) {
        const real = await realpath(safePath);
        assertSafePurgeTarget(real, { protectedPaths });
      }
      const key = process.platform === "win32" ? safePath.toLowerCase() : safePath;
      if (!seen.has(key)) {
        seen.add(key);
        purgeDirs.push({ ...candidate, path: safePath });
      }
    }
  }

  console.log(`\n${dry ? "Previewing" : "Removing"} @lotargo/memory_plugin${opts.purge ? " (with --purge)" : ""}...\n`);

  if (opts.purge) {
    console.log("  Validated purge targets:");
    for (const target of purgeDirs) console.log(`    - ${target.path}`);
    console.log("");
  }

  if (opts.purge && !dry) {
    const ok = await confirmPurge(opts.yes, purgeDirs.map((item) => item.path));
    if (!ok) {
      console.log("  [CANCELLED] Purge aborted by user.\n");
      return;
    }
  }

  let removedCount = 0;
  let skippedCount = 0;
  let failureCount = 0;

  // 1. OpenCode
  if (opts.doOpenCode) {
    try {
      const { opencodeDir, opencodeConfigPath } = clientPaths;
      if (!existsSync(opencodeConfigPath)) {
        console.log(`  [SKIP] OpenCode: no config at ${opencodeConfigPath}`);
        skippedCount++;
      } else {
        let config = await readJsonConfig(opencodeConfigPath);
        const fields = ["plugin", "plugins"];
        const ownedCount = fields.reduce((count, field) => count + (
          Array.isArray(config[field]) ? config[field].filter(isMemoryPluginEntry).length : 0
        ), 0);
        if (ownedCount === 0) {
          console.log(`  [SKIP] OpenCode: no plugin entries in ${opencodeConfigPath}`);
          skippedCount++;
        } else {
          let method = "preview";
          let nativeReason = null;
          if (!dry) {
            const native = runClientCli("opencode2", ["plugin", "remove", "@lotargo/memory_plugin"]);
            if (native.ok) {
              config = await readJsonConfig(opencodeConfigPath);
              method = fields.every((field) => !Array.isArray(config[field]) || !config[field].some(isMemoryPluginEntry))
                ? "native"
                : "fallback";
              if (method === "fallback") nativeReason = "native command did not remove every owned config entry";
            } else {
              method = "fallback";
              nativeReason = cliFailureMessage(native);
            }

            if (method === "fallback") {
              for (const field of fields) {
                if (!Array.isArray(config[field])) continue;
                const filtered = config[field].filter((entry) => !isMemoryPluginEntry(entry));
                if (filtered.length === 0) delete config[field];
                else config[field] = filtered;
              }
              await mkdir(opencodeDir, { recursive: true });
              await writeFile(opencodeConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
            }
          }
          console.log(`  ${tag} OpenCode: removed ${ownedCount} plugin entrie(s) via ${method === "native" ? "opencode2 plugin remove" : method === "preview" ? "native command or ownership-checked fallback" : "ownership-checked config fallback"}${dry ? " (would remove)" : ""}`);
          if (nativeReason) console.log(`  [INFO] OpenCode fallback: ${nativeReason}`);
          removedCount++;
        }
      }

      if (opts.purgeCache) {
        let cacheRemoved = 0;
        for (const target of await discoverOpenCodeCacheTargets(clientPaths.opencodeCachePackages)) {
          if (!existsSync(target)) continue;
          if (!dry) await rm(target, { recursive: true, force: true });
          console.log(`  ${tag} OpenCode cache: removed ${target}${dry ? " (would remove)" : ""}`);
          cacheRemoved++;
        }
        if (cacheRemoved > 0) removedCount += cacheRemoved;
        else {
          console.log(`  [SKIP] OpenCode cache: no owned package-cache directories found`);
          skippedCount++;
        }
      }
    } catch (err) {
      console.log(`  [FAIL] OpenCode: ${err.message}`);
      failureCount++;
    }
  }

  // 2. Claude Code
  if (opts.doClaude) {
    try {
      const result = await removeJsonMcpClient({
        label: "Claude Code",
        configPath: clientPaths.claudeConfigPath,
        cliName: "claude",
        cliArgs: ["mcp", "remove", "--scope", "user", "memory-agent"],
        dry,
      });
      if (result.status === "not_found") {
        console.log(`  [SKIP] Claude Code: owned mcpServers.memory-agent not found`);
        skippedCount++;
      } else if (result.status === "conflict") {
        console.log(`  [WARN] Claude Code: mcpServers.memory-agent is not owned by this plugin — skipped`);
        skippedCount++;
      } else {
        console.log(`  ${tag} Claude Code: removed MCP registration via ${result.method === "native" ? "claude mcp remove" : result.method === "preview" ? "native command or ownership-checked fallback" : "ownership-checked JSON fallback"}${dry ? " (would remove)" : ""}`);
        if (result.nativeReason) console.log(`  [INFO] Claude Code fallback: ${result.nativeReason}`);
        removedCount++;
      }
    } catch (err) {
      console.log(`  [FAIL] Claude Code: ${err.message}`);
      failureCount++;
    }
  }

  // 3. Antigravity
  if (opts.doAntigravity) {
    try {
      const geminiConfigFile = clientPaths.antigravityMcpConfigPath;
      let didGlobal = false;
      if (existsSync(geminiConfigFile)) {
        const config = await readJsonConfig(geminiConfigFile);
        const memoryEntry = config.mcpServers?.["memory-agent"];
        if (memoryEntry && isMemoryMcpServerEntry(memoryEntry)) {
          if (!dry) {
            delete config.mcpServers["memory-agent"];
            // keep empty mcpServers object (do not delete key) to preserve file structure
            await mkdir(clientPaths.antigravityConfigDir, { recursive: true });
            await writeFile(geminiConfigFile, JSON.stringify(config, null, 2) + "\n", "utf-8");
          }
          console.log(`  ${tag} Antigravity: removed mcpServers.memory-agent from ${geminiConfigFile}${dry ? " (would remove)" : ""}`);
          didGlobal = true;
          removedCount++;
        } else if (memoryEntry) {
          console.log(`  [WARN] Antigravity: mcpServers.memory-agent is not owned by this plugin — skipped`);
          didGlobal = true;
          skippedCount++;
        }
      }
      if (!didGlobal) {
        console.log(`  [SKIP] Antigravity (global): mcpServers.memory-agent not found in ${geminiConfigFile}`);
        skippedCount++;
      }

      // local .agents/mcp_config.json
      const localMcpFile = clientPaths.localAgentsMcpConfigPath;
      if (existsSync(localMcpFile)) {
        try {
          const localConfig = await readJsonConfig(localMcpFile);
          const memoryEntry = localConfig.mcpServers?.["memory-agent"];
          if (memoryEntry && isMemoryMcpServerEntry(memoryEntry)) {
            if (!dry) {
              delete localConfig.mcpServers["memory-agent"];
              await writeFile(localMcpFile, JSON.stringify(localConfig, null, 2) + "\n", "utf-8");
            }
            console.log(`  ${tag} Antigravity (local): removed mcpServers.memory-agent from ${localMcpFile}${dry ? " (would remove)" : ""}`);
            removedCount++;
          } else if (memoryEntry) {
            console.log(`  [WARN] Antigravity (local): mcpServers.memory-agent is not owned by this plugin — skipped`);
            skippedCount++;
          } else {
            console.log(`  [SKIP] Antigravity (local): mcpServers.memory-agent not found in ${localMcpFile}`);
            skippedCount++;
          }
        } catch (e) {
          console.log(`  [FAIL] Antigravity (local): ${e.message}`);
          failureCount++;
        }
      }
    } catch (err) {
      console.log(`  [FAIL] Antigravity: ${err.message}`);
      failureCount++;
    }
  }

  // 4. Gemini CLI
  if (opts.doGemini) {
    try {
      const result = await removeJsonMcpClient({
        label: "Gemini CLI",
        configPath: clientPaths.geminiSettingsPath,
        cliName: "gemini",
        cliArgs: ["mcp", "remove", "--scope", "user", "memory-agent"],
        dry,
      });
      if (result.status === "not_found") {
        console.log(`  [SKIP] Gemini CLI: owned mcpServers.memory-agent not found`);
        skippedCount++;
      } else if (result.status === "conflict") {
        console.log(`  [WARN] Gemini CLI: mcpServers.memory-agent is not owned by this plugin — skipped`);
        skippedCount++;
      } else {
        console.log(`  ${tag} Gemini CLI: removed MCP registration via ${result.method === "native" ? "gemini mcp remove" : result.method === "preview" ? "native command or ownership-checked fallback" : "ownership-checked settings.json fallback"}${dry ? " (would remove)" : ""}`);
        if (result.nativeReason) console.log(`  [INFO] Gemini CLI fallback: ${result.nativeReason}`);
        removedCount++;
      }
    } catch (err) {
      console.log(`  [FAIL] Gemini CLI: ${err.message}`);
      failureCount++;
    }
  }

  // 5. Codex
  if (opts.doCodex) {
    try {
      const codexConfig = clientPaths.codexConfigPath;
      if (!existsSync(codexConfig)) {
        console.log(`  [SKIP] Codex: no config at ${codexConfig}`);
        skippedCount++;
      } else {
        let content = await readFile(codexConfig, "utf-8");
        const { removeCodexMemoryAgentConfig } = await import("./codex_config.js");
        let result = removeCodexMemoryAgentConfig(content);
        if (result.status === "not_found") {
          console.log(`  [SKIP] Codex: [mcp_servers.memory-agent] not found`);
          skippedCount++;
        } else if (result.status === "conflict") {
          console.log(`  [WARN] Codex: ${result.reason} — skipped to avoid touching foreign config`);
          skippedCount++;
        } else if (result.changed) {
          let method = "preview";
          let nativeReason = null;
          if (!dry) {
            const native = runClientCli("codex", ["mcp", "remove", "memory-agent"]);
            if (native.ok) {
              content = existsSync(codexConfig) ? await readFile(codexConfig, "utf-8") : "";
              result = removeCodexMemoryAgentConfig(content);
              if (result.status === "not_found") method = "native";
              else if (result.status === "conflict") {
                throw new Error("codex mcp remove left an unrecognized memory-agent section");
              } else {
                method = "fallback";
                nativeReason = "native command did not remove the expected section";
              }
            } else {
              method = "fallback";
              nativeReason = cliFailureMessage(native);
            }
            if (method === "fallback" && result.changed) {
              await writeFile(codexConfig, result.content, "utf-8");
            }
          }
          console.log(`  ${tag} Codex: removed memory-agent via ${method === "native" ? "codex mcp remove" : method === "preview" ? "native command or ownership-checked fallback" : "ownership-checked TOML fallback"}${dry ? " (would remove)" : ""}`);
          if (nativeReason) console.log(`  [INFO] Codex fallback: ${nativeReason}`);
          removedCount++;
        } else {
          console.log(`  [SKIP] Codex: already clean`);
          skippedCount++;
        }
      }
    } catch (err) {
      console.log(`  [FAIL] Codex: ${err.message}`);
      failureCount++;
    }
  }

  // 6. Global Prompt blocks
  try {
    const { disableGlobalPrompt, getGlobalPromptStatus } = await import("./prompt_manager.js");
    const promptTargets = [];
    if (opts.doCodex) promptTargets.push("Codex");
    if (opts.doClaude) promptTargets.push("Claude Code");
    if (opts.doAntigravity) promptTargets.push("Antigravity");
    if (opts.doGemini) promptTargets.push("Gemini CLI");
    if (promptTargets.length > 0) {
      if (dry) {
        const status = await getGlobalPromptStatus(promptTargets);
        for (const s of status) {
          if (s.enabled) {
            console.log(`  ${tag} ${s.name}: would remove prompt block from ${s.filePath}`);
            removedCount++;
          } else {
            console.log(`  [SKIP] ${s.name}: prompt block not present`);
            skippedCount++;
          }
        }
      } else {
        const results = await disableGlobalPrompt(promptTargets);
        for (const r of results) {
          if (r.status === "disabled" || r.status === "removed_file") {
            console.log(`  [OK] ${r.name}: removed prompt block from ${r.filePath}`);
            removedCount++;
          } else if (r.status === "skipped") {
            console.log(`  [SKIP] ${r.name}: prompt block not found`);
            skippedCount++;
          } else if (r.status === "failed") {
            console.log(`  [FAIL] ${r.name}: ${r.error}`);
            failureCount++;
          }
        }
      }
    } else {
      console.log(`  [SKIP] Prompts: --opencode only, no AGENTS.md prompts to remove`);
      skippedCount++;
    }
  } catch (err) {
    console.log(`  [FAIL] Prompts: ${err.message}`);
    failureCount++;
  }

  // 7. Skills
  try {
    const rawSkills = [
      opts.doOpenCode ? { name: "OpenCode", dir: join(clientPaths.opencodeDir, "skills", "using-memory") } : null,
      opts.doAntigravity ? { name: "Antigravity", dir: join(clientPaths.antigravityConfigDir, "skills", "using-memory") } : null,
      opts.doGemini ? { name: "Gemini CLI", dir: join(clientPaths.geminiSkillsDir, "using-memory") } : null,
      opts.doCodex ? { name: "Codex", dir: join(home, ".codex", "skills", "using-memory") } : null,
      opts.doCodex ? { name: "Codex shared agents", dir: join(home, ".agents", "skills", "using-memory") } : null,
      opts.doClaude ? { name: "Claude Code", dir: join(home, ".claude", "skills", "using-memory") } : null,
    ].filter(Boolean);

    // local Antigravity .agents/skills
    const cwd = clientPaths.cwd;
    if (opts.doAntigravity && existsSync(join(cwd, ".agents"))) {
      rawSkills.push({ name: "Antigravity (local)", dir: join(cwd, ".agents", "skills", "using-memory") });
    }

    // Deduplicate by normalized path (e.g. Codex shared agents and Antigravity local may coincide)
    const seen = new Set();
    const homeSkills = [];
    for (const target of rawSkills) {
      const key = target.dir.replace(/\\/g, "/").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      homeSkills.push(target);
    }

    for (const target of homeSkills) {
      if (existsSync(target.dir)) {
        if (!await isOwnedSkillDir(target.dir)) {
          console.log(`  [WARN] ${target.name}: using-memory skill is modified or not owned by this plugin — skipped`);
          skippedCount++;
          continue;
        }
        if (!dry) {
          await rm(target.dir, { recursive: true, force: true });
        }
        console.log(`  ${tag} ${target.name}: removed skill at ${target.dir}${dry ? " (would remove)" : ""}`);
        removedCount++;
      } else {
        console.log(`  [SKIP] ${target.name}: skill not found at ${target.dir}`);
        skippedCount++;
      }
    }
  } catch (err) {
    console.log(`  [FAIL] Skills: ${err.message}`);
    failureCount++;
  }

  // 8. Data purge
  if (opts.purge) {
    for (const d of purgeDirs) {
      if (existsSync(d.path)) {
        if (!dry) {
          try {
            await rm(d.path, { recursive: true, force: true });
          } catch (e) {
            console.log(`  [FAIL] Purge ${d.label}: ${e.message}`);
            failureCount++;
            continue;
          }
        }
        console.log(`  ${tag} Purge: removed ${d.label} at ${d.path}${dry ? " (would remove)" : ""}`);
        removedCount++;
      } else {
        console.log(`  [SKIP] Purge: ${d.label} not found at ${d.path}`);
        skippedCount++;
      }
    }
  }

  console.log("");
  if (dry) {
    console.log(`Preview complete. ${removedCount} item(s) would be removed, ${skippedCount} skipped. Re-run without --dry-run to apply.`);
    if (!opts.purge) console.log(`Tip: add --purge to also delete local Notebook / RAG / blobs (kept by default).`);
  } else {
    console.log(`Uninstall complete. Removed ${removedCount} item(s), ${skippedCount} skipped.`);
    if (!opts.purge) {
      console.log(`Local Notebook / RAG data was kept. To delete it, run: memory_plugin uninstall --purge`);
    }
    console.log(`To remove the npm package itself (if installed globally), run: npm uninstall -g @lotargo/memory_plugin`);
    console.log(`Restart OpenCode / Codex / Claude Code / Gemini CLI / Antigravity to apply changes.\n`);
  }
  if (failureCount > 0) {
    process.exitCode = 1;
    console.log(`Completed with ${failureCount} failure(s).\n`);
  }
  return { ok: failureCount === 0, removedCount, skippedCount, failureCount };
}
