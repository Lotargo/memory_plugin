import { clientRequest } from '../services/client_service.js';
export const CLIENT_USAGE = `memory-cli clients status [--client opencode|codex|claude|gemini|antigravity]
memory-cli clients probe --client <client> --operation version|doctor --expected-version <status-version>
Status reads local files and PATH only. Probes explicitly start bounded processes.
Doctor supports owned direct Node/boot.js and Codex/Claude marketplace adapters.
Npx, foreign, project overrides and OpenCode native context need separate host acceptance.
No probe confirms an active session or automatic instruction delivery.`;
export function parseClientCommand(args) {
  const [action, ...rest] = args;
  if (!action || ['help','--help','-h'].includes(action)) return { action: 'help' };
  const flags = { '--client': 'client', '--operation': 'operation', '--expected-version': 'expectedVersion' }, input = { action };
  for (let i=0;i<rest.length;i++) {
    const field = flags[rest[i]];
    if (!field || Object.hasOwn(input,field) || !rest[i+1] || rest[i+1].startsWith('--')) throw Object.assign(new Error('Unknown/repeated client option or missing value.'), { code: 'INVALID' });
    input[field] = rest[++i];
  }
  return input;
}
export async function handleClientCommand(args) {
  try {
    const input = parseClientCommand(args), result = input.action === 'help' ? null : await clientRequest(input);
    console.log(result ? JSON.stringify(result,null,2) : CLIENT_USAGE);
    if (result?.status && result.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    const known = ['INVALID','CONFLICT','BUSY'].includes(error.code);
    console.error(`${known ? error.code : 'UNAVAILABLE'}: ${known ? error.message : 'Client status/probe unavailable.'}`); process.exitCode = 1;
  }
}
