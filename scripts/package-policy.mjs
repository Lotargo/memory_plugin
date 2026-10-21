import { posix } from 'node:path';

// The approved manifest is intentionally exact: a new file needs an explicit review.
// Report only path + rule, never matched secret values.
export function inspectPackage(files, approved, readText, privateValues = []) {
  const issues = [];
  const actual = new Set(files);
  const allowed = new Set(approved);
  const secrets = [
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['service credential', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}|AIza[A-Za-z0-9_-]{35})\b/],
    ['JWT credential', /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/],
    ['private user path', /[A-Z]:[\\/]Users[\\/](?!<|example\b|demo\b|Public\b|Default\b)[A-Za-z0-9_.-]+[\\/]/i],
    ['private connection URL', /https?:\/\/127\.0\.0\.1:\d+\/#[a-f0-9]{64}/i],
  ];
  for (const path of files) {
    if (!allowed.has(path)) issues.push(`${path}: file is outside the approved package manifest`);
    if (path !== posix.normalize(path) || path.startsWith('../') || path.includes('\\')) issues.push(`${path}: unsafe path`);
    if (/(?:^|\/)(?:\.env(?:\.|$)|node_modules|dev_docs|exports|backups?|snapshots?|test[^/]*|benchmarks)(?:\/|$)|\.(?:sqlite(?:-\w+)?|db|log|tgz|bak|enc)$|(?:^|\/)(?:config|connection|auth_secrets)\.json$/i.test(path)) {
      issues.push(`${path}: private or development artifact`);
    }
    if (!/\.(?:js|mjs|cjs|json|md|html|css|svg|txt)$/.test(path)) continue;
    const content = readText(path);
    for (const [label, pattern] of secrets) if (pattern.test(content)) issues.push(`${path}: ${label}`);
    for (const value of privateValues.filter(value => value && value.length > 5)) {
      if (content.toLowerCase().includes(value.toLowerCase())) issues.push(`${path}: local profile/workspace path`);
    }
  }
  for (const path of approved) if (!actual.has(path)) issues.push(`${path}: approved runtime file is missing`);
  return issues;
}
