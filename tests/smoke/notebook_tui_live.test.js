import assert from 'node:assert/strict';
import readline from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'memory-tui-live-'));
Object.assign(process.env, { MEMORY_DIR: join(root, 'memory'), OPENCODE_CONFIG_DIR: join(root, 'opencode'),
  MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_DISABLE_WEB_AUTOSTART: '1' });
const { writeMemory, readMemory } = await import('../../mcp-server/memory.js');
const { browseNotebookFacts } = await import('../../mcp-server/cli/notebook.js');
const { readNotebook } = await import('../../mcp-server/services/notebook_service.js');
const { closeDatabase } = await import('../../mcp-server/db/database.js');
try {
  const a = 'git:example.test/terminal/a', b = 'git:example.test/terminal/b';
  const line = '- [2026-10-05 10:00] **Terminal fixture** — Original terminal body <!-- id:same, keep:1 -->';
  for (const key of ['global', a, b]) await writeMemory(key, [line]);
  if (process.argv.includes('--interactive')) {
    readline.emitKeypressEvents(process.stdin);
    await browseNotebookFacts(a, 'ISOLATED TERMINAL A');
  }
  assert.deepEqual(await readMemory(b), [line]);
  assert.deepEqual(await readMemory('global'), [line]);
  console.log(JSON.stringify({ status: 'PASS', terminal: process.stdin.isTTY === true,
    selected: (await readNotebook({ key: a })).records.map(({ id, title, body, meta }) => ({ id, title, body, meta })),
    otherStores: 'unchanged' }));
} finally {
  closeDatabase();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
