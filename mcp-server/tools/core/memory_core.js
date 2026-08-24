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
} from "../../memory.js";
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
  isDirectiveFact,
} from "../../fact_format.js";
import { requireProjectKey, resolveFactIndex } from "../helpers.js";

// Single implementation of the Notebook tools, shared by the MCP server
// (mcp-server/tools/memory_tools.js) and the OpenCode plugin
// (opencode-plugin/index.js). Both used to carry their own copy, so bug fixes
// in one never reached the other. Every function returns a plain string; the
// callers wrap it in whatever envelope their host expects.
//
// `ctx` carries the host's notion of the current location:
//   { worktree, directory } — the MCP server passes nothing and falls back to cwd.

const TITLE_PATTERN = /^\*\*([^*]+)\*\*\s*(?:—|--|-|:)?\s*(.*)$/;

function splitTitle(rawText, explicitTitle) {
  let finalTitle = explicitTitle ? explicitTitle.trim() : null;
  let finalFact = String(rawText || "").trim();
  const match = TITLE_PATTERN.exec(finalFact);
  if (match) {
    if (!finalTitle) finalTitle = match[1].trim();
    finalFact = match[2].trim();
  }
  return { finalTitle, finalFact };
}

function extractEffectiveDir(args = {}, ctx = {}) {
  return (
    args?.directory ||
    args?.project ||
    ctx?.directory ||
    ctx?.worktree ||
    null
  );
}

async function resolveScopeKey(scope, args = {}, ctx = {}) {
  const dir = extractEffectiveDir(args, ctx);
  return await scopeKey(scope || "project", ctx?.worktree ?? null, dir);
}

