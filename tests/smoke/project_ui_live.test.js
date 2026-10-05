// Isolated fixture for manual browser acceptance; no user memory is opened.
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const root=fs.mkdtempSync(join(tmpdir(),'memory-project-ui-'));
process.env.MEMORY_DIR=join(root,'memory');process.env.OPENCODE_CONFIG_DIR=join(root,'opencode');
process.env.MEMORY_DISABLE_PERSONA_SYNC='1';process.env.MEMORY_DISABLE_BACKGROUND_SYNC='1';
const memory=await import('../../mcp-server/memory.js');
const {getDatabase,closeDatabase}=await import('../../mcp-server/db/database.js');
const {projectRequest}=await import('../../mcp-server/services/project_service.js');
const {upsertIdentity,registerAlias}=await import('../../mcp-server/identity.js');
const {startDashboard}=await import('../../mcp-server/dashboard/server.js');
const {ingestDocument}=await import('../../mcp-server/ingest/pipeline.js');
const {migrateKnowledge,manageKnowledgeLinks}=await import('../../mcp-server/services/knowledge_links_service.js');
let app;
try {
  const a='git:example.test/ui/a',b='git:example.test/ui/b',c='git:example.test/ui/c';
  const db=await getDatabase();
  for(const [key,name] of [[a,'Проект A'],[b,'Проект B'],[c,'Проект C']])await upsertIdentity(db,{key,name,primaryRemote:key.slice(4)});
  await memory.writeMemory(a,['- [2026-10-04 10:00] **Правило A** — Хранить исходные данные <!-- id:same, kind:directive, keep:1 -->']);
  await memory.writeMemory(b,['- [2026-10-04 10:00] **Факт B** — Данные проекта B <!-- id:same, kind:fact -->']);
  await memory.writeMemory(c,['- [2026-10-04 10:00] **Конфликт** — Данные проекта B <!-- id:another, kind:directive -->']);
  await memory.writeMemory('legacy-ui',['- [2026-10-04 10:00] **Legacy** — Старая заметка <!-- id:old, kind:fact -->']);
  const missing=join(root,'unavailable-project-a');await registerAlias(db,{alias:'path:'+memory.canonicalPath(missing),identityKey:a,kind:'path'});
  const repo=join(root,'git-ui');fs.mkdirSync(repo);execFileSync('git',['init',repo],{stdio:'pipe'});execFileSync('git',['-C',repo,'remote','add','origin','https://example.test/ui/git-ui.git']);
  const doc=await ingestDocument({path:'ui-source.md',title:'Источник A',content:'# Доказательство\n\nДанные для связи.',projectScope:a,generateEmbeddings:false});
  await migrateKnowledge();
  const input={operation:'create',scopeKey:a,fields:{factRef:'id:same',docId:doc.docId,relationType:'SUPPORTS'}};
  const p=await manageKnowledgeLinks({...input,action:'preview'});await manageKnowledgeLinks({...input,action:'apply',previewToken:p.previewToken});
  app=await startDashboard();
  console.log(JSON.stringify({url:app.url,root,repo,missing,source:a,target:b,conflict:c,legacy:'legacy-ui'}));
  if(process.argv.includes('--serve'))await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  else {await projectRequest({action:'list'});console.log('PASS isolated project UI fixture');}
}finally{if(app)await app.close();closeDatabase();fs.rmSync(root,{recursive:true,force:true,maxRetries:5});}
