// Real dashboard + synthetic records only. Never read installed memory or client homes.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

if (!process.env.MEMORY_BROWSER_DEPS) throw new Error('Set MEMORY_BROWSER_DEPS to a directory containing playwright.');
const require = createRequire(join(resolve(process.env.MEMORY_BROWSER_DEPS), 'package.json'));
const { chromium } = require('playwright');
const root = await mkdtemp(join(tmpdir(), 'memory-readme-demo-'));
Object.assign(process.env, {
  MEMORY_DIR: join(root, 'memory'), OPENCODE_CONFIG_DIR: join(root, 'opencode'),
  HOME: root, USERPROFILE: root, APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'local'),
  CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude'),
  MEMORY_WEB_STARTUP_DIR: join(root, 'startup'), MEMORY_CLIENT_PROBE: '1',
  MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1',
  MEMORY_DISABLE_WEB_AUTOSTART: '1', MEMORY_WEB_AUTOSTART: '0',
});
const { writeMemory } = await import('../mcp-server/memory.js');
const { getDatabase, closeDatabase } = await import('../mcp-server/db/database.js');
const { upsertIdentity } = await import('../mcp-server/identity.js');
const { ingestDocument } = await import('../mcp-server/ingest/pipeline.js');
const { startDashboard } = await import('../mcp-server/dashboard/server.js');
let app, browser;
try {
  const db = await getDatabase();
  for (const name of ['demo-app', 'design-system']) {
    await upsertIdentity(db, { key: `git:example.test/demo/${name}`, name, primaryRemote: `example.test/demo/${name}` });
  }
  await writeMemory('global', [
    '- [2026-10-20 10:00] **Стиль ответов** — Отвечай кратко и объясняй причину предлагаемых изменений. <!-- id:demo01, kind:directive, tags:communication, keep:1 -->',
    '- [2026-10-20 10:05] **Проверка изменений** — Перед коммитом запускай проверки, относящиеся к изменённому коду. <!-- id:demo02, kind:directive, tags:workflow -->',
    '- [2026-10-20 10:10] **Технологии демопроекта** — В учебном приложении используются TypeScript, Node.js и SQLite. <!-- id:demo03, kind:fact, tags:architecture -->',
    '- [2026-10-20 10:15] **Решение по поиску** — Краткие правила хранятся в Notebook, подробные исследования — в базе знаний. <!-- id:demo04, kind:fact, tags:knowledge -->',
    '- [2026-10-20 10:20] **Документация API** — Примеры запросов используют вымышленные данные и домен example.test. <!-- id:demo05, kind:fact, tags:docs -->',
  ]);
  await ingestDocument({ path: 'memory://note/demo-search', title: 'Как устроена память демопроекта', projectScope: 'global', generateEmbeddings: false,
    metadataOverrides: { source_type: 'note', note_kind: 'decision', tags: ['demo', 'architecture'] },
    content: '# Память демопроекта\n\nВсе записи в этом примере вымышлены.\n\n## Notebook: краткий контекст\n\nФакты, предпочтения и рабочие инструкции доступны агенту при запуске сессии.\n\n## База знаний: подробные источники\n\nРешения, исследования и документация находятся через поиск и открываются по мере необходимости.\n\n| Информация | Где хранится |\n| --- | --- |\n| Краткое правило | Notebook |\n| Подробное решение | Memory Note |\n| Внешняя документация | Источник |\n\n## Области проектов\n\nGit-идентичность отделяет контекст одного проекта от другого.',
  });
  await ingestDocument({ path: 'demo-guide.md', title: 'Руководство по учебному API', projectScope: 'global', generateEmbeddings: false,
    content: '# Учебный API\n\nПример общедоступной документации.\n\n## Проверки\n\nИспользуйте только синтетические данные в демонстрациях.' });
  app = await startDashboard();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  // No remote services, model downloads, analytics or external images in the capture.
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(app.url).origin ? route.continue() : route.abort());
  await page.goto(app.url);
  await page.locator('.record-row').filter({ hasText: 'Решение по поиску' }).click();
  await page.locator('#recordTitle').filter({ hasText: 'Решение по поиску' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const output = new URL('../assets/ui/', import.meta.url);
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('notebook.png', output)), fullPage: true });
  await page.locator('[data-view="knowledge"]').click();
  await page.locator('#knowledgeDocuments button').filter({ hasText: 'Как устроена память' }).click();
  await page.locator('#knowledgeTitle').filter({ hasText: 'Как устроена память' }).waitFor();
  await page.locator('#knowledgeRendered h4').waitFor();
  await page.locator('#knowledgeReader[aria-busy="false"]').waitFor();
  assert.deepEqual(failures, []);
  assert.equal(new URL(page.url()).hash, '');
  await page.screenshot({ path: fileURLToPath(new URL('knowledge.png', output)), fullPage: true });
  console.log('Saved two dashboard screenshots with synthetic demo data; no browser errors.');
} finally {
  await browser?.close();
  await app?.close();
  closeDatabase();
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
}
