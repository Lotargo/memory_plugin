import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
const root=fs.mkdtempSync(join(tmpdir(),'memory-diagnostics-ui-'));
Object.assign(process.env,{HOME:root,USERPROFILE:root,MEMORY_DIR:join(root,'memory'),CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),OPENCODE_CONFIG_DIR:join(root,'opencode'),XDG_CONFIG_HOME:join(root,'config'),MEMORY_DISABLE_PERSONA_SYNC:'1',MEMORY_DISABLE_BACKGROUND_SYNC:'1',MEMORY_DISABLE_WEB_AUTOSTART:'1'});
const {createKnowledgeFixture}=await import('../fixtures/knowledge_fixture.js');
const {migrateKnowledge}=await import('../../mcp-server/services/knowledge_links_service.js');
const {diagnosticsRequest}=await import('../../mcp-server/services/diagnostics_service.js');
const {saveBlob,getBlobPath}=await import('../../mcp-server/storage/blob_store.js');
const {closeDatabase}=await import('../../mcp-server/db/database.js');
const {startDashboard}=await import('../../mcp-server/dashboard/server.js');
let app;
try {
  const f=await createKnowledgeFixture();await migrateKnowledge();
  await saveBlob('Unused UI source A');await saveBlob('Unused UI source B');
  app=await startDashboard();console.log(JSON.stringify({url:app.url,root}));
  if(process.argv.includes('--serve'))await new Promise(done=>{
    process.stdin.resume();process.stdin.on('data',async bytes=>{
      const command=bytes.toString().trim();
      if(command==='conflict'){await saveBlob(`Concurrent UI source ${Date.now()}`);console.log('Fixture unused files changed');}
      if(command==='interrupt'){
        await saveBlob('Interrupted UI source A');await saveBlob('Interrupted UI source B');
        const preview=await diagnosticsRequest({action:'preview',operation:'cleanup-blobs'});
        const result=await diagnosticsRequest({action:'apply',operation:'cleanup-blobs',previewToken:preview.previewToken,confirm:true},{afterFile:()=>{throw new Error('isolated fault');}});console.log(JSON.stringify(result));
      }
      if(command==='readback')console.log(JSON.stringify({documents:f.db.localDb.prepare('SELECT count(*) n FROM documents').get().n,status:await diagnosticsRequest({action:'status'})}));
      if(command==='stop'){process.stdin.pause();done();}
    });process.once('SIGINT',done);process.once('SIGTERM',done);
  });else console.log('PASS isolated diagnostic UI fixture');
}finally{
  if(app)await app.close();closeDatabase();
  if(dirname(resolve(root))!==resolve(tmpdir())||!root.startsWith(join(tmpdir(),'memory-diagnostics-ui-')))throw new Error('Unsafe fixture cleanup target');
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5});
}
