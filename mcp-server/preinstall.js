import { execSync } from "child_process";

// Only run graceful process termination during explicit global npm updates
// Skip if running interactively or inside active MCP sessions to avoid EOF drops
if (process.env.npm_config_global === "true" || process.env.MEMORY_PREINSTALL_FORCE === "true") {
  try {
    const currentPid = process.pid;
    const ppid = process.ppid;
    if (process.platform === "win32") {
      // Safely attempt to terminate orphaned background memory node processes
      try {
        execSync(`wmic process where "name='node.exe' and commandline like '%memory_plugin%' and ProcessId!=${currentPid} and ProcessId!=${ppid}" call terminate`, { stdio: "ignore" });
      } catch {}
    } else {
      try {
        execSync(`pkill -f "memory-agent|memory_plugin" || true`, { stdio: "ignore" });
      } catch {}
    }
  } catch (e) {
    // Ignore errors
  }
}
