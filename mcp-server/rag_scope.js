import { GLOBAL_KEY, projectKey, MEMORY_DIR } from "./memory.js";
import { withSnapshotLock } from './storage/snapshot_lock.js';

export async function resolveRagScopeKey(scope = "project", ctx = {}) {
  if (scope === "global") return GLOBAL_KEY;
  const dir = ctx.directory || ctx.project || null;
  const key = await projectKey(ctx.worktree ?? null, dir);
  if (!key) {
    if (scope === "project") {
      throw new Error("Project-scoped RAG requires a Git repository. Use scope='global' outside Git.");
    }
    return null;
  }
  return key;
}

export async function resolveRagScopeKeys(scope = "all", ctx = {}) {
  if (scope === "global") return [GLOBAL_KEY];
  const dir = ctx.directory || ctx.project || null;
  const project = await projectKey(ctx.worktree ?? null, dir);
  if (scope === "project") {
    if (!project) {
      throw new Error("Project-scoped RAG requires a Git repository. Use scope='global' outside Git.");
    }
    return [project];
  }
  return project ? [GLOBAL_KEY, project] : [GLOBAL_KEY];
}

export async function resolveManageRagScopeKeys(action, scope, ctx = {}) {
  if (action !== "delete" || scope) {
    return await resolveRagScopeKeys(scope || "all", ctx);
  }

  // Browsing defaults to the combined visible view, but a destructive action
  // defaults to the narrowest current ownership boundary. Inside Git that is
  // the project; outside Git the only visible boundary is global.
  const visible = await resolveRagScopeKeys("all", ctx);
  return visible.length > 1 ? [visible[visible.length - 1]] : visible;
}

export async function addDocumentScope(db, docId, scopeKey) {
  return withSnapshotLock(MEMORY_DIR, () => addScopeLocked(db, docId, scopeKey));
}
async function addScopeLocked(db, docId, scopeKey) {
  const key = scopeKey || GLOBAL_KEY;
  await db
    .prepare(
      "INSERT OR IGNORE INTO document_scopes (doc_id, scope_key, created_at) VALUES (?, ?, ?);"
    )
    .run(docId, key, Date.now());
  return key;
}

export async function removeDocumentScopes(db, docId, scopeKeys, { deferFinalRemoval = false } = {}) {
  return withSnapshotLock(MEMORY_DIR, () => removeScopesLocked(db, docId, scopeKeys, { deferFinalRemoval }));
}
async function removeScopesLocked(db, docId, scopeKeys, { deferFinalRemoval = false } = {}) {
  const keys = Array.isArray(scopeKeys) ? [...new Set(scopeKeys.filter(Boolean))] : [];
  if (!keys.length) return {removedScopes:[],remainingScopes:0};
  const {removalState,publishRemoval} = await import('./storage/knowledge_removal.js');
  const {BLOBS_DIR} = await import('./db/database.js');
  const state = removalState(db.localDb,docId,keys);
  if (!state) return {removedScopes:[],remainingScopes:0};
  if (!state.removedScopes.length) return {removedScopes:[],remainingScopes:state.scopes.length};
  // Kept only for callers explicitly retaining the last scope until a purge.
  if (deferFinalRemoval && state.purge) return {removedScopes:state.removedScopes,remainingScopes:0};
  return publishRemoval(db,state,BLOBS_DIR);
}

export function scopeFilterSql(scopeKeys, column = "ds.scope_key") {
  if (!Array.isArray(scopeKeys) || scopeKeys.length === 0) {
    return { clause: "", params: [] };
  }
  return {
    clause: `${column} IN (${scopeKeys.map(() => "?").join(",")})`,
    params: scopeKeys,
  };
}
