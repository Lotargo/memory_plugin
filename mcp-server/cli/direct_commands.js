import { basename } from "node:path";
import {
  readMemory,
  writeMemory,
  storeFilePath,
  canonicalPath,
  listProjectStores,
  migrateStoreTitles,
  GLOBAL_KEY,
  projectKey,
} from "../memory.js";
import { factBody } from "../fact_format.js";

export async function handleDirectCommands(cliArgs) {
  if (cliArgs[0] === "uninstall" || cliArgs.includes("uninstall") || cliArgs.includes("--uninstall")) {
    const { runUninstall } = await import("../uninstall.js");
    await runUninstall();
    return true;
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
    console.log(dryRun
      ? "\nNo files were changed.\n"
      : "\nGlobal directives and managed client prompts are synchronized.\n");
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

  if (cliArgs[0] === "link") {
    const dirIdx = cliArgs.indexOf("--dir");
    const dir = dirIdx >= 0 && cliArgs[dirIdx + 1] ? cliArgs[dirIdx + 1] : process.cwd();
    const remIdx = cliArgs.indexOf("--remote");
    const remote = remIdx >= 0 && cliArgs[remIdx + 1] ? cliArgs[remIdx + 1] : null;

    try {
      const { getDatabase } = await import("../db/database.js");
      const { resolveProjectIdentity, upsertIdentity, registerAlias, normalizeRemoteUrl } = await import("../identity.js");
      const db = await getDatabase();

      const identity = await resolveProjectIdentity(dir);
      if (!identity && !remote) {
        console.error("Error: No Git repository detected and no remote URL specified.");
        process.exit(1);
      }

      let key = identity ? identity.key : `git:${normalizeRemoteUrl(remote)}`;
      let name = identity ? identity.name : basename(dir) || "unbound";
      let primaryRemote = remote ? normalizeRemoteUrl(remote) : (identity ? identity.primaryRemote : null);

      await upsertIdentity(db, { key, name, primaryRemote });

      const aliases = [];
      if (primaryRemote) {
        aliases.push({ alias: `remote:${primaryRemote}`, kind: "remote" });
      }
      aliases.push({ alias: `path:${canonicalPath(dir)}`, kind: "path" });
      aliases.push({ alias: `basename:${name}`, kind: "basename" });

      for (const a of aliases) {
        await registerAlias(db, { alias: a.alias, identityKey: key, kind: a.kind });
      }

      console.log(`\n  [OK] Linked directory "${dir}" successfully to identity key: ${key}\n`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    return true;
  }

  if (cliArgs[0] === "unlink") {
    const dirIdx = cliArgs.indexOf("--dir");
    const dir = dirIdx >= 0 && cliArgs[dirIdx + 1] ? cliArgs[dirIdx + 1] : process.cwd();
    const purge = cliArgs.includes("--purge");

    try {
      const { getDatabase } = await import("../db/database.js");
      const { unregisterAlias, removeIdentity, resolveProjectIdentity } = await import("../identity.js");
      const db = await getDatabase();

      const alias = `path:${canonicalPath(dir)}`;
      await unregisterAlias(db, alias);

      if (purge) {
        const identity = await resolveProjectIdentity(dir);
        if (identity) {
          await removeIdentity(db, identity.key);
        }
      }

      console.log(`\n  [OK] Unlinked directory "${dir}" successfully.\n`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    return true;
  }

  if (cliArgs[0] === "relink") {
    const dirIdx = cliArgs.indexOf("--dir");
    const dir = dirIdx >= 0 && cliArgs[dirIdx + 1] ? cliArgs[dirIdx + 1] : process.cwd();
    const remIdx = cliArgs.indexOf("--remote");
    const remote = remIdx >= 0 && cliArgs[remIdx + 1] ? cliArgs[remIdx + 1] : null;

    if (!remote) {
      console.error("Error: --remote parameter is required for relink.");
      process.exit(1);
    }

    try {
      const { getDatabase } = await import("../db/database.js");
      const { resolveProjectIdentity, upsertIdentity, removeIdentity, normalizeRemoteUrl } = await import("../identity.js");
      const db = await getDatabase();

      const sourceIdentity = await resolveProjectIdentity(dir);
      if (!sourceIdentity) {
        console.error("Error: Source project identity not detected.");
        process.exit(1);
      }

      const targetKey = `git:${normalizeRemoteUrl(remote)}`;
      const sourceKey = sourceIdentity.key;

      if (sourceKey === targetKey) {
        console.log("Source and target identities are already identical.");
        return true;
      }

      const sourceFacts = await readMemory(sourceKey);
      const targetFacts = await readMemory(targetKey);
      const seen = new Set(targetFacts.map((e) => factBody(e).toLowerCase().trim()));

      let mergedCount = 0;
      for (const f of sourceFacts) {
        const body = factBody(f).toLowerCase().trim();
        if (!seen.has(body)) {
          seen.add(body);
          targetFacts.push(f);
          mergedCount++;
        }
      }

      await writeMemory(targetKey, targetFacts);
      await upsertIdentity(db, { key: targetKey, name: sourceIdentity.name, primaryRemote: normalizeRemoteUrl(remote) });
      await db.prepare("UPDATE project_aliases SET identity_key = ? WHERE identity_key = ?;").run(targetKey, sourceKey);
      const { moveKnowledgeScope } = await import("../graph/knowledge_linker.js");
      await moveKnowledgeScope(db, sourceKey, targetKey);
      await removeIdentity(db, sourceKey);

      try {
        const sourceFp = storeFilePath(sourceKey);
        const { existsSync } = await import("node:fs");
        if (existsSync(sourceFp)) {
          const { unlink } = await import("fs/promises");
          await unlink(sourceFp);
        }
      } catch (e) {}

      console.log(`\n  [OK] Relinked and merged ${mergedCount} facts successfully!\n`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    return true;
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
          console.log(`  [OK] ${k}: ${res.changed} fact(s) titled`);
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
    console.log("\n  [OK] Global prompt enabled across client configurations:\n");
    results.forEach((r) => console.log(`  - ${r.name}: ${r.filePath} (${r.status})`));
    console.log("");
    return true;
  }

  if (cliArgs.includes("--disable-prompt") || cliArgs.includes("disable-prompt")) {
    const { disableGlobalPrompt } = await import("../prompt_manager.js");
    const results = await disableGlobalPrompt();
    console.log("\n  [OK] Global prompt disabled across client configurations:\n");
    results.forEach((r) => console.log(`  - ${r.name}: ${r.filePath} (${r.status})`));
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
