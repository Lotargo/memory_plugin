import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { normalizeContent, fetchUrlContent } from './normalizer.js';
import { assertIngestPathAllowed } from '../security/path_guard.js';
import { buildTripleHierarchy } from './chunker.js';
import { embedBatch, vectorToBuffer } from '../ml/model_manager.js';
import { getConfig } from '../config/config_manager.js';
import { hashContent } from '../storage/blob_store.js';

export const EDIT_BYTES = 2 * 1024 * 1024;
const fail = (code, message) => Object.assign(new Error(message), { code });
export async function normalizeIngestionSource({ content, type = 'text', path = null, title = null, metadataOverrides = null }, progress = () => {}) {
  let effectiveType = type, effectivePath = path, effectiveTitle = title;
  progress({ phase: 'reading' });
  if (type === 'url') {
    const fetched = await fetchUrlContent(String(content));
    content = fetched.markdown; effectiveType = 'text';
    effectiveTitle = title || fetched.title; effectivePath = path || fetched.finalUrl;
  } else if (type === 'file' && (!content || content === (path || content))) {
    const file = path || content, safe = assertIngestPathAllowed(file);
    if ((await stat(safe)).size > 32 * 1024 * 1024) throw fail('INVALID', 'File exceeds the 32 MiB ingestion limit.');
    content = await readFile(safe, ['.pdf', '.docx', '.xlsx', '.xls'].includes(extname(safe).toLowerCase()) ? null : 'utf8');
    effectivePath = file;
  }
  progress({ phase: 'normalizing' });
  const normalized = await normalizeContent({ content, type: effectiveType, path: effectivePath, title: effectiveTitle });
  if (type === 'url') normalized.metadata.source_type = 'url';
  return { markdown: normalized.markdown, title: normalized.title, path: effectivePath,
    metadata: { ...normalized.metadata, ...(metadataOverrides || {}), char_count: normalized.markdown.length } };
}

export async function prepareIngestion(input, { progress = () => {}, cancelled = () => false, embed = embedBatch } = {}) {
  const source = await normalizeIngestionSource(input, progress);
  if (!source.markdown.trim()) throw fail('INVALID', 'Normalized source is empty.');
  if (Buffer.byteLength(source.markdown) > EDIT_BYTES) throw fail('UNSUPPORTED', 'Normalized content exceeds the 2 MiB editor limit.');
  const check = () => { if (cancelled()) throw fail('CANCELLED', 'Preparation cancelled before publication.'); };
  check();
  const hierarchy = buildTripleHierarchy(source.markdown, input.docId, source.title);
  if(hierarchy.microChunks.length>5000)throw fail('UNSUPPORTED','Prepared index exceeds 5000 micro-chunks.');
  const config = getConfig(), model = config.embeddingModel || 'Xenova/multilingual-e5-small';
  const dimension = config.vectorDimension || null;
  const batchSize = Math.max(1, Math.min(128, config.batchSize || 12));
  let completed = 0, actualDimension = null;
  for (let start = 0; start < hierarchy.microChunks.length; start += batchSize) {
    check(); const batch = hierarchy.microChunks.slice(start, start + batchSize);
    progress({ phase: input.generateEmbeddings ? 'embedding' : 'indexing', completed, total: hierarchy.microChunks.length });
    const vectors = input.generateEmbeddings ? await embed(batch.map(item => `${item.content}\n\nContext: ${source.title}${item.breadcrumbs ? ` > ${item.breadcrumbs}` : ''}`), false, model, null, null, {}, dimension) : null;
    check();
    if (vectors && (vectors.length !== batch.length || vectors.some(vector => !vector?.length || [...vector].some(value => !Number.isFinite(value))))) throw fail('EMBEDDING_FAILED', 'Embedding batch did not return complete finite vectors.');
    for (let i = 0; i < batch.length; i++) {
      if (vectors) {
        actualDimension ??= vectors[i].length;
        if (actualDimension !== vectors[i].length) throw fail('EMBEDDING_FAILED', 'Embedding dimensions changed during preparation.');
      }
      batch[i].vector = vectors ? vectorToBuffer(vectors[i]) : Buffer.alloc(0);
    }
    completed += batch.length;
  }
  progress({ phase: 'indexing', completed, total: hierarchy.microChunks.length });
  source.metadata.index_state = input.generateEmbeddings && hierarchy.microChunks.length ? 'dense' : 'lexical-only';
  source.metadata.embedding_provenance = source.metadata.index_state === 'dense' ? { model, dimension: actualDimension, recordedAt: Date.now() } : null;
  return { ...source, docId: input.docId, blobHash: hashContent(source.markdown), hierarchy };
}
