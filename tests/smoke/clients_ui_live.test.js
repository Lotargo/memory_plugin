import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, delimiter } from 'node:path';
const root = fs.mkdtempSync(join(tmpdir(),'memory-clients-ui-')), bin = join(root,'bin'); fs.mkdirSync(bin);
Object.assign(process.env,{ HOME:root,USERPROFILE:root,MEMORY_DIR:join(root,'memory'),CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),OPENCODE_CONFIG_DIR:join(root,'opencode'),XDG_CONFIG_HOME:join(root,'config'),MEMORY_DISABLE_PERSONA_SYNC:'1',MEMORY_DISABLE_BACKGROUND_SYNC:'1',MEMORY_DISABLE_WEB_AUTOSTART:'1',MEMORY_PLUGIN_DISABLE_NATIVE_CLI:'0',PATH:`${bin}${delimiter}${process.env.PATH}` });
const { createKnowledgeFixture } = await import('../fixtures/knowledge_fixture.js');
const { closeDatabase } = await import('../../mcp-server/db/database.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
const { resolveClientPaths } = await import('../../mcp-server/client_paths.js');
const { buildCodexMemoryAgentSection } = await import('../../mcp-server/codex_config.js');
const paths=resolveClientPaths();
const write=(file,text)=>{fs.mkdirSync(dirname(file),{recursive:true});fs.writeFileSync(file,text);};
write(paths.opencodeConfigPath,JSON.stringify({plugin:['@lotargo/memory_plugin']}));
write(paths.codexConfigPath,buildCodexMemoryAgentSection({nodePath:process.execPath,bootPath:resolve('mcp-server/boot.js')}));
write(paths.claudeConfigPath,'{ corrupt CLIENT_UI_SECRET_DO_NOT_RETURN');
write(paths.geminiSettingsPath,JSON.stringify({mcpServers:{'memory-agent':{command:'foreign',env:{token:'CLIENT_UI_SECRET_DO_NOT_RETURN'}}}}));
const cli=join(bin,process.platform==='win32'?'codex.cmd':'codex');
write(cli,process.platform==='win32'?'@echo off\r\necho CLIENT_UI_SECRET_DO_NOT_RETURN codex 1.2.3\r\n':'#!/bin/sh\necho CLIENT_UI_SECRET_DO_NOT_RETURN codex 1.2.3\n');if(process.platform!=='win32')fs.chmodSync(cli,0o755);
let app;
try {
  const fixture=await createKnowledgeFixture();app=await startDashboard();console.log(JSON.stringify({url:app.url,root}));
  if(process.argv.includes('--serve'))await new Promise(done=>{
    process.stdin.resume();process.stdin.on('data',bytes=>{
      const command=bytes.toString().trim();
      if(command==='conflict'){fs.appendFileSync(paths.codexConfigPath,'\n# fixture update');console.log('Fixture configuration changed');}
      if(command==='timeout'){
        const sleeper=join(root,'sleep.cjs');write(sleeper,'setInterval(()=>{},1000)');
        write(cli,process.platform==='win32'?`@echo off\r\n"${process.execPath}" "${sleeper}"\r\n`:`#!/bin/sh\n"${process.execPath}" "${sleeper}"\n`);
        console.log('Fixture CLI will time out');
      }
      if(command==='readback')console.log(JSON.stringify({documents:fixture.db.localDb.prepare('SELECT count(*) n FROM documents').get().n,codexDirect:fs.readFileSync(paths.codexConfigPath,'utf8').includes('[mcp_servers.memory-agent]')}));
      if(command==='stop'){process.stdin.pause();done();}
    });process.once('SIGINT',done);process.once('SIGTERM',done);
  });else console.log('PASS isolated clients browser fixture');
}finally{
  if(app)await app.close();closeDatabase();
  if(dirname(resolve(root))!==resolve(tmpdir())||!root.startsWith(join(tmpdir(),'memory-clients-ui-')))throw new Error('Unsafe fixture cleanup');
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5});
}
