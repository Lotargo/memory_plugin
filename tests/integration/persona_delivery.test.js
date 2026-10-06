import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = fs.mkdtempSync(join(tmpdir(), 'memory-persona-delivery-'));
const env = { HOME: root, USERPROFILE: root, MEMORY_DIR: join(root, 'memory'), XDG_CONFIG_HOME: join(root, 'config'),
  CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude'), OPENCODE_CONFIG_DIR: join(root, 'opencode'),
  MEMORY_DISABLE_PERSONA_SYNC: '1', MEMORY_DISABLE_BACKGROUND_SYNC: '1', MEMORY_DISABLE_WEB_AUTOSTART: '1' };
Object.assign(process.env, env);
const { writeMemory, readMemory, storeFilePath } = await import('../../mcp-server/memory.js');
const { closeDatabase } = await import('../../mcp-server/db/database.js');
const { personaDeliveryRequest: request, PERSONA_DELIVERY_PATHS: P } = await import('../../mcp-server/services/persona_delivery_service.js');
const { compilePersona } = await import('../../mcp-server/context/persona_context.js');
const { buildPersonaOverlayBlock, buildIncludeBlock, PROMPT_BLOCK } = await import('../../mcp-server/prompt_manager.js');
const { rememberFact, updateFactText, forgetFacts, recallFacts } = await import('../../mcp-server/tools/core/memory_core.js');
const { previewPersonaContext } = await import('../../mcp-server/services/persona_service.js');
const { promptRequest } = await import('../../mcp-server/services/prompt_service.js');
const { uninstallRequest } = await import('../../mcp-server/services/uninstall_service.js');
const { parsePersonaCommand } = await import('../../mcp-server/cli/persona_commands.js');
const put = (file, text) => { fs.mkdirSync(join(file, '..'), { recursive: true }); fs.writeFileSync(file, text); };
const text = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const preview = (operation = 'migrate', extra = {}) => request({ action: 'preview', operation, ...extra });
const apply = view => request({ action: 'apply', operation: view.operation, ...(view.operation === 'restore' ? { backupId: view.backupId } : { clients: view.clients }), previewToken: view.previewToken, confirm: true });
let network = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { network++; throw new Error('No network allowed'); };
try {
  const lines = [
    '- [2099-01-01 10:00] **Style** — Use a warm concise voice <!-- id:voice, kind:directive, keep:1 -->',
    '- [2099-01-01 10:00] **Legacy** — Preserve literal evidence <!-- id:legacy, tags:style -->',
    '- [2099-01-01 10:00] **Fact** — The user works locally <!-- id:fact, kind:fact, tags:persona -->',
    '- [2099-01-01 10:00] **Disabled** — Do not activate this rule <!-- id:disabled, kind:directive, disabled:1 -->',
    '- [2000-01-01 10:00] **Expired** — An old rule <!-- id:expired, kind:directive, ttl:1d, keep:1 -->',
    '- [2099-01-01 10:00] **Replaced** — A replaced rule <!-- id:old, kind:directive, supersededBy:voice -->',
  ];
  await writeMemory('global', lines);
  const notebookBefore = text(storeFilePath('global'));
  const legacy = buildPersonaOverlayBlock(lines);
  for (const file of [P.codex, P.claude, P.gemini, P.antigravity]) put(file, `# User-owned guidance\n\n${PROMPT_BLOCK}\n\n${legacy}\n`);
  put(P.prompt, PROMPT_BLOCK + '\n');
  for (const file of [P.claude, P.gemini]) put(file, `# User-owned guidance\n\n${buildIncludeBlock(P.prompt)}\n\n${legacy}\n`);
  put(P.claudeSettings, JSON.stringify({ permissions: { deny: ['Read(private)'] }, unrelated: 42 }));
  put(join(root, 'codex', 'config.toml'), '[plugins."memory@lotargo-memory-local"]\nenabled = true\n');
  const beforeFiles = new Map([P.codex, P.claude, P.gemini, P.antigravity, P.claudeSettings].map(file => [file, text(file)]));
  let view = await preview();
  assert.equal(view.directiveCount, 2); assert.deepEqual(view.sourceIds, ['voice', 'legacy']);
  assert.equal(view.notebookChanged, false); assert.equal(view.persona, compilePersona(lines).persona);
  for (const [file, before] of beforeFiles) assert.equal(text(file), before);
  assert.equal(fs.existsSync(P.field), false); assert.equal(fs.existsSync(P.state), false);
  // Every observed client file, not just the Notebook, participates in CAS.
  put(P.codex, text(P.codex) + '\nConcurrent edit');
  await assert.rejects(apply(view), { code: 'CONFLICT' });
  put(P.codex, beforeFiles.get(P.codex));
  const originalRename = fs.renameSync;
  let injected = false;
  fs.renameSync = (from, to) => {
    if (!injected && to === P.claudeSettings) { injected = true; throw Object.assign(new Error('Injected publication failure'), { code: 'EPROTO' }); }
    return originalRename(from, to);
  };
  try { await assert.rejects(apply(await preview()), /Injected publication failure/); }
  finally { fs.renameSync = originalRename; }
  assert.equal(injected, true);
  for (const [file, before] of beforeFiles) assert.equal(text(file), before, 'a failed migration rolls back every published file');
  assert.equal(fs.existsSync(P.claudeStyle), false); assert.equal(fs.existsSync(P.journal), false);
  const saved = await apply(await preview());
  assert.equal(saved.status, 'saved'); assert.ok(fs.existsSync(saved.backup));
  assert.equal(text(storeFilePath('global')), notebookBefore, 'migration never edits Notebook metadata or bodies');
  assert.match(text(P.field), /Use a warm concise voice/);
  assert.doesNotMatch(text(P.field), /old rule|Do not activate|replaced rule|works locally/i);
  assert.match(text(P.codex), /Use a warm concise voice/);
  assert.match(text(P.claudeStyle), /keep-coding-instructions: true/);
  assert.match(text(P.claudeStyle), /Preserve literal evidence/);
  assert.equal(JSON.parse(text(P.claudeSettings)).outputStyle, 'memory-persona');
  assert.equal(JSON.parse(text(P.claudeSettings)).unrelated, 42);
  assert.deepEqual(JSON.parse(text(P.claudeSettings)).permissions, { deny: ['Read(private)'] });
  assert.doesNotMatch(text(P.claude), /START MEMORY PERSONA/);
  for (const file of [P.claude, P.gemini]) {
    assert.match(text(file), /\n@/); assert.doesNotMatch(text(file), /SESSION INITIALIZATION/);
  }
  assert.doesNotMatch(text(P.antigravity), /START MEMORY PERSONA/);
  assert.match(text(P.gemini), /Use a warm concise voice/);
  for (const file of [P.codex, P.claude, P.gemini, P.antigravity]) assert.match(text(file), /User-owned guidance/);
  assert.equal((await apply(await preview())).status, 'up_to_date', 'migration is idempotent');
  // Completed migrations can be restored by a bounded, checksummed backup.
  const restore = await preview('restore', { backupId: saved.backupId });
  await apply(restore);
  for (const [file, before] of beforeFiles) assert.equal(text(file), before);
  assert.equal(fs.existsSync(P.field), false); assert.equal(fs.existsSync(P.claudeStyle), false);
  assert.equal(text(storeFilePath('global')), notebookBefore);
  await apply(await preview());
  const p = await previewPersonaContext({ key: 'global', client: 'claude' });
  assert.equal(p.persona, compilePersona(lines).persona); assert.equal(p.nativeDeliveryEnabled, true);
  const recalled = await recallFacts({ scope: 'global' });
  assert.match(recalled, /Disabled.*\[INACTIVE_DIRECTIVE\].*\[DISABLED\]/);
  assert.match(recalled, /Expired.*\[EXPIRED\].*\[INACTIVE_DIRECTIVE\]/);
  // Existing memory writes continue to drive every native projection.
  delete process.env.MEMORY_DISABLE_PERSONA_SYNC;
  await rememberFact({ scope: 'global', title: 'New style', fact: 'Explain decisions plainly', kind: 'directive' });
  assert.match(text(P.claudeStyle), /Explain decisions plainly/); assert.match(text(P.codex), /Explain decisions plainly/);
  await updateFactText({ scope: 'global', id: 'Explain decisions plainly', newText: 'Only historical context', kind: 'fact' });
  assert.doesNotMatch(text(P.field), /Explain decisions plainly|Only historical context/);
  await forgetFacts({ scope: 'global', query: 'Only historical context', force: true });
  // User-selected output styles are preserved, with the same field delivered as instructions.
  const settings = JSON.parse(text(P.claudeSettings)); settings.outputStyle = 'My style'; put(P.claudeSettings, JSON.stringify(settings));
  await apply(await preview('sync'));
  assert.equal(JSON.parse(text(P.claudeSettings)).outputStyle, 'My style');
  assert.match(text(P.claude), /Use a warm concise voice/); assert.equal(fs.existsSync(P.claudeStyle), false);
  // Legacy memory prompt enable must not put the persona back into agy's second file.
  const prompt = await promptRequest({ action: 'preview', client: 'antigravity', operation: 'enable' });
  await promptRequest({ action: 'apply', client: 'antigravity', operation: 'enable', previewToken: prompt.previewToken, confirm: true });
  assert.doesNotMatch(text(P.antigravity), /START MEMORY PERSONA/);
  // User edits to generated field are preserved and block a stale automatic overwrite.
  const field = text(P.field); put(P.field, field + '\nUser edit');
  await assert.rejects(preview('sync'), { code: 'CONFLICT' }); put(P.field, field);
  // Direct-client uninstall/restore includes new projections and the native selector.
  put(P.claudeSettings, JSON.stringify({ ...settings, outputStyle: 'memory-persona' }));
  await apply(await preview('sync'));
  const removal = await uninstallRequest({ action: 'preview', client: 'claude', operation: 'uninstall' });
  assert.ok(removal.files.some(file => file.id === 'persona-style'));
  assert.ok(removal.files.some(file => file.id === 'persona-settings'));
  const removed = await uninstallRequest({ action: 'apply', client: 'claude', operation: 'uninstall', previewToken: removal.previewToken, confirm: true });
  assert.equal(fs.existsSync(P.claudeStyle), false); assert.equal(JSON.parse(text(P.claudeSettings)).outputStyle, undefined);
  const recovery = await uninstallRequest({ action: 'preview', client: 'claude', operation: 'restore', backupId: removed.operationId });
  await uninstallRequest({ action: 'apply', client: 'claude', operation: 'restore', backupId: removed.operationId, previewToken: recovery.previewToken, confirm: true });
  assert.equal(JSON.parse(text(P.claudeSettings)).outputStyle, 'memory-persona'); assert.ok(fs.existsSync(P.claudeStyle));
  assert.deepEqual(parsePersonaCommand(['migrate', '--dry-run']), { action: 'preview', operation: 'migrate' });
  assert.throws(() => parsePersonaCommand(['sync', '--dry-run', '--confirm']));
  const cli = spawnSync(process.execPath, ['mcp-server/cli_boot.js', 'persona', 'sync', '--dry-run'], { cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr); const cliView = JSON.parse(cli.stdout);
  assert.equal(cliView.directiveCount, 2); assert.equal(Object.hasOwn(cliView, 'persona'), false);
  assert.equal(network, 0);
  await assert.rejects(request({ action: 'preview', operation: 'sync', clients: false }), { code: 'INVALID' });
  await assert.rejects(preview('disable', { clients: ['opencode'] }), { code: 'UNSUPPORTED' });
  // Disabling projections and then removing OpenCode's plugin must not bring
  // legacy files back on the next remember() call.
  for (const client of ['claude', 'codex', 'gemini', 'antigravity']) await apply(await preview('disable', { clients: [client] }));
  const off = await uninstallRequest({ action: 'preview', operation: 'uninstall', client: 'opencode' });
  await uninstallRequest({ action: 'apply', operation: 'uninstall', client: 'opencode', previewToken: off.previewToken, confirm: true });
  assert.equal((await request({ action: 'status' })).clients.length, 0);
  await rememberFact({ scope: 'global', title: 'After removal', fact: 'Keep disabled client projections disabled', kind: 'directive' });
  assert.equal(fs.existsSync(P.field), false); assert.doesNotMatch(text(P.codex), /Keep disabled client projections/);
  console.log('PASS native persona: one field, exclusions, CAS, unchanged Notebook, idempotent migration/restore, automatic memory writes, user styles, uninstall and CLI.');
} finally {
  globalThis.fetch = originalFetch; await closeDatabase();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
