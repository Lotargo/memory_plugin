import { uninstallRequest } from '../services/uninstall_service.js';

export const UNINSTALL_USAGE = `memory-cli uninstall status
memory-cli uninstall preview --client opencode|codex|claude|gemini|antigravity --operation uninstall
memory-cli uninstall preview --client <client> --operation restore --backup-id <uninstall-receipt-id>
memory-cli uninstall apply --client <client> --operation uninstall|restore [--backup-id <id>] --preview-token <token> --confirm
memory-cli uninstall receipt --operation-id <id>
Reviewed global client files only. Memory, package, cache, projects and panel are preserved.
Legacy flag-based uninstall/purge remains a separate terminal command.`;
export function parseUninstallCommand(args) {
  const [action, ...rest] = args;
  if (!action || ['help','-h','--help'].includes(action)) return { action: 'help' };
  const flags = { '--client': 'client', '--operation': 'operation', '--backup-id': 'backupId', '--operation-id': 'operationId', '--preview-token': 'previewToken' };
  const input = { action }, seen = new Set();
  for (let i=0; i<rest.length; i++) {
    const flag = rest[i];
    if (seen.has(flag)) throw Object.assign(new Error('Repeated uninstall option.'), { code: 'INVALID' }); seen.add(flag);
    if (flag === '--confirm') { input.confirm = true; continue; }
    if (!flags[flag] || !rest[i+1] || rest[i+1].startsWith('--')) throw Object.assign(new Error('Unknown uninstall option or missing value.'), { code: 'INVALID' });
    input[flags[flag]] = rest[++i];
  }
  return input;
}
export async function handleUninstallCommand(args) {
  try {
    const input = parseUninstallCommand(args), result = input.action === 'help' ? null : await uninstallRequest(input);
    console.log(result ? JSON.stringify(result, null, 2) : UNINSTALL_USAGE);
    if (result?.phase === 'interrupted' || result?.status === 'partial') process.exitCode = 1;
  } catch (error) {
    const known = ['INVALID','CONFLICT','CONFIRMATION','UNSUPPORTED','RECOVERY_REQUIRED','NOT_FOUND'].includes(error.code);
    console.error(`${known ? error.code : 'UNAVAILABLE'}: ${known ? error.message : 'Client file operation failed. Check its receipt before retrying.'}`);
    process.exitCode = 1;
  }
}
