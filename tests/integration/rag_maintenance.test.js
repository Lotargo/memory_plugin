import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const cwd=process.cwd(),root=fs.mkdtempSync(join(tmpdir(),'memory-rag-maintenance-'));
Object.assign(process.env,{HOME:root,USERPROFILE:root,MEMORY_DIR:join(root,'memory'),CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),OPENCODE_CONFIG_DIR:join(root,'opencode'),XDG_CONFIG_HOME:join(root,'config'),MEMORY_DISABLE_PERSONA_SYNC:'1',MEMORY_DISABLE_BACKGROUND_SYNC:'1',MEMORY_DISABLE_WEB_AUTOSTART:'1'});
process.chdir(root);
const {ragMaintenanceRequest:request,stageRagFile}=await import('../../mcp-server/services/rag_maintenance_service.js');
const {getConfig,updateConfig}=await import('../../mcp-server/config/config_manager.js');
const {getDatabase,closeDatabase,BLOBS_DIR}=await import('../../mcp-server/db/database.js');
const {createKnowledgeFixture}=await import('../fixtures/knowledge_fixture.js');
const {migrateKnowledge}=await import('../../mcp-server/services/knowledge_links_service.js');
const {ingestDocument}=await import('../../mcp-server/ingest/pipeline.js');
const {storeFilePath,readMemory,writeMemory}=await import('../../mcp-server/memory.js');
const {getBlobPath}=await import('../../mcp-server/storage/blob_store.js');
const {CloudSnapshots}=await import('../../mcp-server/admin/cloud_snapshots.js');
const {captureLocal,stateHash}=await import('../../mcp-server/admin/full_snapshot.js');
const {startDashboard}=await import('../../mcp-server/dashboard/server.js');
const {handleRagMaintenanceAction}=await import('../../mcp-server/cli/handlers/rag_maintenance_actions.js');
const {parseRagMaintenanceCommand}=await import('../../mcp-server/cli/rag_maintenance_commands.js');
const nativeFetch=globalThis.fetch;let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw new Error('Network forbidden in RAG engine acceptance');};
const rejects=(fn,code)=>assert.rejects(fn,error=>error.code===code);
const preview=(fields={operation:'reset'})=>request({action:'preview',...fields});
const apply=(view,hooks)=>request({action:'apply',operation:view.operation,...(view.snapshotId?{snapshotId:view.snapshotId,mode:view.mode}:{}),previewToken:view.previewToken,confirm:true},hooks);
const stage=snapshot=>request({action:'stage',fileName:'fixture.json',data:Buffer.from(JSON.stringify(snapshot)).toString('base64')});
let app;
try {
  getConfig();const f=await createKnowledgeFixture();const db=f.db,sql=db.localDb;
  await rejects(()=>preview(),'MIGRATION_REQUIRED');await migrateKnowledge();
  const readCurrent=()=>captureLocal(db,process.env.MEMORY_DIR,BLOBS_DIR,getConfig());
  const notebooks=new Map(['global',f.a,f.b].map(key=>[key,fs.readFileSync(storeFilePath(key))]));
  const before=readCurrent(),exported=await request({action:'export'});
  assert.ok(fs.existsSync(exported.outputPath));const downloaded=await request({action:'download',snapshotId:exported.snapshotId});
  const {safeGunzip}=await import('../../mcp-server/storage/blob_store.js');const source=JSON.parse(safeGunzip(Buffer.from(downloaded.data,'base64')));
  assert.equal(source.version,4);assert.equal(source.documents.length,5);assert.equal(source.notebooks,undefined);assert.equal(source.project_identities,undefined);
  assert.equal(source.embedding_settings.embeddingModel,getConfig().embeddingModel);assert.equal(stateHash(readCurrent()),stateHash(before));
  await rejects(()=>request({action:'stage',fileName:'../x.json',data:'e30='}),'INVALID');
  await rejects(()=>request({action:'status',path:'arbitrary'}),'INVALID');await rejects(()=>request({action:'__proto__'}),'INVALID');
  await rejects(()=>preview({operation:'reset',mode:'replace'}),'INVALID');
  await rejects(()=>request({action:'download',snapshotId:'../../config'}),'INVALID');
  const invalid=structuredClone(source);invalid.blobs.pop();await rejects(()=>stage(invalid),'INVALID');
  const badVector=structuredClone(source);badVector.micro_chunks[0].vector='not-base64';await rejects(()=>stage(badVector),'INVALID');
  const wrongParent=structuredClone(source);wrongParent.micro_chunks[0].doc_id=source.documents.find(row=>row.id!==wrongParent.micro_chunks[0].doc_id).id;await rejects(()=>stage(wrongParent),'INVALID');
  const duplicate=structuredClone(source);duplicate.documents.push(duplicate.documents[0]);await rejects(()=>stage(duplicate),'INVALID');
  const emptyScope=structuredClone(source);emptyScope.document_scopes=[];await rejects(()=>stage(emptyScope),'INVALID');
  const unknown=structuredClone(source);unknown.notebooks=[];await rejects(()=>stage(unknown),'INVALID');
  const orphan=structuredClone(source);orphan.knowledge_links[0].section_id='removed-section';orphan.knowledge_links[0].status='orphaned';
  const orphanId=(await stage(orphan)).snapshotId;const orphanView=await preview({operation:'import',snapshotId:orphanId,mode:'merge'});assert.ok(orphanView.canApply,'declared orphaned source links remain reviewable');
  const collision=structuredClone(source),collisionLink=collision.knowledge_links.find(link=>link.fact_key===f.a);collisionLink.fact_id='same';collisionLink.fact_key=f.a.replace('/a','_a');
  collision.document_scopes.push({doc_id:collisionLink.doc_id,scope_key:collisionLink.fact_key,created_at:Date.now()});
  const collisionId=(await stage(collision)).snapshotId,collisionView=await preview({operation:'import',snapshotId:collisionId,mode:'merge'});assert.ok(collisionView.linkReviews.some(row=>row.linkId===collisionLink.id&&row.reason==='missing-or-different-notebook-fact'),'a colliding slug must verify the Notebook key header');
  const independent=structuredClone(source);independent.graph_edges.push({source_id:'fact:global:id:global',target_id:f.global,relation_type:'MANUAL_FOREIGN',metadata_json:null,created_at:Date.now()});
  const independentId=(await stage(independent)).snapshotId;await rejects(()=>preview({operation:'import',snapshotId:independentId,mode:'merge'}),'UNSUPPORTED');
  const legacy=structuredClone(source);legacy.version=2;delete legacy.document_scopes;delete legacy.embedding_settings;delete legacy.knowledge_scope_revisions;
  for(const doc of legacy.documents)for(const key of ['revision','content_revision','index_revision'])delete doc[key];
  for(const link of legacy.knowledge_links)for(const key of ['fact_id','revision','status','source_revision'])delete link[key];
  const legacyId=(await stage(legacy)).snapshotId,legacyView=await preview({operation:'import',snapshotId:legacyId,mode:'replace'});assert.ok(legacyView.incomingDocuments.every(doc=>doc.scopes.includes('global')));
  const staged=await stage(source),target={operation:'import',snapshotId:staged.snapshotId,mode:'merge'};
  const view=await preview(target);assert.equal(stateHash(readCurrent()),stateHash(before));
  await rejects(async()=>request({action:'apply',operation:'reset',previewToken:(await preview()).previewToken}),'CONFIRMATION');
  // Merge replaces whole document hierarchies, while preserving other docs.
  await ingestDocument({path:'global.md',title:'New source',content:'# New\n\nNewsearchterm.\n\n## Extra\n\nOld stale children must disappear.',projectScope:'global',generateEmbeddings:false});
  await rejects(()=>apply(view),'CONFLICT');
  const extra=await ingestDocument({path:'extra.md',title:'Keep extra',content:'# Extra\n\nKeep this document.',projectScope:f.b,generateEmbeddings:false});
  const fresh=await preview(target),saved=await apply(fresh);
  assert.equal(saved.status,'saved');assert.ok(fs.existsSync(saved.backup));assert.equal(saved.notebookChanged,false);
  assert.deepEqual(sql.prepare('SELECT id FROM sections WHERE doc_id=? ORDER BY id').all(f.global).map(row=>row.id),source.sections.filter(row=>row.doc_id===f.global).map(row=>row.id).sort());
  assert.equal(sql.prepare('SELECT 1 FROM documents WHERE id=?').get(extra.docId)[1],1);
  assert.equal(sql.prepare("SELECT count(*) n FROM micro_chunks_fts WHERE micro_chunks_fts MATCH 'Newsearchterm'").get().n,0);
  assert.equal(sql.prepare('SELECT count(*) n FROM micro_chunks_fts').get().n,sql.prepare('SELECT count(*) n FROM micro_chunks').get().n);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
  for(const [key,bytes]of notebooks)assert.deepEqual(fs.readFileSync(storeFilePath(key)),bytes);
  assert.deepEqual(await request({action:'receipt',operationId:saved.operationId}),saved);
  // Foreign/mismatched stable IDs never become a valid link on this machine.
  const foreign=structuredClone(source);foreign.knowledge_links[0].fact_id='same';foreign.knowledge_links[0].fact_text='Foreign body';foreign.knowledge_links[0].status='valid';foreign.knowledge_links[0].source_revision=1;
  const foreignId=(await stage(foreign)).snapshotId,foreignView=await preview({operation:'import',snapshotId:foreignId,mode:'merge'});
  assert.ok(foreignView.linkReviews.some(row=>row.reason==='missing-or-different-notebook-fact'));
  await apply(foreignView);const foreignLink=sql.prepare('SELECT * FROM knowledge_links WHERE id=?').get(foreign.knowledge_links[0].id);assert.equal(foreignLink.fact_id,null);assert.equal(foreignLink.status,'needs_review');
  // Unknown/different embedding model clears imported vectors; no model load.
  const vectorSource=structuredClone(source);vectorSource.embedding_settings={embeddingModel:'different/model',vectorDimension:2};vectorSource.micro_chunks[0].vector=Buffer.from(new Float32Array([1,2]).buffer).toString('base64');
  const vectorId=(await stage(vectorSource)).snapshotId,vectorView=await preview({operation:'import',snapshotId:vectorId,mode:'replace'});assert.equal(vectorView.vectorsCleared,1);assert.ok(vectorView.documents.some(row=>row.id===extra.docId&&row.effect==='removed'));
  const vectorSaved=await apply(vectorView);assert.equal(vectorSaved.reindexRequired,true);assert.equal(sql.prepare('SELECT length(vector) n FROM micro_chunks WHERE id=?').get(vectorSource.micro_chunks[0].id).n,0);
  assert.equal(JSON.parse(sql.prepare('SELECT metadata_json FROM documents WHERE id=?').get(vectorSource.micro_chunks[0].doc_id).metadata_json).index_state,'lexical-only');
  const compatible=structuredClone(source),dimension=getConfig().vectorDimension||2,compatibleVector=new Float32Array(dimension);compatibleVector[0]=1;
  compatible.micro_chunks[0].vector=Buffer.from(compatibleVector.buffer).toString('base64');
  const compatibleDoc=compatible.documents.find(doc=>doc.id===compatible.micro_chunks[0].doc_id),meta=JSON.parse(compatibleDoc.metadata_json||'{}');
  meta.embedding_provenance={model:getConfig().embeddingModel,dimension};meta.index_state='dense';compatibleDoc.metadata_json=JSON.stringify(meta);
  const compatibleId=(await stage(compatible)).snapshotId,compatibleView=await preview({operation:'import',snapshotId:compatibleId,mode:'replace'});assert.equal(compatibleView.vectorsCleared,0);await apply(compatibleView);
  assert.equal(sql.prepare('SELECT length(vector) n FROM micro_chunks WHERE id=?').get(compatible.micro_chunks[0].id).n,dimension*4);
  // Corrupt staged bytes and missing local blobs abort before publication.
  const frozen=await preview(target),bytes=fs.readFileSync(staged.outputPath);fs.appendFileSync(staged.outputPath,'tamper');await rejects(()=>apply(frozen),'RECOVERY_REQUIRED');fs.writeFileSync(staged.outputPath,bytes);
  const blobPath=getBlobPath(source.documents[0].blob_hash),blobBytes=fs.readFileSync(blobPath);fs.unlinkSync(blobPath);await assert.rejects(()=>preview());fs.writeFileSync(blobPath,blobBytes);
  const stale=await preview();await writeMemory(f.a,[...(await readMemory(f.a)),'- [2026-10-05 00:00] Concurrent fact <!-- id:concurrent, kind:fact -->']);await rejects(()=>apply(stale),'CONFLICT');
  const race=await preview();await rejects(()=>apply(race,{afterBackup:()=>updateConfig({embeddingModel:'new/model'})}),'CONFLICT');updateConfig({embeddingModel:source.embedding_settings.embeddingModel});
  // Fault before COMMIT rolls back all tables/FTS and creates no saved receipt.
  const rolled=readCurrent(),receiptCount=(await request({action:'status'})).receipts.length;
  await assert.rejects(async()=>apply(await preview(),{beforeCommit:()=>{throw new Error('before commit');}}));
  assert.equal(stateHash(readCurrent()),stateHash(rolled));assert.equal((await request({action:'status'})).receipts.length,receiptCount);
  // Real process exit after COMMIT: reopen reads committed receipt and data.
  const crashView=await preview(),moduleUrl=new URL('../../mcp-server/services/rag_maintenance_service.js',import.meta.url).href;
  const crash=spawnSync(process.execPath,['--input-type=module','-e',`const {ragMaintenanceRequest}=await import(${JSON.stringify(moduleUrl)});await ragMaintenanceRequest(${JSON.stringify({action:'apply',operation:'reset',previewToken:crashView.previewToken,confirm:true})},{afterCommit:()=>process.exit(73)});`],{cwd:root,env:process.env,encoding:'utf8'});
  assert.equal(crash.status,73,crash.stderr);assert.equal(sql.prepare('SELECT count(*) n FROM documents').get().n,0);assert.equal(sql.prepare('SELECT count(*) n FROM micro_chunks_fts').get().n,0);
  const crashedReceipt=(await request({action:'status'})).receipts[0];assert.equal(crashedReceipt.operation,'reset');assert.equal(crashedReceipt.status,'saved');assert.ok(fs.existsSync(crashedReceipt.backup));
  const resetAgain=await preview();assert.equal(resetAgain.changed,false,'repeat reset preserves deletion history');assert.equal((await apply(resetAgain)).status,'unchanged');
  assert.ok(fs.existsSync(blobPath),'reset preserves physical CAS files');assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(sql.prepare('SELECT count(*) n FROM project_identities').get().n,2);
  const backups=new CloudSnapshots(),restore=await backups.restore({id:crashedReceipt.backupId});await backups.restore({id:crashedReceipt.backupId,confirmToken:restore.confirmToken});assert.equal(sql.prepare('SELECT count(*) n FROM documents').get().n,5);
  // TUI cancellation and stale edits use the same service.
  const ui={clear(){},log(){},waitForEnter:async()=>{},promptText:async()=> 'n'};const tuiBefore=stateHash(readCurrent());await handleRagMaintenanceAction('hard_reset',ui);assert.equal(stateHash(readCurrent()),tuiBefore);
  const logs=[];await handleRagMaintenanceAction('hard_reset',{...ui,log:text=>logs.push(text),promptText:async()=>{updateConfig({embeddingModel:'tui/race'});return 'y';}});assert.ok(logs.some(text=>text.includes('CONFLICT')));updateConfig({embeddingModel:source.embedding_settings.embeddingModel});
  // Strict CLI routing and frozen local paths.
  assert.throws(()=>parseRagMaintenanceCommand(['preview','--operation','reset','--operation','reset']));
  const inputFile=join(root,'input.json');fs.writeFileSync(inputFile,JSON.stringify(source));const fileStage=await stageRagFile(inputFile);assert.ok(fileStage.snapshotId);
  const tools=new Map(),{registerRagTools}=await import('../../mcp-server/tools/rag_tools.js');registerRagTools({registerTool:(name,schema,call)=>tools.set(name,{schema,call})});
  const manage=tools.get('manage_knowledge_base').call,mcp=async args=>JSON.parse((await manage(args)).content[0].text);
  assert.equal((await mcp({action:'rag_status'})).scope,'all-local-rag');
  const mcpView=await mcp({action:'reset_rag'});assert.equal(mcpView.changed,true);
  await rejects(()=>mcp({action:'reset_rag',previewToken:mcpView.previewToken}),'CONFIRMATION');
  const mcpSaved=await mcp({action:'reset_rag',previewToken:mcpView.previewToken,confirm:true});assert.equal(mcpSaved.status,'saved');
  const importView=await mcp({action:'import_snapshot',snapshotId:fileStage.snapshotId,importMode:'replace'});
  await mcp({action:'import_snapshot',snapshotId:fileStage.snapshotId,importMode:'replace',previewToken:importView.previewToken,confirm:true});
  assert.equal((await mcp({action:'rag_receipt',operationId:mcpSaved.operationId})).operationId,mcpSaved.operationId);
  await assert.rejects(()=>mcp({action:'reset_rag',scope:'global'}));
  const {MemoryPlugin}=await import('../../opencode-plugin/main.js'),plugin=await MemoryPlugin({directory:root,worktree:null,client:{}}),nativeTools=new Map();
  await (await import('../../opencode-plugin/main.js')).default.setup({location:{directory:root},session:{hook:async()=>{}},tool:{transform:async run=>run({add:tool=>nativeTools.set(tool.name,tool)})}});
  const v1=args=>plugin.tool.manage_knowledge_base.execute(args,{}),v2=async args=>(await nativeTools.get('manage_knowledge_base').execute(args)).content;
  for(const run of [v1,v2]) {
    assert.equal(JSON.parse(await run({action:'rag_status'})).scope,'all-local-rag');
    const p=JSON.parse(await run({action:'reset_rag'}));await rejects(()=>run({action:'reset_rag',previewToken:p.previewToken}),'CONFIRMATION');
    assert.equal(JSON.parse(await run({action:'reset_rag',previewToken:p.previewToken,confirm:true})).status,'saved');
    const imported=JSON.parse(await run({action:'import_snapshot',snapshotId:fileStage.snapshotId,importMode:'replace'}));
    assert.equal(JSON.parse(await run({action:'import_snapshot',snapshotId:fileStage.snapshotId,importMode:'replace',previewToken:imported.previewToken,confirm:true})).status,'saved');
  }
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client=new Client({name:'rag-maintenance-acceptance',version:'1.0.0'});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve(cwd,'mcp-server/index.js')],env:process.env,stderr:'pipe'}));
    const schema=(await client.listTools()).tools.find(tool=>tool.name==='manage_knowledge_base').inputSchema;assert.ok(schema.properties.snapshotId);assert.ok(schema.properties.confirm);
    const p=await client.callTool({name:'manage_knowledge_base',arguments:{action:'reset_rag'}});assert.ok(!p.isError);const parsed=JSON.parse(p.content[0].text);
    assert.equal((await client.callTool({name:'manage_knowledge_base',arguments:{action:'reset_rag',previewToken:parsed.previewToken}})).isError,true);
    const saved=await client.callTool({name:'manage_knowledge_base',arguments:{action:'reset_rag',previewToken:parsed.previewToken,confirm:true}});assert.ok(!saved.isError);assert.equal(JSON.parse(saved.content[0].text).status,'saved');
    const restored=await preview({operation:'import',snapshotId:fileStage.snapshotId,mode:'replace'});await apply(restored);
  }finally{await client.close();}
  for(const entry of ['cli_boot.js','boot.js','index.js']){const child=spawnSync(process.execPath,[resolve(cwd,'mcp-server',entry),'rag-maintenance','status'],{cwd:root,env:process.env,encoding:'utf8'});assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).scope,'all-local-rag');}
  // Authenticated HTTP, same-origin mutations, no arbitrary path.
  assert.equal(networkCalls,0);globalThis.fetch=nativeFetch;
  app=await startDashboard();const token=app.url.split('#')[1],headers={Authorization:`Bearer ${token}`,Origin:app.origin,'Content-Type':'application/json'};
  assert.equal((await fetch(`${app.origin}/api/rag-maintenance`)).status,401);
  assert.equal((await fetch(`${app.origin}/api/rag-maintenance`,{method:'POST',headers:{...headers,Origin:'https://foreign.test'},body:JSON.stringify({action:'export'})})).status,403);
  assert.equal((await fetch(`${app.origin}/api/rag-maintenance?path=x`,{headers})).status,400);
  assert.equal((await fetch(`${app.origin}/api/rag-maintenance`,{method:'POST',headers,body:JSON.stringify({action:'stage',sourcePath:inputFile})})).status,400);
  const statusResponse=await fetch(`${app.origin}/api/rag-maintenance`,{headers}),cookie=statusResponse.headers.get('set-cookie');assert.match(cookie,/HttpOnly; SameSite=Strict/);
  const downloadResponse=await fetch(`${app.origin}/api/rag-maintenance/download?snapshotId=${fileStage.snapshotId}`,{headers:{Cookie:cookie.split(';')[0]}});
  assert.equal(downloadResponse.status,200);assert.match(downloadResponse.headers.get('content-disposition'),/^attachment/);assert.equal(JSON.parse(safeGunzip(Buffer.from(await downloadResponse.arrayBuffer()))).version,4);
  assert.equal((await fetch(`${app.origin}/api/rag-maintenance/download?snapshotId=${fileStage.snapshotId}`)).status,401);
  assert.equal((await fetch(`${app.origin}/api/rag-maintenance/download?snapshotId=${fileStage.snapshotId}&snapshotId=${fileStage.snapshotId}`,{headers})).status,400);
  const httpPreview=await (await fetch(`${app.origin}/api/rag-maintenance`,{method:'POST',headers,body:JSON.stringify({action:'preview',operation:'reset'})})).json();assert.equal(httpPreview.scope,'all-local-rag');
  console.log('PASS RAG maintenance: merge/replace/reset, scopes/links/FTS/vectors/provenance, staging, backup, CAS, real process exit/receipt/restore, CLI/TUI/MCP stdio/OpenCode V1/V2/HTTP, zero engine network');
}finally{globalThis.fetch=nativeFetch;if(app)await app.close();closeDatabase();process.chdir(cwd);assert.ok(resolve(root).startsWith(resolve(tmpdir())));fs.rmSync(root,{recursive:true,force:true,maxRetries:5});}
