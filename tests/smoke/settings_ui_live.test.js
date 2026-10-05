// Isolated real-engine browser fixture; never opens the user's memory.
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=fs.mkdtempSync(join(tmpdir(),'memory-settings-ui-'));
process.env.MEMORY_DIR=join(root,'memory');process.env.OPENCODE_CONFIG_DIR=join(root,'opencode');
process.env.MEMORY_WEB_STARTUP_DIR=join(root,'startup');process.env.MEMORY_DISABLE_BACKGROUND_SYNC='1';process.env.MEMORY_DISABLE_PERSONA_SYNC='1';process.env.MEMORY_DISABLE_WEB_AUTOSTART='1';
const {writeMemory}=await import('../../mcp-server/memory.js');
const {closeDatabase}=await import('../../mcp-server/db/database.js');
const {startDashboard}=await import('../../mcp-server/dashboard/server.js');
let app;
try {
  await writeMemory('global',['- [2026-10-04 10:00] **UI fixture** — Settings test <!-- id:test, kind:fact -->']);
  app=await startDashboard();console.log(JSON.stringify({url:app.url,root}));
  await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
}finally{if(app)await app.close();closeDatabase();fs.rmSync(root,{recursive:true,force:true,maxRetries:5});}
