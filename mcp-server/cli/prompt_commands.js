import { promptRequest } from '../services/prompt_service.js';
import { closeDatabase } from '../db/database.js';

export const PROMPT_USAGE = `memory-cli prompts status
memory-cli prompts preview --client <codex|claude|gemini|antigravity> --operation <enable|disable|sync>
memory-cli prompts apply --client <client> --operation <operation> --preview-token <token> --confirm
memory-cli prompts recover --confirm
Only global managed files are changed. OpenCode uses native context. Marketplace-owned targets are skipped; MCP/plugin activation and active-session usage are separate.`;

export function parsePromptCommand(args) {
  const [action, ...rest] = args;
  if (!action || ['help', '-h', '--help'].includes(action)) return { action: 'help' };
  const flags = { '--client': 'client', '--operation': 'operation', '--preview-token': 'previewToken' };
  const result = { action }, seen = new Set();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (seen.has(flag)) throw Object.assign(new Error('Repeated prompt option.'), { code: 'INVALID' }); seen.add(flag);
    if (flag === '--confirm') { result.confirm = true; continue; }
    if (!flags[flag] || !rest[i + 1] || rest[i + 1].startsWith('--')) throw Object.assign(new Error('Unknown prompt option or missing value.'), { code: 'INVALID' });
    result[flags[flag]] = rest[++i];
  }
  return result;
}

export async function handlePromptCommand(args) {
  try {
    const input = parsePromptCommand(args);
    if (input.action === 'help') console.log(PROMPT_USAGE);
    else console.log(JSON.stringify(await promptRequest(input), null, 2));
  } catch (error) {
    const known = ['INVALID', 'UNSUPPORTED', 'CONFLICT', 'CONFIRMATION', 'RECOVERY_REQUIRED'].includes(error.code);
    console.error(`${known ? error.code : 'UNAVAILABLE'}: ${known ? error.message : 'Local client file operation failed. Review the current state before retrying.'}`);
    process.exitCode = 1;
  } finally { closeDatabase(); }
}
