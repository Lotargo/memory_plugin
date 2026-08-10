#!/usr/bin/env node

// ── CLI Boot Guard ──────────────────────────────────────────────────────────
// Same version check as boot.js — see that file for the rationale.
// ─────────────────────────────────────────────────────────────────────────────

const MIN_MAJOR = 22;
const MIN_MINOR = 5;

const [major, minor] = process.versions.node.split(".").map(Number);

if (major < MIN_MAJOR || (major === MIN_MAJOR && minor < MIN_MINOR)) {
  process.stderr.write(
    `\n` +
    `  ╔══════════════════════════════════════════════════════════════════╗\n` +
    `  ║  @lotargo/memory_plugin requires Node.js >= 22.5.0             ║\n` +
    `  ║                                                                ║\n` +
    `  ║  Detected: Node.js ${process.versions.node.padEnd(44)}║\n` +
    `  ║                                                                ║\n` +
    `  ║  The built-in node:sqlite module used by this plugin was       ║\n` +
    `  ║  introduced in Node.js 22.5.0.  Please upgrade your           ║\n` +
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
import("./cli.js").then(m => {
  if (process.argv[1] && process.argv[1].includes("cli_boot.js")) {
    m.runCli().catch((err) => console.error("CLI error:", err));
  }
});
