import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createDocxFixture } from "../fixtures/docx_fixture.js";
import { normalizeContent } from '../../mcp-server/ingest/normalizer.js';

const buffer = await createDocxFixture();
const parsed = await normalizeContent({ content: buffer, type: 'file', path: 'synthetic-release.docx' });
assert.match(parsed.markdown, /# Release decision/);
assert.match(parsed.markdown, /Пример DOCX: SKU-123, 2026-10-21, A & B\./);
assert.match(parsed.markdown, /(?:\*\*Important evidence\*\*|__Important evidence__)/);
assert.match(parsed.markdown, /[-*] First verification/);
for (const value of ['Metric', 'Value', 'Samples', '42']) assert.ok(parsed.markdown.includes(value));
assert.ok(parsed.markdown.indexOf('Metric') < parsed.markdown.indexOf('Samples'));
await assert.rejects(normalizeContent({ content: Buffer.from('invalid archive'), type: 'file', path: 'broken.docx' }), /Failed to parse DOCX/);

const vendor = new URL('../../mcp-server/vendor/mammoth/', import.meta.url);
const provenance = JSON.parse(await readFile(new URL('provenance.json', vendor), 'utf8'));
const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
assert.equal(provenance.version, '1.13.0');
assert.ok(!Object.hasOwn(provenance.externalDependencies, 'argparse'));
assert.ok(!Object.hasOwn(provenance.files, 'lib/main.js'));
const copied = (await readdir(new URL('lib/', vendor), { recursive: true })).filter(path => path.endsWith('.js')).map(path => 'lib/' + path.replaceAll('\\', '/')).sort();
assert.deepEqual(copied, Object.keys(provenance.files).sort(), 'every shipped module must have upstream provenance');
for (const name of Object.keys(provenance.externalDependencies)) assert.ok(pkg.dependencies[name], `audited external dependency: ${name}`);
for (const [path, hash] of Object.entries(provenance.files)) {
  assert.equal(createHash('sha256').update(await readFile(new URL(path, vendor))).digest('hex'), hash, `unchanged upstream module: ${path}`);
}
assert.match(await readFile(new URL('LICENSE', vendor), 'utf8'), /Redistribution and use in source and binary forms/);
console.log('PASS real DOCX ingestion: heading, Unicode, exact identifiers/dates, bold, list, table, corrupt archive rejection and verified library-only upstream sources.');
