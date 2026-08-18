import BaseMemoryPlugin from "./index.js";
import { rememberNote } from "../mcp-server/tools/core/note_core.js";
import { runSingleRagQuery, runBatchRagQuery } from "../mcp-server/tools/core/rag_query_core.js";

const REMEMBER_NOTE_DESCRIPTION =
  "Save high-value long-form or episodic context as a cold RAG Memory Note. " +
  "Use this for decisions with rationale, research/experiment results, investigations, handoffs, and detailed context that may matter later but should NOT be injected into every session. " +
  "Use remember instead for concise durable facts that should stay hot/automatically available. " +
  "Use ingest_document instead for external reusable truth sources such as files, URLs, documentation, reports, or codebases. " +
  "The note is indexed in the existing RAG knowledge base and can later be found semantically and expanded by document ID.";

function buildRememberNoteTool() {
  return {
    description: REMEMBER_NOTE_DESCRIPTION,
    args: {
      title: { type: "string", description: "Concise descriptive title for the memory note" },
      content: { type: "string", description: "Full long-form note content to preserve" },
      scope: { type: "string", description: "Visibility: current Git project (default) or global", default: "project" },
      kind: { type: "string", description: "Note kind: decision, research, context, handoff, or note", default: "note" },
      tags: { type: "string", description: "Optional comma-separated tags; normalized to lowercase unique values" },
      directory: { type: "string", description: "Optional workspace/project directory path to target" },
      project: { type: "string", description: "Alias for directory" },
      generateEmbeddings: { type: "boolean", description: "Compute dense vector embeddings; set false for offline/tests", default: true },
    },
    async execute(args, ctx = {}) {
      const result = await rememberNote(args, {
        worktree: ctx.worktree ?? null,
        directory: ctx.directory ?? null,
      });
      return JSON.stringify(result, null, 2);
    },
  };
}

function addRoutingGuidance(plugin) {
  if (!plugin?.tool) return plugin;

  if (plugin.tool.remember?.description && !plugin.tool.remember.description.includes("remember_note")) {
    plugin.tool.remember.description +=
      " Use remember_note instead when the durable information needs a long-form reasoning/research record that should remain cold and retrieval-only.";
  }

  if (plugin.tool.ingest_document?.description && !plugin.tool.ingest_document.description.includes("remember_note")) {
    plugin.tool.ingest_document.description +=
      " Use remember_note for agent-authored long-form internal memory; use remember for concise hot facts.";
  }

  plugin.tool.remember_note = buildRememberNoteTool();

  if (plugin.tool.query_knowledge_base) {
    plugin.tool.query_knowledge_base.description =
      "Perform project-isolated hybrid search (RSF/RRF BM25 full-text + dense vector similarity). " +
      "Returns ranked candidates with stable parent document IDs, source metadata, breadcrumbs, GraphRAG symbols, and relevance scores.";
    plugin.tool.query_knowledge_base.execute = async (args, ctx = {}) =>
      runSingleRagQuery(args, {
        worktree: ctx.worktree ?? null,
        directory: ctx.directory ?? null,
      });
  }

  if (plugin.tool.batch_query_knowledge_base) {
    plugin.tool.batch_query_knowledge_base.description =
      "Execute multiple project-isolated hybrid searches in one call. " +
      "All query embeddings are computed in one ONNX pass and each result exposes stable parent document IDs and source metadata.";
    plugin.tool.batch_query_knowledge_base.execute = async (args, ctx = {}) =>
      runBatchRagQuery(args, {
        worktree: ctx.worktree ?? null,
        directory: ctx.directory ?? null,
      });
  }

  return plugin;
}

export const MemoryPlugin = async (ctx) => addRoutingGuidance(await BaseMemoryPlugin(ctx));

export default MemoryPlugin;
