// Shared by config, command parsing and the TUI. Zero asks the OS for a free port.
export const DEFAULT_WEB_PORT = 0;

export function assertWebPort(port) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Web port must be an integer from 0 to 65535 (0 = automatic).");
  }
  return port;
}

export function parseWebPort(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("Web port must be an integer from 0 to 65535 (0 = automatic).");
  }
  return assertWebPort(Number(value));
}

export const WEB_USAGE = `Usage:
  memory-plugin web               Start/reuse the background panel; print its saved URL
  memory-cli web open             Start/reuse the panel and open it in the system browser
  memory-plugin web start|status|stop|restart
  memory-plugin web autostart on|off|status
  memory-plugin web --foreground [--port N]  Run a temporary panel until Ctrl+C
  memory-plugin web --port N      Run a temporary panel on an explicit port
  memory-cli web port [N]        Show or save the default port
  memory-cli web --help          Show this help

N: 0..65535; managed launches retain their first automatically selected port.
--port overrides the saved port for a foreground run only.
Aliases: memory_plugin web, memory-cli web, and dashboard.`;

export function parseWebCommand(args = []) {
  if (!args.length) return { action: "start" };
  if (args.length === 1 && ["--help", "-h", "help"].includes(args[0])) return { action: "help" };
  if (args.length === 1 && ['start', 'open', 'status', 'stop', 'restart'].includes(args[0])) return { action: args[0] };
  if (args.length === 2 && args[0] === 'autostart' && ['on', 'off', 'status'].includes(args[1])) return { action: 'autostart', value: args[1] };
  if (args[0] === '--foreground' && (args.length === 1 || (args.length === 3 && args[1] === '--port'))) {
    return { action: 'start', foreground: true, ...(args.length === 3 ? { port: parseWebPort(args[2]) } : {}) };
  }
  if (args[0] === "port" && args.length <= 2) {
    return args.length === 1 ? { action: "port" } : { action: "port", port: parseWebPort(args[1]) };
  }
  if (args.length === 2 && args[0] === "--port") return { action: "start", port: parseWebPort(args[1]) };
  throw new Error(WEB_USAGE);
}
