#!/usr/bin/env node

// ── CLI Boot Guard ──────────────────────────────────────────────────────────
// Same version check as boot.js — see that file for the rationale.
// ─────────────────────────────────────────────────────────────────────────────

import { isSupportedNodeVersion, SUPPORTED_NODE_RANGE } from './codex_config.js';

if (!isSupportedNodeVersion(process.versions.node)) {
  process.stderr.write(
    `\n` +
    `  ╔══════════════════════════════════════════════════════════════════╗\n` +
    `  ║  @lotargo/memory_plugin needs Node.js 22.16+ (22.x) or 24+     ║\n` +
    `  ║                                                                ║\n` +
    `  ║  Detected: Node.js ${process.versions.node.padEnd(44)}║\n` +
    `  ║                                                                ║\n` +
    `  ║  SQLite FTS5 and the browser dependencies are required.      ║\n` +
    `  ║  Supported range: ${SUPPORTED_NODE_RANGE.padEnd(39)}║\n` +
    `  ║  Node.js installation:                                        ║\n` +
    `  ║                                                                ║\n` +
    `  ║    nvm install 22   # or: brew install node@22                 ║\n` +
    `  ║                                                                ║\n` +
    `  ╚══════════════════════════════════════════════════════════════════╝\n` +
    `\n`
  );
  process.exit(1);
}

// Version is OK — hand off to the real CLI.
if (process.argv[2] === 'clients') {
  const { handleClientCommand } = await import('./cli/client_commands.js');
  await handleClientCommand(process.argv.slice(3));
  process.exit(process.exitCode || 0);
}
if (process.argv[2] === 'uninstall' && process.argv[3] && !process.argv[3].startsWith('-')) {
  const { handleUninstallCommand } = await import('./cli/uninstall_commands.js');
  await handleUninstallCommand(process.argv.slice(3));
  process.exit(process.exitCode || 0);
}
if (process.argv[2] === 'persona') {
  const { handlePersonaCommand } = await import('./cli/persona_commands.js');
  await handlePersonaCommand(process.argv.slice(3));
} else if (process.argv[2] === 'rag-maintenance') {
  const { handleRagMaintenanceCommand } = await import('./cli/rag_maintenance_commands.js');
  await handleRagMaintenanceCommand(process.argv.slice(3));
} else if (process.argv[2] === 'prompts') {
  const { handlePromptCommand } = await import('./cli/prompt_commands.js');
  await handlePromptCommand(process.argv.slice(3));
} else if (process.argv[2] === 'notebook') {
  const { handleNotebookCommand } = await import('./cli/notebook_commands.js');
  await handleNotebookCommand(process.argv.slice(3));
} else if (process.argv[2] === 'marketplace') {
  const { handleMarketplaceCommand } = await import('./marketplace.js');
  await handleMarketplaceCommand(process.argv.slice(3));
} else if (process.argv[2] === "knowledge") {
  const { handleKnowledgeCommand } = await import("./cli/knowledge_commands.js");
  await handleKnowledgeCommand(process.argv.slice(3));
} else if (["web", "dashboard"].includes(process.argv[2])) {
  const { handleWebCommand } = await import("./cli/web_commands.js");
  await handleWebCommand(process.argv.slice(3));
} else import("./cli.js").then(m => {
  if (process.argv[1] && process.argv[1].includes("cli_boot.js")) {
    m.runCli().catch((err) => {
      console.error("CLI error:", err);
      process.exitCode = 1;
    });
  }
});
