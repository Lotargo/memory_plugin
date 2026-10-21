// Reproduce the reviewed library-only Mammoth distribution from its official npm tarball.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, lstatSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const version = '1.13.0';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.env.npm_execpath;
if (!npm) throw Error('Run npm run vendor:docx; review version/dependency changes before updating the manifest.');
const work = mkdtempSync(join(tmpdir(), 'memory-docx-vendor-'));
const output = join(root, 'mcp-server/vendor/mammoth');
try {
  const [pkg] = JSON.parse(execFileSync(process.execPath, [npm, 'pack', `mammoth@${version}`, '--ignore-scripts', '--json', '--pack-destination', work], { cwd: work, encoding: 'utf8', timeout: 120000 }));
  const tarball = join(work, pkg.filename);
  const integrity = 'sha512-' + createHash('sha512').update(readFileSync(tarball)).digest('base64');
  if (integrity !== pkg.integrity) throw Error('Tarball integrity mismatch');
  const paths = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split(/\r?\n/);
  if (paths.some(path => !path.startsWith('package/') || path.split('/').includes('..') || path.includes('\\'))) throw Error('Unsafe upstream archive path');
  execFileSync('tar', ['-xzf', tarball, '-C', work]);
  const upstream = join(work, 'package');
  const metadata = JSON.parse(readFileSync(join(upstream, 'package.json'), 'utf8'));
  const files = new Map(), dependencies = new Set();
  function visit(file) {
    const name = relative(upstream, file).replaceAll('\\', '/');
    if (files.has(name)) return;
    if (!name.startsWith('lib/') || lstatSync(file).isSymbolicLink()) throw Error('Unexpected upstream module');
    const content = readFileSync(file); files.set(name, content);
    for (const [, specifier] of content.toString('utf8').matchAll(/require\(["']([^"']+)["']\)/g)) {
      if (specifier.startsWith('.')) visit(createRequire(file).resolve(specifier));
      else if (!specifier.startsWith('node:') && !['fs', 'path', 'url', 'os', 'util'].includes(specifier)) dependencies.add(specifier.startsWith('@') ? specifier.split('/').slice(0,2).join('/') : specifier.split('/')[0]);
    }
  }
  visit(join(upstream, 'lib/index.js'));
  if (dependencies.has('argparse') || dependencies.has('sprintf-js') || files.has('lib/main.js')) throw Error('CLI dependency entered the library graph');
  mkdirSync(output, { recursive: true });
  const hashes = {};
  for (const [name, content] of [...files].sort(([a],[b]) => a.localeCompare(b))) {
    mkdirSync(dirname(join(output, name)), { recursive: true }); writeFileSync(join(output, name), content);
    hashes[name] = createHash('sha256').update(content).digest('hex');
  }
  copyFileSync(join(upstream, 'LICENSE'), join(output, 'LICENSE'));
  writeFileSync(join(output, 'package.json'), JSON.stringify({ name: 'mammoth-library-runtime', version, private: true, type: 'commonjs', main: './lib/index.js', license: metadata.license }, null, 2) + '\n');
  const externalDependencies = Object.fromEntries([...dependencies].sort().map(name => [name, metadata.dependencies[name]]));
  writeFileSync(join(output, 'provenance.json'), JSON.stringify({ upstream: 'https://github.com/mwilliamson/mammoth.js', version, tarball: `https://registry.npmjs.org/mammoth/-/mammoth-${version}.tgz`, integrity, license: metadata.license,
    distribution: 'Unmodified library modules reachable from lib/index.js. CLI, tests, browser bundles and argparse are excluded. External libraries remain audited root dependencies.', externalDependencies, files: hashes }, null, 2) + '\n');
  console.log(`Vendored ${files.size} unmodified Mammoth ${version} library modules; external dependencies: ${[...dependencies].sort().join(', ')}.`);
} finally {
  if (!resolve(work).startsWith(resolve(tmpdir()) + sep)) throw Error('Unsafe temporary cleanup');
  rmSync(work, { recursive: true, force: true });
}
