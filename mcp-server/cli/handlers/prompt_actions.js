import { selectSimpleMenu, promptText, waitForEnter } from '../ui.js';
import { promptRequest } from '../../services/prompt_service.js';

const terminal = { selectSimpleMenu, promptText, waitForEnter, clear: () => console.clear(), log: text => console.log(text) };
export async function handlePromptAction(value, ui = terminal) {
  if (!['enable_prompt', 'disable_prompt'].includes(value)) return;
  try {
    const status = await promptRequest({ action: 'status' });
    const choice = await ui.selectSimpleMenu({ title: 'GLOBAL CLIENT FILE', subtitle: 'Managed files only; MCP/plugin activation is separate',
      items: [...status.items.map(item => ({ value: item.id, label: item.name,
        info: `${item.filePath} | ${item.unavailable ? item.code : item.integration.pluginManaged ? 'marketplace-owned: skip' : `prompt=${item.prompt}, persona=${item.persona}`}` })),
      { value: 'back', label: '< Back' }] });
    if (choice.action !== 'select' || choice.value === 'back') return;
    const operation = value === 'enable_prompt' ? 'enable' : 'disable';
    const view = await promptRequest({ action: 'preview', client: choice.value, operation });
    ui.clear(); ui.log(`\n  ${view.target.name}: ${view.target.filePath}\n  ${view.ownership} | active session: not observed`);
    if (!view.canApply) { ui.log('  [SKIPPED] Marketplace plugin owns this client channel.'); return; }
    ui.log(`\n  CURRENT (${view.current.hash || 'missing'}):\n${view.current.text}\n  AFTER ${operation}:\n${view.proposed.text}`);
    if (view.sharedPrompt.changes) ui.log(`\n  Shared include changes for every referencing client: ${view.sharedPrompt.path}\n${view.sharedPrompt.proposedText}`);
    if (!view.changed) { ui.log('  [UNCHANGED] No file changes.'); return; }
    ui.log(`  ${view.proposed.removeFile ? 'Deletes the unmodified file originally created by this service.' : 'Preserves text outside managed blocks.'} Local backup precedes writes.`);
    if (!/^(y|yes)$/i.test((await ui.promptText('Confirm this client file change? [y/N]:')).trim())) { ui.log('  Cancelled.'); return; }
    const result = await promptRequest({ action: 'apply', client: choice.value, operation, previewToken: view.previewToken, confirm: true });
    ui.log(`  [${result.status}] ${result.name}. Backup: ${result.backup || 'none'}. Active session: not observed.`);
  } catch (error) { ui.log(`  [${error.code || 'UNAVAILABLE'}] ${['UNSUPPORTED', 'CONFLICT', 'RECOVERY_REQUIRED', 'INVALID'].includes(error.code) ? error.message : 'Client file operation failed; refresh state before retrying.'}`); }
  finally { await ui.waitForEnter(); }
}
