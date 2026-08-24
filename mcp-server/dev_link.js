import { copyFile, cp, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveClientPaths } from "./client_paths.js";

export const PACKAGE_NAME = "@lotargo/memory_plugin";
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const DEV_PLUGIN_FILE = join(REPO_ROOT, "opencode-plugin", "main.js");

const LEGACY_PACKAGE_NAMES = new Set([
  PACKAGE_NAME,
  "opencode-memory-plugin",
  "memory_plugin",
  "memory-plugin",
]);

function pluginSpec(entry) {
  return Array.isArray(entry) ? entry[0] : entry;
}

export function isMemoryPluginSpec(spec, devPluginUrl = pathToFileURL(DEV_PLUGIN_FILE).href) {
  if (typeof spec !== "string") return false;
  if (LEGACY_PACKAGE_NAMES.has(spec)) return true;
  if (/^@lotargo\/memory_plugin(?:@[^/]+)?$/i.test(spec)) return true;
  if (/^(?:opencode-memory-plugin|memory_plugin|memory-plugin)(?:@[^/]+)?$/i.test(spec)) return true;
  if (spec === devPluginUrl) return true;
  return false;
}

export function rewriteOpenCodePluginList(pluginList, devPluginUrl) {
  const input = Array.isArray(pluginList) ? pluginList : [];
  const output = [];
  let inserted = false;

  for (const entry of input) {
    const spec = pluginSpec(entry);
    if (!isMemoryPluginSpec(spec, devPluginUrl)) {
      output.push(entry);
      continue;
    }
    if (inserted) continue;
    output.push(Array.isArray(entry) ? [devPluginUrl, entry[1]] : devPluginUrl);
    inserted = true;
  }

  if (!inserted) output.push(devPluginUrl);
  return output;
}

export async function linkOpenCodeToRepository({
  configDir = resolveClientPaths().opencodeDir,
  pluginFile = DEV_PLUGIN_FILE,
} = {}) {
  if (!existsSync(pluginFile)) throw new Error(`OpenCode plugin entry not found: ${pluginFile}`);
  const configPath = join(configDir, "opencode.json");
  const backupPath = `${configPath}.memory-dev-backup`;
  await mkdir(configDir, { recursive: true });

  let config = {};
  if (existsSync(configPath)) {
    const raw = await readFile(configPath, "utf-8");
    config = raw.trim() ? JSON.parse(raw) : {};
    if (!existsSync(backupPath)) await copyFile(configPath, backupPath);
  }

  const devPluginUrl = pathToFileURL(pluginFile).href;
  config.plugin = rewriteOpenCodePluginList(config.plugin, devPluginUrl);
  const content = `${JSON.stringify(config, null, 2)}\n`;
  const tmpPath = `${configPath}.memory-dev-tmp-${process.pid}`;
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, configPath);

  return { configPath, backupPath, devPluginUrl };
}

export function linkGlobalNpmPackage({ repoRoot = REPO_ROOT } = {}) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath && existsSync(npmExecPath) ? process.execPath : "npm";
  const args = npmExecPath && existsSync(npmExecPath) ? [npmExecPath, "link"] : ["link"];
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    // A direct npm-cli.js invocation is preferred. The shell fallback is only
    // needed when dev-link is launched outside npm and no npm_execpath exists;
    // the command and arguments are fixed, not user-provided.
    shell: process.platform === "win32" && !npmExecPath,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm link failed with exit code ${result.status}`);
}

export async function syncDevelopmentSkills({
  skillsSource = join(REPO_ROOT, "skills"),
  targets = null,
} = {}) {
  if (!existsSync(skillsSource)) return [];
  const { home, opencodeDir } = resolveClientPaths();
  const destinations = targets || [
    join(opencodeDir, "skills"),
    join(home, ".codex", "skills"),
    join(home, ".agents", "skills"),
    join(home, ".claude", "skills"),
    join(home, ".gemini", "config", "skills"),
  ];
  const entries = await readdir(skillsSource, { withFileTypes: true });
  for (const destination of destinations) {
    await mkdir(destination, { recursive: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      await cp(join(skillsSource, entry.name), join(destination, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }
  return destinations;
}

export async function runDevLink({ skipNpmLink = false } = {}) {
  console.log(`\nLinking ${PACKAGE_NAME} to the working repository...\n`);
  if (!skipNpmLink) {
    linkGlobalNpmPackage();
    console.log(`  [OK] System CLI linked to ${REPO_ROOT}`);
  }
  const linked = await linkOpenCodeToRepository();
  console.log(`  [OK] OpenCode plugin source: ${linked.devPluginUrl}`);
  console.log(`  [OK] OpenCode config: ${linked.configPath}`);
  console.log(`  [OK] Original config backup: ${linked.backupPath}`);
  const { enableGlobalPrompt } = await import("./prompt_manager.js");
  const promptResults = await enableGlobalPrompt();
  const promptFailures = promptResults.filter((result) => result.status === "failed");
  if (promptFailures.length) {
    throw new Error(`Failed to synchronize client prompts: ${promptFailures.map((item) => item.name).join(", ")}`);
  }
  console.log("  [OK] Codex, Claude Code, Gemini CLI, and Antigravity prompts synchronized");
  const skillTargets = await syncDevelopmentSkills();
  console.log(`  [OK] Development skills synchronized to ${skillTargets.length} client location(s)`);
  console.log("\nDevelopment link is active. After source edits, restart OpenCode; publishing and reinstalling are not required.\n");
  return linked;
}
