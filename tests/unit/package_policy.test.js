import assert from 'node:assert/strict';
import { inspectPackage } from '../../scripts/package-policy.mjs';
const path = 'mcp-server/boot.js';
assert.deepEqual(inspectPackage([path], [path], () => 'export const value = 1;'), []);
assert.ok(inspectPackage([path, 'mcp-server/scratch.js'], [path], () => '').some(issue => issue.includes('outside')));
assert.ok(inspectPackage([], [path], () => '').some(issue => issue.includes('missing')));
for (const artifact of ['mcp-server/.env', 'mcp-server/storage/data.sqlite', 'mcp-server/web/connection.json', 'mcp-server/test_probe.js']) {
  assert.ok(inspectPackage([artifact], [artifact], () => '').some(issue => issue.includes('artifact')), artifact);
}
for (const secret of ['-----BEGIN PRIVATE KEY-----', 'ghp_' + 'a'.repeat(36), 'http://127.0.0.1:8765/#' + 'a'.repeat(64), 'C:\\Users\\private-user\\memory']) {
  const issues = inspectPackage([path], [path], () => secret);
  assert.ok(issues.length > 0);
  assert.ok(!issues.join('\n').includes(secret), 'never echo private content');
}
assert.ok(inspectPackage([path], [path], () => '/private/workspace', ['/private/workspace']).length);
console.log('PASS package policy: exact manifest, missing runtime, private artifacts and redacted credential detection.');
