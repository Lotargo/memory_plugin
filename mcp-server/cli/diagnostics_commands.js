import { diagnosticsRequest } from '../services/diagnostics_service.js';
import { closeDatabase } from '../db/database.js';

export const DIAGNOSTICS_USAGE = `memory-cli diagnostics status
memory-cli diagnostics run --operation graph-check
memory-cli diagnostics preview --operation cleanup-blobs
memory-cli diagnostics preview --operation restore-blobs|resume-cleanup --backup-id <receipt-id>
memory-cli diagnostics apply --operation <operation> [--backup-id <receipt-id>] --preview-token <token> --confirm
memory-cli diagnostics receipt --operation-id <id>
The graph check uses an isolated temporary store, lexical retrieval and no models/cloud.
CAS cleanup keeps a verified recovery ZIP of unused files; active CAS reduction is not net disk space freed.`;
export function parseDiagnosticsCommand(args) {
  const [action, ...rest] = args;
  if (!action || ['help','-h','--help'].includes(action)) return { action: 'help' };
  const flags = { '--operation': 'operation', '--backup-id': 'backupId', '--operation-id': 'operationId', '--preview-token': 'previewToken' };
  const input = { action }, seen = new Set();
  for (let i=0;i<rest.length;i++) {
    const flag = rest[i];
    if (seen.has(flag)) throw Object.assign(new Error('Repeated diagnostics option.'), { code: 'INVALID' }); seen.add(flag);
    if (flag === '--confirm') { input.confirm = true; continue; }
    if (!flags[flag] || !rest[i+1] || rest[i+1].startsWith('--')) throw Object.assign(new Error('Unknown diagnostics option or missing value.'), { code: 'INVALID' });
    input[flags[flag]] = rest[++i];
  }
  return input;
}
export async function handleDiagnosticsCommand(args) {
  try {
    const input = parseDiagnosticsCommand(args), result = input.action === 'help' ? null : await diagnosticsRequest(input);
    console.log(result ? JSON.stringify(result, null, 2) : DIAGNOSTICS_USAGE);
    if (result?.status === 'failed' || result?.phase === 'interrupted') process.exitCode = 1;
  } catch (error) {
    const known = ['INVALID','CONFLICT','CONFIRMATION','UNSUPPORTED','RECOVERY_REQUIRED','MIGRATION_REQUIRED','NOT_FOUND'].includes(error.code);
    console.error(`${known ? error.code : 'UNAVAILABLE'}: ${known ? error.message : 'Local diagnostic maintenance failed. Refresh state before retrying.'}`); process.exitCode = 1;
  } finally { closeDatabase(); }
}
