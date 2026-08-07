import { updateConfig } from "../../config/config_manager.js";
import { selectSimpleMenu, promptText, waitForEnter } from "../ui.js";

export async function handleCloudAction(value, config) {
  switch (value) {
    case "cloud_login": {
      console.clear();
      console.log("\n  [CLOUD] Turso cloud authorization\n");
      const methodItems = [
        { label: "Browser OAuth (GUI)", value: "browser", info: "Opens the system browser for the loopback OAuth flow (requires a desktop session)" },
        { label: "Account API Token", value: "api_token", info: "Paste a Turso account API token — works headless (Docker, Google Jules, VPS/VDS)" },
        { label: "Database URL + Token", value: "db_token", info: "Paste a libsql:// endpoint and its database auth token — no Platform API needed" },
        { label: "Import From Environment", value: "env", info: "Pick up TURSO_DB_URL / TURSO_DB_TOKEN / TURSO_API_TOKEN from env vars or MEMORY_DIR/.env" },
        { label: "< Cancel", value: "cancel", info: "Return to the main menu" },
      ];
      const methodRes = await selectSimpleMenu({
        title: "CHOOSE LOGIN METHOD",
        subtitle: "Browser login needs a GUI. Token / env methods work in Docker, Google Jules and on VPS/VDS.",
        items: methodItems,
      });
      if (methodRes.action !== "select" || methodRes.value === "cancel") break;

      const { loginToCloud, loginWithApiToken, loginWithDatabaseToken, loginFromEnv } = await import("../../admin/auth.js");
      try {
        let secrets;
        if (methodRes.value === "browser") {
          secrets = await loginToCloud();
        } else if (methodRes.value === "api_token") {
          const token = await promptText("Paste your Turso account API token\n  (create one at https://console.turso.tech or via `turso auth api-tokens create`)");
          if (!token) throw new Error("Empty API token.");
          secrets = await loginWithApiToken({ token });
        } else if (methodRes.value === "db_token") {
          const dbUrl = await promptText("Paste your database URL (libsql://<database>-<org>.turso.io)");
          const token = await promptText("Paste your database auth token");
          if (!dbUrl || !token) throw new Error("Empty URL or token.");
          secrets = await loginWithDatabaseToken({ dbUrl, token, validate: false });
        } else if (methodRes.value === "env") {
          const res = await loginFromEnv({ persist: true });
          if (!res.ok) throw new Error(res.reason);
          secrets = res.secrets;
        }
        console.log(`\n  \x1b[32m[OK] Successfully signed in to the cloud! Connected to endpoint: ${secrets.dbUrl}\x1b[0m\n`);
      } catch (e) {
        console.error(`\n  \x1b[31m[ERROR] Authorization failed: ${e.message}\x1b[0m\n`);
      }
      await waitForEnter();
      break;
    }
    case "cloud_logout": {
      console.clear();
      console.log("\n  [CLOUD] Signing out of the cloud...");
      const { logoutFromCloud } = await import("../../admin/auth.js");
      const deleted = logoutFromCloud();
      if (deleted) {
        console.log("  \x1b[32m[OK] You have been signed out. Encrypted secrets removed. Mode reverted to only-local.\x1b[0m\n");
      } else {
        console.log("  [*] Mode reverted to only-local. No session tokens were found.\x1b[0m\n");
      }
      await waitForEnter();
      break;
    }
    case "cloud_api_set": {
      console.clear();
      console.log("\n  [API KEY] Set / replace the Turso account API token\n");
      const { setApiKey } = await import("../../admin/auth.js");
      try {
        const token = await promptText(
          "Paste your Turso account API token\n  (create one at https://console.turso.tech or via `turso auth api-tokens create`)"
        );
        if (!token) throw new Error("Empty API token.");
        const res = await setApiKey(token);
        console.log(
          `\n  \x1b[32m[OK] API token stored. Authorized as "${res.secrets.username}" — endpoint: ${res.secrets.dbUrl}\x1b[0m\n`
        );
      } catch (e) {
        console.error(`\n  \x1b[31m[ERROR] Failed to set API key: ${e.message}\x1b[0m\n`);
      }
      await waitForEnter();
      break;
    }
    case "cloud_api_clear": {
      console.clear();
      console.log("\n  [API KEY] Removing the stored account API token...");
      const { clearApiKey } = await import("../../admin/auth.js");
      const res = clearApiKey();
      if (res.removed) {
        console.log(
          res.keptDbSession
            ? "  \x1b[32m[OK] API token removed. The resolved database session is kept and stays authorized.\x1b[0m\n"
            : "  \x1b[32m[OK] API token removed. Encrypted secrets purged.\x1b[0m\n"
        );
      } else {
        console.log("  [*] No stored API token to remove.\x1b[0m\n");
      }
      await waitForEnter();
      break;
    }
    case "cloud_mode": {
      const modeItems = [
        { label: "only-local (Local only)", value: "only-local", info: "Fully private, offline-first mode (everything stored on disk)" },
        { label: "only-cloud (Cloud only)", value: "only-cloud", info: "Fully serverless cloud mode with no local caching" },
        { label: "hybrid-sync (Local with background sync)", value: "hybrid-sync", info: "Instant local operations with a background sync daemon" },
      ];
      const initialIdx = Math.max(0, modeItems.findIndex((i) => i.value === config.mode));
      const subRes = await selectSimpleMenu({
        title: "CHOOSE OPERATIONAL MODE",
        subtitle: "Configure database storage and cloud sync behavior",
        items: modeItems,
        initialIndex: initialIdx,
      });

      if (subRes.action === "select") {
        updateConfig({ mode: subRes.value });
      }
      break;
    }
    case "conflict_strategy": {
      const strategyItems = [
        { label: "merge (Union local + cloud)", value: "merge", info: "Facts from both sides are merged and deduplicated — no data loss (recommended)" },
        { label: "cloud-wins (Cloud overwrites local)", value: "cloud-wins", info: "On conflict, the cloud copy replaces the local store" },
        { label: "local-wins (Local overwrites cloud)", value: "local-wins", info: "On conflict, the local copy replaces the cloud store" },
      ];
      const initialIdx = Math.max(0, strategyItems.findIndex((i) => i.value === (config.conflictStrategy || "merge")));
      const subRes = await selectSimpleMenu({
        title: "CHOOSE CONFLICT STRATEGY",
        subtitle: "How hybrid-sync resolves differing local vs cloud stores",
        items: strategyItems,
        initialIndex: initialIdx,
      });

      if (subRes.action === "select") {
        updateConfig({ conflictStrategy: subRes.value });
        console.log(`\n  [OK] Conflict strategy set to: ${subRes.value}`);
      }
      break;
    }
  }
}
