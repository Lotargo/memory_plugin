import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const cwd = process.cwd(), root = fs.mkdtempSync(join(tmpdir(), 'memory-client-removal-test-'));
Object.assign(process.env, { HOME: root, USERPROFILE: root, MEMORY_DIR: join(root,'memory'), CODEX_HOME: join(root,'codex'),
  CLAUDE_CONFIG_DIR: join(root,'claude'), OPENCODE_CONFIG_DIR: join(root,'opencode'), XDG_CONFIG_HOME: join(root,'config'),
  MEMORY_DISABLE_PERSONA_SYNC:'1', MEMORY_DISABLE_BACKGROUND_SYNC:'1', MEMORY_DISABLE_WEB_AUTOSTART:'1' });
process.chdir(root);
const { uninstallRequest } = await import('../../mcp-server/services/uninstall_service.js');
const { handleUninstallAction } = await import('../../mcp-server/cli/handlers/uninstall_actions.js');
const { parseUninstallCommand } = await import('../../mcp-server/cli/uninstall_commands.js');
const { buildCodexMemoryAgentSection } = await import('../../mcp-server/codex_config.js');
const { PROMPT_BLOCK, PERSONA_START_MARKER, PERSONA_END_MARKER } = await import('../../mcp-server/prompt_manager.js');
const { resolveClientPaths } = await import('../../mcp-server/client_paths.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
const { closeDatabase } = await import('../../mcp-server/db/database.js');
const { BLOBS_DIR } = await import('../../mcp-server/db/database.js');
const { createKnowledgeFixture } = await import('../fixtures/knowledge_fixture.js');
const { captureLocal, stateHash } = await import('../../mcp-server/admin/full_snapshot.js');
const { getConfig } = await import('../../mcp-server/config/config_manager.js');
const paths = resolveClientPaths(), skill = join(cwd,'skills','using-memory');
const write = (file, text) => { fs.mkdirSync(dirname(file), { recursive:true }); fs.writeFileSync(file, text); };
const owned = { command:'npx', args:['-y','@lotargo/memory_plugin'], env:{ API_SECRET:'TEST_SECRET_KEEP_PRIVATE' } };
const configs = { gemini:paths.geminiSettingsPath, claude:paths.claudeConfigPath, antigravity:paths.antigravityMcpConfigPath, opencode:paths.opencodeConfigPath };
const preview = (client='gemini',operation='uninstall',backupId) => uninstallRequest({action:'preview',client,operation,...(backupId?{backupId}:{})});
const apply = (p,hooks) => uninstallRequest({action:'apply',client:p.client,operation:p.operation,...(p.backupId?{backupId:p.backupId}:{}),previewToken:p.previewToken,confirm:true},hooks);
const fail = (fn,code) => assert.rejects(fn,error=>error.code===code);
let app;
try {
  const fixture=await createKnowledgeFixture();
  const memoryState=()=>stateHash(captureLocal(fixture.db,process.env.MEMORY_DIR,BLOBS_DIR,getConfig()));
  write(join(root,'memory','sentinel.md'),'Notebook / RAG sentinel, keep exact');
  write(join(root,'.agents','mcp_config.json'),JSON.stringify({mcpServers:{'memory-agent':owned}}));
  write(join(root,'config','memory-agent','prompt.md'),'shared prompt preserved');
  write(join(root,'cache','packages','memory-plugin.txt'),'cache preserved');
  for (const [client,file] of Object.entries(configs)) write(file,JSON.stringify({mcpServers:{'memory-agent':owned,foreign:{command:'keep'}},...(client==='opencode'?{plugin:['@lotargo/memory_plugin','@vendor/keep'],plugins:[['@lotargo/memory_plugin@1.7.1',{}],'other']}:{}),custom:'preserve'}));
  write(paths.codexConfigPath, `# foreign config\napi_secret = "TEST_SECRET_KEEP_PRIVATE"\n${buildCodexMemoryAgentSection({nodePath:process.execPath,bootPath:join(cwd,'mcp-server','boot.js')})}\n[unrelated]\nvalue = 4\n`);
  fs.cpSync(skill,join(paths.geminiSkillsDir,'using-memory'),{recursive:true});
  const foreignText = '\uFEFF# Foreign instructions\r\n\r\n';
  write(paths.geminiPromptPath,`${foreignText}${PROMPT_BLOCK}\r\n${PERSONA_START_MARKER}\nprivate instruction\n${PERSONA_END_MARKER}\r\n`);
  const originalConfig=fs.readFileSync(paths.geminiSettingsPath),originalPrompt=fs.readFileSync(paths.geminiPromptPath);
  const originalMemory=memoryState();
  const status=await uninstallRequest({action:'status'}); assert.equal(status.items.length,5);assert.equal(status.recoveryRequired,false);
  assert.equal(JSON.stringify(status).includes('TEST_SECRET_KEEP_PRIVATE'),false);assert.equal(fs.existsSync(join(root,'memory','uninstall')),false);
  for(const input of [{action:'__proto__'},{action:'preview',client:'__proto__',operation:'uninstall'},{action:'preview',client:'gemini',operation:'shell'},
    {action:'status',path:root},{action:'preview',client:'gemini',operation:'uninstall',purge:true},{action:'preview',client:'gemini',operation:'restore',backupId:'../bad'}]) await fail(()=>uninstallRequest(input),'INVALID');
  const p=await preview();assert.ok(p.changed>=3);assert.equal((await preview()).previewToken,p.previewToken);
  await fail(()=>uninstallRequest({action:'apply',client:'gemini',operation:'uninstall',previewToken:p.previewToken}),'CONFIRMATION');
  fs.appendFileSync(paths.geminiSettingsPath,' ');await fail(()=>apply(p),'CONFLICT');fs.writeFileSync(paths.geminiSettingsPath,originalConfig);
  const race=await preview();await fail(()=>apply(race,{afterBackup:()=>fs.appendFileSync(paths.geminiPromptPath,'competing')}),'CONFLICT');
  assert.deepEqual(fs.readFileSync(paths.geminiSettingsPath),originalConfig);fs.writeFileSync(paths.geminiPromptPath,originalPrompt);
  const removed=await apply(await preview());assert.equal(removed.status,'saved');assert.equal(removed.phase,'completed');
  assert.equal(JSON.parse(fs.readFileSync(paths.geminiSettingsPath)).mcpServers['memory-agent'],undefined);
  assert.equal(JSON.parse(fs.readFileSync(paths.geminiSettingsPath)).custom,'preserve');
  assert.equal(fs.readFileSync(paths.geminiPromptPath,'utf8'),`${foreignText}\r\n\r\n`);
  assert.equal(fs.existsSync(join(paths.geminiSkillsDir,'using-memory','SKILL.md')),false);
  assert.equal(JSON.stringify(removed).includes('TEST_SECRET_KEEP_PRIVATE'),false);
  const backupPath=join(root,'memory','uninstall',`${removed.backupId}.backup.json`),bytes=fs.readFileSync(backupPath);
  assert.ok(bytes.toString().includes('memory-client-backup'));
  if(process.platform!=='win32')assert.equal(fs.statSync(backupPath).mode&0o777,0o600);
  const restore=await preview('gemini','restore',removed.operationId),restored=await apply(restore);
  assert.equal(restored.status,'saved');assert.deepEqual(fs.readFileSync(paths.geminiSettingsPath),originalConfig);assert.deepEqual(fs.readFileSync(paths.geminiPromptPath),originalPrompt);
  assert.equal(fs.readFileSync(join(paths.geminiSkillsDir,'using-memory','SKILL.md'),'utf8'),fs.readFileSync(join(skill,'SKILL.md'),'utf8'));
  fs.appendFileSync(backupPath,'tamper');await fail(()=>preview('gemini','restore',removed.operationId),'CONFLICT');fs.writeFileSync(backupPath,bytes);
  fs.appendFileSync(paths.geminiSettingsPath,' competing');await fail(()=>preview('gemini','restore',removed.operationId),'CONFLICT');fs.writeFileSync(paths.geminiSettingsPath,originalConfig);
  // Interrupted removal is read-only on status, blocks new removal and permits reviewed rollback.
  const interrupted=await apply(await preview(),{afterFile:()=>{throw new Error('simulated interruption');}});
  assert.equal(interrupted.phase,'interrupted');assert.equal(interrupted.completed,1);
  const partialBytes=fs.readFileSync(paths.geminiSettingsPath);const pending=await uninstallRequest({action:'status'});
  assert.equal(pending.recoveryRequired,true);assert.deepEqual(fs.readFileSync(paths.geminiSettingsPath),partialBytes);
  const blocked=await preview('opencode');assert.equal(blocked.canApply,false);await fail(()=>apply(blocked),'RECOVERY_REQUIRED');
  await apply(await preview('gemini','restore',interrupted.operationId));assert.equal((await uninstallRequest({action:'status'})).recoveryRequired,false);
  assert.equal((await uninstallRequest({action:'receipt',operationId:interrupted.operationId})).error,undefined);
  assert.equal((await uninstallRequest({action:'status'})).receipts[0].files,undefined,'History is compact; exact files are available by receipt ID');
  // Actual child-process exit after mutation leaves durable intent and dead locks.
  const serviceUrl=new URL('../../mcp-server/services/uninstall_service.js',import.meta.url).href;
  const crashScript=`const {uninstallRequest}=await import(${JSON.stringify(serviceUrl)});const p=await uninstallRequest({action:'preview',client:'gemini',operation:'uninstall'});await uninstallRequest({action:'apply',client:'gemini',operation:'uninstall',previewToken:p.previewToken,confirm:true},{afterFile:()=>process.exit(73)});`;
  const crash=spawnSync(process.execPath,['--input-type=module','-e',crashScript],{env:process.env,cwd:root,encoding:'utf8',timeout:20000});assert.equal(crash.status,73,crash.stderr);
  const crashed=(await uninstallRequest({action:'status'})).receipts.find(item=>item.phase==='running');assert.ok(crashed);
  await apply(await preview('gemini','restore',crashed.operationId));assert.deepEqual(fs.readFileSync(paths.geminiSettingsPath),originalConfig);
  // Exact client isolation, foreign registration and modified skill preservation.
  for(const client of ['opencode','codex','claude','antigravity']) {
    const file=client==='codex'?paths.codexConfigPath:configs[client],before=fs.readFileSync(file),gemini=fs.readFileSync(paths.geminiSettingsPath);
    const result=await apply(await preview(client));assert.equal(result.status,'saved');assert.deepEqual(fs.readFileSync(paths.geminiSettingsPath),gemini);
    if(client==='opencode') {const config=JSON.parse(fs.readFileSync(file));assert.deepEqual(config.plugin,['@vendor/keep']);assert.deepEqual(config.plugins,['other']);}
    if(client==='codex')assert.ok(fs.readFileSync(file,'utf8').includes('[unrelated]'));
    await apply(await preview(client,'restore',result.operationId));assert.deepEqual(fs.readFileSync(file),before);
  }
  write(paths.geminiSettingsPath,JSON.stringify({mcpServers:{'memory-agent':{command:'foreign',args:['keep']}}}));
  write(join(paths.geminiSkillsDir,'using-memory','custom.txt'),'user custom skill');
  const foreign=await preview();assert.ok(foreign.skipped.some(item=>item.reason==='foreign-registration'));assert.ok(foreign.skipped.some(item=>item.reason==='modified-or-foreign'));
  const partial=await apply(foreign);assert.equal(partial.status,'partial');assert.equal(fs.readFileSync(join(paths.geminiSkillsDir,'using-memory','custom.txt'),'utf8'),'user custom skill');
  // Marketplace channel changes invalidate review and guard all selected files.
  const cp=await preview('codex'),codexBefore=fs.readFileSync(paths.codexConfigPath);
  fs.appendFileSync(paths.codexConfigPath,'\n[plugins."memory@lotargo-memory-local"]\nenabled = true\n');
  await fail(()=>apply(cp),'CONFLICT');const managed=await preview('codex');assert.equal(managed.canApply,false);assert.equal(managed.changed,0);assert.equal(managed.skipped[0].reason,'marketplace-managed');
  fs.writeFileSync(paths.codexConfigPath,codexBefore);
  // Malformed/oversized files and junction ancestors fail closed.
  write(paths.claudeConfigPath,'{ broken secret');await fail(()=>preview('claude'),'UNSUPPORTED');
  const outside=join(root,'outside');fs.mkdirSync(outside);write(join(outside,'settings.json'),'precious');
  const moved=join(root,'gemini-moved');fs.renameSync(paths.geminiDir,moved);fs.symlinkSync(outside,paths.geminiDir,process.platform==='win32'?'junction':'dir');
  await fail(()=>preview(),'UNSUPPORTED');assert.equal(fs.readFileSync(join(outside,'settings.json'),'utf8'),'precious');fs.unlinkSync(paths.geminiDir);fs.renameSync(moved,paths.geminiDir);
  const big=fs.openSync(paths.antigravityMcpConfigPath,'w');fs.ftruncateSync(big,513*1024);fs.closeSync(big);await fail(()=>preview('antigravity'),'UNSUPPORTED');
  // TUI cancellation and stale review share the service and don't silently retry.
  const logs=[];const ui={clear:()=>{},log:text=>logs.push(text),waitForEnter:async()=>{},selectSimpleMenu:async()=>({action:'select',value:'codex'}),promptText:async()=> 'no'};
  await handleUninstallAction('client_uninstall',ui);assert.ok(logs.some(line=>line.includes('Cancelled')));
  ui.promptText=async()=>{fs.appendFileSync(paths.codexConfigPath,'# competing\n');return 'yes';};await handleUninstallAction('client_uninstall',ui);assert.ok(logs.some(line=>line.includes('CONFLICT')));
  assert.throws(()=>parseUninstallCommand(['status','--client','a','--client','b']),/Repeated/);
  for(const entry of ['cli_boot.js','boot.js','index.js']) {
    const run=spawnSync(process.execPath,[join(cwd,'mcp-server',entry),'uninstall','status'],{env:process.env,cwd:root,encoding:'utf8',timeout:20000});assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).localOnly,true);
    const unknown=spawnSync(process.execPath,[join(cwd,'mcp-server',entry),'uninstall','typo'],{env:process.env,cwd:root,encoding:'utf8',timeout:20000});assert.notEqual(unknown.status,0);
    const injected=spawnSync(process.execPath,[join(cwd,'mcp-server',entry),'uninstall','status','--version'],{env:process.env,cwd:root,encoding:'utf8',timeout:20000});assert.notEqual(injected.status,0);
  }
  const alias=spawnSync(process.execPath,[join(cwd,'mcp-server','boot.js'),'setup','--uninstall','status'],{env:process.env,cwd:root,encoding:'utf8',timeout:20000});assert.equal(alias.status,0,alias.stderr);assert.equal(JSON.parse(alias.stdout).localOnly,true);
  app=await startDashboard();const url=new URL(app.url),origin=url.origin,token=url.hash.slice(1);
  const request=(method,body,headers={})=>fetch(`${origin}/api/uninstall`,{method,headers:{Authorization:`Bearer ${token}`,Origin:origin,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('GET')).status,200);
  assert.equal((await request('POST',{action:'preview',client:'codex',operation:'uninstall',shell:'arbitrary'})).status,400);
  assert.equal((await request('POST',{action:'preview',client:'codex',operation:'uninstall'},{Origin:'https://foreign.invalid'})).status,403);
  assert.equal((await request('GET',null,{Authorization:''})).status,401);
  const hp=await (await request('POST',{action:'preview',client:'opencode',operation:'uninstall'})).json();
  const response=await request('POST',{action:'apply',client:'opencode',operation:'uninstall',previewToken:hp.previewToken,confirm:true});assert.equal(response.status,200);
  assert.equal((await response.text()).includes('TEST_SECRET_KEEP_PRIVATE'),false);
  assert.equal(fs.readFileSync(join(root,'memory','sentinel.md'),'utf8'),'Notebook / RAG sentinel, keep exact');
  assert.equal(JSON.parse(fs.readFileSync(join(root,'.agents','mcp_config.json'))).mcpServers['memory-agent'].command,'npx');
  assert.equal(fs.readFileSync(paths.promptFile,'utf8'),'shared prompt preserved');
  assert.equal(fs.readFileSync(join(root,'cache','packages','memory-plugin.txt'),'utf8'),'cache preserved');
  assert.equal(memoryState(),originalMemory,'Notebook, identities, RAG, graph, vectors and settings remain unchanged');
  console.log('PASS fixed client uninstall, private backup, recovery, isolation, CLI/TUI and HTTP');
} finally {
  if(app)await app.close();closeDatabase();process.chdir(cwd);
  if(dirname(resolve(root))!==resolve(tmpdir())||!root.startsWith(join(tmpdir(),'memory-client-removal-test-')))throw new Error('Unsafe fixture cleanup target');
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5});
}
