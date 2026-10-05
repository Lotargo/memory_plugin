import { selectSimpleMenu, waitForEnter } from '../ui.js';
import { clientRequest } from '../../services/client_service.js';
const terminal = { selectSimpleMenu, waitForEnter, log: text => console.log(text), clear: () => console.clear() };
export async function handleClientAction(value, ui = terminal) {
  if (!['client_status','client_probe'].includes(value)) return;
  try {
    ui.clear();
    const status = await clientRequest({ action: 'status' });
    ui.log(`Local client files / PATH · ${status.observedAt}\nWorkspace: ${status.items[0]?.workspace}\nActive session / automatic initialization / agent usage: UNVERIFIED`);
    for (const item of status.items) ui.log(`  ${item.name}: ${item.status} / ${item.channel?.mode || item.code} · executable ${item.executable.available ? 'found' : 'unavailable'} · installed ${item.installed}`);
    if (value === 'client_status') return;
    const selected = await ui.selectSimpleMenu({ title: 'CLIENT PROBE', subtitle: 'Explicit bounded child process; no session observation', items: [...status.items.map(item => ({ value: item.client, label: item.name, info: item.channel?.mode || item.code })), { value: 'back', label: '< Back' }] });
    if (selected.action !== 'select' || selected.value === 'back') return;
    const item = status.items.find(item => item.client === selected.value);
    if (!item?.version) { ui.log('  Client files unavailable. Refresh after fixing the configuration.'); return; }
    const operation = await ui.selectSimpleMenu({ title: 'CLIENT PROBE', subtitle: 'A separate process will be started; 20 second deadline', items: [
      { value: 'version', label: 'Check Client CLI Version', info: 'Fixed --version command; output is summarized' },
      { value: 'doctor', label: 'Check Memory Adapter', info: 'Owned direct/marketplace adapter; initialize/list/info/recall' }, { value: 'back', label: '< Back' }] });
    if (operation.action !== 'select' || operation.value === 'back') return;
    const result = await clientRequest({ action: 'probe', client: item.client, operation: operation.value, expectedVersion: item.version });
    ui.log(`  ${result.status} · ${result.code || result.cliVersion || `${result.toolCount} tools`} · ${result.durationMs}ms\n  Active session and automatic initialization: UNVERIFIED`);
    for (const check of result.checks) ui.log(`  [${check.level}] ${check.label}`);
  } catch (error) { ui.log(`  [${['INVALID','CONFLICT','BUSY'].includes(error.code) ? error.code : 'UNAVAILABLE'}] Client status/probe could not finish. Refresh status.`); }
  finally { await ui.waitForEnter(); }
}
