export async function seedDirectiveTransferFixture() {
  const memory = await import('../../mcp-server/memory.js');
  const { getDatabase } = await import('../../mcp-server/db/database.js');
  const { upsertIdentity } = await import('../../mcp-server/identity.js');
  const { ingestDocument } = await import('../../mcp-server/ingest/pipeline.js');
  const { migrateKnowledge, manageKnowledgeLinks } = await import('../../mcp-server/services/knowledge_links_service.js');
  const a = 'git:example.test/transfer/a', b = 'git:example.test/transfer/b';
  const db = await getDatabase();
  for (const [key, name] of [[a, 'Проект A'], [b, 'Проект B']]) await upsertIdentity(db, { key, name, primaryRemote: key.slice(4) });
  const line = (title, body, meta) => `- [2099-01-01 10:00] **${title}** — ${body} <!-- ${meta} -->`;
  await memory.writeMemory('global', [line('Общее правило', 'Global stays unchanged', 'id:global, kind:directive')]);
  await memory.writeMemory(a, [
    line('Переносимая инструкция', 'Сохранять источники <img src=x onerror=alert(1)>', 'id:same, kind:directive, keep:1, ttl:90d'),
    line('Совпадение текста', 'Повторяющийся текст', 'id:dupe, kind:directive'),
    line('История', 'Старая инструкция', 'id:old, kind:directive, supersededBy:new'),
    line('Замещение', 'Новая инструкция', 'id:new, kind:directive, supersedes:old'),
    line('Конкурирующая', 'Изменяемая из другого клиента инструкция', 'id:concurrent, kind:directive'),
    line('Выключенная', 'Сохранить выключенное состояние', 'id:disabled, kind:directive, disabled:1'),
  ]);
  await memory.writeMemory(b, [line('Исходный факт B', 'Оставить запись B', 'id:same, kind:fact'), line('Дубликат B', 'Повторяющийся текст', 'id:dupe-b, kind:directive')]);
  const doc = await ingestDocument({ content: '# Основание\n\nСохранённый источник инструкции.', title: 'Основание инструкции', path: 'transfer-ui-evidence', projectScope: a, generateEmbeddings: false });
  await migrateKnowledge();
  const request = { scopeKey: a, operation: 'create', fields: { factRef: 'id:same', docId: doc.docId, startLine: 3, endLine: 3, relationType: 'SUPPORTS' } };
  const preview = await manageKnowledgeLinks({ ...request, action: 'preview' });
  await manageKnowledgeLinks({ ...request, action: 'apply', previewToken: preview.previewToken });
  return { a, b, docId: doc.docId };
}
