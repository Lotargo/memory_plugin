import * as z from "zod/v4";
import { optStr, optNum, defStr, defBool } from "./helpers.js";
import {
  rememberFact,
  recallFacts,
  getFactById,
  forgetFacts,
  updateFactText,
  memoryInfo,
} from "./core/memory_core.js";

export function registerMemoryTools(server) {
  server.registerTool(
    "remember",
    {
      description:
        "Save an important, durable fact to memory. Only use for high-signal information " +
        "(name, goals, constraints, tech preferences, project conventions). " +
        "Set kind='directive' only for active user-approved personality, behavior, tone, style, preference, or working instructions; use kind='fact' for descriptive context. " +
        "directory: optional workspace/project directory path to target (ensures saving into the project store even from external cwd). " +
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
        kind: z.enum(["fact", "directive"]).nullish().transform((v) => v || "fact").describe("'fact' (context) or 'directive' (active personalization/working instruction)"),
        scope: defStr("project").describe("'project' (default) or 'global'"),
        directory: optStr().describe("Optional workspace/project directory path to target when scope='project' (e.g. 'F:/projects/my-app')"),
        project: optStr().describe("Alias for directory"),
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
    async (args) => ({ content: [{ type: "text", text: await rememberFact(args) }] })
  );

  server.registerTool(
    "recall",
    {
      description:
        "Show saved facts with any Agent-linked Knowledge Base documents/lines. " +
        "scope: 'project', 'global', 'all' (default), or 'list_projects'. " +
        "Use directory: '<directory path>' with scope 'project'/'all' to read facts of a specific project from any working directory. " +
        "query filters by keyword (all space-separated terms must match). " +
        "tags filters by comma-separated tags. since/until filter by date (YYYY-MM-DD, inclusive). " +
        "Superseded facts are excluded by default; pass includeSuperseded=true to inspect history. " +
        "Expired facts are shown with [EXPIRED], protected ones with [KEEP]. The response includes the store file paths.",
      inputSchema: z.object({
        scope: defStr("all").describe("'project', 'global', 'all', or 'list_projects'"),
        directory: optStr().describe("Directory path of the project to read facts from (e.g. 'F:/projects/plugins/memory')"),
        project: optStr().describe("Alias for directory"),
        query: optStr().describe("Optional keyword filter; all space-separated terms must match"),
        tags: optStr().describe("Optional comma-separated tag filter (any match)"),
        since: optStr().describe("Optional start date filter, YYYY-MM-DD (inclusive)"),
        until: optStr().describe("Optional end date filter, YYYY-MM-DD (inclusive)"),
        mode: z.enum(["headers", "full"]).nullish().transform((v) => v || "full").describe("Result mode: 'full' (with body, default) or 'headers' (title and badges only)"),
        offset: optNum().describe("Pagination offset (optional)"),
        limit: optNum().describe("Pagination limit (optional)"),
        includeSuperseded: defBool(false).describe("Include superseded historical facts (excluded by default)"),
      }),
    },
    async (args) => ({ content: [{ type: "text", text: await recallFacts(args) }] })
  );

  server.registerTool(
    "get_fact",
    {
      description: "Get the full text and metadata of a single fact by its metadata id.",
      inputSchema: z.object({
        id: z.string().describe("The unique metadata id of the fact (e.g. '8f3a2c')"),
        scope: defStr("all").describe("'project', 'global', or 'all' (default)"),
        directory: optStr().describe("Optional workspace/project directory path"),
        project: optStr().describe("Alias for directory"),
      }),
    },
    async (args) => ({ content: [{ type: "text", text: await getFactById(args) }] })
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
        directory: optStr().describe("Optional workspace/project directory path"),
        project: optStr().describe("Alias for directory"),
        force: defBool(false).describe("Also delete protected (keep) facts"),
      }),
    },
    async (args) => ({ content: [{ type: "text", text: await forgetFacts(args) }] })
  );

  server.registerTool(
    "update_fact",
    {
      description:
        "Update the text of an existing fact by number (from recall), id, or text match, " +
        "preserving its original date and metadata. kind can optionally reclassify it as context ('fact') or active personalization ('directive'). Linked Knowledge Base documents are re-pointed to the new text.",
      inputSchema: z.object({
        id: z.string().describe("Number (from recall), metadata id, or text of the fact to update"),
        newText: z.string().describe("New fact text"),
        title: optStr().describe("Optional new title for the fact"),
        kind: z.enum(["fact", "directive"]).nullish().describe("Optional new semantic kind: 'fact' or 'directive'"),
        scope: defStr("project").describe("'project' (default) or 'global'"),
        directory: optStr().describe("Optional workspace/project directory path"),
        project: optStr().describe("Alias for directory"),
      }),
    },
    async (args) => ({ content: [{ type: "text", text: await updateFactText(args) }] })
  );

  server.registerTool(
    "memory_info",
    {
      description:
        "Show memory storage paths (store file locations, MEMORY_DIR, SQLite DB), fact counts, " +
        "Knowledge Base stats, and the installed package version.",
      inputSchema: z.object({
        directory: optStr().describe("Optional workspace/project directory path to inspect (default: current directory)"),
        project: optStr().describe("Alias for directory"),
      }),
    },
    async (args) => ({ content: [{ type: "text", text: await memoryInfo(args) }] })
  );
}
