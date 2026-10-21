// Explicit release acceptance: real CPU inference, isolated data and model copies.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const worker = process.argv[2] === '--worker';
const root = worker ? resolve(process.argv[3]) : await mkdtemp(join(tmpdir(), 'memory-dependency-models-'));
const embedding = 'Xenova/multilingual-e5-small';
const reranker = 'SugoLabs/mmarco-mMiniLMv2-L12-H384-v1';
if (!worker) {
  try {
    const models = join(root, 'memory', 'storage', 'models'); await mkdir(models, { recursive: true });
    // Read public model assets only; never point writable runtime storage at installed memory.
    if (process.env.MEMORY_MODEL_CACHE) for (const name of [embedding, reranker]) {
      const source = join(resolve(process.env.MEMORY_MODEL_CACHE), name);
      if (existsSync(source)) await cp(source, join(models, name), { recursive: true });
    }
    const env = { ...process.env, MEMORY_DIR: join(root, 'memory'), OPENCODE_CONFIG_DIR: join(root, 'opencode'),
      MEMORY_WEB_STARTUP_DIR: join(root, 'startup'), MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1',
      MEMORY_DISABLE_WEB_AUTOSTART: '1', MEMORY_WEB_AUTOSTART: '0', MEMORY_CLIENT_PROBE: '1' };
    const result = await run(process.execPath, [fileURLToPath(import.meta.url), '--worker', root], { env, windowsHide: true, timeout: 600000, maxBuffer: 4 * 1024 * 1024 });
    process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
} else {
  const { updateConfig } = await import('../../mcp-server/config/config_manager.js');
  const { closeDatabase } = await import('../../mcp-server/db/database.js');
  const { getExtractor, getReranker, embedText, rerankHits, unloadModels, getModelRuntimeStatus, cosineSimilarity } = await import('../../mcp-server/ml/model_manager.js');
  const { ingestDocument } = await import('../../mcp-server/ingest/pipeline.js');
  const { hybridQuery } = await import('../../mcp-server/retrieval/retriever.js');
  updateConfig({ embeddingModel: embedding, executionDevice: 'cpu', rerankerEnabled: false, onnxThreads: 2, vectorDimension: 384 });
  try {
    await getExtractor(embedding, null, { strict: true, device: 'cpu', localOnly: existsSync(join(root, 'memory/storage/models', embedding, 'onnx/model_quantized.onnx')) });
    const vector = await embedText('semantic document retrieval', true, embedding);
    assert.equal(vector.length, 384); assert.ok(Array.from(vector).every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-5);
    const related = await embedText('Search documents by meaning with dense vectors.', false, embedding);
    const unrelated = await embedText('The recipe uses carrots, butter and potatoes.', false, embedding);
    assert.ok(cosineSimilarity(vector, related) > cosineSimilarity(vector, unrelated));
    await ingestDocument({ content: '# Semantic retrieval\n\nSearch documents by meaning with dense vectors and cosine similarity.', type: 'text', path: 'synthetic-search.md', title: 'Semantic retrieval', projectScope: 'global', generateEmbeddings: true });
    const hits = await hybridQuery({ query: 'semantic document retrieval', scope: 'global', limit: 3 });
    assert.ok(hits.some(hit => Number(hit.cosine_sim) > 0.1), 'dense retrieval must not silently degrade to lexical search');
    await unloadModels('dependency-smoke-reload');
    assert.equal(getModelRuntimeStatus().embedding.loaded, false);
    await getExtractor(embedding, null, { strict: true, localOnly: true, device: 'cpu' });
    const reloaded = await embedText('semantic document retrieval', true, embedding);
    assert.ok(Array.from(vector).every((value, i) => Math.abs(value - reloaded[i]) < 1e-6));
    console.log('PASS real q8 CPU embedding: 384 finite normalized values, semantic ordering, saved dense retrieval, unload/reload stability.');

    await getReranker(reranker, null, { strict: true, device: 'cpu' });
    const ranked = await rerankHits('What is the capital of France?', [
      { content: 'Bananas grow in warm tropical climates.', id: 'unrelated' },
      { content: 'Paris is the capital of France.', id: 'answer' },
    ], reranker);
    assert.equal(ranked[0].id, 'answer');
    assert.ok(ranked.every(hit => Number.isFinite(hit.rerank_score)));
    assert.ok(ranked[0].rerank_score > ranked[1].rerank_score, 'real logits must separate relevant and irrelevant passages');
    console.log('PASS real q8 CPU reranker: default multilingual model, finite unequal raw logits and correct relevance ordering.');
  } finally { await unloadModels('dependency-smoke-complete'); closeDatabase(); }
}
