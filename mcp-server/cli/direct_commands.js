import {
  readMemory,
  listProjectStores,
  migrateStoreTitles,
  GLOBAL_KEY,
  projectKey,
} from "../memory.js";

export async function handleDirectCommands(cliArgs) {
  if (cliArgs[0] === 'rag-maintenance') {
    const { handleRagMaintenanceCommand } = await import('./rag_maintenance_commands.js');
    await handleRagMaintenanceCommand(cliArgs.slice(1)); return true;
  }
  if (cliArgs[0] === 'maintenance') {
    const { handleMaintenanceCommand } = await import('./maintenance_commands.js');
    await handleMaintenanceCommand(cliArgs.slice(1)); return true;
  }
  if (cliArgs[0] === 'prompts') {
    const { handlePromptCommand } = await import('./prompt_commands.js');
    await handlePromptCommand(cliArgs.slice(1)); return true;
  }
  if (cliArgs[0] === 'notebook') {
    const { handleNotebookCommand } = await import('./notebook_commands.js');
    await handleNotebookCommand(cliArgs.slice(1)); return true;
  }
  if (cliArgs[0] === 'marketplace') {
    const { handleMarketplaceCommand } = await import('../marketplace.js');
    await handleMarketplaceCommand(cliArgs.slice(1));
    return true;
  }
  if (cliArgs[0] === "knowledge") {
    const { handleKnowledgeCommand } = await import("./knowledge_commands.js");
    await handleKnowledgeCommand(cliArgs.slice(1));
    return true;
  }
  if (["web", "dashboard"].includes(cliArgs[0])) {
    const { handleWebCommand } = await import("./web_commands.js");
    await handleWebCommand(cliArgs.slice(1));
    return true;
  }
  if (cliArgs[0] === "snapshots") {
    const { handleSnapshotCommands } = await import("./snapshot_commands.js");
    return handleSnapshotCommands(cliArgs);
  }
  if (cliArgs[0] === "uninstall" || cliArgs.includes("uninstall") || cliArgs.includes("--uninstall")) {
    const { runUninstall } = await import("../uninstall.js");
    await runUninstall();
    return true;
  }

  if (cliArgs[0] === "models" || cliArgs[0] === "model") {
    const { handleModelCommands } = await import("./model_commands.js");
    return await handleModelCommands(cliArgs);
  }

  if (cliArgs[0] === "dev-link" || cliArgs[0] === "dev_link") {
    const { runDevLink } = await import("../dev_link.js");
    await runDevLink();
    return true;
  }

  if (cliArgs[0] === "sync-persona" || cliArgs[0] === "sync_persona") {
    const { syncPersonaPrompts } = await import("../prompt_manager.js");
    const results = await syncPersonaPrompts();
    console.log("\nPersona overlay synchronization:\n");
    for (const result of results) {
      console.log(`  - ${result.name}: ${result.status}${result.error ? ` (${result.error})` : ""}`);
    }
    console.log("");
    if (results.some((result) => result.status === "failed")) process.exitCode = 1;
    return true;
  }

  if (cliArgs[0] === "migrate-persona" || cliArgs[0] === "migrate_persona") {
    const { migrateLegacyPersonaDirectives } = await import("../persona_migration.js");
    const dryRun = cliArgs.includes("--dry-run");
    const result = await migrateLegacyPersonaDirectives({ dryRun });
    console.log(`\nPersona metadata migration${dryRun ? " (dry run)" : ""}:\n`);
    console.log(`  Legacy directives found: ${result.changed}`);
    for (const item of result.migrated) {
      console.log(`  - ${item.title}${item.id ? ` (${item.id})` : ""}`);
    }
    console.log(dryRun ? "\nNo files were changed.\n" : `\nNotebook: ${result.status}. Backup: ${result.backup || 'no changes'}.\n`);
    if (!dryRun) for (const item of result.persona || []) console.log(`  - ${item.name || 'Persona sync'}: ${item.status}`);
    if (result.status === 'partial') process.exitCode = 1;
    return true;
  }

  if (cliArgs[0] === "doctor" && cliArgs.includes("--codex")) {
    const { runCodexDoctor } = await import("../codex_diagnostics.js");
    console.log("\nCodex memory-agent diagnostics\n");
    const result = await runCodexDoctor();
    console.log("");
    if (!result.ok) process.exitCode = 1;
    return true;
  }

  if (cliArgs[0] === 'projects') {
    const { handleProjectCommand } = await import('./project_commands.js');
    await handleProjectCommand(cliArgs.slice(1)); return true;
  }
  if (['link','unlink','relink'].includes(cliArgs[0])) {
    const { executeProjectOperation } = await import('../services/project_service.js');
    const values = { directory:process.cwd() };
    for(let i=1;i<cliArgs.length;i++) {
      const flag=cliArgs[i];
      if(flag==='--purge') values.purge=true;
      else if(['--dir','--remote'].includes(flag) && cliArgs[i+1] && !cliArgs[i+1].startsWith('--')) values[flag==='--dir'?'directory':'remote']=cliArgs[++i];
      else throw new Error('Usage: memory-cli link|unlink|relink [--dir <absolute path>] [--remote <url>]');
    }
    console.log(JSON.stringify(await executeProjectOperation(cliArgs[0],values),null,2)); return true;
  }

  if (cliArgs[0] === "identity") {
    const dirIdx = cliArgs.indexOf("--dir");
    const dir = dirIdx >= 0 && cliArgs[dirIdx + 1] ? cliArgs[dirIdx + 1] : process.cwd();

    try {
      const { resolveProjectIdentity } = await import("../identity.js");
      const identity = await resolveProjectIdentity(dir);
      console.log(`\n  PROJECT IDENTITY`);
      if (identity) {
        console.log(`  - Key: ${identity.key}`);
        console.log(`  - Name: ${identity.name}`);
        console.log(`  - Primary Remote: ${identity.primaryRemote || "none"}`);
        console.log(`  - Toplevel Directory: ${identity.toplevel}`);
      } else {
        console.log("  No Git repository detected.");
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    return true;
  }

  if (cliArgs[0] === "migrate_titles") {
    const keyIdx = cliArgs.indexOf("--key");
    const key = keyIdx >= 0 && cliArgs[keyIdx + 1] ? cliArgs[keyIdx + 1] : null;

    try {
      const targets = [];
      if (key) {
        targets.push(key);
      } else {
        const gitKey = await projectKey(process.cwd(), null);
        if (gitKey) targets.push(gitKey);
        targets.push(GLOBAL_KEY);
        const stores = await listProjectStores();
        for (const s of stores) {
          if (!targets.includes(s.key)) targets.push(s.key);
        }
      }

      let total = 0;
      for (const k of targets) {
        const res = await migrateStoreTitles(k);
        if (res.ok) {
          total += res.changed;
          console.log(`  [${res.status}] ${k}: ${res.changed} record(s) updated (titles/IDs). Backup: ${res.backup || 'no changes'}`);
        } else {
          console.log(`  [SKIP] ${k}: ${res.reason}`);
        }
      }
      console.log(`\n  Done. ${total} fact(s) updated across ${targets.length} store(s).\n`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    return true;
  }

  if (cliArgs.includes("--enable-prompt") || cliArgs.includes("enable-prompt")) {
    const { enableGlobalPrompt } = await import("../prompt_manager.js");
    const results = await enableGlobalPrompt();
    console.log("\n  Global prompt enable results (active sessions not observed):\n");
    results.forEach((r) => console.log(`  - ${r.name}: ${r.filePath} (${r.status})${r.error ? `: ${r.error}` : ''}`));
    if (results.some(r => r.status === 'failed')) process.exitCode = 1;
    console.log("");
    return true;
  }

  if (cliArgs.includes("--disable-prompt") || cliArgs.includes("disable-prompt")) {
    const { disableGlobalPrompt } = await import("../prompt_manager.js");
    const results = await disableGlobalPrompt();
    console.log("\n  Global prompt disable results (MCP/plugin activation unchanged):\n");
    results.forEach((r) => console.log(`  - ${r.name}: ${r.filePath} (${r.status})${r.error ? `: ${r.error}` : ''}`));
    if (results.some(r => r.status === 'failed')) process.exitCode = 1;
    console.log("");
    return true;
  }

  if (cliArgs.includes("login")) {
    console.log("\n  [CLOUD] Starting Turso cloud authorization...");
    const loginIdx = cliArgs.indexOf("login");
    const loginArgs = cliArgs.slice(loginIdx + 1);
    const flagValue = (name) => {
      const i = loginArgs.indexOf(name);
      return i >= 0 && loginArgs[i + 1] ? loginArgs[i + 1] : null;
    };
    const { loginToCloud, loginWithApiToken, loginWithDatabaseToken, loginFromEnv } = await import("../admin/auth.js");
    try {
      let secrets;
      if (loginArgs.includes("--from-env")) {
        const res = await loginFromEnv({ persist: false });
        if (!res.ok) throw new Error(res.reason);
        secrets = res.secrets;
      } else if (loginArgs.includes("--db-url") || loginArgs.includes("--db-token") || process.env.TURSO_DB_TOKEN) {
        const { resolveSecret } = await import("./secret_input.js");
        const dbToken = await resolveSecret({
          argvValue: flagValue("--db-token"),
          envKeys: ["TURSO_DB_TOKEN", "TURSO_TOKEN"],
          promptLabel: "Turso database token",
        });
        if (!dbToken) throw new Error("Missing database token. Set TURSO_DB_TOKEN or provide it at the prompt.");
        secrets = await loginWithDatabaseToken({
          dbUrl: flagValue("--db-url") || process.env.TURSO_DB_URL || process.env.TURSO_URL,
          token: dbToken,
          username: flagValue("--username") || "",
          org: flagValue("--org") || "",
          db: flagValue("--database") || "",
          validate: !loginArgs.includes("--no-validate"),
        });
      } else if (
        loginArgs.includes("--token") ||
        loginArgs.includes("--api-token") ||
        loginArgs.includes("--api-key") ||
        process.env.TURSO_API_TOKEN
      ) {
        const { resolveSecret } = await import("./secret_input.js");
        const token = await resolveSecret({
          argvValue: flagValue("--token") || flagValue("--api-token") || flagValue("--api-key"),
          envKeys: ["TURSO_API_TOKEN"],
          promptLabel: "Turso API token",
        });
        if (!token) {
          throw new Error(
            "Missing token value. Set TURSO_API_TOKEN, or run: memory-cli login --api-token (you will be prompted)"
          );
        }
        secrets = await loginWithApiToken({
          token,
          org: flagValue("--org") || null,
          databaseName: flagValue("--database") || null,
        });
      } else {
        secrets = await loginToCloud();
      }
      console.log(`\n  \x1b[32m[OK] Successfully signed in to the cloud! Connected to endpoint: ${secrets.dbUrl}\x1b[0m\n`);
    } catch (e) {
      console.error(`\n  \x1b[31m[ERROR] Authorization failed: ${e.message}\x1b[0m\n`);
      process.exit(1);
    }
    return true;
  }

  if (cliArgs.includes("logout")) {
    const { logoutFromCloud, clearApiKey } = await import("../admin/auth.js");
    if (cliArgs.includes("--api-key")) {
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
      return true;
    }
    console.log("\n  [CLOUD] Signing out of the cloud...");
    const deleted = logoutFromCloud();
    if (deleted) {
      console.log("  \x1b[32m[OK] You have been signed out. Encrypted secrets removed. Mode reverted to only-local.\x1b[0m\n");
    } else {
      console.log("  [*] Mode reverted to only-local. No session tokens were found.\x1b[0m\n");
    }
    return true;
  }

  if (cliArgs.includes("auth-status") || cliArgs.includes("auth_status") || cliArgs.includes("auth")) {
    const { getAuthStatus } = await import("../admin/auth.js");
    const st = getAuthStatus();
    console.log("\n  [CLOUD] Authentication status:");
    console.log(`    Source:        ${st.source}`);
    console.log(`    Authorized:    ${st.authorized ? "YES" : "no"}`);
    console.log(`    API Key:       ${st.hasApiKey ? "SET" : "not set"}`);
    console.log(`    Endpoint:      ${st.dbUrl || "(none)"}`);
    console.log(`    Username:      ${st.username || "(unknown)"}`);
    console.log(`    Organization:  ${st.org || "(unknown)"}`);
    console.log(`    Database:      ${st.database || "(unknown)"}`);
    console.log(`    Mode:          ${st.mode}`);
    console.log("");
    return true;
  }

  return false;
}
