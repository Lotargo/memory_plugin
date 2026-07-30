export function extractSymbolsFromContent(content) {
  const symbols = new Set();

  const jsTsRegex = /(?:function|class|interface|type|enum|const|let|var)\s+([a-zA-Z0-9_$]+)/g;
  let match;
  while ((match = jsTsRegex.exec(content)) !== null) {
    const symbol = match[1];
    if (symbol.length > 2 && !["const", "let", "var", "function", "class", "import", "export", "from", "return", "if", "for", "while"].includes(symbol)) {
      symbols.add(symbol);
    }
  }

  const pyRegex = /(?:def|class)\s+([a-zA-Z0-9_]+)/g;
  while ((match = pyRegex.exec(content)) !== null) {
    const symbol = match[1];
    if (symbol.length > 2 && !["def", "class", "self", "return", "import", "from"].includes(symbol)) {
      symbols.add(symbol);
    }
  }

  return Array.from(symbols);
}

export function buildGraphEdges(docId, hierarchy) {
  const edges = [];

  for (const sec of hierarchy.sections) {
    edges.push({
      source_id: docId,
      target_id: sec.id,
      relation_type: "CONTAINS",
    });

    const symbols = extractSymbolsFromContent(sec.content);
    for (const sym of symbols) {
      edges.push({
        source_id: sec.id,
        target_id: `symbol:${sym}`,
        relation_type: "DEFINES_SYMBOL",
      });
    }
  }

  for (const micro of hierarchy.microChunks) {
    edges.push({
      source_id: micro.section_id,
      target_id: micro.id,
      relation_type: "CONTAINS",
    });
  }

  return edges;
}

export function saveGraphEdges(db, edges) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO graph_edges (source_id, target_id, relation_type)
    VALUES (?, ?, ?);
  `);
  for (const edge of edges) {
    stmt.run(edge.source_id, edge.target_id, edge.relation_type);
  }
}

export function getRelatedSymbols(db, sectionId) {
  const stmt = db.prepare(`
    SELECT target_id, relation_type FROM graph_edges
    WHERE source_id = ? AND relation_type = 'DEFINES_SYMBOL';
  `);
  const rows = stmt.all(sectionId);
  return rows.map((r) => r.target_id.replace("symbol:", ""));
}
