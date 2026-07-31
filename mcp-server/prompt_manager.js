import { readFile, writeFile, mkdir, unlink, rename, copyFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

const START_MARKER = "<!-- START MEMORY AGENT PROMPT -->";
const END_MARKER = "<!-- END MEMORY AGENT PROMPT -->";

export const PROMPT_BLOCK = `${START_MARKER}
[SYSTEM INSTRUCTION: PERSONAL CONTEXT & MEMORY AGENT]
1. MANDATORY FIRST STEP (SESSION INITIALIZATION): At the very start of every session or conversation, your VERY FIRST ACTION MUST BE to execute \`recall\` from \`memory-agent\` to load all saved facts, user preferences, personal context, and project guidelines BEFORE performing any other tasks or reading code.
2. PROACTIVE SAVING DIRECTIVE: You MUST automatically and proactively call \`remember\` from \`memory-agent\` whenever the user shares durable facts, personal preferences, coding guidelines, technology choices, or project architecture decisions. Do NOT wait for explicit user commands like "remember this".
3. SIGNAL FILTER: Save only high-signal facts (name, language, roles, constraints, tech stack preferences, architecture decisions, conventions). Translate facts into clear, concise English when saving. Do NOT save transient details or one-off conversation turns.
${END_MARKER}`;

// Plugin-owned files live here so we never destroy user-owned config content.
const AGENT_CONFIG_DIR = join(homedir(), ".config", "memory-agent");
export const PROMPT_FILE = join(AGENT_CONFIG_DIR, "prompt.md");
const BACKUP_DIR = join(AGENT_CONFIG_DIR, "backups");
const STATE_FILE = join(AGENT_CONFIG_DIR, "prompt-state.json");

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function atomicWrite(filePath, content) {
  const tmp = `${filePath}.memory-tmp-${process.pid}`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, filePath);
}

async function backupFile(filePath) {
  await mkdir(BACKUP_DIR, { recursive: true });
  const name = filePath.split(/[\\/]/).pop() || "config";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(BACKUP_DIR, `${name}.${stamp}.bak`);
  await copyFile(filePath, dest);
  return dest;
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

async function saveState(state) {
  await mkdir(AGENT_CONFIG_DIR, { recursive: true });
  await atomicWrite(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

export function getGlobalPromptTargets() {
  const home = homedir();
  return [
    {
      name: "Antigravity",
      filePath: join(home, ".gemini", "config", "AGENTS.md"),
      // Antigravity resolves `@` imports only in GEMINI.md, not reliably in AGENTS.md
      includeSupported: false,
    },
    {
      name: "Codex",
      filePath: join(home, ".codex", "AGENTS.md"),
      // AGENTS.md standard has no import syntax
      includeSupported: false,
    },
    {
      name: "Claude Code",
      filePath: join(home, ".claude", "CLAUDE.md"),
      // @path imports are supported and trusted in user-scope CLAUDE.md
      includeSupported: true,
    },
  ];
}

// Ensure the plugin-owned prompt file exists and is up to date with PROMPT_BLOCK.
// This file is referenced via `@` includes; updating it never touches user configs.
export async function syncPromptFile() {
  await mkdir(AGENT_CONFIG_DIR, { recursive: true });
  const expected = `${PROMPT_BLOCK}\n`;
  const current = existsSync(PROMPT_FILE) ? await readFile(PROMPT_FILE, "utf-8") : "";
  if (current !== expected) {
    await atomicWrite(PROMPT_FILE, expected);
  }
  return PROMPT_FILE;
}

function toIncludePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function buildIncludeBlock(promptFile) {
  return `${START_MARKER}
@${toIncludePath(promptFile)}
${END_MARKER}`;
}

function stripPromptBlock(content) {
  const startIndex = content.indexOf(START_MARKER);
  const endIndex = content.indexOf(END_MARKER);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = content.substring(0, startIndex);
    const after = content.substring(endIndex + END_MARKER.length);
    return (before + after).replace(/\n{3,}/g, "\n\n").trim();
  }
  return content.trim();
}

export async function enableGlobalPrompt() {
  const promptFile = await syncPromptFile();
  const targets = getGlobalPromptTargets();
  const state = await loadState();
  const results = [];

  for (const target of targets) {
    try {
      const parentDir = join(target.filePath, "..");
      if (!existsSync(parentDir)) {
        await mkdir(parentDir, { recursive: true });
      }

      const existed = existsSync(target.filePath);
      const existing = existed ? await readFile(target.filePath, "utf-8") : "";
      const clean = stripPromptBlock(existing);

      const block = target.includeSupported
        ? buildIncludeBlock(promptFile)
        : PROMPT_BLOCK;
      const updated = clean ? `${clean}\n\n${block}\n` : `${block}\n`;

      const key = target.filePath;
      const prev = state[key];

      if (existed && existing === updated) {
        results.push({ name: target.name, filePath: target.filePath, status: "up_to_date" });
        continue;
      }

      // Hash guard: if the user modified the file since we last wrote it,
      // back it up before overwriting their edits.
      if (existed && prev && prev.hash && prev.hash !== sha256(existing)) {
        await backupFile(target.filePath);
      }

      await atomicWrite(target.filePath, updated);
      state[key] = { hash: sha256(updated), existedBefore: existed };
      results.push({
        name: target.name,
        filePath: target.filePath,
        status: existed ? "enabled" : "created_new_file",
      });
    } catch (err) {
      results.push({ name: target.name, filePath: target.filePath, status: "failed", error: err.message });
    }
  }

  await saveState(state);
  return results;
}

export async function disableGlobalPrompt() {
  const targets = getGlobalPromptTargets();
  const state = await loadState();
  const results = [];

  for (const target of targets) {
    try {
      if (!existsSync(target.filePath)) {
        results.push({ name: target.name, filePath: target.filePath, status: "skipped" });
        continue;
      }

      const existing = await readFile(target.filePath, "utf-8");
      if (!existing.includes(START_MARKER)) {
        results.push({ name: target.name, filePath: target.filePath, status: "skipped" });
        continue;
      }

      const clean = stripPromptBlock(existing);
      const key = target.filePath;
      const prev = state[key];

      if (clean.length === 0) {
        // Only delete the file if we created it; otherwise leave the user's file in place.
        if (prev && prev.existedBefore === false) {
          await unlink(target.filePath);
          results.push({ name: target.name, filePath: target.filePath, status: "removed_file" });
        } else {
          await atomicWrite(target.filePath, "");
          results.push({ name: target.name, filePath: target.filePath, status: "disabled" });
        }
      } else {
        await atomicWrite(target.filePath, clean + "\n");
        results.push({ name: target.name, filePath: target.filePath, status: "disabled" });
      }

      delete state[key];
    } catch (err) {
      results.push({ name: target.name, filePath: target.filePath, status: "failed", error: err.message });
    }
  }

  await saveState(state);
  return results;
}

export async function getGlobalPromptStatus() {
  const targets = getGlobalPromptTargets();
  const status = [];

  for (const target of targets) {
    let enabled = false;
    if (existsSync(target.filePath)) {
      const content = await readFile(target.filePath, "utf-8");
      enabled = content.includes(START_MARKER) && content.includes(END_MARKER);
    }
    status.push({ name: target.name, filePath: target.filePath, enabled });
  }

  return status;
}
