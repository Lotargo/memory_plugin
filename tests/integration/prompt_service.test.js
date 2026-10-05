import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(join(tmpdir(), 'memory-prompts-')), previousCwd = process.cwd();
Object.assign(process.env, { HOME: root, USERPROFILE: root, MEMORY_DIR: join(root, 'memory'), XDG_CONFIG_HOME: join(root, 'config'),
  CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude'), OPENCODE_CONFIG_DIR: join(root, 'opencode'),
  MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_DISABLE_WEB_AUTOSTART: '1' });
const cliBoot = join(previousCwd, 'mcp-server', 'cli_boot.js'), boot = join(previousCwd, 'mcp-server', 'boot.js');
process.chdir(root);
const { promptRequest, managePromptTargets } = await import('../../mcp-server/services/prompt_service.js');
const { enableGlobalPrompt, disableGlobalPrompt, syncPersonaPrompts, START_MARKER, END_MARKER, PROMPT_BLOCK } = await import('../../mcp-server/prompt_manager.js');
const { handlePromptAction } = await import('../../mcp-server/cli/handlers/prompt_actions.js');
const { parsePromptCommand } = await import('../../mcp-server/cli/prompt_commands.js');
const { writeMemory } = await import('../../mcp-server/memory.js');
const { closeDatabase } = await import('../../mcp-server/db/database.js');
const { startDashboard } = await import('../../mcp-server/dashboard/server.js');
const { resolveClientPaths } = await import('../../mcp-server/client_paths.js');
const paths = resolveClientPaths();
const put = (file, text) => { fs.mkdirSync(join(file, '..'), { recursive: true }); fs.writeFileSync(file, text); };
const text = file => fs.readFileSync(file, 'utf8');
const codex = join(root, 'codex', 'AGENTS.md'), claude = join(root, 'claude', 'CLAUDE.md'), gemini = join(root, '.gemini', 'GEMINI.md');
const journal = join(paths.agentConfigDir, 'prompt-journal.json');
const directive = '- [2026-10-05 00:00] **Style** — Keep fixture replies concise <!-- id:one, kind:directive -->';
const view = (client = 'codex', operation = 'enable') => promptRequest({ action: 'preview', client, operation });
const save = preview => promptRequest({ action: 'apply', client: preview.target.id, operation: preview.operation, previewToken: preview.previewToken, confirm: true });
const fail = (action, code) => assert.rejects(action, error => error.code === code);
let app;
try {
  await writeMemory('global', [directive]);
  const before = fs.readdirSync(root);
  const initial = await promptRequest({ action: 'status' });
  assert.equal(initial.items.length, 4); assert.equal(initial.native.fileManaged, false);
  const first = await view();
  assert.equal(first.current.exists, false); assert.ok(first.persona.expectedBlock.includes('Keep fixture'));
  assert.deepEqual(fs.readdirSync(root), before, 'status and preview must not create client/config files');
  assert.equal(fs.existsSync(paths.promptFile), false);
  await fail(() => promptRequest({ action: 'apply', client: 'codex', operation: 'enable', previewToken: first.previewToken }), 'CONFIRMATION');
  await fail(() => promptRequest({ action: 'preview', client: 'codex', operation: 'enable', filePath: '/arbitrary' }), 'INVALID');
  await fail(() => promptRequest({ action: 'preview', client: 'opencode', operation: 'enable' }), 'INVALID');
  await fail(() => managePromptTargets('enable', ['unknown']), 'INVALID');
  const created = await save(first); assert.equal(created.status, 'created_new_file'); assert.ok(fs.existsSync(created.backup));
  assert.equal(JSON.parse(text(paths.promptStateFile))[codex].existedBefore, false);
  await syncPersonaPrompts(['Codex'], [directive.replace('concise', 'brief')]);
  assert.equal(JSON.parse(text(paths.promptStateFile))[codex].existedBefore, false, 'resync preserves original file provenance');
  await save(await view('codex', 'disable')); assert.equal(fs.existsSync(codex), false, 'unmodified owned new file may be deleted');

  const foreign = '\ufeff# Foreign\r\n\r\nKeep my instructions <script>unsafe()</script>\r\n\r\n\r\nTail\r\n';
  put(codex, foreign); await save(await view());
  assert.ok(text(codex).startsWith(foreign), 'enable preserves foreign bytes and BOM');
  assert.equal(JSON.parse(text(paths.promptStateFile))[codex].existedBefore, true);
  put(codex, text(codex) + '\nNew external instruction');
  assert.equal((await view()).ownership, 'externally-edited');
  assert.equal((await save(await view('codex', 'disable'))).status, 'removed');
  assert.ok(text(codex).startsWith(foreign)); assert.ok(text(codex).includes('New external instruction')); assert.ok(!text(codex).includes('START MEMORY'));

  let stale = await view(); put(codex, text(codex) + '\nConcurrent edit');
  await fail(() => save(stale), 'CONFLICT'); assert.ok(text(codex).endsWith('Concurrent edit'));
  stale = await view(); await writeMemory('global', [directive.replace('concise', 'different')]);
  await fail(() => save(stale), 'CONFLICT'); await writeMemory('global', [directive]);
  stale = await view(); put(paths.promptStateFile, text(paths.promptStateFile) + '\n');
  await fail(() => save(stale), 'CONFLICT');
  stale = await view('claude'); put(paths.promptFile, 'Shared file customization');
  await fail(() => save(stale), 'CONFLICT');
  const include = await view('claude'); assert.equal(include.sharedPrompt.changes, true); assert.ok(include.proposed.text.includes('@'));
  await save(include); assert.equal(text(paths.promptFile), PROMPT_BLOCK + '\n'); assert.equal((await view('claude')).changed, false);

  stale = await view(); put(join(root, 'codex', 'config.toml'), '[plugins."memory@lotargo-memory-local"]\nenabled = true\n');
  await fail(() => save(stale), 'CONFLICT');
  const pluginBefore = text(codex);
  for (const operation of ['enable', 'disable', 'sync']) {
    const preview = await view('codex', operation); assert.equal(preview.canApply, false); assert.equal(preview.sharedPrompt.changes, false);
    assert.equal(preview.proposed.text, preview.current.text); assert.equal((await save(preview)).status, 'plugin_managed');
  }
  assert.equal((await disableGlobalPrompt(['Codex']))[0].status, 'plugin_managed'); assert.equal(text(codex), pluginBefore);
  put(join(root, 'codex', 'config.toml'), '[plugins."memory@lotargo-memory-local"]\nenabled = false\n');
  for (const malformed of [START_MARKER, END_MARKER, `${START_MARKER}${START_MARKER}${END_MARKER}${END_MARKER}`]) {
    put(codex, foreign + malformed); await fail(() => view(), 'UNSUPPORTED'); assert.equal(text(codex), foreign + malformed);
  }
  assert.equal((await promptRequest({ action: 'status' })).items.find(item => item.id === 'codex').unavailable, true);
  put(codex, `${foreign}${PROMPT_BLOCK}\n${PROMPT_BLOCK}`); await save(await view());
  assert.equal(text(codex).split(START_MARKER).length - 1, 1, 'duplicate complete managed blocks collapse');
  const smallEnough = text(codex); put(codex, 'a'.repeat(512 * 1024 - 1));
  await fail(() => view(), 'UNSUPPORTED'); assert.equal(text(codex).length, 512 * 1024 - 1); put(codex, smallEnough);

  const stateBefore = text(paths.promptStateFile); put(paths.promptStateFile, '{broken');
  await fail(() => view(), 'RECOVERY_REQUIRED'); put(paths.promptStateFile, stateBefore);
  const heldClaude = join(root, 'claude-held');
  fs.renameSync(join(root, 'claude'), heldClaude);
  fs.symlinkSync(heldClaude, join(root, 'claude'), process.platform === 'win32' ? 'junction' : 'dir');
  try { await fail(() => view('claude'), 'UNSUPPORTED'); }
  finally { fs.unlinkSync(join(root, 'claude')); fs.renameSync(heldClaude, join(root, 'claude')); }
  await writeMemory('global', [directive.replace('concise', START_MARKER)]);
  assert.ok(!(await view()).persona.expectedBlock.includes(START_MARKER), 'Notebook comment syntax does not become a prompt delimiter');
  await writeMemory('global', [directive]);
  // Inject a real filesystem failure after the first write to verify rollback.
  await save(await view('claude', 'disable')); put(claude, 'Existing Claude instructions'); put(paths.promptFile, 'Before failed include');
  const rollbackPreview = await view('claude'), claudeBefore = text(claude), sharedBefore = text(paths.promptFile), ownerBefore = text(paths.promptStateFile);
  const originalRename = fs.renameSync; let inject = true;
  fs.renameSync = (from, to) => { if (to === claude && inject) { inject = false; throw Object.assign(new Error('fixture denied'), { code: 'EIO' }); } return originalRename(from, to); };
  try { await assert.rejects(() => save(rollbackPreview)); } finally { fs.renameSync = originalRename; }
  assert.equal(text(claude), claudeBefore); assert.equal(text(paths.promptFile), sharedBefore); assert.equal(text(paths.promptStateFile), ownerBefore); assert.equal(fs.existsSync(journal), false);
  const recoveryFile = { path: codex, before: { exists: true, text: text(codex) }, after: { exists: true, text: 'Interrupted write' } };
  put(codex, recoveryFile.after.text); put(journal, JSON.stringify({ phase: 'pending', files: [recoveryFile] }));
  await fail(() => view(), 'RECOVERY_REQUIRED'); assert.equal((await promptRequest({ action: 'status' })).recoveryRequired, true);
  await fail(() => promptRequest({ action: 'recover' }), 'CONFIRMATION');
  assert.equal((await promptRequest({ action: 'recover', confirm: true })).disposition, 'rolled-back'); assert.equal(text(codex), recoveryFile.before.text);
  put(codex, 'External edit after crash'); put(journal, JSON.stringify({ phase: 'pending', files: [recoveryFile] }));
  await fail(() => promptRequest({ action: 'recover', confirm: true }), 'RECOVERY_REQUIRED'); assert.equal(text(codex), 'External edit after crash'); fs.unlinkSync(journal);
  put(codex, recoveryFile.after.text); put(journal, JSON.stringify({ phase: 'committed', files: [recoveryFile] }));
  assert.equal((await promptRequest({ action: 'recover', confirm: true })).disposition, 'committed'); assert.equal(text(codex), recoveryFile.after.text);
  put(journal, JSON.stringify({ phase: 'pending', files: [{ ...recoveryFile, path: join(root, 'arbitrary.md') }] }));
  await fail(() => promptRequest({ action: 'recover', confirm: true }), 'RECOVERY_REQUIRED'); fs.unlinkSync(journal);

  fs.unlinkSync(codex); fs.mkdirSync(codex);
  const partial = await enableGlobalPrompt(['Codex', 'Gemini CLI']); assert.equal(partial.find(item => item.name === 'Codex').status, 'failed'); assert.notEqual(partial.find(item => item.name === 'Gemini CLI').status, 'failed');
  fs.rmdirSync(codex); put(codex, foreign);
  const logs = []; let prompts = 0;
  const tui = { selectSimpleMenu: async () => ({ action: 'select', value: 'codex' }), clear() {}, log(message) { logs.push(message); }, waitForEnter: async () => {},
    promptText: async () => { prompts++; put(codex, foreign + '\nConcurrent TUI edit'); return 'yes'; } };
  await handlePromptAction('enable_prompt', tui); assert.equal(prompts, 1); assert.ok(logs.some(item => item.includes('[CONFLICT]'))); assert.ok(!text(codex).includes(START_MARKER));
  tui.promptText = async () => 'no'; await handlePromptAction('enable_prompt', tui); assert.ok(logs.includes('  Cancelled.')); assert.ok(!text(codex).includes(START_MARKER));
  tui.promptText = async () => 'yes'; await handlePromptAction('enable_prompt', tui); assert.ok(text(codex).includes(START_MARKER));
  assert.throws(() => parsePromptCommand(['preview', '--client', 'codex', '--client', 'claude']), /Repeated/);
  for (const entry of [cliBoot, boot]) {
    const cli = spawnSync(process.execPath, [entry, 'prompts', 'status'], { env: process.env, encoding: 'utf8', timeout: 15000 });
    assert.equal(cli.status, 0, cli.stderr); assert.equal(JSON.parse(cli.stdout).items.length, 4);
  }
  const cliPreview = spawnSync(process.execPath, [cliBoot, 'prompts', 'preview', '--client', 'gemini', '--operation', 'disable'], { env: process.env, encoding: 'utf8' });
  assert.equal(cliPreview.status, 0, cliPreview.stderr);
  const cliApply = spawnSync(process.execPath, [boot, 'prompts', 'apply', '--client', 'gemini', '--operation', 'disable', '--preview-token', JSON.parse(cliPreview.stdout).previewToken, '--confirm'], { env: process.env, encoding: 'utf8' });
  assert.equal(cliApply.status, 0, cliApply.stderr); assert.equal(fs.existsSync(gemini), false);

  app = await startDashboard(); const origin = new URL(app.url).origin, token = new URL(app.url).hash.slice(1);
  const headers = { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' };
  assert.equal((await fetch(origin + '/api/prompts')).status, 401);
  assert.equal((await fetch(origin + '/api/prompts?client=codex', { headers })).status, 400);
  assert.equal((await fetch(origin + '/api/prompts', { headers })).status, 200);
  assert.equal((await fetch(origin + '/api/prompts', { method: 'POST', headers: { ...headers, origin: 'https://foreign.test' }, body: '{}' })).status, 403);
  const httpPreview = await (await fetch(origin + '/api/prompts', { method: 'POST', headers, body: JSON.stringify({ action: 'preview', client: 'codex', operation: 'disable' }) })).json();
  assert.equal(httpPreview.current.exists, true);
  const response = await fetch(origin + '/api/prompts', { method: 'POST', headers, body: JSON.stringify({ action: 'apply', client: 'codex', operation: 'disable', previewToken: httpPreview.previewToken, confirm: true }) });
  assert.equal(response.status, 200); assert.ok(!text(codex).includes(START_MARKER)); assert.equal((await fetch(origin + '/prompts.js')).status, 200);
  console.log('PASS prompt service: read-only preview, exact targets, ownership, foreign UTF-8/BOM, conflicts, includes, marketplace skip, rollback/recovery, partial, TUI, CLI and HTTP');
} finally {
  if (app) await app.close(); closeDatabase(); process.chdir(previousCwd);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
