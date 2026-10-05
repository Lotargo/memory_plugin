import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';
import { getDatabase, BLOBS_DIR } from '../db/database.js';
import { MEMORY_DIR, storeFilePath, extractFacts } from '../memory.js';
import { factMeta } from '../fact_format.js';
import { withSnapshotLock, atomicWrite } from '../storage/snapshot_lock.js';
import { hasKnowledgeSchema } from '../storage/knowledge_schema.js';
import { getBlobPath, safeGunzip, hashContent } from '../storage/blob_store.js';
import { prepareIngestion, EDIT_BYTES } from '../ingest/staged.js';
import { ingestDocument, createNoteVirtualPath, normalizeNoteTags, RAG_NOTE_KINDS } from '../ingest/pipeline.js';
import { listKnowledgeTargets } from './knowledge_service.js';
import { resolvedLinkState } from './knowledge_links_service.js';
import { serviceError } from './notebook_service.js';
import { assertLocalMemoryReady, getConfig } from '../config/config_manager.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const STAGE_BYTES = 64 * 1024 * 1024, LIFETIME = 30 * 60 * 1000;
const operations = ['create-note', 'update-note', 'ingest-source', 'refresh-source', 'metadata'];
const folder = () => join(MEMORY_DIR, '.knowledge-staging');
const previewBinding = job => digest([job.operationId,job.scopeKey,job.operation,job.docId,job.path,job.initial.version,job.fields,job.prepared,job.effects,job.preserveIndex,job.source]);
function stagePath(id) {
  if (!/^operation_[0-9a-f-]{36}$/.test(id || '')) throw serviceError('INVALID', 'Exact operationId required.');
  return join(folder(), `${id}.json`);
}
function save(job) {
  const text = JSON.stringify(job, (_, value) => value?.type === 'Buffer' && Array.isArray(value.data) ? { vectorBase64: Buffer.from(value.data).toString('base64') } : value);
  if (Buffer.byteLength(text) > STAGE_BYTES) throw serviceError('UNSUPPORTED', 'Prepared index exceeds the 64 MiB staging limit.');
  fs.mkdirSync(folder(), { recursive: true }); atomicWrite(stagePath(job.operationId), text);
}
function pruneStages() {
  fs.mkdirSync(folder(), { recursive: true });
  let active = 0;
  for (const name of fs.readdirSync(folder()).filter(name => /^operation_[0-9a-f-]{36}\.json$/.test(name))) {
    const path = join(folder(), name);
    if (Date.now() - fs.statSync(path).mtimeMs > LIFETIME) fs.unlinkSync(path);
    else active++;
  }
  if (active >= 50) throw serviceError('BUSY', 'Too many prepared operations; wait for old preparations to expire.');
}
function load(id, scopeKey) {
  const path = stagePath(id);
  if (!fs.existsSync(path)) throw serviceError('NOT_FOUND', 'Prepared operation is missing or expired.');
  if (fs.statSync(path).size > STAGE_BYTES) throw serviceError('INVALID', 'Staging file exceeds its limit.');
  let job;
  try { job = JSON.parse(fs.readFileSync(path, 'utf8'), (_, value) => typeof value?.vectorBase64 === 'string' ? Buffer.from(value.vectorBase64, 'base64') : value); }
  catch { throw serviceError('INVALID', 'Prepared operation is corrupt.'); }
  if (job.scopeKey !== scopeKey) throw serviceError('NOT_FOUND', 'Operation is not visible in this scope.');
  if (job.expiresAt < Date.now()) throw serviceError('CONFLICT', 'Preparation expired. Prepare again; saved knowledge was not changed.');
  return job;
}
function publicJob(job) {
  return { operationId: job.operationId, operation: job.operation, state: job.state, phase: job.phase,
    completed: job.completed ?? 0, total: job.total ?? null, expiresAt: job.expiresAt,
    preview: job.state === 'ready' ? job.preview : undefined, result: job.result,
    error: job.error };
}
function parseMeta(row) { try { return JSON.parse(row.metadata_json || '{}'); } catch { return {}; } }
function raw(row) {
  if (!/^[a-f0-9]{64}$/.test(row.blob_hash || '')) throw serviceError('UNSUPPORTED', 'Saved source hash is corrupt.');
  try {
    const text = safeGunzip(fs.readFileSync(getBlobPath(row.blob_hash, BLOBS_DIR)), EDIT_BYTES).toString('utf8');
    if (hashContent(text) !== row.blob_hash) throw new Error('hash');
    return text;
  } catch { throw serviceError('UNSUPPORTED', 'Saved source is missing, corrupt or exceeds the 2 MiB editor limit.'); }
}
function state(sql, scopeKey, docId, path) {
  const row = docId ? sql.prepare('SELECT * FROM documents WHERE id=?').get(docId) : sql.prepare('SELECT * FROM documents WHERE path=?').get(path);
  if (docId && (!row || !sql.prepare('SELECT 1 FROM document_scopes WHERE doc_id=? AND scope_key=?').get(docId, scopeKey))) throw serviceError('NOT_FOUND', 'Choose an owning scope to edit this document.');
  const scopes = row ? sql.prepare('SELECT ds.scope_key,r.generation FROM document_scopes ds LEFT JOIN knowledge_scope_revisions r ON ds.scope_key=r.scope_key WHERE doc_id=? ORDER BY ds.scope_key').all(row.id) : [];
  const links = row ? sql.prepare('SELECT * FROM knowledge_links WHERE doc_id=? ORDER BY id').all(row.id) : [];
  const epoch = sql.prepare("SELECT key,value FROM sync_state WHERE key IN ('snapshot_restore_id','knowledge_import_epoch') ORDER BY key").all();
  const scopeGeneration = sql.prepare('SELECT generation FROM knowledge_scope_revisions WHERE scope_key=?').get(scopeKey);
  return { row, scopes, links, version: digest([row || null, scopes, links, epoch, scopeGeneration || null]) };
}
async function context(scopeKey) {
  assertLocalMemoryReady();
  if (!(await listKnowledgeTargets()).some(target => target.key === scopeKey)) throw serviceError('NOT_FOUND', 'Existing explicit scopeKey required.');
  const db = await getDatabase();
  if (!hasKnowledgeSchema(db)) throw serviceError('MIGRATION_REQUIRED', 'Explicit knowledge migration is required before K3 editing.');
  return db;
}
export async function readKnowledgeEditor({ scopeKey, docId }) {
  const db = await context(scopeKey);
  return withSnapshotLock(MEMORY_DIR, () => {
    const current = state(db.localDb, scopeKey, docId), meta = parseMeta(current.row);
    return { docId, title: current.row.title, path: current.row.path, sourceType: meta.source_type || 'UNKNOWN',
      kind: meta.note_kind || 'note', tags: normalizeNoteTags(meta.tags), content: raw(current.row), version: current.version,
      indexState: meta.index_state || 'UNKNOWN', shared: current.scopes.length > 1, otherScopeCount: current.scopes.filter(item => item.scope_key !== scopeKey).length };
  });
}
function fields(input) {
  const value = input.fields;
  const allowed = { 'create-note': ['title','content','kind','tags','indexMode'], 'update-note': ['title','content','kind','tags','indexMode'],
    'ingest-source': ['title','content','path','sourceType','tags','indexMode'], 'refresh-source': ['title','content','tags','indexMode'], 'metadata': ['title','kind','tags','indexMode'] }[input.operation];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw serviceError('INVALID', 'Unknown content fields.');
  if (value.title !== undefined && (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 2000)) throw serviceError('INVALID', 'Nonempty title of at most 2000 characters required.');
  if (value.content !== undefined && (typeof value.content !== 'string' || !value.content.trim() || Buffer.byteLength(value.content) > EDIT_BYTES)) throw serviceError('INVALID', 'Nonempty content of at most 2 MiB required.');
  if (value.kind !== undefined && !RAG_NOTE_KINDS.includes(value.kind)) throw serviceError('INVALID', 'Unknown Note kind.');
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.length > 100 || value.tags.some(tag => typeof tag !== 'string' || tag.length > 200))) throw serviceError('INVALID', 'tags must be an array of at most 100 short strings.');
  if (value.indexMode !== undefined && !['lexical','dense'].includes(value.indexMode)) throw serviceError('INVALID', 'Choose lexical or dense indexing.');
  if (value.path !== undefined && (typeof value.path !== 'string' || !value.path.trim() || value.path.length > 4000)) throw serviceError('INVALID', 'Short nonempty source path required.');
  return value;
}
function linkEffects(job, prepared) {
  const oldLines = job.oldText.replace(/\r\n?/g, '\n').split('\n'), newLines = prepared.markdown.replace(/\r\n?/g, '\n').split('\n');
  const contentSame = job.oldText === prepared.markdown;
  return job.initial.links.map(link => {
    const oldState = resolvedLinkState(job.sql, link);
    const oldSection = link.section_id && job.sections.find(section => section.id === link.section_id);
    const nextSection = link.section_id && prepared.hierarchy?.sections.find(section => section.id === link.section_id);
    const sectionSame = !link.section_id || (oldSection && nextSection && oldSection.content === nextSection.content && oldSection.heading === nextSection.heading && oldSection.breadcrumbs === nextSection.breadcrumbs);
    const rangeSame = link.start_line && link.end_line <= newLines.length && oldLines.slice(link.start_line - 1, link.end_line).join('\n') === newLines.slice(link.start_line - 1, link.end_line).join('\n');
    const proven = contentSame && (!link.section_id || job.preserveIndex) || (!contentSame && !!rangeSame) || !!link.section_id && sectionSame;
    const orphaned = !!link.section_id && !(job.preserveIndex ? oldSection : nextSection);
    const status = orphaned ? 'orphaned' : job.factValidity[link.id] && oldState.status === 'valid' && proven ? 'valid' : 'needs_review';
    return { linkId: link.id, factKey: link.fact_key, status, reason: orphaned ? 'section-missing' : status === 'valid' ? 'exact-binding-preserved' : 'source-review-required', orphaned };
  });
}
async function prepare(job, dependencies = {}) {
  try {
    const { sql, ...persistable } = job; job = persistable;
    const cancelled = () => load(job.operationId, job.scopeKey).state === 'cancelled';
    const progress = value => { if (cancelled()) throw serviceError('CANCELLED', 'Preparation cancelled.'); Object.assign(job, value); save(job); };
    job.state = 'preparing'; save(job);
    let prepared;
    if (job.preserveIndex) {
      prepared = { docId: job.nextId, path: job.path, title: job.source.title, markdown: job.oldText, metadata: { ...job.source.metadataOverrides }, blobHash: hashContent(job.oldText) };
    } else prepared = await prepareIngestion({ ...job.source, docId: job.nextId }, { progress, cancelled, ...dependencies });
    if (cancelled()) return publicJob(load(job.operationId, job.scopeKey));
    // Recheck the original revision after model/network preparation, not just at apply.
    const db = await context(job.scopeKey);
    await withSnapshotLock(MEMORY_DIR, () => {
      if (state(db.localDb, job.scopeKey, job.docId, job.path).version !== job.initial.version) throw serviceError('CONFLICT', 'Knowledge changed during preparation. Your saved revision was not overwritten.');
      const effects = job.docId ? linkEffects({ ...job, sql: db.localDb }, prepared) : [];
      job.prepared = prepared; job.effects = effects;
      job.preview = { title: prepared.title, docId: job.nextId, operation: job.operation, sourceType: prepared.metadata.source_type,
        shared: job.initial.scopes.length > 1, scopeCount: Math.max(1, job.initial.scopes.length),
        visibleScopes: job.initial.scopes.filter(item => item.scope_key === job.scopeKey || item.scope_key === 'global').map(item => item.scope_key),
        otherScopeCount: job.initial.scopes.filter(item => item.scope_key !== job.scopeKey && item.scope_key !== 'global').length,
        links: effects.filter(link => link.factKey === job.scopeKey), otherLinkCount: effects.filter(link => link.factKey !== job.scopeKey).length,
        totalLinks: effects.length, needsReview: effects.filter(link => link.status !== 'valid').length,
        contentChanged: job.oldText !== prepared.markdown, rebuildIndex: !job.preserveIndex,
        indexState: prepared.metadata.index_state || 'UNKNOWN', microCount: prepared.hierarchy?.microChunks.length ?? job.oldMicroCount,
        sourceExcerpt: prepared.markdown.slice(0, 2000), contentCharacters: prepared.markdown.length,
        previewToken: previewBinding(job) };
      job.state = 'ready'; job.phase = 'preview'; save(job);
    });
  } catch (error) {
    if (error.code === 'CANCELLED') job.state = 'cancelled';
    else { job.state = 'failed'; job.error = { code: ['INVALID','UNSUPPORTED','CONFLICT','NOT_FOUND','MIGRATION_REQUIRED'].includes(error.code) ? error.code : 'PREPARATION_FAILED', message: error.code === 'CONFLICT' ? error.message : 'Preparation failed; the previous saved revision remains unchanged. Check the input or explicitly retry lexical-only.' }; }
    delete job.prepared; save(job);
  }
  return publicJob(job);
}
export async function startKnowledgeContent(input, { wait = false, ...dependencies } = {}) {
  const db = await context(input.scopeKey);
  if (!operations.includes(input.operation)) throw serviceError('INVALID', 'Unknown content operation.');
  const value = fields(input), create = input.operation === 'create-note' || input.operation === 'ingest-source';
  const job = await withSnapshotLock(MEMORY_DIR, () => {
    pruneStages();
    const initial = state(db.localDb, input.scopeKey, create ? null : input.docId, create ? value.path || '' : null);
    if (!create && (!input.expectedVersion || input.expectedVersion !== initial.version)) throw serviceError('CONFLICT', 'Expected document version changed. Reload the editor while keeping your draft.');
    if (create && initial.row) throw serviceError('CONFLICT', 'This path already exists. Use refresh-source on its exact docId.');
    const old = initial.row, meta = old ? parseMeta(old) : {}, sourceType = old ? meta.source_type : input.operation === 'create-note' ? 'note' : value.sourceType;
    if ((input.operation === 'update-note') && sourceType !== 'note') throw serviceError('INVALID', 'update-note requires a Note.');
    if (!['note','text','file','url'].includes(sourceType) || input.operation === 'refresh-source' && sourceType === 'note') throw serviceError('UNSUPPORTED', 'Stored source type cannot be refreshed by this operation.');
    if (input.operation === 'metadata' && value.kind !== undefined && sourceType !== 'note') throw serviceError('INVALID', 'kind is only valid for Notes.');
    const nextId = old?.id || `doc_${randomUUID().replaceAll('-', '')}`;
    const path = old?.path || (sourceType === 'note' ? createNoteVirtualPath() : value.path || `memory://source/${randomUUID()}`);
    if (sourceType === 'file' || sourceType === 'url') { if (!old && !value.path) throw serviceError('INVALID', 'File path or URL required.'); }
    const oldText = old ? raw(old) : '';
    const title = value.title?.trim() || old?.title;
    if (!title) throw serviceError('INVALID', 'Title required.');
    if (['create-note','update-note'].includes(input.operation) && value.content === undefined) throw serviceError('INVALID', 'Note content required.');
    if (sourceType === 'text' && input.operation !== 'metadata' && value.content === undefined) throw serviceError('INVALID', 'Explicit text content required.');
    const preserveIndex = input.operation === 'metadata' && title === old.title;
    if (!preserveIndex && value.indexMode === undefined) throw serviceError('INVALID', 'Explicit indexMode lexical or dense required.');
    if (initial.links.length > 5000) throw serviceError('UNSUPPORTED', 'Too many affected links for a single edit.');
    const factValidity = {}, stores = new Map();
    for (const link of initial.links) {
      if (!stores.has(link.fact_key)) { const file = storeFilePath(link.fact_key); stores.set(link.fact_key, fs.existsSync(file) ? extractFacts(fs.readFileSync(file, 'utf8')) : []); }
      factValidity[link.id] = !!link.fact_id && stores.get(link.fact_key).filter(line => factMeta(line).id === link.fact_id).length === 1;
    }
    const metadataOverrides = { ...meta, source_type: sourceType, ...(sourceType === 'note' ? { note_kind: value.kind ?? meta.note_kind ?? 'note' } : {}), tags: value.tags === undefined ? meta.tags || [] : normalizeNoteTags(value.tags) };
    const stage = { operationId: `operation_${randomUUID()}`, scopeKey: input.scopeKey, docId: old?.id || null, nextId, path,
      operation: input.operation, fields: value, initial, oldText, preserveIndex, oldMicroCount: old ? db.localDb.prepare('SELECT COUNT(*) AS n FROM micro_chunks WHERE doc_id=?').get(old.id).n : 0,
      sections: old ? db.localDb.prepare('SELECT * FROM sections WHERE doc_id=?').all(old.id) : [], factValidity,
      source: { type: input.operation === 'metadata' || sourceType === 'note' ? 'text' : sourceType, path, title,
        content: input.operation === 'metadata' ? oldText : ['file','url'].includes(sourceType) ? path : value.content,
        generateEmbeddings: value.indexMode === 'dense', metadataOverrides },
      state: 'queued', phase: 'queued', ownerPid: process.pid, expiresAt: Date.now() + LIFETIME };
    // A creation preview is tied to the actual generated path, not the empty search key.
    if (create) stage.initial = state(db.localDb, input.scopeKey, null, path);
    save(stage); return stage;
  });
  if (wait) return prepare(job, dependencies);
  void prepare(job, dependencies);
  return publicJob(job);
}
export async function applyKnowledgeContent(input, { afterCommit } = {}) {
  const db = await context(input.scopeKey);
  return withSnapshotLock(MEMORY_DIR, async () => {
    const job = load(input.operationId, input.scopeKey);
    if (job.state === 'saved') { if (input.previewToken !== job.preview?.previewToken) throw serviceError('CONFLICT', 'Preview token mismatch.'); return publicJob(job); }
    if (job.state !== 'ready' || input.previewToken !== job.preview.previewToken || previewBinding(job) !== input.previewToken) throw serviceError('CONFLICT', 'A fresh unchanged prepared preview is required.');
    if (job.preview.shared && input.confirmShared !== true) throw serviceError('CONFIRMATION', 'Confirm publication to every owning scope of this shared document.');
    if (state(db.localDb, job.scopeKey, job.docId, job.path).version !== job.initial.version) throw serviceError('CONFLICT', 'Document, scopes or links changed after preview. Draft remains available.');
    const provenance = job.prepared.metadata.embedding_provenance;
    if (!job.preserveIndex && provenance && (provenance.model !== (getConfig().embeddingModel || 'Xenova/multilingual-e5-small') || job.source.generateEmbeddings && (getConfig().vectorDimension || provenance.dimension) !== provenance.dimension)) throw serviceError('CONFLICT', 'Embedding configuration changed after preparation.');
    job.state = 'committing'; job.phase = 'publishing'; save(job);
    try {
      const saved = await ingestDocument({ customDb: db, projectScope: job.scopeKey, prepared: job.prepared, forceReindex: !job.preserveIndex,
        beforePublish(sql) { if (state(sql, job.scopeKey, job.docId, job.path).version !== job.initial.version) throw serviceError('CONFLICT', 'Knowledge changed before publication.'); },
        publicationEffects(sql) {
          const row = sql.prepare('SELECT content_revision FROM documents WHERE id=?').get(job.nextId);
          for (const link of job.effects) sql.prepare('UPDATE knowledge_links SET status=?,source_revision=? WHERE id=?').run(link.status, link.status === 'valid' ? row.content_revision : null, link.linkId);
          sql.prepare('INSERT INTO knowledge_operations (id,journal_hash,committed_at) VALUES (?,?,?)').run(job.operationId,job.preview.previewToken,Date.now());
        } });
      afterCommit?.();
      job.state = 'saved'; job.phase = 'complete'; job.result = { status: 'saved', docId: saved.docId, version: state(db.localDb, job.scopeKey, saved.docId).version,
        indexState: job.preview.indexState, links: job.preview.links, otherLinkCount: job.preview.otherLinkCount };
      delete job.prepared; save(job); return publicJob(job);
    } catch (error) {
      const committed = db.localDb.prepare('SELECT journal_hash FROM knowledge_operations WHERE id=?').get(job.operationId);
      if(committed?.journal_hash===job.preview.previewToken){
        job.state='saved';job.phase='complete';job.result={status:'saved',docId:job.nextId,publicationRecorded:true,receiptWarning:'Saved revision committed; staging receipt or subsequent cleanup did not complete.'};
        delete job.prepared;try{save(job);}catch{}return publicJob(job);
      }
      job.state = 'failed'; job.phase = 'publication-failed'; job.error = { code: error.code || 'STORAGE_UNAVAILABLE', message: 'Publication failed; reload saved state before retrying.' }; save(job); throw error;
    }
  });
}
export async function manageKnowledgeContent(input = {}) {
  if (input.action === 'read') return readKnowledgeEditor(input);
  if (input.action === 'start' || input.action === 'prepare') return startKnowledgeContent(input, { wait: input.action === 'prepare' });
  if (input.action === 'apply') return applyKnowledgeContent(input);
  const db = await context(input.scopeKey);
  if (input.action === 'status') return withSnapshotLock(MEMORY_DIR, () => {
    const job = load(input.operationId, input.scopeKey);
    if (['queued','preparing'].includes(job.state)) {
      try { process.kill(job.ownerPid, 0); } catch (error) { if (error.code === 'ESRCH') { job.state = 'failed'; job.error = { code: 'INTERRUPTED', message: 'Preparation host exited. Saved knowledge was not changed.' }; save(job); } }
    }
    // If a CLI host died before publication, readiness is never invented.
    if (job.state === 'committing') {
      const row = db.localDb.prepare('SELECT * FROM documents WHERE id=?').get(job.nextId);
      const ledger = db.localDb.prepare('SELECT journal_hash FROM knowledge_operations WHERE id=?').get(job.operationId);
      if (ledger?.journal_hash === job.preview?.previewToken) {
        job.state = 'saved'; job.result = { status: 'saved', docId: job.nextId, recoveredPublication: true, superseded: !row || row.blob_hash !== job.prepared?.blobHash || row.metadata_json !== JSON.stringify(job.prepared?.metadata) }; delete job.prepared; save(job);
      } else { job.state = 'failed'; job.error = { code: 'INTERRUPTED', message: 'Publication was interrupted. Reload saved knowledge.' }; save(job); }
    }
    return publicJob(job);
  });
  if (input.action === 'cancel') return withSnapshotLock(MEMORY_DIR, () => {
    const job = load(input.operationId, input.scopeKey);
    if (['committing','saved'].includes(job.state)) throw serviceError('CONFLICT', 'Publication cannot be cancelled; read its actual result.');
    job.state = 'cancelled'; delete job.prepared; save(job); return publicJob(job);
  });
  throw serviceError('INVALID', 'Unknown content action.');
}
