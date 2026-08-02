const ignoredKeywords = new Set([
  "const", "let", "var", "function", "class", "import", "export", "from", "return", "if", "for", "while", "switch", "case", "default",
  "def", "self", "lambda", "pass", "yield", "async", "await", "with", "except", "try", "catch", "finally",
  "func", "type", "struct", "interface", "chan", "map", "go", "defer", "package", "range",
  "fn", "enum", "trait", "impl", "pub", "mut", "ref", "self", "Self", "match", "use", "mod", "crate",
  "namespace", "template", "typename", "public", "private", "protected", "virtual", "override", "using", "inline", "static", "constexpr", "extern", "explicit", "friend", "operator", "throw",
  "record", "synchronized", "final", "void", "throws", "new", "this", "super", "fun", "val", "null", "true", "false",
  "internal", "readonly", "base", "get", "set", "echo", "exit", "die", "require", "include",
  "module", "end", "extend", "attr_accessor", "attr_reader", "attr_writer", "nil", "puts", "raise"
]);

export function extractSymbolsFromContent(content) {
  if (!content) return [];
  const symbols = new Set();

  const patterns = [
    // JS/TS
    /(?:function|class|interface|type|enum|const|let|var)\s+([a-zA-Z0-9_$]+)/g,
    // Python / PHP / Ruby
    /(?:def|class|function|module|trait)\s+([a-zA-Z0-9_!?=]+)/g,
    // Go / Rust / C++ / Java / Kotlin / C# / PHP (Types)
    /\b(?:class|struct|interface|record|enum|trait|type|namespace)\s+([a-zA-Z0-9_]+)/g,
    // Go (Functions)
    /\bfunc\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)\s*\(/g,
    // Rust (Functions)
    /\bfn\s+([a-zA-Z0-9_]+)/g,
    // Kotlin (Functions)
    /\bfun\s+([a-zA-Z0-9_]+)/g,
    // Java / C# / C++ (Methods/Functions)
    /\b(?:public|protected|private|static|synchronized|final|async|virtual|override|readonly)*\s*[\w<>\[\]]+\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(?:const|override|noexcept|throws\s+[\w,\s]+|\s)*\s*[{;]/g
  ];

  for (const pattern of patterns) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(content)) !== null) {
      const symbol = match[1];
      if (symbol && symbol.length > 2 && !ignoredKeywords.has(symbol)) {
        symbols.add(symbol);
      }
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

export async function saveGraphEdges(db, edges) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO graph_edges (source_id, target_id, relation_type)
    VALUES (?, ?, ?);
  `);
  for (const edge of edges) {
    await stmt.run(edge.source_id, edge.target_id, edge.relation_type);
  }
}

export async function getRelatedSymbols(db, sectionId) {
  const stmt = db.prepare(`
    SELECT target_id, relation_type FROM graph_edges
    WHERE source_id = ? AND relation_type = 'DEFINES_SYMBOL';
  `);
  const rows = await stmt.all(sectionId);
  return rows.map((r) => r.target_id.replace("symbol:", ""));
}
