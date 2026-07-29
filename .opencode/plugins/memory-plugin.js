const { readFile, writeFile, mkdir } = await import("fs/promises");
const { existsSync } = await import("fs");
const { join, basename } = await import("path");
const { homedir } = await import("os");

const CONFIG_DIR = process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode");
const MEMORY_DIR = join(CONFIG_DIR, "memory");
const GLOBAL_KEY = "global";

async function ensureDir() {
  if (!existsSync(MEMORY_DIR)) await mkdir(MEMORY_DIR, { recursive: true });
}

function projectName(worktree, directory) {
  const dir = worktree || directory;
  return dir ? basename(dir) : "default";
}

function scopeKey(scope, worktree, directory) {
  return scope === "global" ? GLOBAL_KEY : projectName(worktree, directory);
}

function memoryPath(key) {
  return join(MEMORY_DIR, `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.md`);
}

async function readMemory(key) {
  const fp = memoryPath(key);
  if (!existsSync(fp)) return [];
  const content = await readFile(fp, "utf-8");
  return content.split("\n").filter((l) => l.startsWith("- ["));
}

async function readMemoryRaw(key) {
  return (await readMemory(key)).map((e) => e.slice(2));
}

async function writeMemory(key, entries) {
  const header = `# ${key === GLOBAL_KEY ? "Global Memory" : `Memory: ${key}`}\n\n`;
  await writeFile(memoryPath(key), header + entries.join("\n") + "\n");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function notify(client, message, variant = "success") {
  if (!client?.tui?.showToast) {
    await client?.app?.log({
      body: { service: "memory-plugin", level: "warn", message: "client.tui.showToast not available" },
    });
    return;
  }
  const payload = { message, variant, duration: 3000 };
  try {
    await client.tui.showToast({ body: payload });
  } catch (err1) {
    try {
      await client.tui.showToast(payload);
    } catch (err2) {
      await client?.app?.log({
        body: {
          service: "memory-plugin",
          level: "error",
          message: "showToast failed",
          extra: { shape1: String(err1), shape2: String(err2) },
        },
      });
    }
  }
}

const MEMORY_INSTRUCTION =
  "Use `remember` only for important, durable facts about the user and project.\n" +
  "Save high-signal things like: name, language, role/goals, constraints, tech\n" +
  "stack preferences, architecture decisions, project conventions.\n" +
  "DO NOT save: transient details, one-off statements, full conversation turns,\n" +
  "or anything unlikely to be useful in future sessions.\n" +
  "When saving, translate the fact into English and keep it concise.\n" +
  "Use `scope: \"global\"` for personal facts, `scope: \"project\"` for project-specific facts.";

function buildMemoryContext(globalFacts, projectFacts, projectKey) {
  const parts = [MEMORY_INSTRUCTION];
  if (globalFacts.length) {
    parts.push("## Global\n" + globalFacts.map((f, i) => `${i + 1}. ${f}`).join("\n"));
  }
  if (projectFacts.length) {
    parts.push(`## Project: ${projectKey}\n` + projectFacts.map((f, i) => `${i + 1}. ${f}`).join("\n"));
  }
  return `<MEMORY>\n${parts.join("\n\n")}\n</MEMORY>`;
}

const MCP_SERVERS = [
  { id: "context7", desc: "Документация библиотек и фреймворков (Context7)" },
  { id: "supabase", desc: "БД Supabase — SQL, миграции, edge functions" },
  { id: "stitch", desc: "UI дизайн — генерация и редактирование экранов" },
  { id: "neon", desc: "БД Neon — PostgreSQL, схемы, миграции" },
  { id: "linear", desc: "Linear — задачи, проекты, документы" },
  { id: "grep", desc: "Поиск примеров кода на GitHub" },
  { id: "skills-anthropic", desc: "Скиллы Anthropic — дизайн, доки, MCP, PDF/PPTX/XLSX" },
  { id: "skills-vercel", desc: "Скиллы mattpocock — engineering workflow (grill, tdd, triage, architecture)" },
  { id: "playwright", desc: "Браузерные тесты — навигация, скриншоты, клики" },
  { id: "github", desc: "GitHub API — PRs, issues, репозитории" },
];

export const MemoryPlugin = async ({ directory, worktree, client }) => {
  await ensureDir();
  const projectKey = projectName(worktree, directory);

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages?.length) return;
      const firstUser = output.messages.find((m) => m?.info?.role === "user");
      if (!firstUser?.parts?.length) return;

      if (firstUser.parts.some((p) => p.type === "text" && p.text.includes("<MEMORY>"))) return;

      const [globalFacts, projectFacts] = await Promise.all([
        readMemoryRaw(GLOBAL_KEY),
        readMemoryRaw(projectKey),
      ]);

      const context = buildMemoryContext(globalFacts, projectFacts, projectKey);
      const ref = firstUser.parts[0];
      firstUser.parts.unshift({ ...ref, type: "text", text: context });
    },

    tool: {
      "list-mcp-tools": {
        description: "Показать список всех подключённых MCP серверов и их назначение",
        args: {},
        async execute() {
          const lines = MCP_SERVERS.map((s) => `  ${s.id.padEnd(20)} ${s.desc}`);
          return "Доступные MCP серверы:\n" + lines.join("\n");
        },
      },
      "mcp-reminder": {
        description: "Напомнить какие MCP инструменты подходят для текущей задачи. Вызови когда сомневаешься что выбрать.",
        args: {
          task: {
            type: "string",
            description: "Описание того что собираешься делать (опционально)",
          },
        },
        async execute({ task }) {
          if (task) {
            return `Для задачи "${task}" рекомендую посмотреть список через list-mcp-tools. Основные сценарии:\n- Работа с кодом → skills-vercel (grill, tdd, review), github\n- UI/дизайн → stitch, skills-anthropic (frontend-design, webapp-testing)\n- База данных → supabase, neon\n- Документы → skills-anthropic (docx, pdf, pptx, xlsx)\n- Поиск примеров → grep`;
          }
          return "Вызови list-mcp-tools чтобы увидеть все доступные MCP серверы";
        },
      },
      "remember": {
        description: "Save an important, durable fact to memory. Only use for high-signal information (name, goals, constraints, tech preferences, project conventions). Translate the fact into English before saving. scope: 'project' (default) or 'global'",
        args: {
          fact: { type: "string", description: "The fact to remember, written in English" },
          scope: {
            type: "string",
            description: "'project' (default) or 'global'",
            default: "project",
          },
        },
        async execute({ fact, scope }, { worktree, directory }) {
          const key = scopeKey(scope || "project", worktree, directory);
          const entries = await readMemory(key);
          const factNormalized = fact.toLowerCase().trim();
          if (entries.some((e) => {
            const idx = e.indexOf("] ");
            return idx !== -1 && e.slice(idx + 2).toLowerCase().trim() === factNormalized;
          })) {
            return "Already saved";
          }
          entries.push(`- [${today()}] ${fact}`);
          await writeMemory(key, entries);
          await notify(client, "Memory updated");
          return "Memory updated";
        },
      },
      "recall": {
        description: "Показать запомненные факты (scope: project | global | all, по умолчанию все)",
        args: {
          scope: {
            type: "string",
            description: "project, global или all (по умолчанию)",
            default: "all",
          },
        },
        async execute({ scope }, { worktree, directory }) {
          const project = projectName(worktree, directory);
          const results = [];
          if (scope !== "project") {
            const global = await readMemoryRaw(GLOBAL_KEY);
            if (global.length) {
              results.push("--- Global ---");
              global.forEach((e, i) => results.push(`${i + 1}. ${e}`));
            }
          }
          if (scope !== "global") {
            const local = await readMemoryRaw(project);
            if (local.length) {
              if (results.length) results.push("");
              results.push(`--- ${project} ---`);
              local.forEach((e, i) => results.push(`${i + 1}. ${e}`));
            }
          }
          return results.length ? results.join("\n") : "Memory is empty.";
        },
      },
      "forget": {
        description: "Удалить факт по номеру (см. recall) или тексту",
        args: {
          query: { type: "string", description: "Номер факта или текст для поиска" },
          scope: {
            type: "string",
            description: "project (по умолчанию) или global",
            default: "project",
          },
        },
        async execute({ query, scope }, { worktree, directory }) {
          const key = scopeKey(scope || "project", worktree, directory);
          const entries = await readMemory(key);
          const num = parseInt(query, 10);
          let removed;
          if (!isNaN(num) && num > 0 && num <= entries.length) {
            removed = entries.splice(num - 1, 1);
          } else {
            const filtered = entries.filter((e) => !e.toLowerCase().includes(query.toLowerCase()));
            removed = entries.filter((e) => e.toLowerCase().includes(query.toLowerCase()));
            entries.length = 0;
            entries.push(...filtered);
          }
          await writeMemory(key, entries);
          const result = removed.length ? "Memory updated" : "Not found.";
          if (removed.length) await notify(client, "Memory updated");
          return result;
        },
      },
    },
  };
};

export default MemoryPlugin;
