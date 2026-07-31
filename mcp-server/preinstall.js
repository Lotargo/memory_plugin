import { execSync } from "child_process";

// Skip preinstall entirely in CI / Docker / Jules containers
if (process.env.CI || process.env.CONTINUOUS_INTEGRATION || process.env.DEBIAN_FRONTEND === "noninteractive" || process.cwd().startsWith("/app")) {
  process.exit(0);
}

// Only run graceful process termination during explicit global npm updates
if (process.env.npm_config_global === "true" || process.env.MEMORY_PREINSTALL_FORCE === "true") {
  try {
    const currentPid = process.pid;
    const ppid = process.ppid;

    if (process.platform === "win32") {
      try {
        const psCmd = `Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -like '*mcp-server/index.js*' -or $_.CommandLine -like '*mcp-server\\\\index.js*') -and $_.CommandLine -notlike '*install*' -and $_.ProcessId -ne ${currentPid} -and $_.ProcessId -ne ${ppid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
        execSync(`powershell -NoProfile -NonInteractive -Command "${psCmd}"`, { stdio: "ignore" });
      } catch {}
    } else {
      try {
        const psOutput = execSync(`ps -eo pid,ppid,args 2>/dev/null || true`, { encoding: "utf-8" });
        const lines = psOutput.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parts = trimmed.split(/\s+/);
          const pid = parseInt(parts[0], 10);
          const parentPid = parseInt(parts[1], 10);
          const cmd = parts.slice(2).join(" ");

          if (!pid || pid === currentPid || pid === ppid || parentPid === currentPid) continue;

          const isServer = cmd.includes("mcp-server/index.js") || cmd.includes("mcp-server/index.js");
          const isInstaller = /npm|npx|yarn|pnpm|preinstall|install/i.test(cmd);

          if (isServer && !isInstaller) {
            try {
              process.kill(pid, "SIGTERM");
            } catch {}
          }
        }
      } catch {}
    }
  } catch (e) {
    // Ignore errors
  }
}

