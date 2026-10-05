import fs from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import readline from 'node:readline';
readline.emitKeypressEvents(process.stdin);
const root=fs.mkdtempSync(join(tmpdir(),'memory-diagnostics-tui-'));
Object.assign(process.env,{HOME:root,USERPROFILE:root,MEMORY_DIR:join(root,'memory'),CODEX_HOME:join(root,'codex'),OPENCODE_CONFIG_DIR:join(root,'opencode'),XDG_CONFIG_HOME:join(root,'config'),MEMORY_DISABLE_PERSONA_SYNC:'1',MEMORY_DISABLE_BACKGROUND_SYNC:'1',MEMORY_DISABLE_WEB_AUTOSTART:'1'});
const {saveBlob,blobExists}=await import('../../mcp-server/storage/blob_store.js');
const {closeDatabase}=await import('../../mcp-server/db/database.js');
const {handleCasAction}=await import('../../mcp-server/cli/handlers/cas_actions.js');
try {
  const blob=await saveBlob('Disposable terminal source');
  await handleCasAction('cas_cleanup');
  if(!await blobExists(blob.hash))throw new Error('Cancellation did not preserve the fixture file');
  console.log('PASS cancellation; confirm the next reviewed cleanup with y.');
  await handleCasAction('cas_cleanup');
  if(await blobExists(blob.hash))throw new Error('Confirmed cleanup did not remove the unused fixture file');
  console.log('PASS reviewed cleanup; select its receipt and confirm restoration with y.');
  await handleCasAction('cas_restore');
  if(!await blobExists(blob.hash))throw new Error('Confirmed restore did not recover the fixture file');
  await handleCasAction('graph_test');
  console.log('PASS Windows PTY cancelled/applied cleanup, reviewed restore and isolated diagnostic check');
}finally{
  closeDatabase();if(dirname(resolve(root))!==resolve(tmpdir())||!root.startsWith(join(tmpdir(),'memory-diagnostics-tui-')))throw new Error('Unsafe fixture cleanup target');
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5});
}