export async function rememberFact(
  { fact, title, kind = "fact", scope, directory, project, docId, startLine, endLine, relationType, ttl, keep, tags, supersedes },
  ctx = {}
) {
  if (!['fact', 'directive'].includes(kind)) throw new Error("kind must be 'fact' or 'directive'.");
  const key = requireProjectKey(await resolveScopeKey(scope, { directory, project }, ctx));
  const entries = await readMemory(key);

  let { finalTitle, finalFact } = splitTitle(fact, title);
  if (!finalTitle) finalTitle = autoGenerateTitle(finalFact);

  const text = `**${finalTitle}** — ${finalFact}`;
  const factBodyNormalized = finalFact.toLowerCase();
  const duplicate = entries.some((e) => factBody(e).toLowerCase().trim() === factBodyNormalized);

  let supersededInfo = "";
  if (!duplicate) {
    const [date, time] = today().split(" ");
    const meta = { ttl, tags, kind };
    if (keep) meta.keep = "1";
    if (supersedes) {
      const targetIdx = resolveFactIndex(entries, supersedes);
      if (targetIdx !== -1) {
        let targetId = factMeta(entries[targetIdx]).id;
        if (!targetId) {
          targetId = nextFactId(entries);
          entries[targetIdx] = withMeta(entries[targetIdx], { id: targetId });
        }
        const newId = nextFactId(entries);
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
    if (key === GLOBAL_KEY && kind === "directive") await syncGlobalPersonaPrompts();
  }

  let linkInfo = "";
  if (docId) {
    try {
      const { linkFactToDocument } = await import("../../graph/knowledge_linker.js");
      const linkRes = await linkFactToDocument({
        factKey: key,
        factText: finalFact,
        docId,
        startLine,
        endLine,
        relationType: relationType || "LINKS_TO",
      });
      const linesStr = startLine ? `:L${startLine}${endLine ? `-${endLine}` : ""}` : "";
      linkInfo = ` [Linked to Doc: "${linkRes.docTitle}"${linesStr}]`;
    } catch (err) {
      linkInfo = ` (Note: Fact saved, but document link failed: ${err.message})`;
    }
  }

  return `Memory updated${supersededInfo}${linkInfo}`;
}

async function resolveTargetKey(projectPath) {
  if (!projectPath) return null;
  if (typeof projectPath === "string" && (projectPath.startsWith("git:") || projectPath.startsWith("git_") || projectPath === GLOBAL_KEY)) {
    return projectPath;
  }
  try {
    const { resolveProjectIdentity } = await import("../../identity.js");
    const identity = await resolveProjectIdentity(projectPath);
    if (identity) return identity.key;
  } catch {}
  return canonicalPath(projectPath);
}

export async function recallFacts(
  { scope, directory, project, query, tags, since, until, mode, offset, limit, includeSuperseded = false },
  ctx = {}
) {
  const results = [];
  const now = Date.now();
  const targetMode = mode || "full";
  const targetOffset = offset !== undefined && offset !== null ? offset : 0;
  const targetProjectInput = directory || project || ctx.directory || ctx.worktree || null;

  if (scope === "list_projects") {
    const stores = await listProjectStores();
    if (!stores.length) return "No project memory stores found.";
    const lines = stores.map(
      (s, i) =>
        `${i + 1}. ${s.basename} — ${s.count} fact(s) [${s.file}]${
          s.path ? ` (bound to ${s.path})` : " (unbound legacy store)"
        }`
    );
    return `Project Memory Stores:\n${lines.join(
      "\n"
    )}\n\nUse recall(scope: "project", directory: "<path>") to read a specific store.\n\nMemory dir: ${MEMORY_DIR}`;
  }

  let getLinksForFact = null;
  try {
    ({ getLinksForFact } = await import("../../graph/knowledge_linker.js"));
  } catch {}

  const target =
    (await resolveTargetKey(targetProjectInput)) ?? (await projectKey(ctx.worktree ?? null, targetProjectInput));
  const label = targetProjectInput ? target : await projectName(ctx.worktree ?? null, targetProjectInput);

  const formatFactWithLinks = async (factLine, index, key) => {
    const p = parseFactEntry(factLine);
    if (!p) return factLine;

    const meta = p.meta;
    const badges = [];
    if (isExpiredLine(factLine, now)) badges.push("EXPIRED");
    if (isKeepFact(factLine)) badges.push("KEEP");
    if (isSuperseded(factLine)) badges.push("SUPERSEDED");
    if (meta.inject === "1") badges.push("INJECT");
    if (isDirectiveFact(factLine)) badges.push("DIRECTIVE");
    if (meta.id) badges.push(`id:${meta.id}`);
    if (meta.tags) badges.push(`tags:${meta.tags}`);
    badges.push(`${p.date} ${p.time}`);
    const badgesStr = badges.length ? ` [${badges.join("] [")}]` : "";

    let lineText =
      targetMode === "headers" ? `**${factTitle(factLine)}**${badgesStr}` : `${p.text}${badgesStr}`;

    if (getLinksForFact) {
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
      } catch {}
    }
    return `${index}. ${lineText}`;
  };

  const collect = async (entries, key) => {
    const matched = entries
      .map((entry, storageIndex) => ({ entry, storageIndex }))
      .filter(
        ({ entry }) =>
          (includeSuperseded || !isSuperseded(entry)) &&
          matchesQuery(entry, query) &&
          matchesTags(entry, tags) &&
          inDateRange(entry, since, until)
      );
    if (!matched.length) return;
    if (results.length) results.push("");
    results.push(`--- ${key === GLOBAL_KEY ? "Global" : `Project: ${key === target ? label : key}`} ---`);

    const hasLimit = limit !== undefined && limit !== null;
    const targetLimit = hasLimit ? limit : matched.length;
    const paginated = matched.slice(targetOffset, targetOffset + targetLimit);
    for (let i = 0; i < paginated.length; i++) {
      results.push(
        await formatFactWithLinks(paginated[i].entry, paginated[i].storageIndex + 1, key)
      );
    }
    if (hasLimit && matched.length > targetLimit) {
      results.push(
        `Showing entries ${targetOffset + 1}-${Math.min(targetOffset + targetLimit, matched.length)} of ${matched.length}`
      );
    }
    results.push(`Store file: ${storeFilePath(key)}`);
  };

  if (scope !== "project") await collect(await readMemory(GLOBAL_KEY), GLOBAL_KEY);
  if (scope !== "global" && target) await collect(await readMemory(target), target);

  const filtered = Boolean(query || tags || since || until);
  if (!results.length) return filtered ? "No facts match the search." : "Memory is empty.";
  return `${results.join("\n")}\n\nMemory dir: ${MEMORY_DIR}`;
}

export async function getFactById({ id, scope, directory, project }, ctx = {}) {
  const targetId = String(id || "").trim();
  if (!targetId) throw new Error("ID parameter is required.");

  const targetDir = extractEffectiveDir({ directory, project }, ctx);
  const results = [];
  const check = async (key) => {
    const entries = await readMemory(key);
    const match = entries.find((e) => factMeta(e).id === targetId);
    if (match) {
      results.push({ key, title: factTitle(match), body: factBody(match), meta: factMeta(match), line: match });
    }
  };

  if (scope !== "project") await check(GLOBAL_KEY);
  if (scope !== "global") {
    const projKey = await projectKey(ctx.worktree ?? null, targetDir);
    if (projKey) await check(projKey);
  }

  if (!results.length) return `Fact with ID "${targetId}" not found.`;

  return results
    .map((r) => {
      const metaStr = Object.entries(r.meta)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      return `[Store: ${r.key === GLOBAL_KEY ? "Global" : "Project"}]\nTitle: ${r.title}\nBody: ${r.body}\nMetadata: ${
        metaStr ? `<!-- ${metaStr} -->` : "none"
      }`;
    })
    .join("\n\n");
}

export async function forgetFacts({ query, scope, force, directory, project }, ctx = {}) {
  const key = requireProjectKey(await resolveScopeKey(scope, { directory, project }, ctx));
  const entries = await readMemory(key);

  const rangeMatch = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(query);
  let indices = [];
  if (rangeMatch) {
    const from = parseInt(rangeMatch[1], 10);
    const to = parseInt(rangeMatch[2], 10);
    if (from > 0 && to >= from && to <= entries.length) {
      for (let i = from - 1; i < to; i++) indices.push(i);
    }
  }
  if (!indices.length && /^\s*\d+\s*$/.test(String(query))) {
    const num = parseInt(query, 10);
    if (num > 0 && num <= entries.length) indices.push(num - 1);
  }
  if (!indices.length) {
    const q = String(query).toLowerCase();
    indices = entries.reduce((acc, e, i) => (e.toLowerCase().includes(q) ? acc.concat(i) : acc), []);
  }
  if (!indices.length) return "Not found.";

  const removable = indices.filter((i) => force || !isKeepFact(entries[i]));
  const removedGlobalDirective = key === GLOBAL_KEY && removable.some((i) => isDirectiveFact(entries[i]));
  const protectedCount = indices.length - removable.length;
  if (removable.length) {
    const removedBodies = removable.map((i) => factBody(entries[i]) || factText(entries[i]));
    for (const i of removable.sort((a, b) => b - a)) entries.splice(i, 1);
    await writeMemory(key, entries);
    if (removedGlobalDirective) await syncGlobalPersonaPrompts();
    try {
      const { getDatabase } = await import("../../db/database.js");
      const { deleteLinksForFacts } = await import("../../graph/knowledge_linker.js");
      await deleteLinksForFacts(await getDatabase(), key, removedBodies);
    } catch {}
  }
  let text = removable.length ? "Memory updated" : "Nothing removed.";
  if (protectedCount) text += ` (${protectedCount} protected fact(s) skipped; use force=true to override)`;
  return text;
}

export async function updateFactText({ id, newText, title, kind, scope, directory, project }, ctx = {}) {
  if (kind && !['fact', 'directive'].includes(kind)) throw new Error("kind must be 'fact' or 'directive'.");
  const key = requireProjectKey(await resolveScopeKey(scope, { directory, project }, ctx));
  const entries = await readMemory(key);
  const idx = resolveFactIndex(entries, id);
  if (idx === -1) throw new Error(`Fact not found: ${id}`);

  const p = parseFactEntry(entries[idx]);
  const oldText = p ? p.text : entries[idx];
  const oldBody = factBody(entries[idx]) || oldText;
  const wasDirective = isDirectiveFact(entries[idx]);

  let { finalTitle, finalFact } = splitTitle(newText, title);
  if (!finalTitle) finalTitle = factTitle(entries[idx]) || autoGenerateTitle(finalFact);

  entries[idx] = formatFactEntry({
    date: p.date,
    time: p.time,
    text: `**${finalTitle}** — ${finalFact}`,
    meta: kind ? { ...p.meta, kind } : p.meta,
  });
  await writeMemory(key, entries);
  if (key === GLOBAL_KEY && (wasDirective || isDirectiveFact(entries[idx]))) await syncGlobalPersonaPrompts();

  let linksUpdated = 0;
  try {
    const { getDatabase } = await import("../../db/database.js");
    const db = await getDatabase();
    const linkedRows = await db
      .prepare("SELECT * FROM knowledge_links WHERE fact_key = ? AND fact_text = ?")
      .all(key, oldBody);
    const res = await db
      .prepare("UPDATE knowledge_links SET fact_text = ? WHERE fact_key = ? AND fact_text = ?")
      .run(finalFact, key, oldBody);
    linksUpdated = res.changes;
    if (linksUpdated) {
      const { queueDocumentSyncIfNeeded } = await import("../../graph/knowledge_linker.js");
      const docIds = new Set();
      for (const link of linkedRows) {
        const targetSpec = link.start_line
          ? `${link.doc_id}:L${link.start_line}-${link.end_line || link.start_line}`
          : link.doc_id;
        await db.prepare(
          "DELETE FROM graph_edges WHERE source_id = ? AND target_id = ? AND relation_type = ?"
        ).run(
          `fact:${key}:${oldBody.substring(0, 30)}`,
          targetSpec,
          link.relation_type || "LINKS_TO"
        );
        await db.prepare(`
          INSERT OR IGNORE INTO graph_edges (source_id, target_id, relation_type, metadata_json, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          `fact:${key}:${finalFact.substring(0, 30)}`,
          targetSpec,
          link.relation_type || "LINKS_TO",
          link.metadata_json || JSON.stringify({ linkId: link.id }),
          link.created_at || Date.now()
        );
        docIds.add(link.doc_id);
      }
      for (const docId of docIds) await queueDocumentSyncIfNeeded(db, docId);
    }
  } catch {}

  return `Fact updated${linksUpdated ? `, ${linksUpdated} doc link(s) updated` : ""}`;
}

async function syncGlobalPersonaPrompts() {
  if (process.env.MEMORY_DISABLE_PERSONA_SYNC === "1") return;
  try {
    const { syncPersonaPrompts } = await import("../../prompt_manager.js");
    await syncPersonaPrompts();
  } catch {
    // Memory persistence must not fail because an optional client config is
    // unavailable or read-only. Explicit sync-persona surfaces such failures.
  }
}

export async function memoryInfo(_args = {}, ctx = {}) {
  const effectiveDir = extractEffectiveDir(_args, ctx) || process.cwd();
  const dbPath = join(MEMORY_DIR, "storage", "memory.sqlite");
  const activeKey = await projectKey(ctx.worktree ?? null, effectiveDir);
  const globalFile = storeFilePath(GLOBAL_KEY);
  const projectFile = activeKey ? storeFilePath(activeKey) : null;

  let version = "unknown";
  try {
    version = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf-8")).version;
  } catch {}

  const rag = {};
  try {
    const { getDatabase } = await import("../../db/database.js");
    const db = await getDatabase();
    const count = async (table) => {
      const row = await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
      return row ? row.c : 0;
    };
    rag.documents = await count("documents");
    rag.sections = await count("sections");
    rag.chunks = await count("micro_chunks");
    rag.edges = await count("graph_edges");
    rag.links = await count("knowledge_links");
  } catch (e) {
    rag.error = e.message;
  }

  const stores = await listProjectStores();

  const identityLines = [];
  try {
    const { getDatabase } = await import("../../db/database.js");
    const { resolveProjectIdentity, listIdentities } = await import("../../identity.js");
    const db = await getDatabase();
    const identity = await resolveProjectIdentity(effectiveDir);
    const all = await listIdentities(db);
    const registered = identity ? all.find((item) => item.key === identity.key) : null;
    identityLines.push(
      `Identity: ${identity ? "git" : "no-git"}` +
        (identity
          ? ` | key: ${identity.key} | name: ${identity.name}${
              identity.primaryRemote ? ` | remote: ${identity.primaryRemote}` : ""
            }`
          : ""),
      `Registry: ${identity ? (registered ? "linked" : "unlinked") : "not-applicable"}` +
        (registered ? ` | aliases: ${registered.aliases.length}` : ""),
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
    `Project store: ${projectFile || "not applicable (outside Git)"}`,
    `Project stores: ${stores.length}`,
    `Facts (global): ${(await readMemoryRaw(GLOBAL_KEY)).length}`,
    `Facts (project): ${(activeKey ? await readMemoryRaw(activeKey) : []).length}`,
    ...identityLines,
  ];
  if (rag.error) lines.push(`RAG: unavailable (${rag.error})`);
  else
    lines.push(
      `RAG: ${rag.documents} doc(s), ${rag.sections} section(s), ${rag.chunks} chunk(s), ${rag.edges} edge(s), ${rag.links} memory link(s)`
    );
  return lines.join("\n");
}
