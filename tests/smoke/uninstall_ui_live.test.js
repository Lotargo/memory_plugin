import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
const root=fs.mkdtempSync(join(tmpdir(),'memory-uninstall-ui-'));
Object.assign(process.env,{HOME:root,USERPROFILE:root,MEMORY_DIR:join(root,'memory'),CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),OPENCODE_CONFIG_DIR:join(root,'opencode'),XDG_CONFIG_HOME:join(root,'config'),MEMORY_DISABLE_PERSONA_SYNC:'1',MEMORY_DISABLE_BACKGROUND_SYNC:'1',MEMORY_DISABLE_WEB_AUTOSTART:'1'});
const {createKnowledgeFixture}=await import('../fixtures/knowledge_fixture.js');
const {closeDatabase}=await import('../../mcp-server/db/database.js');
const {startDashboard}=await import('../../mcp-server/dashboard/server.js');
const {resolveClientPaths}=await import('../../mcp-server/client_paths.js');
const {buildCodexMemoryAgentSection}=await import('../../mcp-server/codex_config.js');
const {uninstallRequest}=await import('../../mcp-server/services/uninstall_service.js');
const {PROMPT_BLOCK}=await import('../../mcp-server/prompt_manager.js');
const paths=resolveClientPaths();
const write=(file,text)=>{fs.mkdirSync(dirname(file),{recursive:true});fs.writeFileSync(file,text);};
const owned={command:'npx',args:['-y','@lotargo/memory_plugin'],env:{API_SECRET:'UI_SECRET_NOT_FOR_BROWSER'}};
let app;
try {
  const f=await createKnowledgeFixture();
  write(paths.opencodeConfigPath,JSON.stringify({plugin:['@lotargo/memory_plugin','@vendor/preserve'],mcpServers:{foreign:{command:'keep'}}}));
  write(paths.geminiSettingsPath,JSON.stringify({mcpServers:{'memory-agent':owned,foreign:{command:'keep'}}}));
  write(paths.geminiPromptPath,`# User instructions\n\n${PROMPT_BLOCK}\n`);
  fs.cpSync(new URL('../../skills/using-memory',import.meta.url),join(paths.geminiSkillsDir,'using-memory'),{recursive:true});
  write(paths.codexConfigPath,`${buildCodexMemoryAgentSection({nodePath:process.execPath,bootPath:resolve('mcp-server/boot.js')})}\n[plugins."memory@lotargo-memory-local"]\nenabled = true\n`);
  app=await startDashboard();console.log(JSON.stringify({url:app.url,root}));
  if(process.argv.includes('--serve'))await new Promise(done=>{
    process.stdin.resume();process.stdin.on('data',async bytes=>{
      const command=bytes.toString().trim();
      if(command==='conflict'){fs.appendFileSync(paths.geminiSettingsPath,' ');console.log('Fixture client config changed');}
      if(command==='interrupt'){
        const p=await uninstallRequest({action:'preview',client:'gemini',operation:'uninstall'});
        const result=await uninstallRequest({action:'apply',client:'gemini',operation:'uninstall',previewToken:p.previewToken,confirm:true},{afterFile:()=>{throw new Error('fixture fault');}});
        console.log(JSON.stringify(result));
      }
      if(command==='readback')console.log(JSON.stringify({documents:f.db.localDb.prepare('SELECT count(*) n FROM documents').get().n,
        registration:!!JSON.parse(fs.readFileSync(paths.geminiSettingsPath)).mcpServers['memory-agent'],
        foreign:JSON.parse(fs.readFileSync(paths.geminiSettingsPath)).mcpServers.foreign.command,
        prompt:fs.readFileSync(paths.geminiPromptPath,'utf8').startsWith('# User instructions'),status:await uninstallRequest({action:'status'})}));
      if(command==='stop'){process.stdin.pause();done();}
    });process.once('SIGINT',done);process.once('SIGTERM',done);
  });else console.log('PASS isolated uninstall browser fixture');
}finally{
  if(app)await app.close();closeDatabase();
  if(dirname(resolve(root))!==resolve(tmpdir())||!root.startsWith(join(tmpdir(),'memory-uninstall-ui-')))throw new Error('Unsafe fixture cleanup target');
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5});
}
