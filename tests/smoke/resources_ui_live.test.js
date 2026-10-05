// Isolated browser fixture: real OS measurements, no model/cache/user-memory changes.
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root = fs.mkdtempSync(join(tmpdir(), 'memory-resources-ui-'));
process.env.MEMORY_DIR = join(root, 'memory'); process.env.OPENCODE_CONFIG_DIR = join(root, 'opencode');
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = '1'; process.env.MEMORY_DISABLE_PERSONA_SYNC = '1'; process.env.MEMORY_DISABLE_WEB_AUTOSTART = '1';
const {writeMemory} = await import('../../mcp-server/memory.js');
const {closeDatabase} = await import('../../mcp-server/db/database.js');
const {startDashboard} = await import('../../mcp-server/dashboard/server.js');
let app;
try {
  await writeMemory('global', ['- [2026-10-04 10:00] **Monitoring fixture** — Isolated RAM/GPU browser acceptance <!-- id:resources, kind:fact -->']);
  app = await startDashboard();
  console.log(JSON.stringify({url: app.url, root}));
  await new Promise(resolve => {process.once('SIGINT', resolve); process.once('SIGTERM', resolve);});
} finally {
  if (app) await app.close(); await closeDatabase();
  console.log('Resource browser fixture stopped; evidence directory: ' + root);
}
