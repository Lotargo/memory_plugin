import { waitForEnter } from "../ui.js";

export async function handlePromptAction(value) {
  switch (value) {
    case "enable_prompt": {
      const { enableGlobalPrompt } = await import("../../prompt_manager.js");
      const results = await enableGlobalPrompt();
      console.clear();
      console.log("\n  [OK] Global prompt enabled across client configurations:\n");
      results.forEach((r) => console.log(`  - ${r.name}: ${r.filePath} (${r.status})`));
      await waitForEnter();
      break;
    }
    case "disable_prompt": {
      const { disableGlobalPrompt } = await import("../../prompt_manager.js");
      const results = await disableGlobalPrompt();
      console.clear();
      console.log("\n  [OK] Global prompt disabled across client configurations:\n");
      results.forEach((r) => console.log(`  - ${r.name}: ${r.filePath} (${r.status})`));
      await waitForEnter();
      break;
    }
  }
}
