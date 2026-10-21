// Real dashboard + isolated memory + optional Playwright installation.
// Set PLAYWRIGHT_MODULE to an installed playwright/index.mjs when not in PATH.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = fs.mkdtempSync(join(tmpdir(), 'memory-i18n-ui-'));
process.env.MEMORY_DIR = join(root, 'memory');
process.env.OPENCODE_CONFIG_DIR = join(root, 'opencode');
process.env.MEMORY_WEB_STARTUP_DIR = join(root, 'startup');
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = '1';
process.env.MEMORY_DISABLE_PERSONA_SYNC = '1';
process.env.MEMORY_WEB_AUTOSTART = '0';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const { writeMemory } = await import('../../mcp-server/memory.js');
const { closeDatabase } = await import('../../mcp-server/db/database.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
const { ingestDocument } = await import('../../mcp-server/ingest/pipeline.js');
let app, browser;
try {
  await writeMemory('global', ['- [2026-10-21 10:00] **Все записи** — Инструкции <!-- id:test, kind:fact -->']);
  await ingestDocument({path:'source.md',content:'# Русский источник\n\nВсе записи\n\n```mermaid\ngraph LR\nA-->B\n```',title:'Источник',projectScope:'global',generateEmbeddings:false});
  app = await startDashboard();
  browser = await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
  const context = await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU'});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => {errors.push(error.message); console.error('Browser error:', error.message);});
  page.on('dialog', dialog => dialog.accept());
  await page.goto(app.url);
  await page.waitForFunction(() => !document.getElementById('create').disabled);
  assert.equal(await page.locator('html').getAttribute('lang'), 'en', 'English despite Russian browser locale');
  assert.equal(await page.locator('#viewTitle').textContent(), 'All records');
  assert.equal(await page.locator('#scopeName').textContent(), 'Global memory');
  assert.equal(await page.locator('#resultCount').textContent(), '1 record');
  await page.locator('.record-row').click();
  assert.equal(await page.locator('#recordTitle').textContent(), 'Все записи');
  await page.locator('#edit').click();
  await page.locator('#title').fill('Черновик 草稿 draft');
  await page.locator('#body').fill('Все записи');
  for (const [language, title] of [['zh-CN','全部记录'],['ru','Все записи'],['en','All records']]) {
    await page.locator('#language').selectOption(language);
    assert.equal(await page.locator('#viewTitle').textContent(), title);
    assert.equal(await page.locator('#scopeName').textContent(), {en:'Global memory',ru:'Глобальная память','zh-CN':'全局记忆'}[language]);
    assert.equal(await page.locator('#title').inputValue(), 'Черновик 草稿 draft');
    assert.equal(await page.locator('#body').inputValue(), 'Все записи');
    assert.ok(await page.locator('#editForm').isVisible());
    assert.equal(await page.locator('#notebookCount').textContent(), '1', 'counter survives switching');
  }
  await page.locator('#cancelEdit').click(); await page.locator('#discardChanges').click();
  await page.locator('#openSettings').click();
  await page.waitForSelector('#setting-fusionAlgorithm');
  assert.equal(await page.locator('label[for="setting-fusionAlgorithm"]').textContent(), 'Search algorithm');
  await page.locator('#setting-alpha').fill('0.75');
  // A native modal blocks its background control; exercise the same setter in
  // place to verify that an open dialog and its edited inputs are preserved.
  await page.evaluate(async () => (await import('/i18n.js')).setLanguage('zh-CN'));
  assert.equal(await page.locator('label[for="setting-fusionAlgorithm"]').textContent(), '搜索算法');
  assert.equal(await page.locator('#setting-alpha').inputValue(), '0.75');
  assert.ok(await page.locator('#settingsDialog').isVisible());
  await page.locator('#settingsClose').click();
  await page.locator('#settingsDiscard').click();
  // Settings has a draft guard: keep testing on a clean navigation after reload.
  await page.reload(); await page.waitForFunction(() => !document.getElementById('create').disabled);
  assert.equal(await page.locator('#language').inputValue(), 'zh-CN', 'choice survives reload');
  const cookies = await context.cookies();
  assert.equal(cookies.find(cookie => cookie.name === 'memory_panel_language')?.value, 'zh-CN');
  for (const language of ['en','ru','zh-CN']) {
    await page.locator('#language').selectOption(language);
    await page.locator('#openModels').click();
    await page.waitForFunction(() => !document.getElementById('modelsContent').hidden);
    assert.equal(await page.locator('#modelsDialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, `model dialog width / ${language}`);
    await page.locator('[data-close="modelsDialog"]').click();
    if (process.env.I18N_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.I18N_SCREENSHOT_DIR, {recursive:true});
      await page.screenshot({path:join(process.env.I18N_SCREENSHOT_DIR,`dashboard-${language}.png`)});
    }
  }
  await page.route('**/api/models', route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'BUSY',error:'Другая операция с моделями ещё выполняется или ожидает подтверждения.'})}));
  await page.locator('#openModels').click();
  await page.waitForFunction(() => document.getElementById('modelsMessage').textContent.includes('其他模型操作'));
  await page.locator('[data-close="modelsDialog"]').click();
  await page.unroute('**/api/models');
  await page.locator('[data-view="knowledge"]').click();
  await page.waitForSelector('#knowledgeDocuments button');
  await page.locator('#knowledgeDocuments button').first().click();
  await page.waitForSelector('#knowledgeRendered .diagram');
  await page.locator('#language').selectOption('en');
  assert.ok((await page.locator('#knowledgeRendered').textContent()).includes('Все записи'), 'source content preserved');
  assert.ok((await page.locator('#knowledgeRendered').textContent()).includes('Diagram code'), 'renderer chrome localized');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#navigation').click();
  await page.locator('#language').selectOption('zh-CN');
  assert.ok(await page.locator('#language').isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no mobile horizontal overflow');
  if (process.env.I18N_SCREENSHOT_DIR) await page.screenshot({path:join(process.env.I18N_SCREENSHOT_DIR,'dashboard-mobile.png')});
  // Host-scoped cookie also survives a new dashboard port.
  const second = await startDashboard();
  try {
    await page.goto(second.url);await page.waitForFunction(() => !document.getElementById('create').disabled);
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  } finally { await second.close(); }
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS live i18n: en/ru/zh-CN, drafts, settings, models, source preservation, Markdown, mobile, reload, port changes, zero browser errors.');
} finally {
  if (browser) await browser.close();
  if (app) await app.close();
  closeDatabase();
  // Only this test-created directory is removed.
  fs.rmSync(root, {recursive:true,force:true,maxRetries:5});
}
