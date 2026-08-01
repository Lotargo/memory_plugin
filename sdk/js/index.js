/**
 * @lotargo/memory_plugin — Programmatic SDK
 *
 * Embeds the Memory & Hybrid RAG Knowledge Engine into custom clients
 * (LangChain agents, bots, scripts) WITHOUT reverse-engineering the plugin
 * or spinning up the MCP server. All operations return structured objects,
 * not formatted text.
 *
 * Data directory resolution (same rules as the core):
 *   1. process.env.MEMORY_DIR
 *   2. process.env.OPENCODE_CONFIG_DIR/memory
 *   3. legacy ~/.config/opencode/memory
 *   4. platform default
 *
 * NOTE: the memory directory is captured at first import. To force a custom
 * directory, call `configure({ memoryDir })` (or set process.env.MEMORY_DIR)
 * BEFORE the first memory operation in the process.
 */

const CORE = "../../mcp-server";

export function configure({ memoryDir = null, opencodeConfigDir = null } = {}) {
  if (memoryDir) process.env.MEMORY_DIR = memoryDir;
  if (opencodeConfigDir) process.env.OPENCODE_CONFIG_DIR = opencodeConfigDir;
  return { memoryDir: memoryDir || process.env.MEMORY_DIR || null };
}

async function core() {
  return import(`${CORE}/memory.js`);
}

export class MemoryEngine {
  constructor({ memoryDir = null, opencodeConfigDir = null } = {}) {
    configure({ memoryDir, opencodeConfigDir });
    this._memory = null;
    this._db = null;
  }

  async _memoryModule() {
    if (!this._memory) this._memory = await core();
    return this._memory;
  }

  async _dbModule() {
    if (!this._db) this._db = await import(`${CORE}/db/database.js`);
    return this._db;
  }

  async _linker() {
    return import(`${CORE}/graph/knowledge_linker.js`);
  }

  get memoryDir() {
    return process.env.MEMORY_DIR || null;
  }

  /**
   * Close the underlying SQLite connection. Call when finished with the
   * engine (e.g. at the end of a script) so the store directory can be
   * removed/renamed on Windows.
   */
  async close() {
    if (this._db) {
      await this._db.closeDatabase();
      this._db = null;
    }
  }

  // --- Key-Value Memory ---

  async remember({
    fact,
    scope = "project",
    docId = null,
    startLine = null,
    endLine = null,
    relationType = "LINKS_TO",
    projectPath = null,
  }) {
    if (!fact || typeof fact !== "string") {
      throw new Error("remember: 'fact' (string) is required");
    }
    const m = await this._memoryModule();
    const key = scope === "global" ? m.GLOBAL_KEY : (projectPath ? m.canonicalPath(projectPath) : m.projectKey(null, null));

    const entries = await m.readMemory(key);
    const factNormalized = fact.toLowerCase().trim();
    let added = false;
    if (!entries.some((e) => {
      const idx = e.indexOf("] ");
      return idx !== -1 && e.slice(idx + 2).toLowerCase().trim() === factNormalized;
    })) {
      entries.push(`- [${m.today()}] ${fact}`);
      await m.writeMemory(key, entries);
      added = true;
    }

    let link = null;
    let linkError = null;
    if (docId) {
      try {
        const { linkFactToDocument } = await this._linker();
        link = linkFactToDocument({ factKey: key, factText: fact, docId, startLine, endLine, relationType });
      } catch (err) {
        linkError = err.message;
      }
    }

    return {
      status: added ? "added" : "exists",
      added,
      fact,
      scope: scope === "global" ? "global" : "project",
      store: key,
      link,
      linkError,
    };
  }

