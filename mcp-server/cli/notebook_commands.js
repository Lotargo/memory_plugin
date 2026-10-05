import { readNotebook, listNotebookTargets } from '../services/notebook_service.js';
import { directiveTransferRequest } from '../services/directive_transfer_service.js';
import { closeDatabase } from '../db/database.js';

export const NOTEBOOK_USAGE = `memory-cli notebook targets
memory-cli notebook read --key <key>
memory-cli notebook transfer <preview|apply> --source-key <key> --target-key <key> --ref <id:ID|legacy:N> --source-version <version> --target-version <version> [--share-sources] [--preview-token <token>] [--confirm] [--confirm-share]
Read returns the store version and scoped refs. Transfer requires both reviewed versions. Preview never migrates or changes memory. Apply creates a verified local ZIP; sharing sources requires separate confirmation.`;

export function parseNotebookCommand(args) {
  const [command, ...rest] = args;
  if (!command || ['help', '--help', '-h'].includes(command)) return { command: 'help' };
  if (command === 'targets') { if (rest.length) throw new Error('targets takes no options.'); return { command }; }
  if (command === 'read') {
    if (rest.length !== 2 || rest[0] !== '--key' || !rest[1] || rest[1].startsWith('--')) throw new Error('read requires one explicit --key.');
    return { command, key: rest[1] };
  }
  if (command !== 'transfer' || !['preview', 'apply'].includes(rest[0])) throw new Error(NOTEBOOK_USAGE);
  const input = { action: rest[0] }, seen = new Set();
  const flags = { '--source-key': 'sourceKey', '--target-key': 'targetKey', '--ref': 'ref',
    '--source-version': 'expectedSourceVersion', '--target-version': 'expectedTargetVersion', '--preview-token': 'previewToken' };
  const booleans = { '--share-sources': 'shareSources', '--confirm': 'confirm', '--confirm-share': 'confirmShare' };
  for (let i = 1; i < rest.length; i++) {
    const flag = rest[i];
    if (seen.has(flag)) throw new Error('Repeated Notebook option.'); seen.add(flag);
    if (booleans[flag]) { input[booleans[flag]] = true; continue; }
    if (!flags[flag] || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('Unknown Notebook option or missing value.');
    input[flags[flag]] = rest[++i];
  }
  return { command, input };
}

export async function handleNotebookCommand(args) {
  try {
    let parsed;
    try { parsed = parseNotebookCommand(args); } catch (error) { throw Object.assign(error, { code: 'INVALID' }); }
    if (parsed.command === 'help') console.log(NOTEBOOK_USAGE);
    else console.log(JSON.stringify(parsed.command === 'targets' ? { items: await listNotebookTargets() }
      : parsed.command === 'read' ? await readNotebook({ key: parsed.key }) : await directiveTransferRequest(parsed.input), null, 2));
  } catch (error) {
    const known = ['INVALID', 'NOT_FOUND', 'CONFLICT', 'CONFIRMATION', 'UNSUPPORTED', 'MIGRATION_REQUIRED', 'RECOVERY_REQUIRED'].includes(error.code);
    console.error(`${known ? error.code : 'STORAGE_UNAVAILABLE'}: ${known ? error.message : 'Local Notebook operation failed. Review both stores before retrying.'}`);
    process.exitCode = 1;
  } finally { closeDatabase(); }
}
