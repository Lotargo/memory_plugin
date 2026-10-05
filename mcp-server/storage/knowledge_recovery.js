import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicWrite } from './snapshot_lock.js';
import { getDatabase } from '../db/database.js';
export const journalPath = directory => path.join(directory, '.knowledge-journal.json');
const hash = text => createHash('sha256').update(text).digest('hex');
const fileHash = file => fs.existsSync(file) ? hash(fs.readFileSync(file)) : null;
const failure = message => Object.assign(new Error(message), { code: 'RECOVERY_REQUIRED' });
export async function recoverKnowledge(directory) {
  if (!fs.existsSync(journalPath(directory))) return;
  return recoverKnowledgeSync(directory, (await getDatabase()).localDb);
}
export function recoverKnowledgeSync(directory, sql) {
  const file = journalPath(directory);
  if (!fs.existsSync(file)) return;
  const bytes = fs.readFileSync(file);
  if (bytes.length > 64 * 1024 * 1024) throw failure('Knowledge recovery journal is too large. Inspect the local journal.');
  let journal;
  try { journal = JSON.parse(bytes); } catch { throw failure('Knowledge recovery journal is corrupt. Inspect the local journal.'); }
  if (journal.version !== 1 || !Array.isArray(journal.files) || typeof journal.id !== 'string') throw failure('Unsupported knowledge recovery journal.');
  const table = sql.prepare("SELECT name FROM sqlite_master WHERE name='knowledge_operations'").get();
  const operation = table && sql.prepare('SELECT journal_hash FROM knowledge_operations WHERE id=?').get(journal.id);
  if (!operation) { fs.unlinkSync(file); return { status: 'discarded', operationId: journal.id }; }
  if (operation.journal_hash !== hash(bytes)) throw failure('Knowledge journal does not match its committed SQL operation.');
  // Validate every file before replacing any. An unexpected external edit is
  // preserved and blocks further operations instead of silently losing data.
  for (const item of journal.files) {
    const safeName = /^[^\\/\x00-\x1f:]+\.md$/.test(item.file) || /^\.knowledge-backups\/[0-9a-f-]+\.zip\.report\.json$/.test(item.file);
    if (!safeName || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\./i.test(item.file) || (item.content !== null && typeof item.content !== 'string') || (item.content === null ? item.newHash !== null : hash(item.content) !== item.newHash)) throw failure('Invalid staged knowledge file.');
    const current = fileHash(path.join(directory, item.file));
    if (current !== item.oldHash && current !== item.newHash) throw failure('A Notebook file changed outside the pending operation. Review the file and journal before recovery.');
  }
  for (const item of journal.files) {
    const target = path.join(directory, item.file);
    if (fileHash(target) !== item.newHash) {
      if (item.content === null) fs.unlinkSync(target); else atomicWrite(target, item.content);
    }
    if (fileHash(target) !== item.newHash) throw failure('Notebook replacement verification failed. Retry recovery.');
  }
  if (journal.pruneLedger === true) sql.prepare('DELETE FROM knowledge_operations WHERE id=?').run(journal.id);
  fs.unlinkSync(file);
  return { status: 'recovered', operationId: journal.id };
}

export function prepareKnowledge(directory, files, { pruneLedger = false } = {}) {
  if (fs.existsSync(journalPath(directory))) throw failure('Recover the pending knowledge operation before preparing another one.');
  const journal = { version: 1, id: randomUUID(), pruneLedger, files: files.map(({ file, content }) => ({ file, content,
    oldHash: fileHash(path.join(directory, file)), newHash: content === null ? null : hash(content) })) };
  const bytes = JSON.stringify(journal);
  if (Buffer.byteLength(bytes) > 64 * 1024 * 1024) throw Object.assign(new Error('Combined Notebook operation exceeds the 64 MiB journal limit.'), { code: 'INVALID' });
  atomicWrite(journalPath(directory), bytes);
  return { journal, bytes };
}
export function recordKnowledgeCommit(sql, { journal, bytes }) {
  sql.prepare('INSERT INTO knowledge_operations (id,journal_hash,committed_at) VALUES (?,?,?)').run(journal.id, hash(bytes), Date.now());
}

// Call under withSnapshotLock. No await is allowed inside the SQL transaction;
// all model/network/preparation work and backups happen before this function.
export async function commitKnowledge(directory, db, files, apply, { afterCommit } = {}) {
  const sql = db.localDb;
  const prepared = prepareKnowledge(directory, files), { journal } = prepared;
  let committed = false, begun = false;
  try {
    sql.exec('BEGIN IMMEDIATE'); begun = true;
    apply(sql);
    recordKnowledgeCommit(sql, prepared);
    sql.exec('COMMIT'); committed = true;
  } catch (error) {
    if (begun) sql.exec('ROLLBACK');
    fs.unlinkSync(journalPath(directory)); throw error;
  }
  if (committed && afterCommit) await afterCommit(); // fault injection in isolated acceptance tests
  recoverKnowledgeSync(directory, sql);
  return journal.id;
}
