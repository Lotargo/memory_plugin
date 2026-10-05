// Explicit installed-package acceptance. All product imports resolve from the
// supplied installation, not the checkout. --serve keeps disposable UI data
// alive until stdin receives "stop"; normal runs clean up immediately.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const packageRoot=resolve(process.argv[2]||'');
assert.equal(JSON.parse(fs.readFileSync(join(packageRoot,'package.json'),'utf8')).name,'@lotargo/memory_plugin');
for(const alias of ['memory-plugin','memory_plugin','memory-agent','memory-cli'])assert.ok(fs.existsSync(resolve(packageRoot,'..','..','.bin',alias+(process.platform==='win32'?'.cmd':''))),`Missing npm bin: ${alias}`);
const load=relative=>import(pathToFileURL(join(packageRoot,relative)).href);
const requireInstalled=createRequire(join(packageRoot,'package.json'));
const root=fs.mkdtempSync(join(tmpdir(),'knowledge-installed-'));
process.env.MEMORY_DIR=join(root,'memory');process.env.OPENCODE_CONFIG_DIR=join(root,'opencode');
process.env.MEMORY_DISABLE_PERSONA_SYNC='1';process.env.MEMORY_DISABLE_BACKGROUND_SYNC='1';
if(process.env.MEMORY_MODEL_CACHE){const cache=fs.realpathSync(process.env.MEMORY_MODEL_CACHE);assert.ok(fs.statSync(cache).isDirectory());fs.mkdirSync(join(root,'memory','storage'),{recursive:true});fs.symlinkSync(cache,join(root,'memory','storage','models'),process.platform==='win32'?'junction':'dir');}
const {writeMemory}=await load('mcp-server/memory.js');
const {getDatabase,closeDatabase}=await load('mcp-server/db/database.js');
const {updateConfig}=await load('mcp-server/config/config_manager.js');
const {migrateKnowledge,manageKnowledgeLinks:links}=await load('mcp-server/services/knowledge_links_service.js');
const {manageKnowledgeContent:content}=await load('mcp-server/services/knowledge_content_service.js');
const {manageKnowledgeRemoval:remove}=await load('mcp-server/services/knowledge_removal_service.js');
const {inspectKnowledge:inspect}=await load('mcp-server/services/knowledge_service.js');
const {embedText,unloadModels}=await load('mcp-server/ml/model_manager.js');
const nativeFetch=globalThis.fetch;let network=0,app,modelEvidence=null;
globalThis.fetch=async()=>{network++;throw new Error('Installed acceptance prohibits remote fetch');};
try {
  updateConfig({mode:'only-local',embeddingModel:'Xenova/multilingual-e5-small',executionDevice:'cpu',vectorDimension:0,rerankerEnabled:false});
  await getDatabase();await writeMemory('global',['- [2026-10-03 10:00] **Проверка пакета** — Источник и чанк доступны через общий движок. <!-- id:installed, kind:fact -->']);
  await migrateKnowledge();
  const create=async fields=>{const job=await content({action:'prepare',scopeKey:'global',operation:'create-note',fields:{indexMode:'lexical',...fields}});assert.equal(job.state,'ready');return (await content({action:'apply',scopeKey:'global',operationId:job.operationId,previewToken:job.preview.previewToken})).result.docId;};
  const docId=await create({title:'Installed lifecycle',content:'# Lifecycle\n\nInstalledoldterm.'});
  const linkInput={scopeKey:'global',operation:'create',fields:{factRef:'id:installed',docId,startLine:3,endLine:3,relationType:'SUPPORTS'}};
  const lp=await links({action:'preview',...linkInput}),link=await links({action:'apply',...linkInput,previewToken:lp.previewToken});
  assert.ok((await inspect({action:'graph',scopeKey:'global',docId})).edges.some(edge=>edge.links.some(item=>item.linkId===link.linkId)));
  const editor=await content({action:'read',scopeKey:'global',docId});
  const prepared=await content({action:'prepare',scopeKey:'global',docId,operation:'update-note',expectedVersion:editor.version,fields:{content:'# Lifecycle\n\nInstallednewterm.',indexMode:'lexical'}});
  await content({action:'apply',scopeKey:'global',operationId:prepared.operationId,previewToken:prepared.preview.previewToken});
  const input={action:'search',scopeKey:'global',query:'Installednewterm'};
  const found=await inspect(input);assert.equal(found.items[0].docId,docId);
  assert.equal((await inspect({...input,query:'Installedoldterm'})).items.length,0);
  assert.equal((await inspect({action:'links',scopeKey:'global',docId})).items[0].status,'needs_review');
  const cli=JSON.parse(execFileSync(process.execPath,[join(packageRoot,'mcp-server/cli_boot.js'),'knowledge','search','--scope-key','global','--query',input.query],{env:process.env,encoding:'utf8',timeout:30000}));assert.equal(cli.items[0].docId,docId);
  const opencode=await load('opencode-plugin/main.js'),legacy=await opencode.MemoryPlugin({directory:root,worktree:null,client:{}});
  assert.equal(JSON.parse(await legacy.tool.inspect_knowledge.execute(input)).items[0].docId,docId);
  const nativeTools=new Map();await opencode.default.setup({location:{directory:root},session:{hook:async()=>{}},tool:{transform:async run=>run({add:t=>nativeTools.set(t.name,t)})}});
  assert.equal(JSON.parse((await nativeTools.get('inspect_knowledge').execute(input)).content).items[0].docId,docId);
  const {Client}=await import(pathToFileURL(requireInstalled.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
  const {StdioClientTransport}=await import(pathToFileURL(requireInstalled.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
  const client=new Client({name:'installed-acceptance',version:'1'});
  try{await client.connect(new StdioClientTransport({command:process.execPath,args:[join(packageRoot,'mcp-server/index.js')],env:process.env,stderr:'pipe'}));
    const response=await client.callTool({name:'inspect_knowledge',arguments:input});assert.ok(!response.isError);assert.equal(JSON.parse(response.content[0].text).items[0].docId,docId);
  }finally{await client.close();}
  const removal={scopeKey:'global',operation:'unlink-scope',docId},rp=await remove({action:'preview',...removal});
  assert.equal((await remove({action:'apply',...removal,previewToken:rp.previewToken,confirm:true})).deleted,true);assert.equal((await inspect(input)).items.length,0);
  const richDoc=await create({title:'Установленный пакет: Markdown, KaTeX, Mermaid',content:'# Проверка пакета\n\n**Markdown** и формула $E=mc^2$.\n\n```mermaid\nflowchart LR\n  A[Факт] --> B[Note]\n  B --> C[Чанк]\n```'});
  const richInput={scopeKey:'global',operation:'create',fields:{factRef:'id:installed',docId:richDoc,relationType:'SUPPORTS'}};
  const richPreview=await links({action:'preview',...richInput});await links({action:'apply',...richInput,previewToken:richPreview.previewToken});
  if(process.env.MEMORY_MODEL_CACHE){
    const status=await inspect({action:'search-status',scopeKey:'global'});assert.equal(status.available,true);
    const denseJob=await content({action:'prepare',scopeKey:'global',operation:'create-note',fields:{title:'Установленный пакет: реальная модель',content:'# Semantic retrieval\n\nDense vector search finds meaning using embeddings and cosine similarity.',indexMode:'dense'}},
      {embed:async texts=>{const values=[];for(const text of texts)values.push(await embedText(text,false,status.model,null,null,null,{localOnly:true}));return values;}});
    assert.equal(denseJob.state,'ready',JSON.stringify(denseJob));const denseDoc=(await content({action:'apply',scopeKey:'global',operationId:denseJob.operationId,previewToken:denseJob.preview.previewToken})).result.docId;
    const dense=await inspect({action:'search',scopeKey:'global',query:'Find documents by meaning',searchMode:'dense'}),hit=dense.items.find(item=>item.docId===denseDoc);assert.ok(hit);assert.ok(hit.scores.cosine>0.1);assert.equal(hit.embedding.queryDimension,384);
    const chunk=await inspect({action:'chunk',scopeKey:'global',docId:denseDoc,level:hit.fragment.level,chunkId:hit.fragment.chunkId});assert.equal(chunk.vector.model,status.model);
    modelEvidence={model:status.model,dimension:384,cosine:hit.scores.cosine};
  }
  assert.equal(network,0);globalThis.fetch=nativeFetch;
  app=await (await load('mcp-server/dashboard/server.js')).startDashboard();const token=new URL(app.url).hash.slice(1),headers={Authorization:`Bearer ${token}`,Origin:app.origin};
  assert.equal((await fetch(`${app.origin}/api/knowledge?action=search&scopeKey=global&query=Markdown`,{headers})).status,200);
  assert.equal((await fetch(`${app.origin}/api/knowledge?action=search&scopeKey=global&query=Markdown`)).status,401);
  for(const asset of ['/','/knowledge.js','/knowledge_search.js','/knowledge_graph.js','/knowledge_removal.js','/content.js','/vendor/marked/marked.esm.js','/vendor/dompurify/purify.es.mjs','/vendor/katex/katex.mjs','/vendor/mermaid/mermaid.esm.min.mjs'])assert.equal((await fetch(app.origin+asset)).status,200,asset);
  const evidence={status:'PASS',packageRoot,interfaces:['npm bins','CLI','MCP stdio','OpenCode legacy','OpenCode native','HTTP','UI assets'],lifecycle:'create/link/graph/edit/fresh-search/delete',networkCalls:network,model:modelEvidence};
  console.log(JSON.stringify(evidence));
  const resultIndex=process.argv.indexOf('--result-file');if(resultIndex>=0)fs.writeFileSync(process.argv[resultIndex+1],JSON.stringify(evidence)+'\n');
  if(process.argv.includes('--serve')){console.log(app.url);await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);process.stdin.setEncoding('utf8');process.stdin.on('data',data=>{if(data.trim()==='stop')resolve();});});}
} finally {
  globalThis.fetch=nativeFetch;if(app)await app.close();await unloadModels('installed-test-complete');closeDatabase();
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));fs.rmSync(root,{recursive:true,force:true,maxRetries:5});process.stdin.pause();
}
