import { maintenanceRequest } from '../services/maintenance_service.js';
import { closeDatabase } from '../db/database.js';

export const MAINTENANCE_USAGE = `memory-cli maintenance status
memory-cli maintenance preview --operation migrate-titles|migrate-persona --key <store>
memory-cli maintenance preview --operation reset-settings
memory-cli maintenance preview --operation restore-settings --backup-id <id>
memory-cli maintenance apply --operation <operation> [--key <store>|--backup-id <id>] --preview-token <token> --confirm
Reset/restore covers search, models and source-access preferences. Cloud, storage, panel startup and snapshot schedule are preserved. Migrations change one Notebook; review client file synchronization separately.`;
export function parseMaintenanceCommand(args) {
  const [action, ...rest] = args;
  if (!action || ['help','-h','--help'].includes(action)) return { action: 'help' };
  const flags = { '--operation': 'operation', '--key': 'key', '--backup-id': 'backupId', '--preview-token': 'previewToken' };
  const input = { action }, seen = new Set();
  for (let i=0;i<rest.length;i++) {
    const flag = rest[i];
    if (seen.has(flag)) throw Object.assign(new Error('Repeated maintenance option.'), { code: 'INVALID' }); seen.add(flag);
    if (flag === '--confirm') { input.confirm = true; continue; }
    if (!flags[flag] || !rest[i+1] || rest[i+1].startsWith('--')) throw Object.assign(new Error('Unknown maintenance option or missing value.'), { code: 'INVALID' });
    input[flags[flag]] = rest[++i];
  }
  return input;
}
export async function handleMaintenanceCommand(args) {
  try {
    const input = parseMaintenanceCommand(args);
    console.log(input.action === 'help' ? MAINTENANCE_USAGE : JSON.stringify(await maintenanceRequest(input), null, 2));
  } catch (error) {
    const known = ['INVALID','CONFLICT','CONFIRMATION','UNSUPPORTED','RECOVERY_REQUIRED','MIGRATION_REQUIRED','NOT_FOUND'].includes(error.code);
    console.error(`${known ? error.code : 'UNAVAILABLE'}: ${known ? error.message : 'Local maintenance failed. Inspect local storage and refresh the preview.'}`); process.exitCode = 1;
  } finally { closeDatabase(); }
}
