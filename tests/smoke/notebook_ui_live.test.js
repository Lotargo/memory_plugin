// Disposable browser fixture. --serve keeps it alive for UI acceptance.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'memory-notebook-ui-'));
process.env.MEMORY_DIR = join(root, 'memory');
process.env.OPENCODE_CONFIG_DIR = join(root, 'opencode');
process.env.MEMORY_DISABLE_PERSONA_SYNC = '1';
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = '1';
process.env.MEMORY_DISABLE_WEB_AUTOSTART = '1';
const memory = await import('../../mcp-server/memory.js');
const { getDatabase, closeDatabase } = await import('../../mcp-server/db/database.js');
const { upsertIdentity } = await import('../../mcp-server/identity.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
const { ingestDocument } = await import('../../mcp-server/ingest/pipeline.js');
const { migrateKnowledge, manageKnowledgeLinks } = await import('../../mcp-server/services/knowledge_links_service.js');
let app;
try {
  const a = 'git:example.test/notebook/a', b = 'git:example.test/notebook/b';
  const db = await getDatabase();
  for (const [key, name] of [[a, 'Проект A'], [b, 'Проект B']]) await upsertIdentity(db, { key, name, primaryRemote: key.slice(4) });
  await memory.writeMemory('global', ['- [2026-10-01 10:00] **Глобальный факт** — Общее правило проверки <!-- id:same, kind:fact, tags:ui -->']);
  await memory.writeMemory(a, [
    '- [2026-10-02 10:00] **Исходное правило A** — Хранить исходные данные <!-- id:same, kind:directive, tags:ui, keep:1 -->',
    '- [2026-01-01 10:00] **Истёкший факт** — Старая запись <!-- id:expired, kind:fact, ttl:1d -->',
    '- [2026-10-01 10:00] **Выключенное правило** — Пока не действует <!-- id:disabled, kind:directive, disabled:1, tags:build -->',
  ]);
  await memory.writeMemory(b, ['- [2026-10-03 10:00] **Факт B** — Данные другого проекта <!-- id:same, kind:fact, tags:build -->']);
  const doc = await ingestDocument({ path: 'evidence.md', content: '# Источник\n\nИсходные данные проекта A.', title: 'Источник A', projectScope: a, generateEmbeddings: false });
  await migrateKnowledge();
  const input = { operation: 'create', scopeKey: a, fields: { factRef: 'id:same', docId: doc.docId, relationType: 'SUPPORTS' } };
  const preview = await manageKnowledgeLinks({ ...input, action: 'preview' });
  await manageKnowledgeLinks({ ...input, action: 'apply', previewToken: preview.previewToken });
  app = await startDashboard();
  console.log(JSON.stringify({ url: app.url, root, a, b }));
  if (process.argv.includes('--serve')) await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  else console.log('PASS isolated Notebook browser fixture');
} finally {
  if (app) await app.close();
  closeDatabase();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
