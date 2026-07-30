const MIGRATIONS = [
  {
    version: 1,
    name: "001_initial_rag_schema",
    up: (db) => {
      // 1. Documents Table
      db.exec(`
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
      db.exec(`
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
      db.exec(`
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
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS micro_chunks_fts USING fts5(
            id UNINDEXED,
            content,
            breadcrumbs
        );
      `);

      // 5. GraphRAG Lite Edges Table
      db.exec(`
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
    up: (db) => {
      try {
        db.exec(`ALTER TABLE graph_edges ADD COLUMN metadata_json TEXT;`);
      } catch (e) {}
      try {
        db.exec(`ALTER TABLE graph_edges ADD COLUMN created_at INTEGER;`);
      } catch (e) {}

      db.exec(`
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
    up: (db) => {
      db.exec(`
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
        db.exec(`ALTER TABLE micro_chunks ADD COLUMN medium_id TEXT REFERENCES medium_chunks(id) ON DELETE CASCADE;`);
      } catch (e) {}
    },
  },
];

export function runMigrations(db) {
  const versionRow = db.prepare("PRAGMA user_version;").get();
  const currentVersion = versionRow ? versionRow.user_version : 0;

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      db.exec("BEGIN IMMEDIATE;");
      try {
        migration.up(db);
        db.exec("COMMIT;");
        db.exec(`PRAGMA user_version = ${migration.version};`);
      } catch (err) {
        db.exec("ROLLBACK;");
        throw new Error(`Migration ${migration.name} failed: ${err.message}`);
      }
    }
  }

  // Defensive table & column check for medium_chunks hierarchy
  db.exec(`
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
    db.exec(`ALTER TABLE micro_chunks ADD COLUMN medium_id TEXT REFERENCES medium_chunks(id) ON DELETE CASCADE;`);
  } catch (e) {}
}
