/**
 * LangChain tool adapter for @lotargo/memory_plugin SDK.
 *
 * Returns real `DynamicStructuredTool` instances (from @langchain/core/tools)
 * ready for `bindTools` / LangGraph `ToolNode`. `@langchain/core` is an
 * optional peer dependency — imported lazily so the core SDK stays
 * dependency-free. If it is not installed, a clear error is thrown.
 *
 * Usage:
 *   import { MemoryEngine } from "@lotargo/memory_plugin/sdk";
 *   import { createLangChainTools } from "@lotargo/memory_plugin/sdk/langchain";
 *
 *   const engine = new MemoryEngine();
 *   const tools = createLangChainTools(engine);            // all tools (object)
 *   const list = Object.values(tools);                     // array for bindTools
 *   const agent = createReactAgent({ llm, tools: list });
 *
 * Tool names are prefixed: memory_remember, memory_recall, memory_forget,
 * memory_list_stores, memory_ingest_document, memory_query_knowledge_base,
 * memory_kb_stats, memory_kb_list.
 */

export async function createLangChainTools(engine, options = {}) {
  if (!engine) {
    throw new Error("createLangChainTools: a MemoryEngine instance is required");
  }

  let DynamicStructuredTool;
  try {
    ({ DynamicStructuredTool } = await import("@langchain/core/tools"));
  } catch (err) {
    throw new Error(
      "createLangChainTools requires the optional peer dependency '@langchain/core'. " +
        "Install it in your project (npm i @langchain/core) and retry."
    );
  }

  let z;
  try {
    z = (await import("zod")).z || (await import("zod")).default;
  } catch (err) {
    throw new Error("createLangChainTools requires the dependency 'zod'.");
  }
  if (!z) z = { object: (schema) => schema };

  const prefix = options.prefix || "memory";
  const build = (name, description, zodSchema, invoke) =>
    new DynamicStructuredTool({
      name: `${prefix}_${name}`,
      description,
      schema: zodSchema,
      strict: true,
      async func(args) {
        const res = await invoke(args);
        return typeof res === "string" ? res : JSON.stringify(res, null, 2);
      },
    });

  const tools = {};

  tools.remember = build(
    "remember",
    "Save an important, durable fact to memory. Only use for high-signal information " +
      "(user preferences, goals, constraints, tech choices, project conventions). " +
      "Optionally link to a knowledge base document (docId, startLine, endLine). " +
      "Translate the fact into English and keep it concise. scope: 'project' (default) or 'global'.",
    z.object({
      fact: z.string().describe("The fact to remember, written in English"),
      scope: z.string().optional().describe("'project' (default) or 'global'"),
      docId: z.string().optional().describe("Optional document ID, title, or path to link this fact to"),
      startLine: z.number().optional().describe("Optional starting line number in target document"),
      endLine: z.number().optional().describe("Optional ending line number in target document"),
      relationType: z.string().optional().describe("Relation type (e.g. 'RULES_FOR', 'IMPLEMENTS', 'REFERENCES')"),
    }),
    (args) => engine.remember({ ...args, scope: args.scope || "project" })
  );

  tools.recall = build(
    "recall",
    "Show saved memory facts. scope: 'project', 'global', 'all' (default), or 'list_projects'. " +
      "Pass project: '<directory path>' to read facts of a specific project from any working directory.",
    z.object({
      scope: z.string().optional().describe("'project', 'global', 'all', or 'list_projects'"),
      project: z.string().optional().describe("Directory path of the project to read facts from"),
    }),
    (args) => engine.recall({ ...args, scope: args.scope || "all" })
  );

  tools.forget = build(
    "forget",
    "Delete a fact by number (from recall) or text search.",
    z.object({
      query: z.string().describe("Number or text to search for"),
      scope: z.string().optional().describe("'project' (default) or 'global'"),
    }),
    (args) => engine.forget({ ...args, scope: args.scope || "project" })
  );

  tools.listStores = build(
    "list_stores",
    "List all project memory stores with their bound paths and fact counts.",
    z.object({}),
    () => engine.listStores()
  );

  tools.ingestDocument = build(
    "ingest_document",
    "Ingest a document (raw text, file path, or web URL) into the RAG knowledge base. " +
      "Processes through 3-tier hierarchy chunking, dense vectors, and GraphRAG code symbols.",
    z.object({
      content: z.string().describe("Raw text content, file path, or web URL"),
      type: z.string().optional().describe("Input content type: 'text', 'file', 'url'"),
      title: z.string().optional().describe("Document title"),
      path: z.string().optional().describe("Original document file path"),
      generateEmbeddings: z.boolean().optional().describe("Compute dense vector embeddings"),
    }),
    (args) => engine.ingestDocument({ ...args, type: args.type || "text", generateEmbeddings: args.generateEmbeddings !== false })
  );

  tools.queryKnowledgeBase = build(
    "query_knowledge_base",
    "Perform hybrid search (BM25 full-text + dense vectors) across the RAG knowledge base. " +
      "Returns top-ranked document sections with breadcrumbs, defined symbols, and scores.",
    z.object({
      query: z.string().describe("Search query in natural language or symbol name"),
      limit: z.number().optional().describe("Maximum number of sections to return"),
      instruction: z.string().optional().describe("Optional retrieval instruction shaping embedding focus"),
      generateEmbeddings: z.boolean().optional().describe("Use vector search alongside BM25"),
    }),
    (args) => engine.queryKnowledgeBase({ ...args, limit: args.limit || 5, generateEmbeddings: args.generateEmbeddings !== false })
  );

  tools.kbStats = build(
    "kb_stats",
    "Return knowledge base statistics (documents, sections, chunks, graph edges counts).",
    z.object({}),
    () => engine.kbStats()
  );

  tools.kbList = build(
    "kb_list",
    "List all documents in the RAG knowledge base.",
    z.object({}),
    () => engine.kbList()
  );

  if (options.only && Array.isArray(options.only)) {
    const filtered = {};
    for (const key of options.only) {
      if (tools[key]) filtered[key] = tools[key];
    }
    return filtered;
  }

  return tools;
}

export default createLangChainTools;
