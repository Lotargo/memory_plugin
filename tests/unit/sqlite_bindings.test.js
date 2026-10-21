import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'memory-sqlite-bindings-'));
process.env.MEMORY_DIR = join(root, 'memory');
process.env.OPENCODE_CONFIG_DIR = join(root, 'opencode');
process.env.MEMORY_DISABLE_WEB_AUTOSTART = '1';
const { getDatabase } = await import('../../mcp-server/db/database.js');
let db;
try {
  db = await getDatabase(':memory:');
  await db.exec("CREATE TABLE binding_roundtrip (id INTEGER PRIMARY KEY, vector BLOB NOT NULL, optional BLOB); INSERT INTO binding_roundtrip VALUES(1, X'', NULL)");
  const empty = (await db.prepare('SELECT vector FROM binding_roundtrip WHERE id = 1').get()).vector;
  assert.equal(empty.byteLength, 0);
  await db.prepare('UPDATE binding_roundtrip SET vector = ? WHERE id = 1').run(empty);
  const value = await db.prepare('SELECT typeof(vector) AS kind, length(vector) AS bytes, optional FROM binding_roundtrip WHERE id = 1').get();
  assert.equal(value.kind, 'blob'); assert.equal(value.bytes, 0); assert.equal(value.optional, null);
  assert.equal((await db.prepare('SELECT typeof(?) AS kind').get(empty)).kind, 'blob');
  assert.equal((await db.prepare('SELECT typeof(:v) AS kind').all({ ':v': empty }))[0].kind, 'blob');
  await db.prepare('INSERT INTO binding_roundtrip (id, vector) VALUES (:id, :v)').run({ ':id': 2, ':v': empty });
  const nonempty = Buffer.from([0, 1, 255]);
  await db.prepare('INSERT INTO binding_roundtrip (id, vector) VALUES (?, ?)').run(3, nonempty);
  assert.deepEqual(Buffer.from((await db.prepare('SELECT vector FROM binding_roundtrip WHERE id = 3').get()).vector), nonempty);
  await assert.rejects(db.prepare('INSERT INTO binding_roundtrip (id, vector) VALUES (?, ?)').run(4, null), /NOT NULL/);
  console.log('PASS SQLite BLOB round trip: empty vectors stay binary across read/write and positional/named bindings; real NULLs and nonempty bytes are preserved.');
} finally { db?.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
