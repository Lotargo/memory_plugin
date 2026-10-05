// Isolated browser acceptance host; never opens the user's memory database.
import { mkdtempSync, rmSync, mkdirSync, statSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'knowledge-browser-'));
process.env.MEMORY_DIR = join(root, 'memory');
process.env.OPENCODE_CONFIG_DIR = join(root, 'opencode');
process.env.MEMORY_DISABLE_PERSONA_SYNC = '1';
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = '1';
const cacheIndex=process.argv.indexOf('--model-cache');
if(cacheIndex>=0){const source=process.argv[cacheIndex+1];if(!source||!statSync(source).isDirectory())throw new Error('Existing explicit model cache required');mkdirSync(join(root,'memory','storage'),{recursive:true});symlinkSync(realpathSync(source),join(root,'memory','storage','models'),process.platform==='win32'?'junction':'dir');}
const { createKnowledgeFixture } = await import('./knowledge_fixture.js');
await createKnowledgeFixture({ richContent: true });
if(process.argv.includes('--migrated'))await (await import('../../mcp-server/services/knowledge_links_service.js')).migrateKnowledge();
if(process.argv.includes('--dense-fixture')){
  const {manageKnowledgeContent}=await import('../../mcp-server/services/knowledge_content_service.js');
  const {embedText}=await import('../../mcp-server/ml/model_manager.js');
  const job=await manageKnowledgeContent({action:'prepare',scopeKey:'git:example.test/knowledge/a',operation:'create-note',fields:{title:'K6 Dense',content:'# Semantic retrieval\n\nDense vector search finds meaning using embeddings and cosine similarity.',indexMode:'dense'}},{embed:async texts=>{const vectors=[];for(const text of texts)vectors.push(await embedText(text,false,null,null,null,null,{localOnly:true}));return vectors;}});
  if(job.state!=='ready')throw new Error('Dense fixture preparation failed');await manageKnowledgeContent({action:'apply',scopeKey:'git:example.test/knowledge/a',operationId:job.operationId,previewToken:job.preview.previewToken});
}
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
const app = await startDashboard();
console.log(app.url);
await new Promise(resolve => {
  process.once('SIGINT', resolve); process.once('SIGTERM', resolve);
  process.stdin.setEncoding('utf8'); process.stdin.on('data', data => { if (data.trim() === 'stop') resolve(); });
});
await app.close();
const { closeDatabase } = await import('../../mcp-server/db/database.js');
await (await import('../../mcp-server/ml/model_manager.js')).unloadModels('preview-stop');
closeDatabase(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); process.stdin.pause();
