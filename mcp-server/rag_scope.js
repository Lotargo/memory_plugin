import { GLOBAL_KEY, projectKey } from "./memory.js";

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
  const key = scopeKey || GLOBAL_KEY;
  await db
    .prepare(
      "INSERT OR IGNORE INTO document_scopes (doc_id, scope_key, created_at) VALUES (?, ?, ?);"
    )
    .run(docId, key, Date.now());
  return key;
}

export async function removeDocumentScopes(db, docId, scopeKeys) {
  const keys = Array.isArray(scopeKeys) ? [...new Set(scopeKeys.filter(Boolean))] : [];
  if (keys.length === 0) return { removedScopes: [], remainingScopes: 0 };
  const placeholders = keys.map(() => "?").join(",");
  const existing = await db
    .prepare(`SELECT scope_key FROM document_scopes WHERE doc_id = ? AND scope_key IN (${placeholders})`)
    .all(docId, ...keys);
  await db
    .prepare(`DELETE FROM document_scopes WHERE doc_id = ? AND scope_key IN (${placeholders})`)
    .run(docId, ...keys);
  const remaining = await db
    .prepare("SELECT COUNT(*) AS cnt FROM document_scopes WHERE doc_id = ?")
    .get(docId);
  const remainingScopes = remaining?.cnt || 0;
  if (existing.length > 0 && remainingScopes > 0) {
    const { queueDocumentSyncIfNeeded } = await import("./graph/knowledge_linker.js");
    await queueDocumentSyncIfNeeded(db, docId);
  }
  return {
    removedScopes: existing.map((row) => row.scope_key),
    remainingScopes,
  };
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
