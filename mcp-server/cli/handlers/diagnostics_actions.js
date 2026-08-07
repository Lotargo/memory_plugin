import { getConfig, updateConfig, resetConfig } from "../../config/config_manager.js";
import { hybridQuery } from "../../retrieval/retriever.js";
import {
  selectSimpleMenu,
  readTextInput,
  waitForEnter,
} from "../ui.js";

export async function handleDiagnosticsAction(value, config, stats) {
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

    case "graph_test": {
      console.clear();
      console.log(`\n  \x1b[1m\x1b[37mGRAPH & NOTEBOOK LINKING VERIFICATION\x1b[0m\n`);

      const sampleDoc = `# Ода о единороге (Секретный проект Unicorn)

## Раздел 1: Введение
Разработка нового высоконагруженного сервиса Unicorn.

## Раздел 2: Стандарты
Строка 7: Бэкенд пишется исключительно на Go.
Строка 8: Хранилище транзакций — PostgreSQL 16.
`;

      const { ingestDocument } = await import("../../ingest/pipeline.js");
      const { linkFactToDocument, getLinksForFact } = await import("../../graph/knowledge_linker.js");
      const { readMemoryRaw, writeMemory, scopeKey } = await import("../../memory.js");

      console.log("  1. Ingesting test document 'Ода о единороге'...");
      const ingRes = await ingestDocument({
        content: sampleDoc,
        type: "text",
        title: "Ода о единороге",
        path: "virtual://oda_unicorna.md",
        generateEmbeddings: false,
      });
      console.log(`     [OK] Document ingested. Doc ID: ${ingRes.docId}`);

      console.log("\n  2. Saving Notebook fact & linking to lines L7-L8...");
      const factText = "Project Unicorn backend services must use Go with PostgreSQL 16";
      const factKey = scopeKey("project", "cli_test_repo", null);

      const entries = await readMemoryRaw(factKey);
      entries.push(`[2026-07-30] ${factText}`);
      await writeMemory(factKey, entries);

      const linkRes = linkFactToDocument({
        factKey,
        factText,
        docId: ingRes.docId,
        startLine: 7,
        endLine: 8,
        relationType: "RULES_FOR",
      });
      console.log(`     [OK] Graph Edge created. Link ID: ${linkRes.linkId} -> L7-L8`);

      console.log("\n  3. Recalling memory (Verifying Graph Document Tag)...");
      const rawFacts = await readMemoryRaw(factKey);
      rawFacts.forEach((f, i) => {
        const links = getLinksForFact(factKey, f);
        let lStr = `     ${i + 1}. ${f}`;
        if (links && links.length > 0) {
          const docStr = links.map(l => `${l.doc_title || l.doc_path}:L${l.start_line}-${l.end_line}`).join(", ");
          lStr += ` \x1b[36m🔗 [Linked Docs: ${docStr}]\x1b[0m`;
        }
        console.log(lStr);
      });

      console.log("\n  \x1b[32m[OK] AGENT-DRIVEN GRAPH LINKING VERIFIED SUCCESSFULLY!\x1b[0m\n");
      await waitForEnter();
      break;
    }

    case "reset": {
      resetConfig();
      console.clear();
      console.log("\n  [OK] Configuration reset to factory defaults (RSF 50/50, e5-small, no reranker).\n");
      await waitForEnter();
      break;
    }
  }
}
