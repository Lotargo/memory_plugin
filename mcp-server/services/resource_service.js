import {resourceMonitor} from '../monitoring/resources.js';
import {readRuntimeStates} from '../ml/model_control.js';

// Runtime receipts come from their owning clients. Reading them does not touch
// model activity, load ONNX sessions, or claim coverage of unregistered clients.
export async function resourceOverview({observerRole = 'dashboard'} = {}, {monitor = resourceMonitor, states = readRuntimeStates, now = Date.now} = {}) {
  const resources = await monitor.snapshot();
  const observedAt = now();
  const clients = states().filter(state => state.serverPid !== process.pid).map(state => {
    const timestamp = Date.parse(state.updatedAt);
    const rss = state.serverRssMB;
    return {pid: state.serverPid, role: 'client', rssBytes: typeof rss === 'number' && Number.isFinite(rss) && rss >= 0 ? rss * 1024 ** 2 : null,
      observedAt: Number.isFinite(timestamp) ? timestamp : null, status: Number.isFinite(timestamp) && observedAt - timestamp >= 0 && observedAt - timestamp < 15000 ? 'fresh' : 'stale'};
  });
  return {...resources, processes: [{pid: process.pid, role: observerRole, rssBytes: process.memoryUsage.rss(), observedAt, status: 'fresh'}, ...clients], processCoverage: 'registered-processes-only'};
}
