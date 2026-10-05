import assert from 'node:assert/strict';
import { filterNotebookRecords as filter } from '../../mcp-server/dashboard/public/notebook_filters.js';

const records = [
  { id: 'same', title: 'First', body: 'Local evidence', kind: 'fact', date: '2026-10-01', meta: { tags: 'design, ui', keep: '1' }, reasons: [] },
  { id: 'same', title: 'Second', body: 'Project evidence', kind: 'directive', date: '2026-10-02', meta: { tags: 'build' }, reasons: ['disabled'] },
  { id: 'old', title: 'Past', body: 'Old evidence', kind: 'directive', date: '2026-09-01', meta: { tags: 'ui', keep: '1' }, reasons: ['expired', 'superseded'] },
  { body: 'broken', meta: {}, reasons: ['invalid'], invalid: true },
];
assert.equal(filter(records).length, 3, 'default excludes history but keeps disabled and malformed visible');
assert.deepEqual(filter(records, { query: 'LOCAL evidence', tags: 'UI', kind: 'fact', since: '2026-10-01', until: '2026-10-01' }), [records[0]]);
assert.deepEqual(filter(records, { tags: 'des' }), [], 'tags match full tokens, not substrings');
assert.deepEqual(filter(records, { tags: 'missing, BUILD' }), [records[1]], 'multiple tags match any token');
assert.deepEqual(filter(records, { view: 'persona', status: 'disabled' }), [records[1]]);
assert.deepEqual(filter(records, { view: 'archive' }), [records[2]]);
for (const status of ['expired', 'superseded']) assert.deepEqual(filter(records, { status }), [records[2]]);
assert.deepEqual(filter(records, { status: 'protected', kind: 'directive' }), [records[2]]);
assert.deepEqual(filter(records, { status: 'all', since: '2026-10-03', until: '2026-10-01' }), []);
assert.deepEqual(filter(records, { status: 'all', query: '2026-09-01' }), [records[2]]);
assert.equal(filter(records, { status: 'all', since: '2026-01-01' }).length, 3, 'missing date cannot satisfy a date filter');
console.log('PASS Notebook filters: combined type/tag/date/query/history and invalid date ranges.');
