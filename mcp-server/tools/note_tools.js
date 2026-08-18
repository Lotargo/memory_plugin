import * as z from "zod/v4";
import { optStr, defBool } from "./helpers.js";
import { rememberNote } from "./core/note_core.js";

const NOTE_KINDS = ["decision", "research", "context", "handoff", "note"];

export function registerNoteTools(server) {
  server.registerTool(
    "remember_note",
    {
      description:
        "Save high-value long-form or episodic context as a cold RAG Memory Note. " +
        "Use this for decisions with rationale, research/experiment results, investigations, handoffs, and detailed context that may matter later but should NOT be injected into every session. " +
        "Use remember() instead for concise durable facts that should stay hot/automatically available. " +
        "Use ingest_document() instead for external reusable truth sources such as files, URLs, documentation, reports, or codebases. " +
        "The note is indexed in the existing RAG knowledge base and can later be found semantically and expanded by document ID.",
      inputSchema: z.object({
        title: z.string().trim().min(1).describe("Concise descriptive title for the memory note"),
        content: z.string().refine((value) => value.trim().length > 0, "RAG Memory Note content must not be empty").describe("Full long-form note content to preserve"),
        scope: z.enum(["project", "global"]).nullish().transform((v) => v || "project").describe("Visibility: current Git project (default) or global"),
        kind: z.enum(NOTE_KINDS).catch("note").nullish().transform((v) => v || "note").describe("Note kind: decision, research, context, handoff, or note"),
        tags: optStr().describe("Optional comma-separated tags; normalized to lowercase unique values"),
        directory: optStr().describe("Optional workspace/project directory path to target"),
        project: optStr().describe("Alias for directory"),
        generateEmbeddings: defBool(true).describe("Compute dense vector embeddings; set false for offline/tests"),
      }),
    },
    async (args) => {
      const result = await rememberNote(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
