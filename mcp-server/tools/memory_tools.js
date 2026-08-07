import * as z from "zod/v4";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readMemory,
  readMemoryRaw,
  writeMemory,
  today,
  MEMORY_DIR,
  GLOBAL_KEY,
  scopeKey,
  projectKey,
  projectName,
  canonicalPath,
  listProjectStores,
  storeFilePath,
} from "../memory.js";
import {
  parseFactEntry,
  factText,
  factMeta,
  withMeta,
  nextFactId,
  isKeepFact,
  isExpiredLine,
  isSuperseded,
  formatFactEntry,
  matchesQuery,
  matchesTags,
  inDateRange,
  factTitle,
  factBody,
  autoGenerateTitle,
} from "../fact_format.js";
import { optStr, optNum, defStr, defBool, requireProjectKey, resolveFactIndex } from "./helpers.js";

export function registerMemoryTools(server) {
  server.registerTool(
    "remember",
    {
      description:
        "Save an important, durable fact to memory. Only use for high-signal information " +
        "(name, goals, constraints, tech preferences, project conventions). " +
        "docId/startLine/endLine/relationType are OPTIONAL and only used to link the fact to a " +
        "Knowledge Base document or line range; omit them when no linking is needed. " +
        "ttl is OPTIONAL (e.g. '90d', '2w', '24h') — expired facts are shown with [EXPIRED] but not auto-deleted. " +
        "keep=true protects the fact from forget deletion unless force=true. " +
        "tags is OPTIONAL comma-separated text for filtering. " +
        "supersedes is OPTIONAL: a number (from recall), id, or text of a fact this one replaces; " +
        "the target is then marked [SUPERSEDED]. " +
        "Translate the fact into English and keep it concise. " +
        "scope: 'project' (default) or 'global'",
      inputSchema: z.object({
        fact: z.string().describe("The fact to remember, written in English"),
        title: optStr().describe("Optional title for the fact. If not specified, one is auto-generated."),
        scope: defStr("project").describe("'project' (default) or 'global'"),
        docId: optStr().describe("Optional document ID, title, or path to link this fact to"),
        startLine: optNum().describe("Optional starting line number in target document"),
        endLine: optNum().describe("Optional ending line number in target document"),
        relationType: defStr("LINKS_TO").describe("Relation type (e.g. 'RULES_FOR', 'IMPLEMENTS', 'REFERENCES')"),
        ttl: optStr().describe("Optional time-to-live, e.g. '90d', '2w', '24h', '12m'"),
        keep: defBool(false).describe("Protect the fact from forget deletion unless force=true"),
        tags: optStr().describe("Optional comma-separated tags, e.g. 'pref,arch'"),
        supersedes: optStr().describe("Optional number, id, or text of the fact this one replaces"),
      }),
    },
    async ({ fact, title, scope, docId, startLine, endLine, relationType, ttl, keep, tags, supersedes }) => {
      const key = requireProjectKey(await scopeKey(scope, null, null));
      const entries = await readMemory(key);

      const explicitTitle = title ? title.trim() : null;
      let finalTitle = explicitTitle;
      let finalFact = fact.trim();

      // If fact already contains a title pattern, extract it
      const titleMatch = /^\*\*([^*]+)\*\*\s*(?:—|--|-|:)?\s*(.*)$/.exec(finalFact);
      if (titleMatch) {
        if (!finalTitle) {
          finalTitle = titleMatch[1].trim();
        }
        finalFact = titleMatch[2].trim();
      }

      if (!finalTitle) {
        finalTitle = autoGenerateTitle(finalFact);
      }

      const text = `**${finalTitle}** — ${finalFact}`;
      const factBodyNormalized = finalFact.toLowerCase();
      let duplicate = false;
      if (entries.some((e) => factBody(e).toLowerCase().trim() === factBodyNormalized)) {
        duplicate = true;
      }

      let supersededInfo = "";
      if (!duplicate) {
        const [date, time] = today().split(" ");
        const meta = { ttl, tags };
        if (keep) meta.keep = "1";
        if (supersedes) {
          const targetIdx = resolveFactIndex(entries, supersedes);
          if (targetIdx !== -1) {
            const newId = nextFactId(entries);
            const targetMeta = factMeta(entries[targetIdx]);
            const targetId = targetMeta.id || nextFactId(entries);
            entries[targetIdx] = withMeta(entries[targetIdx], { id: targetId, supersededBy: newId });
            meta.id = newId;
            meta.supersedes = targetId;
            supersededInfo = ` [superseded: "${factText(entries[targetIdx]).slice(0, 60)}"]`;
          } else {
            supersededInfo = " (note: supersedes target not found)";
          }
        }
        if (!meta.id) meta.id = nextFactId(entries);
        entries.push(formatFactEntry({ date, time, text, meta }));
        await writeMemory(key, entries);
      }

      let linkInfo = "";
      if (docId) {
        const { linkFactToDocument } = await import("../graph/knowledge_linker.js");
        try {
          const linkRes = linkFactToDocument({
            factKey: key,
            factText: finalFact,
            docId,
            startLine,
            endLine,
            relationType,
          });
          const linesStr = startLine ? `:L${startLine}${endLine ? `-${endLine}` : ""}` : "";
          linkInfo = ` [Linked to Doc: "${linkRes.docTitle}"${linesStr}]`;
        } catch (err) {
          linkInfo = ` (Note: Fact saved, but document link failed: ${err.message})`;
        }
      }

      return { content: [{ type: "text", text: `Memory updated${supersededInfo}${linkInfo}` }] };
    }
  );

  server.registerTool(
    "recall",
    {
      description:
        "Show saved facts with any Agent-linked Knowledge Base documents/lines. " +
        "scope: 'project', 'global', 'all' (default), or 'list_projects'. " +
        "Use project: '<directory path>' with scope 'project'/'all' to read facts of a specific project from any working directory. " +
        "query filters by keyword (all space-separated terms must match). " +
        "tags filters by comma-separated tags. since/until filter by date (YYYY-MM-DD, inclusive). " +
        "Expired facts are shown with [EXPIRED], protected ones with [KEEP]. The response includes the store file paths.",
      inputSchema: z.object({
        scope: defStr("all").describe("'project', 'global', 'all', or 'list_projects'"),
        project: optStr().describe("Directory path of the project to read facts from (e.g. 'F:/projects/plugins/memory')"),
        query: optStr().describe("Optional keyword filter; all space-separated terms must match"),
        tags: optStr().describe("Optional comma-separated tag filter (any match)"),
        since: optStr().describe("Optional start date filter, YYYY-MM-DD (inclusive)"),
        until: optStr().describe("Optional end date filter, YYYY-MM-DD (inclusive)"),
        mode: z.enum(["headers", "full"]).nullish().transform((v) => v || "full").describe("Result mode: 'full' (with body, default) or 'headers' (title and badges only)"),
        offset: optNum().describe("Pagination offset (optional)"),
        limit: optNum().describe("Pagination limit (optional)"),
      }),
    },
    async ({ scope, project, query, tags, since, until, mode, offset, limit }) => {
      const { getLinksForFact } = await import("../graph/knowledge_linker.js");
      const results = [];
      const now = Date.now();

      const formatRecallFact = async (factLine, index, key) => {
        const p = parseFactEntry(factLine);
        if (!p) return factLine;

        const title = factTitle(factLine);
        const meta = p.meta;

        const badges = [];
        if (isExpiredLine(factLine, now)) badges.push("EXPIRED");
        if (isKeepFact(factLine)) badges.push("KEEP");
        if (isSuperseded(factLine)) badges.push("SUPERSEDED");
        if (meta.inject === "1") badges.push("INJECT");
        if (meta.id) badges.push(`id:${meta.id}`);
        if (meta.tags) badges.push(`tags:${meta.tags}`);
        badges.push(`${p.date} ${p.time}`);

        const badgesStr = badges.length ? ` [${badges.join("] [")}]` : "";

        let lineText;
        if (mode === "headers") {
          lineText = `**${title}**${badgesStr}`;
        } else {
          lineText = `${p.text}${badgesStr}`;
        }

        try {
          const links = await getLinksForFact(key, p.text);
          if (links && links.length > 0) {
            const docStr = links
              .map((l) => {
                const range = l.start_line ? `:L${l.start_line}${l.end_line ? `-${l.end_line}` : ""}` : "";
                return `${l.doc_title || l.doc_path}${range}`;
              })
              .join(", ");
            lineText += ` 🔗 [Linked Docs: ${docStr}]`;
          }
        } catch (e) {}

        return `${index}. ${lineText}`;
      };

      const collect = async (entries, key) => {
        const matched = entries.filter(
          (e) => matchesQuery(e, query) && matchesTags(e, tags) && inDateRange(e, since, until)
        );
        if (!matched.length) return;
        if (results.length) results.push("");
        results.push(`--- ${key === GLOBAL_KEY ? "Global" : `Project: ${key === target ? label : key}`} ---`);

        const targetOffset = offset !== undefined ? offset : 0;
        const targetLimit = limit !== undefined ? limit : matched.length;

        const paginated = matched.slice(targetOffset, targetOffset + targetLimit);
        for (let i = 0; i < paginated.length; i++) {
          results.push(await formatRecallFact(paginated[i], targetOffset + i + 1, key));
        }

        if (limit !== undefined && matched.length > targetLimit) {
          results.push(`Showing entries ${targetOffset + 1}-${Math.min(targetOffset + targetLimit, matched.length)} of ${matched.length}`);
        }
        results.push(`Store file: ${storeFilePath(key)}`);
      };

      if (scope === "list_projects") {
        const stores = await listProjectStores();
        if (!stores.length) {
          return { content: [{ type: "text", text: "No project memory stores found." }] };
        }
        const lines = stores.map(
          (s, i) => `${i + 1}. ${s.basename} — ${s.count} fact(s) [${s.file}]${s.path ? ` (bound to ${s.path})` : " (unbound legacy store)"}`
        );
        return {
          content: [
            {
              type: "text",
              text: `Project Memory Stores:\n${lines.join("\n")}\n\nUse recall(scope: "project", project: "<path>") to read a specific store.\n\nMemory dir: ${MEMORY_DIR}`,
            },
          ],
        };
      }

      const resolveTargetKey = async (projectPath) => {
        if (!projectPath) return null;
        try {
          const { resolveProjectIdentity } = await import("../identity.js");
          const identity = await resolveProjectIdentity(projectPath);
          if (identity) return identity.key;
        } catch (e) {}
        return canonicalPath(projectPath);
      };

      const target = (await resolveTargetKey(project)) ?? (await projectKey(null, null));
      const label = project ? target : await projectName();
      if (scope !== "project") {
        const global = await readMemory(GLOBAL_KEY);
        await collect(global, GLOBAL_KEY);
      }
      if (scope !== "global") {
        const local = await readMemory(target);
        await collect(local, target);
      }
      const filtered = Boolean(query || tags || since || until);
      const text = results.length
        ? `${results.join("\n")}\n\nMemory dir: ${MEMORY_DIR}`
        : filtered
          ? "No facts match the search."
          : "Memory is empty.";
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "get_fact",
    {
      description: "Get the full text and metadata of a single fact by its metadata id.",
      inputSchema: z.object({
        id: z.string().describe("The unique metadata id of the fact (e.g. '8f3a2c')"),
        scope: defStr("all").describe("'project', 'global', or 'all' (default)"),
      }),
    },
    async ({ id, scope }) => {
      const results = [];
      const targetId = String(id || "").trim();
      if (!targetId) throw new Error("ID parameter is required.");

      const check = async (key) => {
        const entries = await readMemory(key);
        const match = entries.find((e) => factMeta(e).id === targetId);
        if (match) {
          const title = factTitle(match);
          const body = factBody(match);
          const meta = factMeta(match);
          results.push({
            key,
            title,
            body,
            meta,
            line: match,
          });
        }
      };

      if (scope !== "project") {
        await check(GLOBAL_KEY);
      }
      if (scope !== "global") {
        const target = await projectKey(null, null);
        await check(target);
      }

      if (!results.length) {
        return { content: [{ type: "text", text: `Fact with ID "${targetId}" not found.` }] };
      }

      const lines = results.map((r) => {
        const metaStr = Object.entries(r.meta)
          .map(([k, v]) => `${k}:${v}`)
          .join(", ");
        return `[Store: ${r.key === GLOBAL_KEY ? "Global" : "Project"}]\nTitle: ${r.title}\nBody: ${r.body}\nMetadata: ${metaStr ? `<!-- ${metaStr} -->` : "none"}`;
      });

      return { content: [{ type: "text", text: lines.join("\n\n") }] };
    }
  );

  server.registerTool(
    "forget",
    {
      description:
        "Delete a fact by number (from recall), by range (e.g. '3-30', inclusive), or by text search. " +
        "Protected facts (remember with keep=true) are skipped unless force=true.",
      inputSchema: z.object({
        query: z.string().describe("Number, range like '3-30', or text to search for"),
        scope: defStr("project").describe("'project' (default) or 'global'"),
        force: defBool(false).describe("Also delete protected (keep) facts"),
      }),
    },
    async ({ query, scope, force }) => {
      const key = requireProjectKey(await scopeKey(scope, null, null));
      const entries = await readMemory(key);
      const rangeMatch = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(query);
      const num = parseInt(query, 10);
      let indices = [];
      if (rangeMatch) {
        const from = parseInt(rangeMatch[1], 10);
        const to = parseInt(rangeMatch[2], 10);
        if (from > 0 && to >= from && to <= entries.length) {
          for (let i = from - 1; i < to; i++) indices.push(i);
        }
      }
      if (!indices.length && !isNaN(num) && num > 0 && num <= entries.length) {
        indices.push(num - 1);
      }
      if (!indices.length) {
        const q = query.toLowerCase();
        indices = entries.reduce((acc, e, i) => (e.toLowerCase().includes(q) ? acc.concat(i) : acc), []);
      }
      if (!indices.length) {
        return { content: [{ type: "text", text: "Not found." }] };
      }

      const removable = indices.filter((i) => force || !isKeepFact(entries[i]));
      const protectedCount = indices.length - removable.length;
      if (removable.length) {
        for (const i of removable.sort((a, b) => b - a)) entries.splice(i, 1);
        await writeMemory(key, entries);
      }
      let text = removable.length ? "Memory updated" : "Nothing removed.";
      if (protectedCount) text += ` (${protectedCount} protected fact(s) skipped; use force=true to override)`;
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "update_fact",
    {
      description:
        "Update the text of an existing fact by number (from recall), id, or text match, " +
        "preserving its original date and metadata. Linked Knowledge Base documents are re-pointed to the new text.",
      inputSchema: z.object({
        id: z.string().describe("Number (from recall), metadata id, or text of the fact to update"),
        newText: z.string().describe("New fact text"),
        title: optStr().describe("Optional new title for the fact"),
        scope: defStr("project").describe("'project' (default) or 'global'"),
      }),
    },
    async ({ id, newText, title, scope }) => {
      const key = requireProjectKey(await scopeKey(scope, null, null));
      const entries = await readMemory(key);
      const idx = resolveFactIndex(entries, id);
      if (idx === -1) throw new Error(`Fact not found: ${id}`);
      const p = parseFactEntry(entries[idx]);
      const oldText = p ? p.text : entries[idx];
      const oldBody = factBody(entries[idx]) || oldText;

      const explicitTitle = title ? title.trim() : null;
      let finalTitle = explicitTitle;
      let finalFact = newText.trim();

      const titleMatch = /^\*\*([^*]+)\*\*\s*(?:—|--|-|:)?\s*(.*)$/.exec(finalFact);
      if (titleMatch) {
        if (!finalTitle) {
          finalTitle = titleMatch[1].trim();
        }
        finalFact = titleMatch[2].trim();
      }

      if (!finalTitle) {
        finalTitle = factTitle(entries[idx]) || autoGenerateTitle(finalFact);
      }

      const newTextFormatted = `**${finalTitle}** — ${finalFact}`;
      const newLine = formatFactEntry({ date: p.date, time: p.time, text: newTextFormatted, meta: p.meta });
      entries[idx] = newLine;
      await writeMemory(key, entries);

      let linksUpdated = 0;
      try {
        const { getDatabase } = await import("../db/database.js");
        const db = await getDatabase();
        const res = await db
          .prepare("UPDATE knowledge_links SET fact_text = ? WHERE fact_key = ? AND fact_text = ?")
          .run(finalFact, key, oldBody);
        linksUpdated = res.changes;
      } catch (e) {}

      return {
        content: [{ type: "text", text: `Fact updated${linksUpdated ? `, ${linksUpdated} doc link(s) updated` : ""}` }],
      };
    }
  );

  server.registerTool(
    "memory_info",
    {
      description:
        "Show memory storage paths (store file locations, MEMORY_DIR, SQLite DB), fact counts, " +
        "Knowledge Base stats, and the installed package version.",
      inputSchema: z.object({}),
    },
    async () => {
      const dbPath = join(MEMORY_DIR, "storage", "memory.sqlite");
      const globalFile = storeFilePath(GLOBAL_KEY);
      const projectFile = storeFilePath(await projectKey(null, null));

      let version = "unknown";
      try {
        version = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf-8")).version;
      } catch (e) {}

      let rag = {};
      try {
        const { getDatabase } = await import("../db/database.js");
        const db = await getDatabase();
        const docCountRow = await db.prepare("SELECT COUNT(*) AS c FROM documents").get();
        rag.documents = docCountRow ? docCountRow.c : 0;
        const secCountRow = await db.prepare("SELECT COUNT(*) AS c FROM sections").get();
        rag.sections = secCountRow ? secCountRow.c : 0;
        const chunkCountRow = await db.prepare("SELECT COUNT(*) AS c FROM micro_chunks").get();
        rag.chunks = chunkCountRow ? chunkCountRow.c : 0;
        const edgeCountRow = await db.prepare("SELECT COUNT(*) AS c FROM graph_edges").get();
        rag.edges = edgeCountRow ? edgeCountRow.c : 0;
        const linkCountRow = await db.prepare("SELECT COUNT(*) AS c FROM knowledge_links").get();
        rag.links = linkCountRow ? linkCountRow.c : 0;
      } catch (e) {
        rag.error = e.message;
      }

      const stores = await listProjectStores();

      let identityLines = [];
      try {
        const { getDatabase } = await import("../db/database.js");
        const { resolveProjectIdentity, listIdentities } = await import("../identity.js");
        const db = await getDatabase();
        const identity = await resolveProjectIdentity(process.cwd());
        const all = await listIdentities(db);
        identityLines.push(
          `Identity: ${identity ? "git" : "no-git"}` +
            (identity
              ? ` | key: ${identity.key} | name: ${identity.name}${identity.primaryRemote ? ` | remote: ${identity.primaryRemote}` : ""}`
              : ""),
          `Known identities: ${all.length}`
        );
      } catch (e) {
        identityLines.push(`Identity: unavailable (${e.message})`);
      }

      const lines = [
        `Version: ${version}`,
        `MEMORY_DIR: ${MEMORY_DIR}`,
        `SQLite DB: ${dbPath}`,
        `Global store: ${globalFile}`,
        `Project store: ${projectFile}`,
        `Project stores: ${stores.length}`,
        `Facts (global): ${(await readMemoryRaw(GLOBAL_KEY)).length}`,
        `Facts (project): ${(await readMemoryRaw(await projectKey(null, null))).length}`,
        ...identityLines,
      ];
      if (rag.error) lines.push(`RAG: unavailable (${rag.error})`);
      else
        lines.push(
          `RAG: ${rag.documents} doc(s), ${rag.sections} section(s), ${rag.chunks} chunk(s), ${rag.edges} edge(s), ${rag.links} memory link(s)`
        );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
