#!/usr/bin/env node

// ── Boot Guard ──────────────────────────────────────────────────────────────
// This file is the true entry point for both `memory_plugin` and `memory-agent`
// binaries.  Its sole purpose is to verify the Node.js version BEFORE the ESM
// module graph is evaluated — because `mcp-server/index.js` transitively
// imports `node:sqlite` (a built-in available only from Node 22.5.0), and ESM
// static imports are hoisted, so a version check inside that file would never
// execute.
//
// By keeping this file free of any `node:sqlite` dependency we can print a
// clear, actionable error message instead of the cryptic
//   "No such built-in module: node:sqlite"
// that users on Node 18/20/21 would otherwise see.
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

// Version is OK — hand off to the real entry point.
import("./index.js");
