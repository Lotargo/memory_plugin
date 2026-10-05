import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'memory-persona-ui-'));
Object.assign(process.env, { MEMORY_DIR: join(root, 'memory'), OPENCODE_CONFIG_DIR: join(root, 'opencode'),
  CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude'), XDG_CONFIG_HOME: join(root, 'config'),
  MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_DISABLE_WEB_AUTOSTART: '1' });
const { seedPersonaFixture } = await import('../fixtures/persona.js');
const { closeDatabase } = await import('../../mcp-server/db/database.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
let app;
try {
  const projects = await seedPersonaFixture(); app = await startDashboard();
  console.log(JSON.stringify({ url: app.url, root, ...projects }));
  if (process.argv.includes('--serve')) await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  else console.log('PASS isolated persona browser fixture');
} finally {
  if (app) await app.close(); closeDatabase();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
