// Live snapshot transport in an owned temporary table on the configured Turso.
// No production snapshot table or user memory is read/written by the test client.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
if(!process.argv.includes('--child')){
  const {loadSecrets}=await import('../../mcp-server/config/auth_store.js');const secrets=loadSecrets();
  if(!secrets?.dbUrl||!secrets.token||secrets.needsResolution){console.log(JSON.stringify({status:'UNVERIFIED',reason:'Direct configured database credentials unavailable'}));process.exit(0);}
  const result=spawnSync(process.execPath,[process.argv[1],'--child'],{env:{...process.env,TURSO_DB_URL:secrets.dbUrl,TURSO_DB_TOKEN:secrets.token},encoding:'utf8',timeout:60000});
  process.stdout.write(result.stdout||'');if(result.error)console.log(JSON.stringify({status:'UNVERIFIED',reason:'Live child timeout or execution failure'}));process.exitCode=result.status??1;
}else{
  const root=fs.mkdtempSync(join(tmpdir(),'knowledge-cloud-live-'));process.env.MEMORY_DIR=join(root,'memory');process.env.OPENCODE_CONFIG_DIR=join(root,'opencode');process.env.MEMORY_DISABLE_PERSONA_SYNC='1';process.env.MEMORY_DISABLE_BACKGROUND_SYNC='1';
  const {createClient}=await import('@libsql/client');const actual=createClient({url:process.env.TURSO_DB_URL,authToken:process.env.TURSO_DB_TOKEN});
  const table=`kb_acceptance_${randomUUID().replaceAll('-','')}`,index=`idx_${table}`;assert.match(table,/^kb_acceptance_[a-f0-9]{32}$/);
  let writes=0,created=false,result;
  const mapped={async execute(request){const sql=typeof request==='string'?request:request.sql;
    const translated=sql.replaceAll('idx_memory_snapshots_created',index).replaceAll('memory_snapshots',table);
    const response=await actual.execute(typeof request==='string'?translated:{...request,sql:translated});if(/^CREATE TABLE/.test(sql))created=true;if(/^INSERT/.test(sql))writes+=Number(response.rowsAffected);return response;}};
  const {closeDatabase,BLOBS_DIR}=await import('../../mcp-server/db/database.js');
  try{
    const {createKnowledgeFixture}=await import('../fixtures/knowledge_fixture.js'),f=await createKnowledgeFixture();
    await (await import('../../mcp-server/services/knowledge_links_service.js')).migrateKnowledge();
    const {CloudSnapshots}=await import('../../mcp-server/admin/cloud_snapshots.js'),{getConfig}=await import('../../mcp-server/config/config_manager.js');
    const api=new CloudSnapshots({db:f.db,client:mapped,memoryDir:process.env.MEMORY_DIR,blobDir:BLOBS_DIR,config:()=>({...getConfig(),mode:'cloud-snapshots',legacyCloudBackupRequired:false,legacyCloudRestoreRequired:false})});
    const upload=await api.upload();
    if(upload.status!=='uploaded')result={status:'UNVERIFIED',reason:upload.quotaBlocked?'Provider quota blocks live upload':'Provider rejected live upload',providerCode:String(upload.reason||'UNKNOWN').slice(0,100)};
    else{
      assert.equal((await api.list({location:'cloud'})).length,1);const loaded=await api.load(upload.snapshot.id,'cloud');assert.ok(loaded.payload.tables.documents.some(row=>row.id===f.note));
      const {manageKnowledgeRemoval}=await import('../../mcp-server/services/knowledge_removal_service.js');const input={scopeKey:f.a,docId:f.note,operation:'delete'},preview=await manageKnowledgeRemoval({action:'preview',...input});
      await manageKnowledgeRemoval({action:'apply',...input,previewToken:preview.previewToken,confirm:true});const next=await api.upload();assert.equal(next.status,'uploaded');
      const after=await api.load(next.snapshot.id,'cloud');assert.ok(!after.payload.tables.documents.some(row=>row.id===f.note));
      const historic=await api.load(upload.snapshot.id,'cloud');assert.ok(historic.payload.tables.documents.some(row=>row.id===f.note));
      result={status:'PASS',rowsWritten:writes,checkpoints:2,currentDelete:true,historicalPreserved:true,namespace:table};
    }
  }catch(error){result={status:'UNVERIFIED',reason:'Live transport or checkpoint verification failed',providerCode:String(error.code||error.name||'UNKNOWN').slice(0,80),namespace:table};}
  finally{
    if(created){try{await actual.execute(`DROP TABLE ${table}`);result.cleanup='complete';}catch{result.cleanup='pending';result.namespace=table;}}
    else result.cleanup='no-test-table-created';actual.close();closeDatabase();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));fs.rmSync(root,{recursive:true,force:true,maxRetries:5});
  }
  console.log(JSON.stringify(result));if(result.status!=='PASS')process.exitCode=2;
}
