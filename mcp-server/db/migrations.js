const MIGRATIONS = [
  {
    version: 1,
    name: "001_initial_rag_schema",
    up: async (db) => {
      // 1. Documents Table
      await db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            blob_hash TEXT NOT NULL,
            title TEXT,
            checksum TEXT NOT NULL,
            toc_json TEXT,
            metadata_json TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
      `);

      // 2. Sections Table
      await db.exec(`
        CREATE TABLE IF NOT EXISTS sections (
            id TEXT PRIMARY KEY,
            doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            heading TEXT,
            breadcrumbs TEXT,
            content TEXT NOT NULL,
            token_count INTEGER NOT NULL
        );
      `);

      // 3. Micro-Chunks Table
      await db.exec(`
        CREATE TABLE IF NOT EXISTS micro_chunks (
            id TEXT PRIMARY KEY,
            section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
            doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            vector BLOB NOT NULL,
            token_count INTEGER NOT NULL
        );
      `);

      // 4. Full-Text Search (BM25 Index via SQLite FTS5)
      await db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS micro_chunks_fts USING fts5(
            id UNINDEXED,
            content,
            breadcrumbs
        );
      `);

      // 5. GraphRAG Lite Edges Table
      await db.exec(`
        CREATE TABLE IF NOT EXISTS graph_edges (
            source_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            relation_type TEXT NOT NULL,
            PRIMARY KEY (source_id, target_id, relation_type)
        );
      `);
    },
  },
  {
    version: 2,
    name: "002_agent_knowledge_graph",
    up: async (db) => {
      try {
        await db.exec(`ALTER TABLE graph_edges ADD COLUMN metadata_json TEXT;`);
      } catch (e) {}
      try {
        await db.exec(`ALTER TABLE graph_edges ADD COLUMN created_at INTEGER;`);
      } catch (e) {}

      await db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_links (
            id TEXT PRIMARY KEY,
            fact_key TEXT NOT NULL,
            fact_text TEXT NOT NULL,
            doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            section_id TEXT,
            start_line INTEGER,
            end_line INTEGER,
            relation_type TEXT DEFAULT 'LINKS_TO',
            metadata_json TEXT,
            created_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 3,
    name: "003_medium_chunks_hierarchy",
    up: async (db) => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS medium_chunks (
            id TEXT PRIMARY KEY,
            section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
            doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            block_type TEXT NOT NULL,
            token_count INTEGER NOT NULL,
            created_at INTEGER
        );
      `);

      try {
        await db.exec(`ALTER TABLE micro_chunks ADD COLUMN medium_id TEXT REFERENCES medium_chunks(id) ON DELETE CASCADE;`);
      } catch (e) {}
    },
  },
];

export async function runMigrations(db) {
  let currentVersion = 0;
  try {
    const row = await db.prepare("SELECT MAX(version) as v FROM schema_migrations;").get();
    currentVersion = row ? row.v || 0 : 0;
  } catch (e) {
    try {
      const versionRow = await db.prepare("PRAGMA user_version;").get();
      currentVersion = versionRow ? (versionRow.user_version || 0) : 0;
    } catch (e2) {}
  }

  // Ensure schema_migrations table exists for future
  try {
    await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);`);
  } catch (e) {}

  // Create notebooks table if not exists
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS notebooks (
          key TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          updated_at INTEGER NOT NULL
      );
    `);
  } catch (e) {}

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      await db.exec("BEGIN;");
      try {
        await migration.up(db);
        await db.prepare("INSERT INTO schema_migrations (version) VALUES (?);").run(migration.version);
        await db.exec("COMMIT;");
        try {
          await db.exec(`PRAGMA user_version = ${migration.version};`);
        } catch (e) {}
      } catch (err) {
        try {
          await db.exec("ROLLBACK;");
        } catch (e) {}
        throw new Error(`Migration ${migration.name} failed: ${err.message}`);
      }
    }
  }

  // Defensive table & column check for medium_chunks hierarchy
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS medium_chunks (
          id TEXT PRIMARY KEY,
          section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
          doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          block_type TEXT NOT NULL,
          token_count INTEGER NOT NULL,
          created_at INTEGER
      );
    `);
    await db.exec(`ALTER TABLE micro_chunks ADD COLUMN medium_id TEXT REFERENCES medium_chunks(id) ON DELETE CASCADE;`);
  } catch (e) {}
}
