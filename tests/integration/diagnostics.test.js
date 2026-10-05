import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const cwd = process.cwd(), root = fs.mkdtempSync(join(tmpdir(), 'memory-diagnostics-test-'));
Object.assign(process.env, { HOME: root, USERPROFILE: root, MEMORY_DIR: join(root,'memory'), CODEX_HOME: join(root,'codex'),
  CLAUDE_CONFIG_DIR: join(root,'claude'), OPENCODE_CONFIG_DIR: join(root,'opencode'), XDG_CONFIG_HOME: join(root,'config'),
  MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_DISABLE_WEB_AUTOSTART: '1' });
process.chdir(root);
const { diagnosticsRequest } = await import('../../mcp-server/services/diagnostics_service.js');
const { getConfig } = await import('../../mcp-server/config/config_manager.js');
const { writeMemory, MEMORY_DIR } = await import('../../mcp-server/memory.js');
const { getDatabase, closeDatabase, BLOBS_DIR } = await import('../../mcp-server/db/database.js');
const { saveBlob, getBlobPath, safeGunzip } = await import('../../mcp-server/storage/blob_store.js');
const { ingestDocument } = await import('../../mcp-server/ingest/pipeline.js');
const { migrateKnowledge } = await import('../../mcp-server/services/knowledge_links_service.js');
const { captureLocal, stateHash } = await import('../../mcp-server/admin/full_snapshot.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
const { handleCasAction } = await import('../../mcp-server/cli/handlers/cas_actions.js');
const { parseDiagnosticsCommand } = await import('../../mcp-server/cli/diagnostics_commands.js');
const view = (operation = 'cleanup-blobs', backupId) => diagnosticsRequest({ action:'preview', operation, ...(backupId?{backupId}:{}) });
const save = (preview,hooks) => diagnosticsRequest({ action:'apply', operation:preview.operation, ...(preview.backupId?{backupId:preview.backupId}:{}), previewToken:preview.previewToken, confirm:true },hooks);
const fail = (fn,code) => assert.rejects(fn,error=>error.code===code);
let app;
try {
  await writeMemory('global',['- [2026-10-05 00:00] Real fixture fact <!-- id:real, kind:fact -->']);
  const live = await ingestDocument({ path:'live.md', content:'Referenced live source', generateEmbeddings:false });
  await ingestDocument({ path:'shared.md', content:'Referenced live source', projectScope:'project-fixture', generateEmbeddings:false });
  await migrateKnowledge(); const db=await getDatabase();
  const state=()=>stateHash(captureLocal(db,MEMORY_DIR,BLOBS_DIR,getConfig()));
  const before=state(), config=fs.readFileSync(join(MEMORY_DIR,'config.json'));
  const diagnostic = await diagnosticsRequest({ action:'run', operation:'graph-check' });
  assert.equal(diagnostic.status,'passed'); assert.equal(diagnostic.checks.length,5);
  assert.equal(diagnostic.workingMemoryTouched,false); assert.equal(diagnostic.temporaryCleanup,'completed');
  assert.equal(diagnostic.modelsLoaded,false); assert.equal(diagnostic.cloudCalled,false);
  assert.equal(state(),before); assert.deepEqual(fs.readFileSync(join(MEMORY_DIR,'config.json')),config);
  for(const input of [{action:'__proto__'},{action:'run',operation:'shell'},{action:'run',operation:'graph-check',path:root},
    {action:'preview',operation:'cleanup-blobs',backupId:'../wrong'}, {action:'status',confirm:true},
    {action:'preview',operation:'restore-blobs'}, {action:'apply',operation:'cleanup-blobs',confirm:'yes'}]) await fail(()=>diagnosticsRequest(input),'INVALID');

  const a=await saveBlob('Unused A'), b=await saveBlob('Unused B');
  const corruptHash='e'.repeat(64), corruptFile=getBlobPath(corruptHash); fs.mkdirSync(dirname(corruptFile),{recursive:true});fs.writeFileSync(corruptFile,'corrupt gzip');
  fs.writeFileSync(join(BLOBS_DIR,'foreign.txt'),'keep foreign files');
  const preview=await view();assert.equal(preview.changed,2); assert.ok(preview.skipped.some(item=>item.hash===corruptHash));
  assert.equal((await view()).previewToken,preview.previewToken);assert.equal(fs.existsSync(join(MEMORY_DIR,'maintenance-blobs')),false);
  await fail(()=>diagnosticsRequest({action:'apply',operation:'cleanup-blobs',previewToken:preview.previewToken}),'CONFIRMATION');
  const c=await saveBlob('Unused C');await fail(()=>save(preview),'CONFLICT');
  const race=await view();await fail(()=>save(race,{afterBackup:()=>fs.appendFileSync(a.path,'changed')}),'CONFLICT');
  assert.ok(fs.existsSync(a.path));assert.ok(fs.existsSync(b.path));assert.ok(fs.existsSync(c.path));
  // Restore test input after the rejected competing edit.
  fs.unlinkSync(a.path);await saveBlob('Unused A');
  const fresh=await view(), cleanup=await save(fresh);
  assert.equal(cleanup.status,'partial');assert.equal(cleanup.phase,'completed');assert.equal(cleanup.completed,3);
  assert.equal(state(),before);assert.ok(fs.existsSync(getBlobPath(live.blobHash)));assert.ok(fs.existsSync(corruptFile));
  assert.ok(fs.existsSync(join(BLOBS_DIR,'foreign.txt')));assert.ok(fs.existsSync(cleanup.backup));
  assert.equal((await diagnosticsRequest({action:'receipt',operationId:cleanup.operationId})).completed,3);
  assert.equal((await view()).changed,0);assert.equal((await save(await view())).status,'unchanged');
  const restore=await view('restore-blobs',cleanup.operationId), restored=await save(restore);
  assert.equal(restored.status,'saved');assert.equal(restored.completed,3);assert.ok(fs.existsSync(a.path));assert.equal(state(),before);
  // A changed backup and a changed existing CAS target are refused, never overwritten.
  const zip=fs.readFileSync(cleanup.backup);fs.appendFileSync(cleanup.backup,'tamper');await fail(()=>view('restore-blobs',cleanup.operationId),'RECOVERY_REQUIRED');fs.writeFileSync(cleanup.backup,zip);
  fs.appendFileSync(a.path,'foreign');await fail(()=>view('restore-blobs',cleanup.operationId),'CONFLICT');fs.unlinkSync(a.path);await saveBlob('Unused A');

  const interrupted=await save(await view(),{afterFile:()=>{throw new Error('simulated filesystem failure');}});
  assert.equal(interrupted.status,'partial');assert.equal(interrupted.phase,'interrupted');assert.equal(interrupted.completed,1);
  assert.equal((await diagnosticsRequest({action:'status'})).recoveryRequired,true);await fail(()=>view(),'RECOVERY_REQUIRED');
  const remaining=interrupted.files.find(item=>fs.existsSync(getBlobPath(item.hash)));
  const revivedText=safeGunzip(fs.readFileSync(getBlobPath(remaining.hash))).toString('utf8');
  const revived=await ingestDocument({path:'revived.md',content:revivedText,generateEmbeddings:false});assert.equal(revived.blobHash,remaining.hash);
  const resume=await view('resume-cleanup',interrupted.operationId);assert.ok(resume.skipped.some(item=>item.hash===remaining.hash&&item.reason==='now-referenced'));
  const resumed=await save(resume);assert.equal(resumed.status,'partial');assert.equal(resumed.phase,'completed');assert.ok(fs.existsSync(getBlobPath(remaining.hash)));
  assert.equal((await diagnosticsRequest({action:'status'})).recoveryRequired,false);
  await save(await view('restore-blobs',interrupted.operationId));

  // Actual process exit leaves durable intent and a verified recoverable archive.
  const serviceUrl=new URL('../../mcp-server/services/diagnostics_service.js',import.meta.url).href;
  const crashScript=`const {diagnosticsRequest}=await import(${JSON.stringify(serviceUrl)});const p=await diagnosticsRequest({action:'preview',operation:'cleanup-blobs'});await diagnosticsRequest({action:'apply',operation:'cleanup-blobs',previewToken:p.previewToken,confirm:true},{afterFile:()=>process.exit(73)});`;
  const crash=spawnSync(process.execPath,['--input-type=module','-e',crashScript],{env:process.env,cwd:root,encoding:'utf8',timeout:20000});assert.equal(crash.status,73,crash.stderr);
  const crashStatus=await diagnosticsRequest({action:'status'}), pending=crashStatus.receipts.find(item=>item.phase==='running');assert.ok(pending);
  const recovery=await save(await view('restore-blobs',pending.operationId));assert.equal(recovery.status,'saved');
  assert.equal((await diagnosticsRequest({action:'status'})).recoveryRequired,false);
  // Atomic no-clobber restore refuses a competing filesystem writer after staging.
  const cleanedAgain=await save(await view());let competed;
  const clobber=await save(await view('restore-blobs',cleanedAgain.operationId),{beforeRestore:file=>{competed=file;fs.writeFileSync(file,'foreign concurrent bytes');}});
  assert.equal(clobber.phase,'interrupted');assert.equal(clobber.completed,0);assert.equal(fs.readFileSync(competed,'utf8'),'foreign concurrent bytes');
  await fail(()=>view('restore-blobs',clobber.operationId),'CONFLICT');fs.unlinkSync(competed);
  await save(await view('restore-blobs',clobber.operationId));assert.equal((await diagnosticsRequest({action:'status'})).recoveryRequired,false);
  const oversize=getBlobPath('f'.repeat(64));fs.mkdirSync(dirname(oversize),{recursive:true});
  const oversizeFd=fs.openSync(oversize,'wx');fs.ftruncateSync(oversizeFd,65*1024*1024);fs.closeSync(oversizeFd);
  await fail(()=>view(),'UNSUPPORTED');fs.unlinkSync(oversize);
  // Symlink/junction parents cannot redirect the scan or writes outside the store.
  const link=join(BLOBS_DIR,'ff'), outside=join(root,'outside');fs.mkdirSync(outside);fs.writeFileSync(join(outside,'precious'),'preserve');
  if(!fs.existsSync(link)) { fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');
    const linked=await view();assert.ok(linked.skipped.some(item=>item.name==='ff'));assert.equal(fs.readFileSync(join(outside,'precious'),'utf8'),'preserve');fs.unlinkSync(link); }

  // TUI cancellation and CAS conflict use the same service; no silent retry.
  const logs=[];let prompts=0;
  const ui={clear:()=>{},log:text=>logs.push(text),waitForEnter:async()=>{},selectSimpleMenu:async()=>({action:'select',value:cleanup.operationId}),promptText:async()=>{prompts++;return 'no';}};
  await handleCasAction('cas_cleanup',ui);assert.equal(prompts,1);assert.ok(logs.some(text=>text.includes('Cancelled')));
  ui.promptText=async()=>{await saveBlob('Concurrent TUI file');return 'yes';};await handleCasAction('cas_cleanup',ui);assert.ok(logs.some(text=>text.includes('CONFLICT')));
  await handleCasAction('graph_test',ui);assert.ok(logs.some(text=>text.includes('[passed]')));
  assert.throws(()=>parseDiagnosticsCommand(['status','--operation','a','--operation','b']),/Repeated/);
  for (const entry of ['cli_boot.js','boot.js','index.js']) {
    const run=spawnSync(process.execPath,[join(cwd,'mcp-server',entry),'diagnostics','status'],{env:process.env,cwd:root,encoding:'utf8',timeout:20000});assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).localOnly,true);
  }
  app=await startDashboard();const url=new URL(app.url),origin=url.origin,token=url.hash.slice(1);
  const request=(method,body,headers={})=>fetch(`${origin}/api/diagnostics`,{method,headers:{Authorization:`Bearer ${token}`,Origin:origin,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('GET')).status,200);
  assert.equal((await request('POST',{action:'preview',operation:'cleanup-blobs',shell:'arbitrary'})).status,400);
  assert.equal((await request('POST',{action:'run',operation:'graph-check'},{Origin:'https://foreign.test'})).status,403);
  assert.equal((await fetch(`${origin}/api/diagnostics`)).status,401);
  const httpRun=await request('POST',{action:'run',operation:'graph-check'});assert.equal(httpRun.status,200);assert.equal((await httpRun.json()).status,'passed');
  const httpPreview=await (await request('POST',{action:'preview',operation:'cleanup-blobs'})).json();
  await saveBlob('HTTP racing source');assert.equal((await request('POST',{action:'apply',operation:'cleanup-blobs',previewToken:httpPreview.previewToken,confirm:true})).status,409);
  assert.equal((await fetch(`${origin}/diagnostics.js`)).status,200);
  console.log('PASS isolated diagnostics, exact cleanup/restore, CAS, backups, guarded revival, process-exit recovery, symlinks, CLI/TUI/HTTP');
} finally {
  if(app)await app.close();closeDatabase();process.chdir(cwd);
  if(dirname(resolve(root))!==resolve(tmpdir())||!root.startsWith(join(tmpdir(),'memory-diagnostics-test-')))throw new Error('Unsafe fixture cleanup target');
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5});
}
