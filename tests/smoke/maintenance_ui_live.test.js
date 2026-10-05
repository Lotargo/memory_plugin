import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = fs.mkdtempSync(join(tmpdir(),'memory-maintenance-ui-'));
Object.assign(process.env,{HOME:root,USERPROFILE:root,MEMORY_DIR:join(root,'memory'),CODEX_HOME:join(root,'codex'),
  CLAUDE_CONFIG_DIR:join(root,'claude'),OPENCODE_CONFIG_DIR:join(root,'opencode'),XDG_CONFIG_HOME:join(root,'config'),
  MEMORY_DISABLE_PERSONA_SYNC:'1',MEMORY_DISABLE_BACKGROUND_SYNC:'1',MEMORY_DISABLE_WEB_AUTOSTART:'1'});
const { writeMemory, storeFilePath } = await import('../../mcp-server/memory.js');
const { migrateKnowledge } = await import('../../mcp-server/services/knowledge_links_service.js');
const { closeDatabase } = await import('../../mcp-server/db/database.js');
const { updateConfig } = await import('../../mcp-server/config/config_manager.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
let app;
try {
  await writeMemory('global',['- [2026-10-05 00:00] **Стиль** — Короткие ответы <!-- id:same, kind:fact -->']);
  await writeMemory('project-a',['- [2026-10-05 00:00] Работаем с Go <script>window.BAD=1</script> <!-- id:same, keep:1 -->']);
  await writeMemory('project-b',['- [2026-10-05 00:00] Запись другого проекта <!-- id:same, kind:fact -->']);
  await migrateKnowledge();
  fs.appendFileSync(storeFilePath('global'),'- [2026-10-05 00:00] **Legacy persona** — Коротко <!-- id:legacy, tags:persona -->\n');
  updateConfig({alpha:0.8});
  app=await startDashboard(); console.log(JSON.stringify({url:app.url,root}));
  if(process.argv.includes('--serve')) await new Promise(resolve=>{
    process.stdin.resume(); process.stdin.on('data',data=>{
      const command=data.toString().trim();
      if(command==='conflict') {updateConfig({alpha:0.7});console.log('Fixture alpha changed to 0.7');}
      if(command==='stop') {process.stdin.pause();resolve();}
    });process.once('SIGINT',resolve);process.once('SIGTERM',resolve);
  });
  else console.log('PASS isolated maintenance UI fixture');
} finally {if(app)await app.close();closeDatabase();fs.rmSync(root,{recursive:true,force:true,maxRetries:5});}
