import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
const root=fs.mkdtempSync(join(tmpdir(),'memory-rag-ui-'));
Object.assign(process.env,{HOME:root,USERPROFILE:root,MEMORY_DIR:join(root,'memory'),CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),OPENCODE_CONFIG_DIR:join(root,'opencode'),XDG_CONFIG_HOME:join(root,'config'),MEMORY_DISABLE_PERSONA_SYNC:'1',MEMORY_DISABLE_BACKGROUND_SYNC:'1',MEMORY_DISABLE_WEB_AUTOSTART:'1'});
const {createKnowledgeFixture}=await import('../fixtures/knowledge_fixture.js');
const {migrateKnowledge}=await import('../../mcp-server/services/knowledge_links_service.js');
const {ragMaintenanceRequest}=await import('../../mcp-server/services/rag_maintenance_service.js');
const {safeGunzip}=await import('../../mcp-server/storage/blob_store.js');
const {writeMemory,readMemory}=await import('../../mcp-server/memory.js');
const {closeDatabase}=await import('../../mcp-server/db/database.js');
const {startDashboard}=await import('../../mcp-server/dashboard/server.js');
const {ingestDocument}=await import('../../mcp-server/ingest/pipeline.js');
let app;
try{
  const f=await createKnowledgeFixture();await migrateKnowledge();
  const exported=await ragMaintenanceRequest({action:'export'}),download=await ragMaintenanceRequest({action:'download',snapshotId:exported.snapshotId});
  const data=JSON.parse(safeGunzip(Buffer.from(download.data,'base64')));data.documents[0].title='<script>window.BAD=1</script> Длинное имя источника';
  const inputPath=join(root,'upload.json');fs.writeFileSync(inputPath,JSON.stringify(data));
  await ragMaintenanceRequest({action:'stage',fileName:'Проверенный импорт.json',data:Buffer.from(JSON.stringify(data)).toString('base64')});
  await ingestDocument({path:'extra.md',title:'Дополнительный источник',content:'# Extra\n\nRemove only in replace/reset.',projectScope:f.b,generateEmbeddings:false});
  app=await startDashboard();console.log(JSON.stringify({url:app.url,root,inputPath}));
  if(process.argv.includes('--serve'))await new Promise(resolveDone=>{process.stdin.resume();process.stdin.on('data',async bytes=>{
    const command=bytes.toString().trim();
    if(command==='conflict'){await writeMemory(f.a,[...(await readMemory(f.a)),`- [2026-10-05 00:00] Concurrent ${Date.now()} <!-- id:race-${Date.now()}, kind:fact -->`]);console.log('Fixture Notebook changed');}
    if(command==='readback')console.log(JSON.stringify({documents:f.db.localDb.prepare('SELECT count(*) n FROM documents').get().n,notebookCount:(await readMemory(f.a)).length,receipts:(await ragMaintenanceRequest({action:'status'})).receipts.length}));
    if(command==='stop'){process.stdin.pause();resolveDone();}
  });process.once('SIGINT',resolveDone);process.once('SIGTERM',resolveDone);});
  else console.log('PASS isolated RAG UI fixture');
}finally{if(app)await app.close();closeDatabase();if(!resolve(root).startsWith(resolve(tmpdir())))throw new Error('Unsafe fixture cleanup target');fs.rmSync(root,{recursive:true,force:true,maxRetries:5});}
