// Central logger. Everything goes to stderr: stdout is the MCP JSON-RPC
// channel and any stray write there corrupts the protocol stream.
//
// Level is taken from MEMORY_LOG_LEVEL (silent|error|warn|info|debug),
// defaulting to "warn". Hosts embedding the server can swap the sink with
// setLogSink() — e.g. to forward into the OpenCode client log.

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

function envLevel() {
  const raw = String(process.env.MEMORY_LOG_LEVEL || "").toLowerCase();
  return raw in LEVELS ? raw : "warn";
}

let currentLevel = envLevel();
let sink = (level, message) => {
  process.stderr.write(`[memory:${level}] ${message}\n`);
};

export function setLogLevel(level) {
  if (level in LEVELS) currentLevel = level;
}

export function getLogLevel() {
  return currentLevel;
}

export function setLogSink(fn) {
  sink = typeof fn === "function" ? fn : sink;
}

function emit(level, args) {
  if (LEVELS[level] > LEVELS[currentLevel]) return;
  const message = args
    .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  try {
    sink(level, message);
  } catch {}
}

export const logger = {
  error: (...args) => emit("error", args),
  warn: (...args) => emit("warn", args),
  info: (...args) => emit("info", args),
  debug: (...args) => emit("debug", args),
};

export default logger;
