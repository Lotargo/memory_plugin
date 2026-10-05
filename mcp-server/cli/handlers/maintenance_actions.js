import { selectSimpleMenu, promptText, waitForEnter } from '../ui.js';
import { maintenanceRequest } from '../../services/maintenance_service.js';
const terminal = { selectSimpleMenu, promptText, waitForEnter, clear: () => console.clear(), log: text => console.log(text) };
export async function handleMaintenanceAction(value, ui = terminal) {
  if (!['reset','migrate_titles'].includes(value)) return;
  try {
    const operation = value === 'reset' ? 'reset-settings' : 'migrate-titles', fields = {};
    if (value === 'migrate_titles') {
      const status = await maintenanceRequest({ action: 'status' });
      if (status.unavailable) throw Object.assign(new Error('Notebook maintenance is unavailable.'), { code: status.unavailable });
      const choice = await ui.selectSimpleMenu({ title: 'MIGRATE ONE NOTEBOOK', subtitle: 'Choose the exact store; backup precedes writes',
        items: [...status.targets.filter(target => !target.unavailable && target.notebookAvailable !== false).map(target => ({ value: target.key, label: target.name, info: target.key })), { value: 'back', label: '< Back' }] });
      if (choice.action !== 'select' || choice.value === 'back') return;
      fields.key = choice.value;
    }
    const preview = await maintenanceRequest({ action: 'preview', operation, ...fields });
    ui.clear(); ui.log(`\n  ${operation} · ${preview.scope}\n  ${preview.notice}`);
    for (const item of preview.changes) ui.log(`\n  ${item.label || item.ref}\n  BEFORE: ${JSON.stringify(item.before)}\n  AFTER: ${JSON.stringify(item.after)}`);
    if (!preview.changed) { ui.log('  [UNCHANGED] No changes.'); return; }
    if (!/^(y|yes)$/i.test((await ui.promptText('Confirm these reviewed changes? [y/N]:')).trim())) { ui.log('  Cancelled.'); return; }
    const result = await maintenanceRequest({ action: 'apply', operation, ...fields, previewToken: preview.previewToken, confirm: true });
    ui.log(`  [${result.status}] ${result.changed} changes. Backup: ${result.backup}. Runtime models and client files are not synchronized.`);
  } catch (error) { ui.log(`  [${error.code || 'UNAVAILABLE'}] ${error.code ? error.message : 'Maintenance failed; refresh the preview before retrying.'}`); }
  finally { await ui.waitForEnter(); }
}
