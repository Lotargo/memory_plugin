// Call only after setting isolated MEMORY_DIR / OPENCODE_CONFIG_DIR.
export async function createKnowledgeFixture({ richContent = false } = {}) {
  const { ingestDocument } = await import('../../mcp-server/ingest/pipeline.js');
  const { getDatabase } = await import('../../mcp-server/db/database.js');
  const { writeMemory } = await import('../../mcp-server/memory.js');
  const db = await getDatabase();
  const a = 'git:example.test/knowledge/a', b = 'git:example.test/knowledge/b', ragOnly = 'git:example.test/knowledge/no-checkout';
  for (const key of [a, b]) await db.prepare('INSERT INTO project_identities (key, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(key, key.endsWith('/a') ? 'Проект A' : 'Проект B', Date.now(), Date.now());
  const fact = '- [2026-10-03 10:00] **Linked fact** — Same private fact text <!-- id:same, kind:fact -->';
  await writeMemory(a, [fact]); await writeMemory(b, [fact]);
  await writeMemory('global', ['- [2026-10-03 10:00] **Global fact** — public fact <!-- id:global, kind:fact -->']);
  const add = (path, title, content, projectScope, metadataOverrides = null) => ingestDocument({ path, title, content, projectScope, metadataOverrides, generateEmbeddings: false });
  const global = await add('global.md', 'Глобальный источник', '# Global\n\nPublic saved text.', 'global');
  const shared = await add('shared.md', 'Общий источник A/B', '# Shared\n\nSaved source text.\n\n## Detail\n\nPrivate links remain isolated.', a);
  await add('shared.md', 'Общий источник A/B', '# Shared\n\nSaved source text.\n\n## Detail\n\nPrivate links remain isolated.', b);
  const privateB = await add('private-b.md', 'Секрет B', '# Private B\n\nNever show this to A.', b);
  const note = await add('memory://note/fixture-note', 'Решение проекта A', '# Decision\n\nUse explicit scope keys. <img src=x onerror=alert(1)>', a, { source_type: 'note', note_kind: 'decision', tags: ['Design', 'Scope'] });
  const remote = await add('unavailable-original.md', 'Проект без каталога', '# Offline\n\nSaved normalized text stays readable.', ragOnly);
  for (const [id, key, body] of [['link-a', a, 'Same private fact text'], ['link-b', b, 'Same private fact text'], ['link-ambiguous', a, 'ambiguous']]) {
    await db.prepare('INSERT INTO knowledge_links (id, fact_key, fact_text, doc_id, start_line, end_line, relation_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, key, body, shared.docId, 3, 3, 'SUPPORTS', Date.now());
  }
  const { readMemory } = await import('../../mcp-server/memory.js');
  const entries = await readMemory(a);
  entries.push('- [2026-10-03 10:00] ambiguous', '- [2026-10-03 10:00] ambiguous');
  await writeMemory(a, entries);
  if (richContent) {
    await add('rendering.md', 'Markdown, KaTeX и Mermaid', [
      '# Проверка оформления', '', '**Жирный** и *курсив*, [безопасная ссылка](https://example.test/), `код $x$`.', '',
      '| Столбец | Значение |', '| --- | --- |', '| Формула | $E=mc^2$ |', '',
      '$$', '\\int_0^1 x^2\\,dx=\\frac{1}{3}', '$$', '',
      '\\(a^2+b^2=c^2\\)', '', '\\[\\sqrt{4}=2\\]', '',
      '```mermaid', 'flowchart LR', '  A[Notebook] --> B[Источник]', '  B --> C[Чанк]', '```', '',
      '```mermaid', 'not valid diagram', '```', '',
      '<img src="https://example.test/never-load" onerror="alert(1)">',
      '[опасная ссылка](javascript:alert(1))', '![внешнее изображение](https://example.test/never-load)', '',
      '$\\href{javascript:alert(1)}{bad}$', '',
      '```mermaid', '%%{init: {"securityLevel": "loose"}}%%', 'graph TD', 'A --> B', '```',
    ].join('\n'), a);
    entries.push('- [2026-10-03 10:00] **Форматированный факт** — **важно**: $E=mc^2$, `literal $x$`. <!-- id:rich, kind:fact -->');
    await writeMemory(a, entries);
  }
  return { a, b, ragOnly, global: global.docId, shared: shared.docId, privateB: privateB.docId, note: note.docId, remote: remote.docId, db };
}
