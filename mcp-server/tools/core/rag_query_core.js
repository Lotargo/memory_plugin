import { resolveRagScopeKeys } from "../../rag_scope.js";
import { getConfig } from "../../config/config_manager.js";
import { hybridQuery, batchHybridQuery } from "../../retrieval/retriever.js";

function formatIdentityLines(result) {
  const lines = [];
  if (result.doc_id) lines.push(`Doc ID: ${result.doc_id}`);
  if (result.source_type) lines.push(`Source: ${result.source_type}`);
  if (result.note_kind) lines.push(`Kind: ${result.note_kind}`);
  if (Array.isArray(result.tags) && result.tags.length > 0) {
    lines.push(`Tags: ${result.tags.join(", ")}`);
  }
  return lines;
}

export function formatSnippetResult(result, rank, headingLevel = 3) {
  const hashes = "#".repeat(Math.max(1, headingLevel));
  let header = `${hashes} [${rank}] ${result.doc_title || "Untitled"}`;
  if (result.heading) header += ` > ${result.heading}`;
  if (result.breadcrumbs) header += ` (${result.breadcrumbs})`;

  const bodyLines = [
    ...formatIdentityLines(result),
    `Score: ${(result.score || 0).toFixed(4)}`,
  ];

  if (result.defined_symbols && result.defined_symbols.length > 0) {
    bodyLines.push(`Defined Symbols: ${result.defined_symbols.join(", ")}`);
  }

  const body = result.snippet || result.full_section_content || "";
  return `${header}\n${bodyLines.join("\n")}\n\n${body}`;
}

export async function runSingleRagQuery(
  { query, limit = 5, instruction = null, generateEmbeddings = true, scope = "all", directory = null, project = null },
  ctx = {}
) {
  const activeConfig = getConfig();
  const effectiveDirectory = directory || project || ctx.directory || null;
  const scopeKeys = await resolveRagScopeKeys(scope || "all", {
    worktree: ctx.worktree ?? null,
    directory: effectiveDirectory,
  });

  const results = await hybridQuery({
    query,
    limit,
    generateEmbeddings: generateEmbeddings !== false,
    instruction: instruction || null,
    scopeKeys,
  });

  if (!results || results.length === 0) {
    return `[Active Model: ${activeConfig.embeddingModel}]\nNo matching knowledge found for query.`;
  }

  const header = `[Active Model: ${activeConfig.embeddingModel} | Fusion: ${activeConfig.fusionAlgorithm.toUpperCase()}]\n\n`;
  const formatted = results
    .map((result, index) => formatSnippetResult(result, index + 1, 3))
    .join("\n\n---\n\n");

  return header + formatted;
}

export async function runBatchRagQuery(
  { queries, limit = 5, instruction = null, generateEmbeddings = true, scope = "all", directory = null, project = null },
  ctx = {}
) {
  const activeConfig = getConfig();
  const effectiveDirectory = directory || project || ctx.directory || null;
  const scopeKeys = await resolveRagScopeKeys(scope || "all", {
    worktree: ctx.worktree ?? null,
    directory: effectiveDirectory,
  });

  const allResults = await batchHybridQuery(queries, {
    limit,
    generateEmbeddings: generateEmbeddings !== false,
    instruction: instruction || null,
    scopeKeys,
  });

  const formatted = allResults
    .map((results, queryIndex) => {
      const queryHeader = `### Query [${queryIndex + 1}]: "${queries[queryIndex]}"\n\n`;
      if (!results || results.length === 0) {
        return queryHeader + "No matching knowledge found for this query.";
      }
      const items = results
        .map((result, resultIndex) => formatSnippetResult(result, resultIndex + 1, 4))
        .join("\n\n---\n\n");
      return queryHeader + items;
    })
    .join("\n\n===\n\n");

  return `[Active Model: ${activeConfig.embeddingModel} | Fusion: ${activeConfig.fusionAlgorithm.toUpperCase()} | ${queries.length} queries]\n\n${formatted}`;
}
