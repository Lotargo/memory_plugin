import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";

const execFileAsync = promisify(execFile);

export function normalizeRemoteUrl(url) {
  if (!url || typeof url !== "string") return "";
  let s = url.trim();
  s = s.replace(/^(https?|git|ssh|file):\/\//i, "");
  s = s.replace(/^[^@/]+@/, "");
  s = s.replace(/:([a-zA-Z~])/, "/$1");
  s = s.replace(/^([^/]+):[0-9]+/, "$1");
  s = s.replace(/\.git\/?$/, "");
  s = s.replace(/\/+$/, "");
  return s.toLowerCase();
}

export async function detectGitToplevel(dir) {
  const absoluteDir = resolve(dir || process.cwd());
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: absoluteDir });
    return stdout.trim();
  } catch (err) {
    let current = absoluteDir;
    while (true) {
      const gitPath = join(current, ".git");
      if (existsSync(gitPath)) {
        return current;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }
}

export async function getRemoteUrls(toplevel) {
  const urls = [];
  try {
    const { stdout } = await execFileAsync("git", ["config", "--get-regexp", "remote\\..*\\.url"], { cwd: toplevel });
    const lines = stdout.split("\n").filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        urls.push(parts[1]);
      }
    }
  } catch (err) {
    const configPath = join(toplevel, ".git", "config");
    if (existsSync(configPath)) {
      try {
        const configText = readFileSync(configPath, "utf-8");
        const lines = configText.split("\n");
        for (const line of lines) {
          const match = /^\s*url\s*=\s*(.*)$/.exec(line);
          if (match) {
            urls.push(match[1].trim());
          }
        }
      } catch (e) {}
    }
  }
  return urls;
}

let identityCache = new Map();

export function bustIdentityCache() {
  identityCache.clear();
}

export async function resolveProjectIdentity(dir) {
  const absoluteDir = resolve(dir || process.cwd());
  if (identityCache.has(absoluteDir)) {
    return identityCache.get(absoluteDir);
  }

  const toplevel = await detectGitToplevel(absoluteDir);
  if (!toplevel) {
    identityCache.set(absoluteDir, null);
    return null;
  }

  const remotes = await getRemoteUrls(toplevel);
  let key;
  let name = basename(toplevel) || "default";
  let primaryRemote = null;

  if (remotes.length > 0) {
    primaryRemote = normalizeRemoteUrl(remotes[0]);
    key = `git:${primaryRemote}`;
  } else {
    key = `git:local:${name}`;
  }

  const result = { key, name, primaryRemote, toplevel };
  identityCache.set(absoluteDir, result);
  return result;
}

// Registry SQLite API

export async function upsertIdentity(db, { key, name, primaryRemote }) {
  await db.prepare(`
    INSERT INTO project_identities (key, name, primary_remote, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET name = excluded.name, primary_remote = excluded.primary_remote, updated_at = excluded.updated_at;
  `).run(key, name, primaryRemote || null, Date.now(), Date.now());
}

export async function registerAlias(db, { alias, identityKey, kind }) {
  await db.prepare(`
    INSERT INTO project_aliases (alias, identity_key, kind, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(alias) DO UPDATE SET identity_key = excluded.identity_key, kind = excluded.kind;
  `).run(alias, identityKey, kind, Date.now());
}

export async function unregisterAlias(db, alias) {
  await db.prepare("DELETE FROM project_aliases WHERE alias = ?;").run(alias);
}

export async function lookupByCandidates(db, candidates) {
  if (!candidates || !candidates.length) return null;
  const placeholders = candidates.map(() => "?").join(",");
  const row = await db.prepare(`
    SELECT identity_key FROM project_aliases
    WHERE alias IN (${placeholders})
    LIMIT 1;
  `).get(...candidates);
  return row ? row.identity_key : null;
}

export async function listIdentities(db) {
  const rows = await db.prepare("SELECT * FROM project_identities ORDER BY updated_at DESC;").all();
  const res = [];
  for (const row of rows) {
    const aliases = await db.prepare("SELECT alias, kind FROM project_aliases WHERE identity_key = ?;").all(row.key);
    res.push({
      ...row,
      aliases: aliases.map((a) => ({ alias: a.alias, kind: a.kind }))
    });
  }
  return res;
}

export async function removeIdentity(db, key) {
  await db.prepare("DELETE FROM project_identities WHERE key = ?;").run(key);
}
