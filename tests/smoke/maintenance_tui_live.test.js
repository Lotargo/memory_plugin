import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';
readline.emitKeypressEvents(process.stdin);
const root=fs.mkdtempSync(join(tmpdir(),'memory-maintenance-tui-'));
Object.assign(process.env,{HOME:root,USERPROFILE:root,MEMORY_DIR:join(root,'memory'),CODEX_HOME:join(root,'codex'),
  CLAUDE_CONFIG_DIR:join(root,'claude'),OPENCODE_CONFIG_DIR:join(root,'opencode'),XDG_CONFIG_HOME:join(root,'config'),
  MEMORY_DISABLE_PERSONA_SYNC:'1',MEMORY_DISABLE_BACKGROUND_SYNC:'1',MEMORY_DISABLE_WEB_AUTOSTART:'1'});
const {updateConfig,getConfig}=await import('../../mcp-server/config/config_manager.js');
const {handleMaintenanceAction}=await import('../../mcp-server/cli/handlers/maintenance_actions.js');
const {closeDatabase}=await import('../../mcp-server/db/database.js');
try {
  updateConfig({alpha:0.8});
  console.log('Isolated terminal scenario 1: cancel with n, then Enter.');
  await handleMaintenanceAction('reset');assert.equal(getConfig().alpha,0.8);
  console.log('PASS cancellation; scenario 2: confirm with y, then Enter.');
  await handleMaintenanceAction('reset');assert.equal(getConfig().alpha,0.5);
  console.log('PASS real terminal reset: cancellation, reviewed apply, backup and readback.');
} finally {closeDatabase();fs.rmSync(root,{recursive:true,force:true,maxRetries:5});}
