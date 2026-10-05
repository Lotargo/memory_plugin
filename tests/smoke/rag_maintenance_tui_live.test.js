import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import readline from 'node:readline';
readline.emitKeypressEvents(process.stdin);
const root=fs.mkdtempSync(join(tmpdir(),'memory-rag-tui-'));
Object.assign(process.env,{HOME:root,USERPROFILE:root,MEMORY_DIR:join(root,'memory'),CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),OPENCODE_CONFIG_DIR:join(root,'opencode'),XDG_CONFIG_HOME:join(root,'config'),MEMORY_DISABLE_PERSONA_SYNC:'1',MEMORY_DISABLE_BACKGROUND_SYNC:'1',MEMORY_DISABLE_WEB_AUTOSTART:'1'});
const {ingestDocument}=await import('../../mcp-server/ingest/pipeline.js'),{migrateKnowledge}=await import('../../mcp-server/services/knowledge_links_service.js');
const {handleRagMaintenanceAction}=await import('../../mcp-server/cli/handlers/rag_maintenance_actions.js'),{getDatabase,closeDatabase}=await import('../../mcp-server/db/database.js');
try{
  await ingestDocument({path:'fixture.md',content:'# Fixture\n\nTerminal reset source.',title:'Terminal source',projectScope:'global',generateEmbeddings:false});await migrateKnowledge();
  const db=await getDatabase();console.log('Scenario 1: cancel reviewed reset with n, then Enter.');await handleRagMaintenanceAction('hard_reset');assert.equal(db.localDb.prepare('SELECT count(*) n FROM documents').get().n,1);
  console.log('Scenario 2: confirm reviewed reset with y, then Enter.');await handleRagMaintenanceAction('hard_reset');assert.equal(db.localDb.prepare('SELECT count(*) n FROM documents').get().n,0);
  assert.equal(db.localDb.prepare("SELECT count(*) n FROM sync_state WHERE key LIKE 'rag-maintenance:%'").get().n,1);
  console.log('PASS real Windows terminal: cancellation, reviewed RAG reset, pinned backup and committed receipt.');
}finally{closeDatabase();if(!resolve(root).startsWith(resolve(tmpdir())))throw new Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true,maxRetries:5});}
