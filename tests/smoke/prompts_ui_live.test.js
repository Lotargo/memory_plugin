import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'memory-prompts-ui-'));
Object.assign(process.env, { HOME: root, USERPROFILE: root, MEMORY_DIR: join(root, 'memory'), OPENCODE_CONFIG_DIR: join(root, 'opencode'),
  CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude'), XDG_CONFIG_HOME: join(root, 'config'),
  MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_DISABLE_WEB_AUTOSTART: '1' });
const { writeMemory } = await import('../../mcp-server/memory.js');
const { closeDatabase } = await import('../../mcp-server/db/database.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
let app;
try {
  await writeMemory('global', ['- [2026-10-05 00:00] **Краткость** — Отвечай кратко и показывай проверенные результаты. <!-- id:style, kind:directive -->']);
  mkdirSync(join(root, 'codex'), { recursive: true });
  writeFileSync(join(root, 'codex', 'AGENTS.md'), '# Мои инструкции\n\nСохрани этот текст и <script>unsafe()</script> как текст.\n');
  mkdirSync(join(root, 'claude'), { recursive: true });
  writeFileSync(join(root, 'claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'memory@lotargo-memory-local': true } }));
  app = await startDashboard(); console.log(JSON.stringify({ url: app.url, root }));
  if (process.argv.includes('--serve')) await new Promise(resolve => {
    process.once('SIGINT', resolve); process.once('SIGTERM', resolve);
    process.stdin.resume(); process.stdin.on('data', data => { if (data.toString().trim() === 'stop') { process.stdin.pause(); resolve(); } });
  });
  else console.log('PASS isolated prompt browser fixture');
} finally { if (app) await app.close(); closeDatabase(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
