// Detached panel process: no MCP stdio, model loop or persona sync.
process.env.MEMORY_DISABLE_BACKGROUND_SYNC = '1';
process.env.MEMORY_DISABLE_PERSONA_SYNC = '1';
process.env.MEMORY_WEB_AUTOSTART_CHILD = '1';
const { readConnection, writeConnection, storageId, webBuildId } = await import('./runtime.js');
const { startDashboard } = await import('./server.js');
const { closeDatabase } = await import('../db/database.js');
const { readFileSync } = await import('node:fs');
const { randomBytes } = await import('node:crypto');
const { startSnapshotScheduler, stopSnapshotScheduler } = await import('../admin/cloud_snapshots.js');
const connection = readConnection();
if (!connection) throw new Error('Start the panel through memory-plugin web.');
const runtime = {
  kind: 'memory-dashboard', storageId, buildId: await webBuildId(), pid: process.pid,
  version: JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version,
  instanceId: randomBytes(16).toString('hex')
};
let finish;
const finished = new Promise(resolve => { finish = resolve; });
let app;
try {
  app = await startDashboard({ port: connection.port, token: connection.token, runtime, onStop: finish });
  // Only explicit cloud-snapshots + scheduled configuration can upload. The
  // shared persisted deadline prevents duplicate uploads from other clients.
  startSnapshotScheduler({ panel: true });
  const port = Number(new URL(app.origin).port);
  if (connection.port !== port) await writeConnection({ ...connection, port });
  process.once('SIGINT', finish); process.once('SIGTERM', finish);
  console.log(`Memory panel v${runtime.version} ready on ${app.origin}`);
  await finished;
} finally {
  process.removeListener('SIGINT', finish); process.removeListener('SIGTERM', finish);
  if (app) { app.server.closeIdleConnections(); await app.close(); }
  stopSnapshotScheduler();
  closeDatabase();
}
