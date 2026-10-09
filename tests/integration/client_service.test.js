import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = fs.mkdtempSync(join(tmpdir(),'memory-client-service-'));
const bin = join(root,'bin'), cwd = join(root,'workspace'); fs.mkdirSync(bin); fs.mkdirSync(cwd);
Object.assign(process.env, { HOME: root, USERPROFILE: root, MEMORY_DIR: join(root,'memory'), CODEX_HOME: join(root,'codex'), CLAUDE_CONFIG_DIR: join(root,'claude'), OPENCODE_CONFIG_DIR: join(root,'opencode'), XDG_CONFIG_HOME: join(root,'config'),
  MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_DISABLE_WEB_AUTOSTART: '1', MEMORY_PLUGIN_DISABLE_NATIVE_CLI: '0', PATH: `${bin}${delimiter}${process.env.PATH}` });
const { clientRequest } = await import('../../mcp-server/services/client_service.js');
const { boundedProcess } = await import('../../mcp-server/client_probe.js');
const { resolveClientPaths } = await import('../../mcp-server/client_paths.js');
const { buildCodexMemoryAgentSection } = await import('../../mcp-server/codex_config.js');
const { handleClientAction } = await import('../../mcp-server/cli/handlers/client_actions.js');
const { parseClientCommand } = await import('../../mcp-server/cli/client_commands.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
const { closeDatabase } = await import('../../mcp-server/db/database.js');
const paths = resolveClientPaths({ cwd }), opts = { paths, cwd, env: process.env };
const write = (file,text) => { fs.mkdirSync(dirname(file),{ recursive: true }); fs.writeFileSync(file,text); };
const json = (file,value) => write(file,JSON.stringify(value));
const status = async client => (await clientRequest({ action: 'status', client },opts)).items[0];
const probe = async (client,operation,options = opts) => { const item = (await clientRequest({action:'status',client},options)).items[0]; return clientRequest({ action: 'probe', client, operation, expectedVersion: item.version },options); };
const owned = { command: 'npx', args: ['-y','@lotargo/memory_plugin'], env: { API_KEY: 'CLIENT_SECRET_NEVER_RETURN' } };
const cli = join(bin,process.platform === 'win32' ? 'codex.cmd' : 'codex');
const log = join(root,'calls.log'); process.env.CLIENT_LOG = log;
write(cli,process.platform === 'win32' ? '@echo off\r\necho call>>"%CLIENT_LOG%"\r\necho secret CLIENT_SECRET_NEVER_RETURN codex 1.2.3\r\n' : '#!/bin/sh\necho call >> "$CLIENT_LOG"\necho secret CLIENT_SECRET_NEVER_RETURN codex 1.2.3\n');
if(process.platform!=='win32')fs.chmodSync(cli,0o755);
let app;
try {
  json(paths.opencodeConfigPath,{plugin:['@lotargo/memory_plugin']});
  write(paths.codexConfigPath,buildCodexMemoryAgentSection({nodePath:process.execPath,bootPath:resolve('mcp-server/boot.js')}));
  json(paths.claudeConfigPath,{mcpServers:{'memory-agent':owned}});
  json(paths.geminiSettingsPath,{mcpServers:{'memory-agent':{command:'foreign-tool',env:{token:'CLIENT_SECRET_NEVER_RETURN'}}}});
  const before = fs.readFileSync(paths.codexConfigPath), initial = await clientRequest({action:'status'},opts);
  assert.equal(initial.items.length,5); assert.equal(initial.items.find(x=>x.client==='opencode').channel.mode,'native-plugin');
  assert.equal(initial.items.find(x=>x.client==='gemini').status,'foreign');
  assert.equal(fs.existsSync(log),false,'status launched a client'); assert.equal(fs.existsSync(process.env.MEMORY_DIR),false,'status created memory storage');
  assert.ok(!JSON.stringify(initial).includes('CLIENT_SECRET_NEVER_RETURN'));
  assert.deepEqual(fs.readFileSync(paths.codexConfigPath),before);
  // Claude receives the personality through a selected output style, not a CLAUDE.md block.
  assert.equal((await status('claude')).components.prompt.persona,false);
  const styleFile = join(paths.claudeDir,'output-styles','memory-persona.md'), settingsFile = join(paths.claudeDir,'settings.json');
  write(styleFile,'---\nname: memory-persona\n---\n'); json(settingsFile,{outputStyle:'other'});
  assert.equal((await status('claude')).components.prompt.persona,false,'unselected style must not count');
  json(settingsFile,{outputStyle:'memory-persona'});
  assert.equal((await status('claude')).components.prompt.persona,true,'selected output style must count');
  fs.rmSync(join(paths.claudeDir,'output-styles'),{recursive:true}); fs.rmSync(settingsFile);
  const version =await probe('codex','version'); assert.equal(version.status,'passed',JSON.stringify(version)); assert.equal(version.cliVersion,'1.2.3'); assert.ok(!JSON.stringify(version).includes('CLIENT_SECRET'));
  const direct = await probe('codex','doctor'); assert.equal(direct.status,'passed',JSON.stringify(direct)); assert.ok(direct.toolCount>=22); assert.equal(direct.activeSession,'not-observed');
  assert.equal(fs.existsSync(join(process.env.MEMORY_DIR,'control')),false,'doctor started the model command channel');
  write(paths.codexConfigPath,`${before}\nenabled = false\n`);assert.equal((await status('codex')).channel.mode,'disabled');assert.equal((await probe('codex','doctor')).status,'unavailable');
  write(paths.codexConfigPath,`${before}\n${before}\n`);assert.equal((await status('codex')).status,'conflict');
  write(paths.codexConfigPath,before);
  const stale = await status('codex'); fs.appendFileSync(paths.codexConfigPath,'\n# changed');
  await assert.rejects(clientRequest({action:'probe',client:'codex',operation:'version',expectedVersion:stale.version},opts),{code:'CONFLICT'});
  assert.equal((await status('codex')).lastProbe.stale,true);
  write(paths.codexConfigPath,`${before}\n[plugins."memory@lotargo-memory-local"]\nenabled = true\n`);
  assert.equal((await status('codex')).channel.conflict,true); assert.equal((await probe('codex','doctor')).status,'unavailable');
  write(paths.codexConfigPath,before);
  write(join(cwd,'.codex','config.toml'),buildCodexMemoryAgentSection({nodePath:process.execPath,bootPath:resolve('mcp-server/boot.js')}));
  assert.equal((await status('codex')).channel.project,true); assert.equal((await probe('codex','doctor')).code,'UNSUPPORTED_LAUNCHER');
  fs.unlinkSync(join(cwd,'.codex','config.toml'));
  // Both marketplace clients use the actual packaged adapter and this runtime.
  const adapter = join(root,'adapter');
  write(join(adapter,'scripts','entry.cjs'),fs.readFileSync(resolve('mcp-server/marketplace_entry.cjs')));
  const pkg=JSON.parse(fs.readFileSync(resolve('package.json'),'utf8'));
  const listed = join(root,'native-list.cjs');
  for(const client of ['codex','claude']) {
    json(join(adapter,'runtime.json'),{schema:1,client,runtime:resolve('.'),memoryDir:process.env.MEMORY_DIR,version:pkg.version});
    if(client==='codex')write(paths.codexConfigPath,'[plugins."memory@lotargo-memory-local"]\nenabled = true\n');
    else { json(paths.claudeConfigPath,{});json(join(paths.claudeDir,'settings.json'),{enabledPlugins:{'memory@lotargo-memory-local':true}}); }
    write(listed,`console.log(${JSON.stringify(JSON.stringify(client==='codex'?{installed:[{pluginId:'memory@lotargo-memory-local',enabled:true,source:{path:adapter}}]}:[{id:'memory@lotargo-memory-local',enabled:true,installPath:adapter}]))});`);
    const native=join(bin,process.platform==='win32'?`${client}.cmd`:client);
    write(native,process.platform==='win32'?`@echo off\r\n"${process.execPath}" "${listed}"\r\n`:`#!/bin/sh\n"${process.execPath}" "${listed}"\n`);if(process.platform!=='win32')fs.chmodSync(native,0o755);
    const market=await probe(client,'doctor');assert.equal(market.status,'passed',JSON.stringify(market));assert.equal(market.installed,'native-list-confirmed');assert.equal(market.automaticInitialization,'UNVERIFIED');
    const adapterBytes=fs.readFileSync(join(adapter,'scripts','entry.cjs'));fs.appendFileSync(join(adapter,'scripts','entry.cjs'),'\n// changed adapter');
    assert.equal((await probe(client,'doctor')).code,'UNSUPPORTED_LAUNCHER');write(join(adapter,'scripts','entry.cjs'),adapterBytes);
  }
  write(paths.codexConfigPath,before);json(join(paths.claudeDir,'settings.json'),{});
  write(paths.claudeConfigPath,'{ bad CLIENT_SECRET_NEVER_RETURN');
  assert.equal((await status('claude')).status,'unavailable'); assert.equal((await clientRequest({action:'status'},opts)).items.length,5);
  write(paths.claudeConfigPath,'x'.repeat(512*1024+1)); assert.equal((await status('claude')).code,'UNSUPPORTED');
  json(paths.claudeConfigPath,{mcpServers:{'memory-agent':owned}}); assert.equal((await probe('claude','doctor')).code,'UNSUPPORTED_LAUNCHER');
  const foreignSkill=join(root,'foreign-skill');fs.mkdirSync(foreignSkill);write(join(foreignSkill,'SKILL.md'),'CLIENT_SECRET_NEVER_RETURN');
  fs.mkdirSync(join(paths.claudeDir,'skills'),{recursive:true});fs.symlinkSync(foreignSkill,join(paths.claudeDir,'skills','using-memory'),process.platform==='win32'?'junction':'dir');
  assert.equal((await status('claude')).code,'UNSUPPORTED');fs.unlinkSync(join(paths.claudeDir,'skills','using-memory'));
  const absent = await probe('gemini','version',{...opts,env:{...process.env,PATH:bin}}); assert.equal(absent.code,'CLI_UNAVAILABLE');
  await assert.rejects(boundedProcess({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],env:process.env,cwd,timeoutMs:100}),{code:'TIMEOUT'});
  await assert.rejects(boundedProcess({command:process.execPath,args:['-e',"process.stderr.write('SECRET');process.stdout.write('x'.repeat(300000))"],env:process.env,cwd}),{code:'OUTPUT_LIMIT'});
  await assert.rejects(boundedProcess({command:process.execPath,args:['-e',"process.stderr.write('SECRET');process.exit(3)"],env:process.env,cwd}),{code:'PROBE_FAILED'});
  const partialWorker=join(root,'partial.cjs');
  write(partialWorker,`require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
    const m=JSON.parse(line);if(!m.id)return;
    const result=m.method==='initialize'?{protocolVersion:'2024-11-05',serverInfo:{name:'fixture',version:'1'}}:
      m.method==='tools/list'?{tools:[{name:'memory_info'},{name:'recall'}]}:{content:[{type:'text',text:m.params.name==='memory_info'?'RAG: unavailable (SECRET)':'SECRET recalled body'}]};
    console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
  });`);
  const partial=await boundedProcess({command:process.execPath,args:[partialWorker],env:process.env,cwd,protocol:true});
  assert.equal(partial.status,'partial');assert.equal(partial.memoryInfo,'PARTIAL');assert.ok(!JSON.stringify(partial).includes('SECRET'));
  // Actual service timeout and single-flight guard, using a native shim fixture.
  const sleeper = join(root,'sleep.cjs'), pidFile=join(root,'sleep.pid');
  write(sleeper,`require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`);
  write(cli,process.platform==='win32' ? `@echo off\r\n"${process.execPath}" "${sleeper}"\r\n` : `#!/bin/sh\n"${process.execPath}" "${sleeper}"\n`);
  const timed = probe('codex','version',{...opts,timeoutMs:300});
  await new Promise(done=>setTimeout(done,25));
  const item = await status('codex');
  await assert.rejects(clientRequest({action:'probe',client:'codex',operation:'version',expectedVersion:item.version},opts),{code:'BUSY'});
  const timeout = await timed; assert.equal(timeout.status,'timed-out'); assert.ok(timeout.durationMs<4000);
  assert.ok(fs.existsSync(pidFile),'timeout fixture child did not start');
  assert.throws(()=>process.kill(Number(fs.readFileSync(pidFile,'utf8')),0),{code:'ESRCH'},'timeout left the native shim child alive');
  // Config changed while the process is running; stale overrides a failure/pass.
  const during = probe('codex','version',{...opts,timeoutMs:150});
  await new Promise(done=>setTimeout(done,25)); fs.appendFileSync(paths.codexConfigPath,'\n# during probe');
  assert.equal((await during).status,'stale');
  for (const input of [{action:'toString'},{action:'status',command:'anything'},{action:'status',client:'../codex'},{action:'probe',client:'codex',operation:'shell',expectedVersion:item.version}])await assert.rejects(clientRequest(input,opts),{code:'INVALID'});
  assert.throws(()=>parseClientCommand(['status','--client','codex','--client','claude']),{code:'INVALID'});
  for(const file of ['cli_boot.js','boot.js','index.js']) {
    const result = spawnSync(process.execPath,[resolve('mcp-server',file),'clients','status','--client','codex'],{env:process.env,cwd,encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr); assert.equal(JSON.parse(result.stdout).items[0].client,'codex'); assert.ok(!result.stdout.includes('CLIENT_SECRET_NEVER_RETURN'));
    const market=spawnSync(process.execPath,[resolve('mcp-server',file),'marketplace','status','--client','codex'],{env:process.env,cwd,encoding:'utf8',timeout:15000});
    assert.equal(market.status,0,market.stderr);assert.equal(JSON.parse(market.stdout)[0].client,'codex');assert.ok(!market.stdout.includes('CLIENT_SECRET_NEVER_RETURN'));
  }
  const logs=[];await handleClientAction('client_probe',{clear(){},log:s=>logs.push(s),waitForEnter:async()=>{},selectSimpleMenu:async()=>({action:'select',value:'back'})}); assert.ok(logs.some(x=>x.includes('UNVERIFIED')));
  app = await startDashboard(); const token=new URL(app.url).hash.slice(1), headers={Authorization:`Bearer ${token}`};
  assert.equal((await fetch(`${app.origin}/api/clients`)).status,401);
  assert.equal((await fetch(`${app.origin}/api/clients?command=x`,{headers})).status,400);
  const http = await (await fetch(`${app.origin}/api/clients`,{headers})).json(); assert.equal(http.items.length,5); assert.ok(!JSON.stringify(http).includes('CLIENT_SECRET_NEVER_RETURN'));
  assert.equal((await fetch(`${app.origin}/api/clients`,{method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:'https://foreign.test'},body:JSON.stringify({action:'status'})})).status,403);
  const post = await fetch(`${app.origin}/api/clients`,{method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:app.origin},body:JSON.stringify({action:'probe',client:'codex',operation:'version',expectedVersion:http.items.find(x=>x.client==='codex').version})});
  assert.equal(post.status,200);assert.equal((await post.json()).status,'timed-out');
  console.log('PASS client status, bounded probes, secrets, stale/BUSY, CLI/TUI and HTTP security');
} finally {
  if(app)await app.close();closeDatabase();
  if(dirname(resolve(root))!==resolve(tmpdir())||!root.startsWith(join(tmpdir(),'memory-client-service-')))throw new Error('Unsafe fixture cleanup');
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5});
}
