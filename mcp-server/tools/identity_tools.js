import * as z from "zod/v4";
import { basename } from "node:path";
import { GLOBAL_KEY, scopeKey, canonicalPath, readMemory, writeMemory, storeFilePath } from "../memory.js";
import { factBody } from "../fact_format.js";
import { optStr, optNum, defStr, defBool, requireProjectKey } from "./helpers.js";

export function registerIdentityTools(server) {
  server.registerTool(
    "link_knowledge",
    {
      description:
        "Explicitly link a Notebook memory fact to a Knowledge Base document, section, or line range. " +
        "Creates Agent-driven Graph Edges connecting memory to RAG documents.",
      inputSchema: z.object({
        action: z.enum(["link", "list_links", "get_doc_links"]).nullish().transform((v) => v || "link").describe("Action type"),
        factText: optStr().describe("Memory fact text or keyword"),
        docId: optStr().describe("Document ID, title, or file path"),
        scope: defStr("project").describe("'project' (default) or 'global'"),
        directory: optStr().describe("Optional workspace/project directory path"),
        project: optStr().describe("Alias for directory"),
        startLine: optNum().describe("Starting line number in target document"),
        endLine: optNum().describe("Ending line number in target document"),
        relationType: defStr("LINKS_TO").describe("Relation type (e.g. 'RULES_FOR', 'IMPLEMENTS', 'EXPLAINS')"),
      }),
    },
    async ({ action, factText, docId, scope, directory, project, startLine, endLine, relationType }) => {
      const { linkFactToDocument, getLinksForDoc, listAllLinks } = await import("../graph/knowledge_linker.js");
      const key = await scopeKey(scope, null, directory || project || null);

      if (action === "link" || action === "list_links") {
        requireProjectKey(key);
      }

      if (action === "link") {
        if (!factText || !docId) {
          throw new Error("factText and docId are required parameters for link action");
        }
        const facts = await readMemory(key);
        const needle = factText.toLowerCase().trim();
        const matches = facts.filter((entry) => {
          const body = factBody(entry).toLowerCase();
          return body === needle || body.includes(needle) || entry.toLowerCase().includes(needle);
        });
        if (matches.length === 0) throw new Error(`Notebook fact not found for link: ${factText}`);
        if (matches.length > 1) throw new Error(`Notebook fact match is ambiguous; use a more specific factText: ${factText}`);
        const resolvedFactText = factBody(matches[0]);
        const res = await linkFactToDocument({
          factKey: key,
          factText: resolvedFactText,
          docId,
          startLine,
          endLine,
          relationType,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        };
      }

      if (action === "get_doc_links") {
        if (!docId) throw new Error("docId parameter is required for get_doc_links action");
        const allowedScopes = key === GLOBAL_KEY ? [GLOBAL_KEY] : [GLOBAL_KEY, key];
        const links = await getLinksForDoc(docId, allowedScopes);
        return {
          content: [{ type: "text", text: JSON.stringify(links, null, 2) }],
        };
      }

      if (action === "list_links") {
        const links = await listAllLinks(key);
        return {
          content: [{ type: "text", text: JSON.stringify(links, null, 2) }],
        };
      }

      throw new Error(`Unknown action: ${action}`);
    }
  );

  server.registerTool(
    "link_project_memory",
    {
      description: "Link the current directory to a Git-based project identity, register aliases, and optionally migrate legacy/path stores.",
      inputSchema: z.object({
        directory: optStr().describe("Directory path to link (default: current directory)"),
        remote: optStr().describe("Optional explicit remote URL to use as primary identity key"),
      }),
    },
    async ({ directory, remote }) => {
      const { getDatabase } = await import("../db/database.js");
      const { resolveProjectIdentity, upsertIdentity, registerAlias, normalizeRemoteUrl } = await import("../identity.js");
      const db = await getDatabase();

      const dir = directory || process.cwd();
      const identity = await resolveProjectIdentity(dir);
      if (!identity && !remote) {
        throw new Error("No Git repository detected and no remote URL specified.");
      }

      let key = identity ? identity.key : `git:${normalizeRemoteUrl(remote)}`;
      let name = identity ? identity.name : basename(dir) || "unbound";
      let primaryRemote = remote ? normalizeRemoteUrl(remote) : (identity ? identity.primaryRemote : null);

      await upsertIdentity(db, { key, name, primaryRemote });

      const aliases = [];
      if (primaryRemote) {
        aliases.push({ alias: `remote:${primaryRemote}`, kind: "remote" });
      }
      aliases.push({ alias: `path:${canonicalPath(dir)}`, kind: "path" });
      aliases.push({ alias: `basename:${name}`, kind: "basename" });

      for (const a of aliases) {
        await registerAlias(db, { alias: a.alias, identityKey: key, kind: a.kind });
      }

      let migrated = false;
      const legacyPathKey = canonicalPath(dir);
      const legacyEntries = await readMemory(legacyPathKey);
      if (legacyEntries && legacyEntries.length > 0) {
        const gitEntries = await readMemory(key);
        const seen = new Set(gitEntries.map((e) => factBody(e).toLowerCase().trim()));
        let mergedCount = 0;
        for (const entry of legacyEntries) {
          const body = factBody(entry).toLowerCase().trim();
          if (!seen.has(body)) {
            seen.add(body);
            gitEntries.push(entry);
            mergedCount++;
          }
        }
        if (mergedCount > 0) {
          await writeMemory(key, gitEntries);
          migrated = true;
        }
        try {
          const legacyFp = storeFilePath(legacyPathKey);
          const { existsSync } = await import("node:fs");
          if (existsSync(legacyFp)) {
            const { unlink } = await import("node:fs/promises");
            await unlink(legacyFp);
          }
        } catch (e) {}
      }
      const { moveKnowledgeScope } = await import("../graph/knowledge_linker.js");
      const migratedKnowledge = await moveKnowledgeScope(db, legacyPathKey, key);
      if (migratedKnowledge.movedLinks > 0 || migratedKnowledge.movedDocuments > 0) migrated = true;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "success",
                key,
                name,
                primaryRemote,
                aliases: aliases.map((a) => a.alias),
                migrated,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "unlink_project_memory",
    {
      description: "Remove the path alias link for the specified project directory.",
      inputSchema: z.object({
        directory: optStr().describe("Directory path to unlink (default: current directory)"),
        purge: defBool(false).describe("If true, completely purge the project identity from the SQLite store"),
      }),
    },
    async ({ directory, purge }) => {
      const { getDatabase } = await import("../db/database.js");
      const { unregisterAlias, removeIdentity, resolveProjectIdentity } = await import("../identity.js");
      const db = await getDatabase();

      const dir = directory || process.cwd();
      const alias = `path:${canonicalPath(dir)}`;
      await unregisterAlias(db, alias);

      let key = null;
      if (purge) {
        const identity = await resolveProjectIdentity(dir);
        if (identity) {
          key = identity.key;
          await removeIdentity(db, key);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "success",
                alias,
                purgedIdentityKey: key,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "relink_project_memory",
    {
      description: "Move or merge project memories from the current identity to a new target identity.",
      inputSchema: z.object({
        directory: optStr().describe("Directory path to relink (default: current directory)"),
        remote: z.string().describe("New target remote URL / identity key to move memories to"),
      }),
    },
    async ({ directory, remote }) => {
      const { getDatabase } = await import("../db/database.js");
      const { resolveProjectIdentity, upsertIdentity, removeIdentity, normalizeRemoteUrl } = await import("../identity.js");
      const db = await getDatabase();

      const dir = directory || process.cwd();
      const sourceIdentity = await resolveProjectIdentity(dir);
      if (!sourceIdentity) {
        throw new Error("Source project identity not detected.");
      }

      const targetKey = `git:${normalizeRemoteUrl(remote)}`;
      const sourceKey = sourceIdentity.key;

      if (sourceKey === targetKey) {
        return { content: [{ type: "text", text: "Source and target identities are already identical." }] };
      }

      const sourceFacts = await readMemory(sourceKey);
      const targetFacts = await readMemory(targetKey);
      const seen = new Set(targetFacts.map((e) => factBody(e).toLowerCase().trim()));

      let mergedCount = 0;
      for (const f of sourceFacts) {
        const body = factBody(f).toLowerCase().trim();
        if (!seen.has(body)) {
          seen.add(body);
          targetFacts.push(f);
          mergedCount++;
        }
      }

      await writeMemory(targetKey, targetFacts);

      await upsertIdentity(db, { key: targetKey, name: sourceIdentity.name, primaryRemote: normalizeRemoteUrl(remote) });
      await db.prepare("UPDATE project_aliases SET identity_key = ? WHERE identity_key = ?;").run(targetKey, sourceKey);
      const { moveKnowledgeScope } = await import("../graph/knowledge_linker.js");
      const movedKnowledge = await moveKnowledgeScope(db, sourceKey, targetKey);
      await removeIdentity(db, sourceKey);

      try {
        const sourceFp = storeFilePath(sourceKey);
        const { existsSync } = await import("node:fs");
        if (existsSync(sourceFp)) {
          const { unlink } = await import("node:fs/promises");
          await unlink(sourceFp);
        }
      } catch (e) {}

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "success",
                sourceKey,
                targetKey,
                mergedFacts: mergedCount,
                movedKnowledgeLinks: movedKnowledge.movedLinks,
                movedRagDocuments: movedKnowledge.movedDocuments,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
