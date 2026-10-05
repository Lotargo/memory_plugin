// Invoked only by diagnostics_service with a freshly allocated temporary home.
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { getDatabase, closeDatabase } from '../db/database.js';
import { MEMORY_DIR } from '../memory.js';
import { migrateKnowledge, manageKnowledgeLinks } from '../services/knowledge_links_service.js';
import { readNotebook, mutateNotebook } from '../services/notebook_service.js';
import { ingestDocument } from '../ingest/pipeline.js';
import { readKnowledge } from '../services/knowledge_service.js';
import { searchKnowledge } from '../services/knowledge_search_service.js';
import { getModelRuntimeStatus } from '../ml/model_manager.js';

const checks = [];
try {
  assert.equal(process.env.MEMORY_DIAGNOSTIC_ISOLATED, '1');
  assert.equal(resolve(MEMORY_DIR), resolve(join(process.cwd(), 'memory')));
  const db = await getDatabase();
  assert.equal(db.localDb.prepare('SELECT count(*) n FROM documents').get().n, 0);
  await migrateKnowledge();
  checks.push({ name: 'isolated-store', status: 'passed' });
  const content = '# Unicorn\n\nBackend uses Go and PostgreSQL.\n';
  const doc = await ingestDocument({ content, path: 'virtual://diagnostic/unicorn.md', title: 'Diagnostic Unicorn', generateEmbeddings: false });
  const notebook = await readNotebook({ key: 'global' });
  const created = await mutateNotebook({ key: 'global', action: 'create', expectedVersion: notebook.version,
    fields: { title: 'Backend', body: 'Use Go and PostgreSQL', kind: 'fact' } });
  assert.equal(created.status, 'saved');
  const saved = await readNotebook({ key: 'global' });
  assert.equal(saved.records.length, 1);
  checks.push({ name: 'notebook-write-readback', status: 'passed' });
  const target = { operation: 'create', scopeKey: 'global', fields: { factRef: saved.records[0].ref, docId: doc.docId, startLine: 3, endLine: 3, relationType: 'RULES_FOR' } };
  const preview = await manageKnowledgeLinks({ action: 'preview', ...target });
  const link = await manageKnowledgeLinks({ action: 'apply', ...target, previewToken: preview.previewToken });
  const listed = await manageKnowledgeLinks({ action: 'list', scopeKey: 'global', factRef: saved.records[0].ref });
  assert.equal(listed.items.length, 1); assert.equal(listed.items[0].status, 'valid');
  assert.equal(listed.items[0].coordinatesConfirmed, true);
  assert.ok(db.localDb.prepare('SELECT metadata_json FROM graph_edges').all().some(row => JSON.parse(row.metadata_json || '{}').linkIds?.includes(link.linkId)));
  checks.push({ name: 'scoped-link-graph-projection', status: 'passed' });
  const raw = await readKnowledge({ scopeKey: 'global', docId: doc.docId });
  assert.equal(raw.raw.text, content.trimEnd());
  checks.push({ name: 'saved-source-lines', status: 'passed' });
  const search = await searchKnowledge({ scopeKey: 'global', query: 'PostgreSQL', searchMode: 'lexical', resultMode: 'snippet' });
  assert.ok(search.items.some(item => item.docId === doc.docId));
  assert.equal(getModelRuntimeStatus().embedding.loaded, false);
  checks.push({ name: 'lexical-retrieval-without-models', status: 'passed' });
  process.stdout.write(JSON.stringify({ status: 'passed', checks, modelsLoaded: false, cloudCalled: false, agentUsage: 'not-observed' }));
} catch (error) {
  process.stdout.write(JSON.stringify({ status: 'failed', checks, failedCheck: checks.length,
    error: { code: error.code || 'DIAGNOSTIC_FAILED', message: String(error.message).slice(0,1000) } }));
  process.exitCode = 1;
} finally { closeDatabase(); }
