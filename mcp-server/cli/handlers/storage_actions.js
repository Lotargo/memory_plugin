import { browseNotebookFacts } from "../notebook.js";
import { handleMaintenanceAction } from './maintenance_actions.js';
import { join, basename } from "node:path";
import { getDatabase } from "../../db/database.js";
import {
  GLOBAL_KEY,
  projectName,
  projectKey,
  listProjectStores,
  migrateLegacyStore,
  memoryFileName,
  canonicalPath,
  MEMORY_DIR,
} from "../../memory.js";
import { deleteDocument } from "../../ingest/pipeline.js";
import { getModelStorageInfo, deleteModelCache, listAllCachedModels } from "../../ml/model_manager.js";
import {
  EMBEDDING_PRESETS,
  RERANKER_PRESETS,
  selectSimpleMenu,
  readTextInput,
  promptText,
  waitForEnter,
  downloadModelWithProgress,
} from "../ui.js";

export async function handleStorageAction(value, config, stats) {
  switch (value) {
    case "notebook": {
      let nbRunning = true;
      while (nbRunning) {
        const projKey = await projectKey(null, null);
        const projLabel = await projectName(null, null);

        const scopeItems = [
          { label: "Global Memory", value: "global", badge: "global.md", info: "User facts stored across all projects" },
          {
            label: projKey ? `Project Memory (${projLabel})` : `Project Memory (${projLabel} - Not in git)`,
            value: "project",
            badge: projKey ? memoryFileName(projKey) : "none",
            info: projKey ? `Facts bound to ${projKey}` : "Current directory is not a Git repository",
          },
          { label: "Project Stores (All Projects)", value: "projects", info: "List & browse every project memory store; bind legacy stores" },
          { label: "< Back to Main Menu", value: "back" },
        ];
        const scopeRes = await selectSimpleMenu({
          title: "NOTEBOOK FACTS MANAGEMENT",
          subtitle: "Inspect & delete persistent user facts (Layer 1)",
          items: scopeItems,
        });

        if (scopeRes.action === "back" || scopeRes.value === "back") {
          nbRunning = false;
          break;
        }

        if (scopeRes.value === "projects") {
          let stores = await listProjectStores();
          let storeRunning = true;
          while (storeRunning) {
            if (!stores.length) {
              console.clear();
              console.log(`\n  \x1b[1m\x1b[37mPROJECT STORES: NONE FOUND\x1b[0m`);
              console.log("  [*] No project memory stores found.\n");
              await waitForEnter();
              storeRunning = false;
              break;
            }
            const storeItems = stores.map((s) => ({
              label: `${s.basename} (${s.count})`,
              badge: s.file,
              hint: s.legacy ? "LEGACY" : "BOUND",
              info: s.path ? `Bound to: ${s.path}` : `Unbound legacy store. View facts or bind to current dir: ${projKey}`,
              value: s,
            }));
            storeItems.push({ label: "< Back", value: "back" });

            const storeRes = await selectSimpleMenu({
              title: "PROJECT MEMORY STORES",
              subtitle: `Total stores: ${stores.length}`,
              items: storeItems,
            });

            if (storeRes.action === "back" || storeRes.value === "back") {
              storeRunning = false;
              break;
            }

            const store = storeRes.value;
            let actionRunning = true;
            while (actionRunning) {
              const actionItems = [
                { label: "View facts", value: "view", info: `Browse ${store.count} fact(s) in ${store.file}` },
              ];
              if (store.legacy) {
                actionItems.push({
                  label: "[MIGRATE] Bind to current directory",
                  value: "migrate",
                  info: `Rebind '${store.basename}' store from unbound legacy to ${projKey}`,
                });
              }
              actionItems.push({ label: "< Cancel / Back", value: "cancel" });

              const actRes = await selectSimpleMenu({
                title: `STORE: ${store.basename}`,
                subtitle: store.path || "Unbound legacy store",
                items: actionItems,
              });

              if (actRes.action === "back" || actRes.value === "cancel") {
                actionRunning = false;
                break;
              }
              if (actRes.value === "view") {
                await browseNotebookFacts(store.key, store.basename);
              } else if (actRes.value === "migrate") {
                const mig = await migrateLegacyStore(store.key, projKey);
                console.clear();
                if (mig.ok) {
                  console.log(`\n  [OK] Legacy store '${store.basename}' bound to ${mig.key} (${mig.facts} fact(s)) [${mig.file}]\n`);
                } else {
                  console.log(`\n  [*] Could not migrate: ${mig.reason}\n`);
                }
                await waitForEnter();
                stores = await listProjectStores();
                actionRunning = false;
                break;
              }
            }
          }
          continue;
        }

        await browseNotebookFacts(scopeRes.value === "global" ? GLOBAL_KEY : projKey, scopeRes.value === "global" ? "GLOBAL" : projLabel);
      }
      break;
    }

    case "git_identity": {
      let giRunning = true;
      while (giRunning) {
        const { resolveProjectIdentity, listIdentities } = await import("../../identity.js");
        const identity = await resolveProjectIdentity(process.cwd());

        const giItems = [
          { label: "Show current identity & aliases", value: "show" },
          { label: "Link current directory to Git project", value: "link" },
          { label: "Unlink current directory from project", value: "unlink" },
          { label: "Relink directory to another remote/identity", value: "relink" },
          { label: "< Back to Main Menu", value: "back" }
        ];

        const giRes = await selectSimpleMenu({
          title: "PROJECT IDENTITY CONTROL",
          subtitle: identity ? `Current Identity: ${identity.key}` : "No Git repository / project identity linked.",
          items: giItems,
        });

        if (giRes.action === "back" || giRes.value === "back") {
          giRunning = false;
          break;
        }

        const action = giRes.value;
        if (action === "show") {
          console.clear();
          console.log(`\n  \x1b[1m\x1b[37mCURRENT PROJECT IDENTITY\x1b[0m\n`);
          if (identity) {
            console.log(`  - \x1b[1mKey:\x1b[0m ${identity.key}`);
            console.log(`  - \x1b[1mName:\x1b[0m ${identity.name}`);
            console.log(`  - \x1b[1mPrimary Remote:\x1b[0m ${identity.primaryRemote || "none"}`);
            console.log(`  - \x1b[1mToplevel Directory:\x1b[0m ${identity.toplevel}`);

            const db = await getDatabase();
            const aliases = await db.prepare("SELECT alias, kind FROM project_aliases WHERE identity_key = ?;").all(identity.key);
            console.log(`\n  \x1b[1mActive Aliases:\x1b[0m`);
            for (const a of aliases) {
              console.log(`    - [${a.kind}] ${a.alias}`);
            }
          } else {
            console.log("  No Git repository detected in the current directory.");
          }
          console.log(`\n  \x1b[1mAll Known Project Identities in SQLite Registry:\x1b[0m`);
          const db = await getDatabase();
          const ids = await listIdentities(db);
          if (ids.length > 0) {
            for (const id of ids) {
              console.log(`    - \x1b[1m${id.key}\x1b[0m (${id.name})`);
              for (const a of id.aliases) {
                console.log(`      - [${a.kind}] ${a.alias}`);
              }
            }
          } else {
            console.log("    None registered yet.");
          }
          await waitForEnter();
        } else if (action === "link") {
          console.clear();
          console.log(`\n  \x1b[1m\x1b[37mLINK PROJECT TO IDENTITY\x1b[0m\n`);
          const remoteUrl = await promptText("Enter optional explicit remote URL (or press ENTER to auto-detect):");

          try {
            const { executeProjectOperation } = await import('../../services/project_service.js');
            const result = await executeProjectOperation('link', {directory:process.cwd(), remote:remoteUrl || undefined});
            console.log(`\n  [SUCCESS] Linked ${result.key}; backup: ${result.backup}\n`);
          } catch (err) {
            console.log(`\n  \x1b[31m[ERROR] Link failed: ${err.message}\x1b[0m`);
          }
          await waitForEnter();
        } else if (action === "unlink") {
          console.clear();
          console.log(`\n  \x1b[1m\x1b[37mUNLINK PROJECT IDENTITY\x1b[0m\n`);
          const confirm = await promptText("Are you sure you want to unlink the current path alias? (y/N):");
          if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
            try {
              const { executeProjectOperation } = await import('../../services/project_service.js');
              const result = await executeProjectOperation('unlink', {directory:process.cwd()});
              console.log(`\n  [SUCCESS] Removed path alias; memory retained. Backup: ${result.backup}\n`);
            } catch (err) {
              console.log(`\n  \x1b[31m[ERROR] Unlink failed: ${err.message}\x1b[0m`);
            }
          }
          await waitForEnter();
        } else if (action === "relink") {
          console.clear();
          console.log(`\n  \x1b[1m\x1b[37mRELINK PROJECT IDENTITY\x1b[0m\n`);
          if (!identity) {
            console.log("  No Git repository detected in the current directory.");
            await waitForEnter();
            continue;
          }
          const targetRemote = await promptText("Enter new target remote URL:");
          if (!targetRemote) {
            console.log("  Target remote URL cannot be empty.");
            await waitForEnter();
            continue;
          }
          try {
            const { executeProjectOperation } = await import('../../services/project_service.js');
            const result = await executeProjectOperation('relink', {directory:process.cwd(),remote:targetRemote});
            console.log(`\n  [SUCCESS] Moved ${result.mergedFacts} facts; backup: ${result.backup}\n`);
          } catch (err) {
            console.log(`\n  \x1b[31m[ERROR] Relink failed: ${err.message}\x1b[0m`);
          }
          await waitForEnter();
        }
      }
      break;
    }

    case "migrate_titles": {
      await handleMaintenanceAction(value);
      break;
    }

    case "rag_docs": {
      let docRunning = true;
      while (docRunning) {
        const db = await getDatabase();
        const docs = await db.prepare("SELECT id, title, path, created_at FROM documents ORDER BY created_at DESC").all();

        if (!docs || docs.length === 0) {
          console.clear();
          console.log(`\n  \x1b[1m\x1b[37mRAG DOCUMENTS: BASE EMPTY\x1b[0m`);
          console.log("\n  [*] RAG Knowledge Base is empty. No documents ingested.\n");
          await waitForEnter();
          docRunning = false;
          break;
        }

        const docItems = docs.map((doc) => {
          const rawDate = doc.created_at || doc.updated_at || "";
          let formattedDate = "";
          if (rawDate) {
            try {
              const d = typeof rawDate === "number" ? new Date(rawDate) : new Date(String(rawDate));
              formattedDate = isNaN(d.getTime()) ? String(rawDate).substring(0, 16) : d.toISOString().replace("T", " ").substring(0, 16);
            } catch (e) {
              formattedDate = String(rawDate).substring(0, 16);
            }
          }
          const docIdStr = doc.id != null ? String(doc.id) : "";
          return {
            label: doc.title || doc.path || "Untitled Document",
            badge: formattedDate,
            hint: docIdStr ? `ID: ${docIdStr.substring(0, 8)}...` : "",
            info: `Path: ${doc.path || "N/A"}`,
            value: doc,
          };
        });
        docItems.push({ label: "< Back to Main Menu", value: "back" });

        const docRes = await selectSimpleMenu({
          title: "RAG KNOWLEDGE BASE DOCUMENTS",
          subtitle: `Total ingested documents: ${docs.length}`,
          items: docItems,
        });

        if (docRes.action === "back" || docRes.value === "back") {
          docRunning = false;
          break;
        }

        const targetDoc = docRes.value;
        const actionRes = await selectSimpleMenu({
          title: "DOCUMENT ACTION",
          subtitle: targetDoc.title || targetDoc.path,
          items: [
            { label: "[INFO] View Details & Sections", value: "info", info: "Inspect micro-chunks and sections count" },
            { label: "[EXPORT JSON] Export Full Hierarchy to Pretty JSON", value: "export_json", info: "Export multiline JSON with doc metadata & all 3 hierarchy levels" },
            { label: "[DELETE] Delete Document from RAG Base", value: "delete", info: "Purge document, FTS5 index & vectors" },
            { label: "< Cancel / Back", value: "cancel" },
          ],
        });

        if (actionRes.action === "select" && actionRes.value === "info") {
          const secCountRow = await db.prepare("SELECT COUNT(*) as cnt FROM sections WHERE doc_id = ?").get(targetDoc.id);
          const secCount = secCountRow ? secCountRow.cnt : 0;
          const chunkCountRow = await db.prepare("SELECT COUNT(*) as cnt FROM micro_chunks WHERE doc_id = ?").get(targetDoc.id);
          const chunkCount = chunkCountRow ? chunkCountRow.cnt : 0;
          const sampleSections = await db.prepare("SELECT heading FROM sections WHERE doc_id = ? LIMIT 5").all(targetDoc.id);

          console.clear();
          console.log(`\n  \x1b[1m\x1b[37mDOCUMENT DETAILS\x1b[0m\n`);
          console.log(`  Title:          ${targetDoc.title || "Untitled"}`);
          console.log(`  ID:             ${targetDoc.id}`);
          console.log(`  Path:           ${targetDoc.path || "N/A"}`);
          console.log(`  Created:        ${targetDoc.created_at}`);
          console.log(`  Sections Count: ${secCount}`);
          console.log(`  Micro-Chunks:   ${chunkCount}`);
          if (sampleSections.length > 0) {
            console.log("\n  Sample Section Headings:");
            sampleSections.forEach((s, idx) => console.log(`    ${idx + 1}. ${s.heading || "Untitled Section"}`));
          }
          console.log("\n");
          await waitForEnter();
        } else if (actionRes.action === "select" && actionRes.value === "export_json") {
          const { exportDocumentToFile } = await import("../../ingest/exporter.js");
          const outFile = exportDocumentToFile(targetDoc.id, null, db);
          console.clear();
          console.log(`\n  \x1b[32m[OK] Full document JSON exported to:\x1b[0m`);
          console.log(`  \x1b[36m${outFile}\x1b[0m\n`);
          await waitForEnter();
        } else if (actionRes.action === "select" && actionRes.value === "delete") {
          await deleteDocument(targetDoc.id, db);
          console.clear();
          console.log(`\n  [OK] Document "${targetDoc.title || targetDoc.path}" deleted from RAG base.\n`);
          await waitForEnter();
        }
      }
      break;
    }
    case "reindex_embeddings": {
      const db = await getDatabase();
      const chunkCountRow = await db.prepare("SELECT COUNT(*) as cnt FROM micro_chunks").get();
      const chunkCount = chunkCountRow ? chunkCountRow.cnt : 0;
      const docCountRow = await db.prepare("SELECT COUNT(*) as cnt FROM documents").get();
      const docCount = docCountRow ? docCountRow.cnt : 0;

      if (chunkCount === 0) {
        console.clear();
        console.log("\n  [*] No micro-chunks to re-index. Ingest documents first.\n");
        await waitForEnter();
        break;
      }

      const dimLabel = config.vectorDimension > 0 ? `${config.vectorDimension}` : "AUTO";
      console.clear();
      console.log(`\n  \x1b[1m\x1b[37mRE-EMBED KNOWLEDGE BASE\x1b[0m\n`);
      console.log(`  Model:     ${config.embeddingModel}`);
      console.log(`  Dimension: ${dimLabel}`);
      console.log(`  Documents: ${docCount}`);
      console.log(`  Chunks:    ${chunkCount}`);
      console.log("\n  Re-embeds ALL stored vectors with the active model & dimension.");
      console.log("  Facts, fact-doc links, FTS index & graph edges are preserved.\n");

      const confirmRes = await selectSimpleMenu({
        title: "CONFIRM RE-INDEX",
        items: [
          {
            label: "[CONFIRM] Re-Embed All Documents",
            value: "confirm",
            info: "Loads/downloads the model if needed, then re-embeds every chunk with the active configuration",
          },
          { label: "< Cancel / Back", value: "cancel" },
        ],
      });
      if (!(confirmRes.action === "select" && confirmRes.value === "confirm")) break;

      try {
        const { reindexEmbeddings } = await import("../../ingest/pipeline.js");
        await downloadModelWithProgress(config.embeddingModel, "embedding");
        console.log(`\n  [REINDEX] Re-embedding ${chunkCount} chunks...\n`);
        const res = await reindexEmbeddings({
          progressCallback: (p) => {
            process.stdout.write(`\r  Progress: ${p.done}/${p.total} chunks`);
          },
        });
        process.stdout.write("\n");
        console.log(`\n  \x1b[32m[OK] Re-index complete!\x1b[0m`);
        console.log(`  Chunks re-embedded: ${res.reindexed}`);
        console.log(`  Documents affected: ${res.documentsAffected}`);
        console.log(`  Model: ${res.model} | Dimension: ${res.dimension || "AUTO"}\n`);
      } catch (err) {
        console.error(`  \x1b[31m[ERROR] Re-index failed: ${err.message}\x1b[0m\n`);
      }
      await waitForEnter();
      break;
    }
    case "export_snapshot": {
      const { exportSnapshot } = await import("../../admin/snapshot.js");
      const defaultPath = join(MEMORY_DIR, "exports", `rag_snapshot_${Date.now()}.json.gz`);
      const pathRes = await readTextInput("Enter Output Snapshot Path (.json or .json.gz)", defaultPath);
      if (pathRes.action === "submit" && pathRes.value) {
        console.clear();
        console.log(`\n  [EXPORT] Exporting full snapshot to: \x1b[36m${pathRes.value}\x1b[0m...\n`);
        try {
          const res = await exportSnapshot({ outputPath: pathRes.value });
          console.log(`  \x1b[32m[OK] Snapshot exported successfully!\x1b[0m`);
          console.log(`  Documents:    ${res.snapshot.documents ? res.snapshot.documents.length : 0}`);
          console.log(`  Micro-Chunks: ${res.snapshot.micro_chunks ? res.snapshot.micro_chunks.length : 0}`);
          console.log(`  Blobs:        ${res.snapshot.blobs ? res.snapshot.blobs.length : 0}`);
          console.log(`  Output:       ${res.outputPath}\n`);
        } catch (err) {
          console.error(`  \x1b[31m[ERROR] Snapshot export failed: ${err.message}\x1b[0m\n`);
        }
        await waitForEnter();
      }
      break;
    }
    case "import_snapshot": {
      const { importSnapshot, listAvailableSnapshots } = await import("../../admin/snapshot.js");
      const availableSnapshots = listAvailableSnapshots();

      let chosenPath = null;

      if (availableSnapshots.length > 0) {
        const menuItems = availableSnapshots.map((s) => ({
          label: s.name,
          badge: `${s.sizeMB} MB`,
          hint: s.dateStr,
          info: `Path: ${s.path}`,
          value: s.path,
        }));

        menuItems.push({
          label: "[MANUAL ENTRY] Enter Custom Snapshot File Path...",
          value: "manual",
          info: "Type or paste an absolute file path to a .json or .json.gz snapshot file",
        });
        menuItems.push({ label: "< Cancel / Back", value: "back" });

        const subRes = await selectSimpleMenu({
          title: "SELECT SNAPSHOT FOR IMPORT",
          subtitle: `Found ${availableSnapshots.length} snapshot files in exports directory`,
          items: menuItems,
        });

        if (subRes.action === "back" || subRes.value === "back") {
          break;
        }

        if (subRes.value === "manual") {
          const inputRes = await readTextInput("Enter Input Snapshot Path (.json or .json.gz)");
          if (inputRes.action === "submit" && inputRes.value) {
            chosenPath = inputRes.value;
          } else {
            break;
          }
        } else {
          chosenPath = subRes.value;
        }
      } else {
        const inputRes = await readTextInput("Enter Input Snapshot Path (.json or .json.gz)");
        if (inputRes.action === "submit" && inputRes.value) {
          chosenPath = inputRes.value;
        } else {
          break;
        }
      }

      if (chosenPath) {
        console.clear();
        console.log(`\n  [IMPORT] Importing snapshot from: \x1b[36m${chosenPath}\x1b[0m...\n`);
        try {
          const res = await importSnapshot({ snapshotPathOrData: chosenPath });
          console.log(`  \x1b[32m[OK] Snapshot imported successfully!\x1b[0m`);
          console.log(`  Documents:    ${res.documents}`);
          console.log(`  Sections:     ${res.sections}`);
          console.log(`  Medium-Chunks:${res.medium_chunks}`);
          console.log(`  Micro-Chunks: ${res.micro_chunks}`);
          console.log(`  Blobs:        ${res.blobs}\n`);
        } catch (err) {
          console.error(`  \x1b[31m[ERROR] Snapshot import failed: ${err.message}\x1b[0m\n`);
        }
        await waitForEnter();
      }
      break;
    }
    case "hard_reset": {
      const confirmRes = await selectSimpleMenu({
        title: "HARD RESET DATABASE & BLOB STORAGE",
        subtitle: `Permanently purge all ${stats.docCount} docs, ${stats.chunkCount} chunks & blobs`,
        items: [
          {
            label: "[CONFIRM HARD RESET] Purge All Documents, Vectors & Blobs",
            value: "confirm",
            info: "WARNING: Irreversible deletion of all SQLite documents, micro-chunks, and CAS blobs!",
          },
          { label: "< Cancel / Back", value: "cancel" },
        ],
      });

      if (confirmRes.action === "select" && confirmRes.value === "confirm") {
        const { hardResetDatabase } = await import("../../admin/snapshot.js");
        const res = hardResetDatabase();
        console.clear();
        console.log(`\n  \x1b[32m[OK] HARD RESET COMPLETED SUCCESSFULLY!\x1b[0m`);
        console.log(`  Purged Documents: ${res.purgedDocuments}`);
        console.log(`  Purged Chunks:    ${res.purgedChunks}`);
        console.log(`  Purged Blobs:     ${res.purgedBlobs}\n`);
        await waitForEnter();
      }
      break;
    }
    case "manage_models": {
      let modelMgmtRunning = true;
      while (modelMgmtRunning) {
        const allPresets = [...new Set([...EMBEDDING_PRESETS, ...RERANKER_PRESETS.filter((r) => r !== "none")])];
        const cachedOnDisk = listAllCachedModels();
        const diskModelNames = cachedOnDisk.map((m) => m.modelName);

        const combinedModels = [...new Set([...allPresets, ...diskModelNames])];

        let totalDiskBytes = 0;
        const modelItems = combinedModels.map((m) => {
          const info = getModelStorageInfo(m);
          totalDiskBytes += info.bytes;
          let badge = "NOT DOWNLOADED";
          if (info.status === "downloaded") badge = `READY (${info.sizeMB} MB)`;
          else if (info.status === "partial") badge = `INCOMPLETE (${info.sizeMB} MB)`;

          return {
            label: m,
            badge,
            value: m,
            info: info.status !== "not_downloaded"
              ? `Size: ${info.sizeMB} MB | Select to inspect or delete from disk`
              : "Model weights not present on local disk",
          };
        });

        modelItems.push({ label: "< Back to Main Menu", value: "back" });

        const totalDiskMB = (totalDiskBytes / (1024 * 1024)).toFixed(2);
        const subRes = await selectSimpleMenu({
          title: "ML MODEL CACHE MANAGEMENT",
          subtitle: `Total ML Storage Used: ${totalDiskMB} MB | Models Tracked: ${combinedModels.length}`,
          items: modelItems,
        });

        if (subRes.action === "back" || subRes.value === "back") {
          modelMgmtRunning = false;
          break;
        }

        const selectedModel = subRes.value;
        const selectedInfo = getModelStorageInfo(selectedModel);

        if (selectedInfo.status === "not_downloaded") {
          console.clear();
          console.log(`\n  [*] Model "${selectedModel}" is not downloaded on local disk.\n`);
          await waitForEnter();
          continue;
        }

        const actionRes = await selectSimpleMenu({
          title: `MODEL ACTION: ${selectedModel}`,
          subtitle: `Status: ${selectedInfo.status.toUpperCase()} | Size: ${selectedInfo.sizeMB} MB`,
          items: [
            { label: `[PURGE] Delete model weights from disk (${selectedInfo.sizeMB} MB)`, value: "delete", info: `Delete ${selectedInfo.dir} permanently` },
            { label: "< Cancel / Back", value: "cancel" },
          ],
        });

        if (actionRes.action === "select" && actionRes.value === "delete") {
          const delRes = deleteModelCache(selectedModel);
          console.clear();
          if (delRes.deleted) {
            console.log(`\n  \x1b[32m[OK] Model "${selectedModel}" deleted successfully (${delRes.freedMB} MB freed).\x1b[0m\n`);
          } else {
            console.error(`\n  \x1b[31m[ERROR] Failed to delete model: ${delRes.reason}\x1b[0m\n`);
          }
          await waitForEnter();
        }
      }
      break;
    }
  }
}
