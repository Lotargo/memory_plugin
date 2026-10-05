import { updateConfig } from "../../config/config_manager.js";
import { parseWebPort } from "../../dashboard/options.js";
import { readTextInput, waitForEnter } from "../ui.js";

export async function handleWebAction(value, config) {
  if (value !== "web_port") return;
  const input = await readTextInput("Web port: 0 = automatic, or 1..65535 (applies on next start)", String(config.webPort));
  if (input.action !== "submit") return;
  try {
    const port = parseWebPort(input.value);
    updateConfig({ webPort: port });
    console.log(`\nWeb port saved: ${port === 0 ? "automatic" : port}. Start with memory-plugin web.\n`);
  } catch (error) { console.log(`\n${error.message}\n`); }
  await waitForEnter();
}
