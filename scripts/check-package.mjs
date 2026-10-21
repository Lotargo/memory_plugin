import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPackage } from './package-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.npm_execpath) throw new Error('Run this check with npm run check:package.');
const packed = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
}))[0];
const approved = JSON.parse(readFileSync(new URL('./package-files.json', import.meta.url), 'utf8'));
const files = packed.files.map(file => file.path);
const localPaths = [homedir(), root].flatMap(path => [path, path.replaceAll('\\', '/'), path.replaceAll('\\', '\\\\')]);
const issues = inspectPackage(files, approved, path => readFileSync(resolve(root, path), 'utf8'), localPaths);
for (const path of files) if (lstatSync(resolve(root, path)).isSymbolicLink()) issues.push(`${path}: symlink`);
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(resolve(root, 'npm-shrinkwrap.json'), 'utf8'));
if (pkg.version !== lock.version || pkg.version !== lock.packages[''].version) issues.push('package/lock versions differ');
if (JSON.stringify(pkg.dependencies) !== JSON.stringify(lock.packages[''].dependencies)) issues.push('package/shrinkwrap dependencies differ');
if (JSON.stringify(pkg.engines) !== JSON.stringify(lock.packages[''].engines)) issues.push('package/shrinkwrap runtime requirements differ');
for (const path of Object.values(pkg.bin).concat(pkg.main)) if (!files.includes(path)) issues.push(`${path}: missing package entrypoint`);
if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
else console.log(`Package privacy check PASS: ${packed.name}@${packed.version}, ${files.length} approved files, ${packed.unpackedSize} unpacked bytes.`);
