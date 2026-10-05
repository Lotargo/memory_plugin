// Serve only browser distributions of our pinned dependencies. No CDN or
// arbitrary node_modules/file access is available through this route.
import { createRequire } from 'node:module';
import { dirname, resolve, sep, extname } from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const roots = new Map([
  ['marked', dirname(require.resolve('marked'))],
  ['dompurify', dirname(require.resolve('dompurify'))],
  ['katex', dirname(require.resolve('katex'))],
  ['mermaid', dirname(require.resolve('mermaid'))],
]);
const types = new Map([['.js', 'text/javascript'], ['.mjs', 'text/javascript'], ['.css', 'text/css'], ['.woff', 'font/woff'], ['.woff2', 'font/woff2'], ['.ttf', 'font/ttf']]);
export async function browserAsset(pathname) {
  const match = /^\/vendor\/([a-z]+)\/(.+)$/.exec(pathname);
  if (!match || !roots.has(match[1])) return null;
  let relative;
  try { relative = decodeURIComponent(match[2]); } catch { return null; }
  if (relative.includes('\\') || relative.includes('\0') || relative.split('/').some(part => part === '..' || part === '.')) return null;
  const type = types.get(extname(relative));
  if (!type) return null;
  const root = await realpath(roots.get(match[1]));
  const file = resolve(root, relative);
  if (!file.startsWith(root + sep)) return null;
  try {
    const actual = await realpath(file);
    if (!actual.startsWith(root + sep)) return null;
    return { bytes: await readFile(actual), type };
  } catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null; throw error; }
}
