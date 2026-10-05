import { selectSimpleMenu, promptText, waitForEnter } from '../ui.js';
import { diagnosticsRequest } from '../../services/diagnostics_service.js';
const terminal = { selectSimpleMenu, promptText, waitForEnter, clear: () => console.clear(), log: text => console.log(text) };
export async function handleCasAction(value, ui = terminal) {
  if (!['graph_test','cas_cleanup','cas_restore','cas_resume'].includes(value)) return;
  try {
    ui.clear();
    if (value === 'graph_test') {
      ui.log('  Running engine checks in an isolated temporary store. No models or cloud.');
      const result = await diagnosticsRequest({ action: 'run', operation: 'graph-check' });
      ui.log(`  [${result.status}] ${result.scope}`);
      for (const item of result.checks) ui.log(`  ${item.name}: ${item.status}`);
      if (result.error) ui.log(`  [${result.error.code}] ${result.error.message}`);
      if (result.temporaryCleanup !== 'completed') ui.log('  Temporary directory cleanup is unavailable.');
      return;
    }
    const operation = { cas_cleanup: 'cleanup-blobs', cas_restore: 'restore-blobs', cas_resume: 'resume-cleanup' }[value], fields = {};
    if (operation !== 'cleanup-blobs') {
      const status = await diagnosticsRequest({ action: 'status' });
      const selected = await ui.selectSimpleMenu({ title: 'CAS RECOVERY', subtitle: 'Choose the exact local receipt',
        items: [...status.receipts.filter(item => !item.unavailable && (operation !== 'resume-cleanup' || item.operation !== 'restore-blobs')).map(item => ({ value: item.operationId, label: `${item.operation} ${item.status}`, info: item.operationId })), { value: 'back', label: '< Back' }] });
      if (selected.action !== 'select' || selected.value === 'back') return;
      fields.backupId = selected.value;
    }
    const preview = await diagnosticsRequest({ action: 'preview', operation, ...fields });
    ui.log(`  ${operation} · ${preview.scope}\n  ${preview.notice}\n  Files: ${preview.changed}; active CAS bytes: ${preview.bytes}`);
    for (const item of preview.files) ui.log(`  ${item.hash} (${item.bytes} bytes)`);
    for (const item of preview.skipped) ui.log(`  SKIPPED ${item.hash || item.name}: ${item.reason}`);
    if (!preview.changed && operation === 'cleanup-blobs') { ui.log('  [UNCHANGED] No unused files.'); return; }
    if (!/^(y|yes)$/i.test((await ui.promptText('Confirm this reviewed CAS operation? [y/N]:')).trim())) { ui.log('  Cancelled.'); return; }
    const result = await diagnosticsRequest({ action: 'apply', operation, ...fields, previewToken: preview.previewToken, confirm: true });
    ui.log(`  [${result.status}] ${result.completed} files processed. Backup: ${result.backup}. Receipt: ${result.operationId}.`);
    if (result.error) ui.log(`  [${result.error.code}] ${result.error.message}`);
  } catch (error) { ui.log(`  [${error.code || 'UNAVAILABLE'}] ${error.code ? error.message : 'Maintenance failed; inspect receipts before retrying.'}`); }
  finally { await ui.waitForEnter(); }
}
