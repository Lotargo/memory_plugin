import * as z from "zod/v4";
import { GLOBAL_KEY, scopeKey, readMemory } from "../memory.js";
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

  server.registerTool('manage_project_memory', {
    description: 'Inspect Git identities and preview/apply scoped project link, unlink, relink or legacy migration with backup and conflict checks.',
    inputSchema: z.object({ action: z.enum(['list','inspect','preview','apply']), operation: optStr(), directory: optStr(), sourceKey: optStr(), targetKey: optStr(), remote: optStr(), previewToken: optStr(), confirm: defBool(false) }),
  }, async input => {
    const { projectRequest } = await import('../services/project_service.js');
    return { content: [{ type: 'text', text: JSON.stringify(await projectRequest(input), null, 2) }] };
  });
  for (const operation of ['link','unlink','relink']) {
    server.registerTool(`${operation}_project_memory`, {
      description: `${operation} project memory through shared Git identity administration; moves create a verified local backup and reject ambiguous records.`,
      inputSchema: z.object({ directory: optStr(), remote: optStr(), ...(operation === 'unlink' ? { purge: defBool(false) } : {}) }),
    }, async input => {
      const { executeProjectOperation } = await import('../services/project_service.js');
      return { content: [{ type:'text', text:JSON.stringify(await executeProjectOperation(operation, input), null, 2) }] };
    });
  }
}
