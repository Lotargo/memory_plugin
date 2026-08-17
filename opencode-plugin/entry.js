import BaseMemoryPlugin, {
  formatInjectedFacts,
  buildMemoryContext,
} from "./index.js";
import { undoMemory } from "../mcp-server/tools/core/memory_core.js";

export { formatInjectedFacts, buildMemoryContext };

async function notify(client, message, variant = "success") {
  if (!client?.tui?.showToast) return;
  const payload = { message, variant, duration: 3000 };
  try {
    await client.tui.showToast({ body: payload });
  } catch {
    try {
      await client.tui.showToast(payload);
    } catch {}
  }
}

function extendRecallTool(tool) {
  if (!tool) return;
  tool.description =
    "Show saved facts with any Agent-linked Knowledge Base documents/lines. " +
    "scope: 'project', 'global', 'all' (default), or 'list_projects'. " +
    "Use recent=N for the N newest facts or last=true for the newest single fact. " +
    "order can be 'storage' (default), 'newest', or 'oldest'. groupBy='tag' groups the current page by the primary (first) tag. " +
    "query/tags/since/until filters and pagination remain available.";
  tool.args = {
    ...tool.args,
    order: {
      type: "string",
      description: "Result order: storage (default), newest, or oldest",
      default: "storage",
    },
    recent: {
      type: "number",
      description: "Return only the N newest matching facts",
    },
    last: {
      type: "boolean",
      description: "Return only the newest matching fact",
      default: false,
    },
    groupBy: {
      type: "string",
      description: "Group the current result page by primary tag: none (default) or tag",
      default: "none",
    },
  };
}

function extendForgetTool(tool) {
  if (!tool) return;
  tool.description =
    "Delete facts by query or by a stable batch of refs. query accepts a recall number, metadata short ID, range such as '3-30', or text. " +
    "refs accepts an array of recall numbers/IDs resolved against one pre-delete snapshot, so numbering cannot shift mid-operation. " +
    "Range upper bounds beyond the current notebook are clamped safely. Protected keep facts are skipped unless force=true. " +
    "Successful deletion can be reverted with undo.";
  tool.args = {
    ...tool.args,
    query: {
      type: "string",
      description: "Optional recall number, metadata ID, range like '3-30', or text search",
      default: "",
    },
    refs: {
      type: "array",
      items: { type: "string" },
      description: "Optional stable batch of recall numbers or metadata IDs to delete together",
      default: [],
    },
  };
}

export const MemoryPlugin = async (context) => {
  const plugin = await BaseMemoryPlugin(context);
  if (!plugin?.tool) return plugin;

  extendRecallTool(plugin.tool.recall);
  extendForgetTool(plugin.tool.forget);

  if (plugin.tool.remember) {
    plugin.tool.remember.description += " The latest successful mutation can be reverted with undo.";
  }
  if (plugin.tool.update_fact) {
    plugin.tool.update_fact.description += " The latest successful update can be reverted with undo.";
  }
  if (plugin.tool.memory_info) {
    plugin.tool.memory_info.description =
      "Show memory storage paths, fact counts, Knowledge Base stats, undo-journal count, and installed version.";
  }

  plugin.tool.undo = {
    description:
      "Revert the latest journaled remember, forget, or update_fact operation in the selected memory scope. " +
      "Undo refuses to overwrite memory if the notebook or linked RAG state changed after that operation.",
    args: {
      scope: {
        type: "string",
        description: "project (default) or global",
        default: "project",
      },
      directory: {
        type: "string",
        description: "Optional workspace/project directory path",
      },
      project: {
        type: "string",
        description: "Alias for directory",
      },
    },
    async execute(args, ctx = {}) {
      const result = await undoMemory(args, {
        worktree: ctx.worktree ?? context.worktree,
        directory: ctx.directory ?? context.directory,
      });
      if (result.startsWith("Undone")) await notify(context.client, result);
      return result;
    },
  };

  return plugin;
};

export default MemoryPlugin;
