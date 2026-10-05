import fs from 'node:fs';
import readline from 'node:readline';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, delimiter } from 'node:path';
readline.emitKeypressEvents(process.stdin);
const root=fs.mkdtempSync(join(tmpdir(),'memory-clients-tui-')),bin=join(root,'bin');fs.mkdirSync(bin);
Object.assign(process.env,{HOME:root,USERPROFILE:root,MEMORY_DIR:join(root,'memory'),CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),OPENCODE_CONFIG_DIR:join(root,'opencode'),XDG_CONFIG_HOME:join(root,'config'),MEMORY_DISABLE_PERSONA_SYNC:'1',MEMORY_DISABLE_BACKGROUND_SYNC:'1',MEMORY_DISABLE_WEB_AUTOSTART:'1',MEMORY_PLUGIN_DISABLE_NATIVE_CLI:'0',PATH:`${bin}${delimiter}${process.env.PATH}`});
const {handleClientAction}=await import('../../mcp-server/cli/handlers/client_actions.js');
const {clientRequest}=await import('../../mcp-server/services/client_service.js');
const {resolveClientPaths}=await import('../../mcp-server/client_paths.js');
const paths=resolveClientPaths(),cli=join(bin,process.platform==='win32'?'codex.cmd':'codex');
fs.mkdirSync(paths.opencodeDir,{recursive:true});fs.writeFileSync(paths.opencodeConfigPath,JSON.stringify({plugin:['@lotargo/memory_plugin']}));
fs.writeFileSync(cli,process.platform==='win32'?'@echo off\r\necho codex 1.2.3\r\n':'#!/bin/sh\necho codex 1.2.3\n');if(process.platform!=='win32')fs.chmodSync(cli,0o755);
try {
  await handleClientAction('client_status');
  if(fs.existsSync(process.env.MEMORY_DIR))throw new Error('Status initialized user data');
  console.log('PASS status. Cancel the client selection next with Escape.');
  await handleClientAction('client_probe');
  if((await clientRequest({action:'status',client:'codex'})).items[0].lastProbe)throw new Error('Cancelled selection ran a probe');
  console.log('PASS cancellation. Choose Codex, then CLI Version.');
  await handleClientAction('client_probe');
  const probe=(await clientRequest({action:'status',client:'codex'})).items[0].lastProbe;
  if(probe?.status!=='passed'||probe.cliVersion!=='1.2.3')throw new Error('Terminal did not execute the explicit version probe');
  console.log('PASS Windows PTY status, cancellation and explicit version probe');
}finally{
  if(dirname(resolve(root))!==resolve(tmpdir())||!root.startsWith(join(tmpdir(),'memory-clients-tui-')))throw new Error('Unsafe fixture cleanup');
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5});
}
