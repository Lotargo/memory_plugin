import { parseWebCommand, WEB_USAGE } from "../dashboard/options.js";

export async function handleWebCommand(args = [], { launchBrowser, onError } = {}) {
  try {
    const command = parseWebCommand(args);
    if (command.action === "help") {
      console.log(WEB_USAGE);
      return;
    }
    if (command.action === "port") {
      const { getConfig, updateConfig } = await import("../config/config_manager.js");
      const config = command.port === undefined ? getConfig() : updateConfig({ webPort: command.port });
      console.log(`Web port: ${config.webPort}${config.webPort === 0 ? " (automatic)" : ""}. Managed launches keep their saved address; use web restart after changing a preferred port.`);
      return;
    }
    if (command.foreground || command.port !== undefined) {
      const { runDashboard } = await import("../dashboard/server.js");
      await runDashboard(command.port === undefined ? [] : ["--port", String(command.port)]);
      return;
    }
    const { ensureWeb, webStatus, stopWeb, setWebAutostart, registerWebStartup } = await import('../dashboard/runtime.js');
    if (command.action === 'stop') { await stopWeb(); console.log('Memory background panel stopped.'); return; }
    if (command.action === 'autostart') {
      if (command.value === 'status') {
        const { getConfig } = await import('../config/config_manager.js');
        console.log(JSON.stringify({ enabled: getConfig().webAutoStart, startup: registerWebStartup({ dryRun: true }) }, null, 2));
      } else console.log(JSON.stringify(await setWebAutostart(command.value === 'on'), null, 2));
      return;
    }
    if (command.action === 'status') { console.log(JSON.stringify(await webStatus(), null, 2)); return; }
    const result = await ensureWeb({ restart: command.action === 'restart' });
    console.log(`Memory background panel\n${result.url}\nThe panel stays available after this command exits. Stop: memory-plugin web stop.`);
    if (command.action === 'open') {
      const launch = launchBrowser || (await import('../dashboard/browser.js')).requestPanelBrowser;
      await launch(result.url);
      console.log('Browser launch requested.');
    }
  } catch (error) {
    console.error(`Web interface: ${error.message}`);
    if (onError) onError(error);
    else process.exitCode = 1;
  }
}
