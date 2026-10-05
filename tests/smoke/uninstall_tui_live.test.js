import fs from 'node:fs';
import readline from 'node:readline';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
readline.emitKeypressEvents(process.stdin);
const root=fs.mkdtempSync(join(tmpdir(),'memory-uninstall-tui-'));
Object.assign(process.env,{HOME:root,USERPROFILE:root,MEMORY_DIR:join(root,'memory'),CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),OPENCODE_CONFIG_DIR:join(root,'opencode'),XDG_CONFIG_HOME:join(root,'config'),MEMORY_DISABLE_PERSONA_SYNC:'1',MEMORY_DISABLE_BACKGROUND_SYNC:'1',MEMORY_DISABLE_WEB_AUTOSTART:'1'});
const {resolveClientPaths}=await import('../../mcp-server/client_paths.js');
const {handleUninstallAction}=await import('../../mcp-server/cli/handlers/uninstall_actions.js');
const paths=resolveClientPaths();fs.mkdirSync(paths.opencodeDir,{recursive:true});
fs.writeFileSync(paths.opencodeConfigPath,JSON.stringify({plugin:['@lotargo/memory_plugin','@vendor/keep']}));
try {
  await handleUninstallAction('client_uninstall');
  if(!JSON.parse(fs.readFileSync(paths.opencodeConfigPath)).plugin.includes('@lotargo/memory_plugin'))throw new Error('Cancellation changed the registration');
  console.log('PASS cancellation; select OpenCode and confirm next removal with yes.');
  await handleUninstallAction('client_uninstall');
  if(JSON.parse(fs.readFileSync(paths.opencodeConfigPath)).plugin.includes('@lotargo/memory_plugin'))throw new Error('Confirmed removal left the owned registration');
  console.log('PASS removal; select OpenCode, its receipt and confirm restore with yes.');
  await handleUninstallAction('client_restore');
  if(!JSON.parse(fs.readFileSync(paths.opencodeConfigPath)).plugin.includes('@lotargo/memory_plugin'))throw new Error('Restore did not return the registration');
  console.log('PASS Windows PTY cancellation, reviewed removal and exact receipt restoration');
}finally{
  if(dirname(resolve(root))!==resolve(tmpdir())||!root.startsWith(join(tmpdir(),'memory-uninstall-tui-')))throw new Error('Unsafe fixture cleanup target');
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5});
}
