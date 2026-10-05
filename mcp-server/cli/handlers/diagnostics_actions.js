import { handleCasAction } from './cas_actions.js';
import { handleClientAction } from './client_actions.js';
import { handleUninstallAction } from './uninstall_actions.js';
import { handleMaintenanceAction } from './maintenance_actions.js';
import { hybridQuery } from "../../retrieval/retriever.js";
import {
  selectSimpleMenu,
  readTextInput,
  waitForEnter,
} from "../ui.js";

export async function handleDiagnosticsAction(value, config, stats) {
  if (['client_status','client_probe'].includes(value)) return handleClientAction(value);
  if (['client_uninstall','client_restore'].includes(value)) return handleUninstallAction(value);
  if (['graph_test','cas_cleanup','cas_restore','cas_resume'].includes(value)) return handleCasAction(value);
  switch (value) {
    case "test": {
      const queryRes = await readTextInput("Enter Test Verification Query", "sqlite compact database");
      if (queryRes.action === "submit" && queryRes.value) {
        console.clear();
        console.log(`\n  \x1b[1m\x1b[37mSEARCH QUERY EXECUTION\x1b[0m`);
        console.log(`\n  [SEARCH] Executing query: "\x1b[36m${queryRes.value}\x1b[0m"...\n`);
        try {
          const results = await hybridQuery({ query: queryRes.value, limit: 3 });
          if (!results || results.length === 0) {
            console.log("  [*] No matching results found in knowledge base.");
          } else {
            results.forEach((r, i) => {
              console.log(`\n  \x1b[1m[Hit #${i + 1}] ${r.doc_title || "Doc"} > ${r.breadcrumbs || ""}\x1b[0m`);
              console.log(`  Score: \x1b[33m${r.score}\x1b[0m (RSF: ${r.rsf_score}, RRF: ${r.rrf_score}, CosSim: ${r.cosine_sim})`);
              console.log(`  Snippet: \x1b[90m${r.snippet ? r.snippet.substring(0, 100).replace(/\n/g, " ") : ""}...\x1b[0m`);
            });
          }
        } catch (err) {
          console.error("  [ERROR] Query execution failed:", err.message);
        }
        await waitForEnter();
      }
      break;
    }

    case "reset": {
      await handleMaintenanceAction(value);
      break;
    }
  }
}
