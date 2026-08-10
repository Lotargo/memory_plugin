import { realpathSync, existsSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { getConfig } from "../config/config_manager.js";
import { MEMORY_DIR } from "../memory.js";

// Resolve a path to its real location, following symlinks/junctions.
// Falls back to the nearest existing ancestor when the target does not exist yet
// (needed for export targets that are about to be created).
export function realResolve(pathStr) {
  const abs = resolve(String(pathStr || "").trim());
  try {
    return realpathSync(abs);
  } catch {
    let parent = dirname(abs);
    const seen = new Set();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      if (existsSync(parent)) {
        try {
          return resolve(realpathSync(parent), abs.slice(parent.length + 1));
        } catch {
          break;
        }
      }
      const next = dirname(parent);
      if (next === parent) break;
      parent = next;
    }
    return abs;
  }
}

export function isWithin(resolvedPath, dir) {
  const root = realResolve(dir);
  return resolvedPath === root || resolvedPath.startsWith(root + sep);
}

// Roots the ingest pipeline is allowed to read from.
// Defaults to the current working directory (the project the agent is working in)
// plus the plugin's own data directory. Extendable via config.ingestAllowedPaths.
export function getIngestAllowedRoots() {
  const config = getConfig();
  const roots = [process.cwd(), MEMORY_DIR];
  if (Array.isArray(config.ingestAllowedPaths)) {
    for (const p of config.ingestAllowedPaths) {
      if (typeof p === "string" && p.trim()) roots.push(p.trim());
    }
  }
  return [...new Set(roots.map((r) => realResolve(r)))];
}

// Guard against arbitrary file reads (~/.ssh/id_rsa, .env, /etc/passwd) reaching
// the RAG store — and, in hybrid-sync mode, the cloud.
export function assertIngestPathAllowed(pathStr) {
  const resolved = realResolve(pathStr);
  const config = getConfig();
  if (config.ingestAllowAnyPath === true) return resolved;

  const roots = getIngestAllowedRoots();
  if (roots.some((root) => isWithin(resolved, root))) return resolved;

  throw new Error(
    `Ingestion blocked: '${pathStr}' is outside the allowed directories ` +
      `(${roots.join(", ")}). Add the directory to config.ingestAllowedPaths ` +
      `or set config.ingestAllowAnyPath = true to override.`
  );
}
