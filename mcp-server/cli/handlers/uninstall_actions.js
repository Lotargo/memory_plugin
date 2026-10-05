import { selectSimpleMenu, promptText, waitForEnter } from '../ui.js';
import { uninstallRequest } from '../../services/uninstall_service.js';
const terminal = { selectSimpleMenu, promptText, waitForEnter, clear: () => console.clear(), log: text => console.log(text) };
export async function handleUninstallAction(value, ui = terminal) {
  if (!['client_uninstall','client_restore'].includes(value)) return;
  try {
    ui.clear();
    const status = await uninstallRequest({ action: 'status' });
    const selected = await ui.selectSimpleMenu({ title: 'CLIENT INTEGRATION', subtitle: 'Global files; memory and panel are preserved',
      items: [...status.items.map(item => ({ value: item.client, label: item.name, info: item.unavailable ? 'Unavailable' : `${item.changed} files; ${item.integration.mode}` })), { value: 'back', label: '< Back' }] });
    if (selected.action !== 'select' || selected.value === 'back') return;
    const fields = { client: selected.value, operation: value === 'client_restore' ? 'restore' : 'uninstall' };
    if (fields.operation === 'restore') {
      const backup = await ui.selectSimpleMenu({ title: 'CLIENT RECOVERY', subtitle: 'Exact uninstall receipt',
        items: [...status.receipts.filter(item => item.client === fields.client && item.operation === 'uninstall').map(item => ({ value: item.operationId, label: `${item.status} / ${item.phase}`, info: item.operationId })), { value: 'back', label: '< Back' }] });
      if (backup.action !== 'select' || backup.value === 'back') return; fields.backupId = backup.value;
    }
    const preview = await uninstallRequest({ action: 'preview', ...fields });
    ui.log(`  ${preview.name} · ${preview.scope}\n  ${preview.notice}\n  Files: ${preview.changed}`);
    for (const file of preview.files) ui.log(`  ${file.action}: ${file.path} (${file.beforeBytes} -> ${file.afterBytes} bytes)`);
    for (const item of preview.skipped) ui.log(`  [SKIP] ${item.component}: ${item.reason}`);
    if (!preview.canApply || !preview.changed && fields.operation === 'uninstall') { ui.log('  No applicable changes.'); return; }
    const answer = await ui.promptText('Confirm the reviewed client file operation? Type yes', 'no');
    if (String(answer).trim().toLowerCase() !== 'yes') { ui.log('  Cancelled.'); return; }
    const result = await uninstallRequest({ action: 'apply', ...fields, previewToken: preview.previewToken, confirm: true });
    ui.log(`  [${result.status}] ${result.phase || ''} · processed ${result.completed || 0} · receipt ${result.operationId || 'none'}`);
    if (result.error) ui.log(`  [${result.error.code}] ${result.error.message}`);
  } catch (error) {
    const known = ['INVALID','CONFLICT','CONFIRMATION','UNSUPPORTED','RECOVERY_REQUIRED','NOT_FOUND'].includes(error.code);
    ui.log(`  [${known ? error.code : 'UNAVAILABLE'}] ${known ? error.message : 'Client file operation failed; inspect receipts before retrying.'}`);
  } finally { await ui.waitForEnter(); }
}
