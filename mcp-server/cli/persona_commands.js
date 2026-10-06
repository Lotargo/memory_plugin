import { personaDeliveryRequest } from '../services/persona_delivery_service.js';
import { closeDatabase } from '../db/database.js';

export const PERSONA_USAGE = `memory-cli persona status
memory-cli persona migrate --dry-run
memory-cli persona migrate --preview-token <token> --confirm
memory-cli persona sync --dry-run
memory-cli persona sync --preview-token <token> --confirm
memory-cli persona disable --client <codex|claude|gemini|antigravity> --dry-run
memory-cli persona disable --client <client> --preview-token <token> --confirm
memory-cli persona restore --backup-id <id> --dry-run
memory-cli persona restore --backup-id <id> --preview-token <token> --confirm
memory-cli persona recover --confirm
One derived persona field; Notebook records/IDs and remember stay unchanged. No clients are launched.`;

export function parsePersonaCommand(args) {
  const [operation, ...rest] = args;
  if (!operation || ['help', '-h', '--help'].includes(operation)) return { action: 'help' };
  const input = ['status', 'recover'].includes(operation) ? { action: operation } : { operation, action: 'apply' };
  const seen = new Set();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (seen.has(flag)) throw Object.assign(new Error('Repeated personality option.'), { code: 'INVALID' });
    seen.add(flag);
    if (flag === '--dry-run') { input.action = 'preview'; continue; }
    if (flag === '--confirm') { input.confirm = true; continue; }
    const key = { '--client': 'clients', '--preview-token': 'previewToken', '--backup-id': 'backupId' }[flag];
    if (!key || !rest[i + 1] || rest[i + 1].startsWith('--')) throw Object.assign(new Error('Unknown personality option or missing value.'), { code: 'INVALID' });
    const value = rest[++i]; input[key] = key === 'clients' ? [value] : value;
  }
  if (input.action === 'preview' && (input.confirm || input.previewToken)) throw Object.assign(new Error('Dry-run cannot confirm or apply a preview token.'), { code: 'INVALID' });
  return input;
}

export async function handlePersonaCommand(args) {
  try {
    const input = parsePersonaCommand(args);
    if (input.action === 'help') console.log(PERSONA_USAGE);
    else {
      const { persona, ...result } = await personaDeliveryRequest(input);
      // CLI reviews paths/hashes/counts without printing personal instruction bodies.
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    const known = ['INVALID', 'UNSUPPORTED', 'CONFLICT', 'CONFIRMATION', 'RECOVERY_REQUIRED'].includes(error.code);
    console.error(`${known ? error.code : 'UNAVAILABLE'}: ${known ? error.message : 'Personality operation failed; inspect the current state before retrying.'}`);
    process.exitCode = 1;
  } finally { await closeDatabase(); }
}
