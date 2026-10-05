import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const cwd = process.cwd(), root = fs.mkdtempSync(join(tmpdir(), 'memory-maintenance-'));
Object.assign(process.env, { HOME: root, USERPROFILE: root, MEMORY_DIR: join(root,'memory'), CODEX_HOME: join(root,'codex'),
  CLAUDE_CONFIG_DIR: join(root,'claude'), OPENCODE_CONFIG_DIR: join(root,'opencode'), XDG_CONFIG_HOME: join(root,'config'),
  MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_DISABLE_WEB_AUTOSTART: '1' });
process.chdir(root);
const { maintenanceRequest } = await import('../../mcp-server/services/maintenance_service.js');
const { getConfig, updateConfig } = await import('../../mcp-server/config/config_manager.js');
const { writeMemory, readMemory, storeFilePath, migrateStoreTitles } = await import('../../mcp-server/memory.js');
const { getDatabase, closeDatabase } = await import('../../mcp-server/db/database.js');
const { readNotebook } = await import('../../mcp-server/services/notebook_service.js');
const { migrateKnowledge } = await import('../../mcp-server/services/knowledge_links_service.js');
const { factMeta, factBody } = await import('../../mcp-server/fact_format.js');
const { ingestDocument } = await import('../../mcp-server/ingest/pipeline.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
const { handleMaintenanceAction } = await import('../../mcp-server/cli/handlers/maintenance_actions.js');
const { parseMaintenanceCommand } = await import('../../mcp-server/cli/maintenance_commands.js');
const fail = (fn, code) => assert.rejects(fn, error => error.code === code);
const view = (operation, fields = {}) => maintenanceRequest({ action: 'preview', operation, ...fields });
const save = (preview, fields = {}, hooks) => maintenanceRequest({ action: 'apply', operation: preview.operation,
  ...(preview.key ? {key:preview.key} : {}), ...fields, previewToken: preview.previewToken, confirm: true }, hooks);
let app;
try {
  getConfig();
  await writeMemory('global', ['- [2026-10-05 00:00] Global unchanged <!-- id:same, kind:fact -->']);
  await writeMemory('project-a', ['- [2026-10-05 00:00] Use Go <script>window.BAD=1</script> <!-- id:same, tags:persona, keep:1, ttl:90d -->',
    '- [2026-10-05 00:00] Historical body <!-- id:older, kind:fact, supersededBy:same -->']);
  await writeMemory('project-b', ['- [2026-10-05 00:00] Same ID other project <!-- id:same, kind:fact -->']);
  await fail(() => view('migrate-titles', { key: 'project-a' }), 'MIGRATION_REQUIRED');
  await migrateKnowledge();
  const globalBefore = fs.readFileSync(storeFilePath('global')), bBefore = fs.readFileSync(storeFilePath('project-b'));
  const aFile = storeFilePath('project-a'); fs.appendFileSync(aFile, '\n# Foreign footer\n');
  const aBefore = fs.readFileSync(aFile), configBefore = fs.readFileSync(join(root,'memory','config.json'));
  const preview = await view('migrate-titles', { key: 'project-a' });
  assert.equal(preview.changed, 2); assert.ok(preview.changes[0].after.includes('<script>'));
  assert.deepEqual(fs.readFileSync(aFile), aBefore); assert.deepEqual(fs.readFileSync(join(root,'memory','config.json')), configBefore);
  assert.equal(fs.existsSync(join(root,'memory','maintenance')), false, 'preview creates no maintenance backups');
  await fail(() => maintenanceRequest({ action: 'apply', operation: 'migrate-titles', key: 'project-a', previewToken:preview.previewToken }), 'CONFIRMATION');
  await fail(() => view('migrate-titles', { key: '__all__' }), 'NOT_FOUND');
  await fail(() => view('migrate-persona', { key: 'project-a' }), 'INVALID');
  await fail(() => view('reset-settings', { path: 'arbitrary' }), 'INVALID');
  await fail(() => maintenanceRequest({ action:'status', confirm:true }), 'INVALID');
  await fail(() => maintenanceRequest({ action:'__proto__' }), 'INVALID');
  await fail(() => maintenanceRequest({ action:'apply', operation:'reset-settings', confirm:'yes' }), 'INVALID');
  await fail(() => view('restore-settings', { backupId:'../../config' }), 'INVALID');

  const doc = await ingestDocument({ content:'# Source\nUse Go\n', type:'text', title:'Source', scope:'global', generateEmbeddings:false });
  const db = await getDatabase(), sql = db.localDb;
  sql.prepare(`INSERT INTO knowledge_links(id,fact_key,fact_text,doc_id,relation_type,created_at,fact_id,revision,status,source_revision) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('link-a','project-a',factBody((await readMemory('project-a'))[0]),doc.docId,'RULES_FOR',Date.now(),'same',1,'valid',1);
  await fail(() => save(preview), 'CONFLICT', 'link changes invalidate preview');
  const linked = await view('migrate-titles', {key:'project-a'}), saved = await save(linked);
  assert.equal(saved.status,'saved'); assert.ok(fs.existsSync(saved.backup));
  assert.ok(fs.readFileSync(aFile,'utf8').endsWith('# Foreign footer\n'), 'preserve foreign non-record text');
  assert.deepEqual(fs.readFileSync(storeFilePath('global')), globalBefore); assert.deepEqual(fs.readFileSync(storeFilePath('project-b')), bBefore);
  assert.equal(factMeta((await readMemory('project-a'))[0]).keep,'1'); assert.equal(factMeta((await readMemory('project-a'))[0]).ttl,'90d');
  assert.equal(factMeta((await readMemory('project-a'))[1]).supersededBy,'same');
  assert.equal(sql.prepare('SELECT fact_id FROM knowledge_links WHERE id=?').get('link-a').fact_id,'same');
  assert.equal((await view('migrate-titles',{key:'project-a'})).changed,0);
  assert.equal((await migrateStoreTitles('project-a')).changed,0);

  // True legacy content, including missing IDs, and kind:fact authority.
  fs.writeFileSync(storeFilePath('global'), '# Global\n\n- [2026-10-05 00:00] **Tone** — Short replies <!-- tags:persona, keep:1, disabled:1 -->\n- [2026-10-05 00:00] **Past** — Old tone <!-- id:explicit, tags:persona, kind:fact -->\n');
  const persona = await view('migrate-persona',{key:'global'});
  assert.equal(persona.changed,1); assert.ok(persona.changes[0].after.includes('id:f_'));
  assert.equal((await view('migrate-persona',{key:'global'})).previewToken,persona.previewToken);
  await save(persona);
  assert.equal(factMeta((await readMemory('global'))[0]).kind,'directive'); assert.equal(factMeta((await readMemory('global'))[0]).disabled,'1');
  assert.equal(factMeta((await readMemory('global'))[1]).kind,'fact');
  assert.equal(fs.existsSync(join(root,'codex','AGENTS.md')),false,'maintenance never synchronizes prompt files implicitly');

  // Safe reset preserves operational settings and creates a restorable backup.
  updateConfig({ alpha:0.8, embeddingModel:'Xenova/multilingual-e5-base', vectorDimension:384,
    mode:'cloud-snapshots', snapshotSyncMode:'scheduled', snapshotIntervalHours:0.5, webPort:17801, webAutoStart:false,
    authorized:true, username:'fixture', tursoUrl:'libsql://fixture.turso.io', legacyCloudBackupRequired:true });
  const settings = await view('reset-settings');
  assert.ok(settings.changes.some(item => item.key==='alpha')); assert.ok(!JSON.stringify(settings).includes('fixture.turso'));
  let stale = settings; updateConfig({ alpha:0.6 }); await fail(() => save(stale),'CONFLICT');
  const reset = await save(await view('reset-settings'));
  assert.equal(reset.reindexRequired,true); assert.equal(getConfig().alpha,0.5); assert.equal(getConfig().mode,'cloud-snapshots');
  assert.equal(getConfig().snapshotIntervalHours,0.5); assert.equal(getConfig().webPort,17801); assert.equal(getConfig().webAutoStart,false);
  assert.equal(getConfig().authorized,true); assert.equal(getConfig().legacyCloudBackupRequired,true);
  const restore = await view('restore-settings',{backupId:reset.backupId}); await save(restore,{backupId:reset.backupId});
  assert.equal(getConfig().alpha,0.6); assert.equal(getConfig().embeddingModel,'Xenova/multilingual-e5-base');
  const rawConfig = fs.readFileSync(join(root,'memory','config.json'));
  fs.writeFileSync(join(root,'memory','config.json'),'{broken config');
  await fail(()=>view('reset-settings'),'RECOVERY_REQUIRED');
  await fail(()=>maintenanceRequest({action:'status'}),'RECOVERY_REQUIRED');
  assert.equal(fs.readFileSync(join(root,'memory','config.json'),'utf8'),'{broken config');
  fs.writeFileSync(join(root,'memory','config.json'),rawConfig);
  const tamper = fs.readFileSync(reset.backup,'utf8'); fs.writeFileSync(reset.backup,tamper.replace('0.6','0.7'));
  await fail(() => view('restore-settings',{backupId:reset.backupId}),'RECOVERY_REQUIRED'); fs.writeFileSync(reset.backup,tamper);
  const backupRace = await view('reset-settings');
  await fail(() => save(backupRace,{}, {afterBackup:()=>updateConfig({alpha:0.9})}),'CONFLICT'); assert.equal(getConfig().alpha,0.9);
  // Former only-cloud can reset settings without clearing its restore guard.
  updateConfig({legacyCloudRestoreRequired:true}); await save(await view('reset-settings'));
  assert.equal(getConfig().legacyCloudRestoreRequired,true); assert.equal((await maintenanceRequest({action:'status'})).unavailable,'MIGRATION_REQUIRED');
  updateConfig({mode:'only-local',snapshotSyncMode:'off',legacyCloudBackupRequired:false,legacyCloudRestoreRequired:false});

  // Transaction rollback and process-exit recovery through the shared journal.
  fs.appendFileSync(aFile,'- [2026-10-05 00:00] New legacy row <!-- id:new -->\n');
  const interrupted = await view('migrate-titles',{key:'project-a'});
  await assert.rejects(()=>save(interrupted,{}, {afterCommit:()=>{throw new Error('fault after SQL commit');}}));
  assert.ok(fs.existsSync(join(root,'memory','.knowledge-journal.json')));
  assert.ok((await readNotebook({key:'project-a'})).records.find(item=>item.id==='new').title);
  assert.equal(fs.existsSync(join(root,'memory','.knowledge-journal.json')),false);
  fs.appendFileSync(aFile,'- [bad timestamp] Unparseable record\n');
  await fail(()=>view('migrate-titles',{key:'project-a'}),'UNSUPPORTED');
  fs.writeFileSync(aFile,fs.readFileSync(aFile,'utf8').replace('- [bad timestamp] Unparseable record\n',''));
  fs.appendFileSync(aFile,'- [2026-10-05 00:00] Crash row <!-- id:crash -->\n');
  const crashService = new URL('../../mcp-server/services/maintenance_service.js',import.meta.url).href;
  const crashScript = `const {maintenanceRequest}=await import(${JSON.stringify(crashService)});const p=await maintenanceRequest({action:'preview',operation:'migrate-titles',key:'project-a'});await maintenanceRequest({action:'apply',operation:'migrate-titles',key:'project-a',previewToken:p.previewToken,confirm:true},{afterCommit:()=>process.exit(73)});`;
  const crash = spawnSync(process.execPath,['--input-type=module','-e',crashScript],{env:process.env,encoding:'utf8',timeout:20000});
  assert.equal(crash.status,73,crash.stderr);assert.ok(fs.existsSync(join(root,'memory','.knowledge-journal.json')));
  assert.ok((await readNotebook({key:'project-a'})).records.find(item=>item.id==='crash').title);
  assert.equal(fs.existsSync(join(root,'memory','.knowledge-journal.json')),false);
  const { getBlobPath } = await import('../../mcp-server/storage/blob_store.js');
  const blob = getBlobPath(sql.prepare('SELECT blob_hash FROM documents WHERE id=?').get(doc.docId).blob_hash);
  fs.appendFileSync(aFile,'- [2026-10-05 00:00] Backup guard <!-- id:guard -->\n');
  const guard = await view('migrate-titles',{key:'project-a'}), guardBytes=fs.readFileSync(aFile);
  fs.renameSync(blob,`${blob}.fixture-hold`);
  try { await assert.rejects(()=>save(guard));assert.deepEqual(fs.readFileSync(aFile),guardBytes); }
  finally {fs.renameSync(`${blob}.fixture-hold`,blob);}
  // Duplicate IDs never become silently reassigned.
  fs.appendFileSync(aFile,'- [2026-10-05 00:00] Duplicate <!-- id:same -->\n');
  await fail(()=>view('migrate-titles',{key:'project-a'}),'CONFLICT');
  fs.writeFileSync(aFile,fs.readFileSync(aFile,'utf8').replace('- [2026-10-05 00:00] Duplicate <!-- id:same -->\n',''));

  let logs = [], prompts = 0;
  const ui = { selectSimpleMenu:async()=>({action:'select',value:'project-a'}), promptText:async()=>{prompts++;return 'no';},
    waitForEnter:async()=>{},clear:()=>{},log:text=>logs.push(text) };
  updateConfig({alpha:0.7}); await handleMaintenanceAction('reset',ui);
  assert.equal(prompts,1); assert.equal(getConfig().alpha,0.7); assert.ok(logs.some(text=>text.includes('Cancelled')));
  ui.promptText = async()=>{updateConfig({alpha:0.8});return 'yes';}; await handleMaintenanceAction('reset',ui);
  assert.equal(getConfig().alpha,0.8); assert.ok(logs.some(text=>text.includes('CONFLICT')));
  ui.promptText = async()=>'yes'; await handleMaintenanceAction('reset',ui); assert.equal(getConfig().alpha,0.5);
  assert.throws(()=>parseMaintenanceCommand(['preview','--operation','reset-settings','--operation','reset-settings']),/Repeated/);

  for (const entry of ['cli_boot.js','boot.js','index.js']) {
    const run = spawnSync(process.execPath,[join(cwd,'mcp-server',entry),'maintenance','status'],{env:process.env,encoding:'utf8',timeout:20000});
    assert.equal(run.status,0,run.stderr); assert.equal(JSON.parse(run.stdout).localOnly,true);
  }
  app = await startDashboard();
  const url = new URL(app.url), origin = url.origin, token = url.hash.slice(1);
  const request = (method,body,extra={}) => fetch(`${origin}/api/maintenance`,{method,headers:{Authorization:`Bearer ${token}`,Origin:origin,'Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('GET')).status,200);
  assert.equal((await request('POST',{action:'preview',operation:'reset-settings',shell:'arbitrary'})).status,400);
  assert.equal((await request('POST',{action:'preview',operation:'reset-settings'},{Origin:'https://foreign.example'})).status,403);
  assert.equal((await fetch(`${origin}/api/maintenance`)).status,401);
  updateConfig({alpha:0.65}); const httpView = await (await request('POST',{action:'preview',operation:'reset-settings'})).json();
  assert.ok(httpView.previewToken); const httpSave = await request('POST',{action:'apply',operation:'reset-settings',previewToken:httpView.previewToken,confirm:true});
  assert.equal(httpSave.status,200); assert.equal(getConfig().alpha,0.5);
  assert.ok((await fetch(`${origin}/maintenance.js`)).ok);
  console.log('PASS maintenance: scoped migrations, stable legacy IDs, links/history, ZIP backups, settings restore/integrity, CAS/backup race, journal recovery, TUI and CLI/HTTP guards');
} finally {
  if(app) await app.close(); closeDatabase(); process.chdir(cwd); fs.rmSync(root,{recursive:true,force:true,maxRetries:5});
}
