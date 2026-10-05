import { inspectKnowledge } from "../../services/knowledge_service.js";

export const KNOWLEDGE_INSPECT_DESCRIPTION = "Inspect saved local knowledge: targets/list/read/hierarchy/chunk/links/graph are offline and never run models. search offers explicit lexical or local-cached dense retrieval with index/snippet results; search-status only reads model availability. Requires explicit scopeKey and exact entity IDs; includeGlobal adds global sources. Both graph endpoints and retrieval parents are scope checked. Unknown legacy provenance remains UNKNOWN. This is retrieval preview, not proof of injection or agent use. No vectors are exported and no document data is mutated.";

export const KNOWLEDGE_INSPECT_FIELDS = {
  action: { type: "string", enum: ["targets", "list", "read", "hierarchy", "chunk", "links", "graph", "search", "search-status"], description: "Read operation" },
  scopeKey: { type: "string", description: "Existing global, registered Git, or persisted RAG scope key; no directory required" },
  includeGlobal: { type: "boolean", description: "Include global sources with selected project (default false)" },
  docId: { type: "string", description: "Exact saved document ID" },
  searchMode:{type:"string",enum:["lexical","dense"],description:"Explicit trial search mode; dense requires local cached model and never downloads"},
  resultMode:{type:"string",enum:["index","snippet"]},
  policyExpansion:{type:"boolean",description:"Expand table/code policy sources for snippets; no expansion in index mode"},
  nodeType: {type:"string",enum:["all","document","section","medium","micro","fact","symbol","lines"]},
  relationType: {type:"string",description:"Exact saved graph relation filter"},
  query: { type: "string", description: "Metadata query max 500; trial search query max 1000 characters" },
  sourceType: { type: "string", enum: ["all", "note", "source"] },
  offset: { type: "number", description: "Page offset" }, limit: { type: "number", description: "Page size, 1-100" },
  rawOffset: { type: "number", description: "Raw text UTF-16 character offset" },
  startLine: { type: "number", description: "Start raw text at saved normalized line, one-based" },
  textLimit: { type: "number", description: "Raw page size, 1-20000 UTF-16 characters" },
  level: { type: "string", enum: ["section", "medium", "micro"] },
  parentId: { type: "string", description: "Section parent for medium or medium parent for micro" },
  chunkId: { type: "string", description: "Exact chunk/section ID" },
  textOffset: { type: "number", description: "Chunk text offset in Unicode code points" },
};
export async function inspectKnowledgeTool(input) {
  try { return { content: [{ type: "text", text: JSON.stringify(await inspectKnowledge(input), null, 2) }] }; }
  catch (error) {
    const known = ["INVALID", "NOT_FOUND", "CONFLICT", "UNSUPPORTED", "BUSY", "MIGRATION_REQUIRED"].includes(error.code);
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ code: known ? error.code : "STORAGE_UNAVAILABLE", error: known ? error.message : "Local knowledge storage is unavailable." }) }] };
  }
}
