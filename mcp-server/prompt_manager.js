import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const START_MARKER = "<!-- START MEMORY AGENT PROMPT -->";
const END_MARKER = "<!-- END MEMORY AGENT PROMPT -->";

export const PROMPT_BLOCK = `${START_MARKER}
[SYSTEM INSTRUCTION: PERSONAL CONTEXT & MEMORY AGENT]
1. MANDATORY FIRST STEP (SESSION INITIALIZATION): At the very start of every session or conversation, your VERY FIRST ACTION MUST BE to execute \`recall\` from \`memory-agent\` to load all saved facts, user preferences, personal context, and project guidelines BEFORE performing any other tasks or reading code.
2. PROACTIVE SAVING DIRECTIVE: You MUST automatically and proactively call \`remember\` from \`memory-agent\` whenever the user shares durable facts, personal preferences, coding guidelines, technology choices, or project architecture decisions. Do NOT wait for explicit user commands like "remember this".
3. SIGNAL FILTER: Save only high-signal facts (name, language, roles, constraints, tech stack preferences, architecture decisions, conventions). Translate facts into clear, concise English when saving. Do NOT save transient details or one-off conversation turns.
${END_MARKER}`;

export function getGlobalPromptTargets() {
  const home = homedir();
  return [
    {
      name: "Antigravity",
      filePath: join(home, ".gemini", "config", "AGENTS.md"),
    },
    {
      name: "Codex",
      filePath: join(home, ".codex", "AGENTS.md"),
    },
    {
      name: "Claude Code",
      filePath: join(home, ".claude", "CLAUDE.md"),
    },
  ];
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
  const targets = getGlobalPromptTargets();
  const results = [];

  for (const target of targets) {
    try {
      const parentDir = join(target.filePath, "..");
      if (!existsSync(parentDir)) {
        await mkdir(parentDir, { recursive: true });
      }

      let existing = "";
      if (existsSync(target.filePath)) {
        existing = await readFile(target.filePath, "utf-8");
      }

      const clean = stripPromptBlock(existing);
      const updated = clean ? `${clean}\n\n${PROMPT_BLOCK}\n` : `${PROMPT_BLOCK}\n`;

      await writeFile(target.filePath, updated, "utf-8");
      results.push({ name: target.name, filePath: target.filePath, status: "enabled" });
    } catch (err) {
      results.push({ name: target.name, filePath: target.filePath, status: "failed", error: err.message });
    }
  }

  return results;
}

export async function disableGlobalPrompt() {
  const targets = getGlobalPromptTargets();
  const results = [];

  for (const target of targets) {
    try {
      if (!existsSync(target.filePath)) {
        results.push({ name: target.name, filePath: target.filePath, status: "skipped" });
        continue;
      }

      const existing = await readFile(target.filePath, "utf-8");
      const clean = stripPromptBlock(existing);

      if (clean.length === 0) {
        await unlink(target.filePath);
        results.push({ name: target.name, filePath: target.filePath, status: "removed_file" });
      } else {
        await writeFile(target.filePath, clean + "\n", "utf-8");
        results.push({ name: target.name, filePath: target.filePath, status: "disabled" });
      }
    } catch (err) {
      results.push({ name: target.name, filePath: target.filePath, status: "failed", error: err.message });
    }
  }

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