  async recall({ scope = "all", project = null } = {}) {
    const m = await this._memoryModule();
    const result = { scope, global: [], project: null, stores: null };

    if (scope === "list_projects") {
      result.stores = await m.listProjectStores();
      return result;
    }

    const target = project ? m.canonicalPath(project) : m.projectKey(null, null);
    result.project = { key: target, label: project ? target : m.projectName(), facts: [] };

    if (scope !== "project") {
      const globalRaw = await m.readMemoryRaw(m.GLOBAL_KEY);
      result.global = await this._withLinks(m.GLOBAL_KEY, globalRaw);
    }
    if (scope !== "global") {
      const localRaw = await m.readMemoryRaw(target);
      result.project.facts = await this._withLinks(target, localRaw);
    }

    return result;
  }

  async _withLinks(key, facts) {
    let getLinksForFact = null;
    try {
      const { getLinksForFact: fn } = await this._linker();
      getLinksForFact = fn;
    } catch {}
    return facts.map((factText, i) => {
      let links = [];
      if (getLinksForFact) {
        try {
          links = getLinksForFact(key, factText) || [];
        } catch {}
      }
      return { index: i + 1, text: factText, links };
    });
  }

  async forget({ query, scope = "project", projectPath = null } = {}) {
    if (!query) throw new Error("forget: 'query' (number or text) is required");
    const m = await this._memoryModule();
    const key = scope === "global" ? m.GLOBAL_KEY : (projectPath ? m.canonicalPath(projectPath) : m.projectKey(null, null));

    const entries = await m.readMemory(key);
    const num = parseInt(query, 10);
    let removed = [];
    if (!isNaN(num) && num > 0 && num <= entries.length) {
      removed = entries.splice(num - 1, 1);
    } else {
      const kept = entries.filter((e) => !e.toLowerCase().includes(query.toLowerCase()));
      removed = entries.filter((e) => e.toLowerCase().includes(query.toLowerCase()));
      entries.length = 0;
      entries.push(...kept);
    }
    await m.writeMemory(key, entries);

    return {
      status: removed.length ? "removed" : "not_found",
      removed: removed.map((r) => {
        const idx = r.indexOf("] ");
        return idx !== -1 ? r.slice(idx + 2) : r;
      }),
      count: removed.length,
    };
  }

  async listStores() {
    const m = await this._memoryModule();
    return m.listProjectStores();
  }

  async migrateLegacyStore(legacyKey, targetDir) {
    const m = await this._memoryModule();
    return m.migrateLegacyStore(legacyKey, targetDir);
  }

  // --- Knowledge Graph Linking ---

  async linkKnowledge({
    action = "link",
    factText = null,
    docId = null,
    scope = "project",
    startLine = null,
    endLine = null,
    relationType = "LINKS_TO",
    projectPath = null,
  } = {}) {
    const m = await this._memoryModule();
    const linker = await this._linker();
    const key = scope === "global" ? m.GLOBAL_KEY : (projectPath ? m.canonicalPath(projectPath) : m.projectKey(null, null));

    if (action === "link") {
      if (!factText || !docId) throw new Error("linkKnowledge: factText and docId are required for action 'link'");
      return { action, result: linker.linkFactToDocument({ factKey: key, factText, docId, startLine, endLine, relationType }) };
    }
    if (action === "get_doc_links") {
      if (!docId) throw new Error("linkKnowledge: docId is required for action 'get_doc_links'");
      return { action, result: linker.getLinksForDoc(docId) };
    }
    if (action === "list_links") {
      return { action, result: linker.listAllLinks(key) };
    }
    throw new Error(`linkKnowledge: unknown action '${action}'`);
  }

  // --- Hybrid RAG Knowledge Engine ---

  async ingestDocument({
    content,
    type = "text",
    title = null,
    path = null,
    generateEmbeddings = true,
  } = {}) {
    if (!content) throw new Error("ingestDocument: 'content' (text, file path, or URL) is required");
    const { ingestDocument: fn } = await import(`${CORE}/ingest/pipeline.js`);
    const result = await fn({ content, type, title, path, generateEmbeddings });
    return {
      status: "success",
      docId: result.docId,
      title: result.title,
      path: result.path,
      sectionsCount: result.sectionsCount,
      microChunksCount: result.microChunksCount,
      deduplicated: result.deduplicated,
    };
  }

