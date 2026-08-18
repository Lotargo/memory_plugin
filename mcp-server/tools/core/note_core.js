import { resolveRagScopeKey } from "../../rag_scope.js";

/**
 * Shared RAG Memory Note implementation used by MCP and native OpenCode surfaces.
 *
 * The host agent decides what deserves cold/episodic memory. This helper only
 * resolves visibility and routes the note through the existing RAG ingestion
 * pipeline so both tool surfaces keep identical storage semantics.
 */
export async function rememberNote(
  {
    title,
    content,
    scope = "project",
    kind = "note",
    tags = null,
    directory = null,
    project = null,
    generateEmbeddings = true,
  },
  ctx = {}
) {
  const effectiveDirectory = directory || project || ctx.directory || null;
  const projectScope = await resolveRagScopeKey(scope || "project", {
    worktree: ctx.worktree ?? null,
    directory: effectiveDirectory,
  });

  const { ingestNote } = await import("../../ingest/pipeline.js");
  const result = await ingestNote({
    title,
    content,
    kind,
    tags,
    generateEmbeddings: generateEmbeddings !== false,
    projectScope,
  });

  return {
    status: "success",
    docId: result.docId,
    path: result.path,
    title: result.title,
    sourceType: result.sourceType,
    kind: result.kind,
    tags: result.tags,
    sectionsCount: result.sectionsCount,
    microChunksCount: result.microChunksCount,
    deduplicated: result.deduplicated,
    scope: result.projectScope,
  };
}