  async queryKnowledgeBase({
    query,
    limit = 5,
    instruction = null,
    generateEmbeddings = true,
    includeGraphContext = true,
    fusionAlgorithm = null,
    alpha = null,
    scoreThreshold = 0.01,
  } = {}) {
    if (!query) throw new Error("queryKnowledgeBase: 'query' is required");
    const { hybridQuery } = await import(`${CORE}/retrieval/retriever.js`);
    const { getConfig } = await import(`${CORE}/config/config_manager.js`);
    const activeConfig = getConfig();
    const results = await hybridQuery({
      query,
      limit,
      instruction,
      generateEmbeddings,
      includeGraphContext,
      fusionAlgorithm,
      alpha,
      scoreThreshold,
    });
    const algo = generateEmbeddings === false
      ? "lexical_only"
      : (fusionAlgorithm || activeConfig.fusionAlgorithm || "rsf");
    return {
      query,
      activeModel: activeConfig.embeddingModel,
      fusionAlgorithm: algo.toUpperCase(),
      results,
    };
  }

  async kbStats() {
    const db = (await this._dbModule()).getDatabase();
    const cnt = (sql) => db.prepare(sql).get().cnt;
    return {
      documents: cnt("SELECT COUNT(*) as cnt FROM documents"),
      sections: cnt("SELECT COUNT(*) as cnt FROM sections"),
      medium_chunks: cnt("SELECT COUNT(*) as cnt FROM medium_chunks"),
      micro_chunks: cnt("SELECT COUNT(*) as cnt FROM micro_chunks"),
      graph_edges: cnt("SELECT COUNT(*) as cnt FROM graph_edges"),
    };
  }

  async kbList() {
    const db = (await this._dbModule()).getDatabase();
    return db.prepare("SELECT id, title, path, blob_hash, created_at FROM documents ORDER BY created_at DESC").all();
  }

  async kbReadDocument(docId) {
    if (!docId) throw new Error("kbReadDocument: 'docId' is required");
    const db = (await this._dbModule()).getDatabase();
    const doc = db.prepare("SELECT id, title, path, blob_hash, created_at FROM documents WHERE id = ? OR path = ? OR title = ?").get(docId, docId, docId);
    if (!doc) throw new Error(`Document not found in knowledge base for docId: ${docId}`);
    const { readBlob } = await import(`${CORE}/storage/blob_store.js`);
    const content = await readBlob(doc.blob_hash);
    return { id: doc.id, title: doc.title, path: doc.path, created_at: doc.created_at, content };
  }

  async kbDelete(docId) {
    if (!docId) throw new Error("kbDelete: 'docId' is required");
    const { deleteDocument } = await import(`${CORE}/ingest/pipeline.js`);
    return deleteDocument(docId);
  }

  async kbExportSnapshot(outputPath = null) {
    const { exportSnapshot } = await import(`${CORE}/admin/snapshot.js`);
    const result = await exportSnapshot({ outputPath });
    return { outputPath: result.outputPath };
  }

  async kbImportSnapshot(snapshotPath) {
    if (!snapshotPath) throw new Error("kbImportSnapshot: 'snapshotPath' is required");
    const { importSnapshot } = await import(`${CORE}/admin/snapshot.js`);
    return importSnapshot({ snapshotPathOrData: snapshotPath });
  }

  async kbHardReset() {
    const { hardResetDatabase } = await import(`${CORE}/admin/snapshot.js`);
    return hardResetDatabase();
  }

  // --- Config ---

  async getConfig() {
    const { getConfig } = await import(`${CORE}/config/config_manager.js`);
    return getConfig();
  }

  async updateConfig(partial) {
    const { updateConfig } = await import(`${CORE}/config/config_manager.js`);
    return updateConfig(partial);
  }

  async resetConfig() {
    const { resetConfig } = await import(`${CORE}/config/config_manager.js`);
    return resetConfig();
  }
}

export async function createEngine(options = {}) {
  return new MemoryEngine(options);
}

export default MemoryEngine;
