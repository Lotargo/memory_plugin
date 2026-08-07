import { ingestDocument } from "./ingest/pipeline.js";
import { exportDocumentToFile } from "./ingest/exporter.js";
import { getDatabase } from "./db/database.js";
import { runMigrations } from "./db/migrations.js";

async function run() {
  const db = await getDatabase();
  await runMigrations(db);

  const sampleDoc = `# Руководство по архитектуре RAG и HTTP клиенту

## 1. Общее описание проекта
Наш модуль persistent memory эволюционирует в Zero-Docker Hybrid RAG engine.
В т. ч. поддерживаются русский и английский языки без зависимости от Python.

## 2. Спецификация API и таблица параметров
Таблица ниже содержит ключевые параметры системы:

| Параметр | Тип | Описание |
| --- | --- | --- |
| fusionAlgorithm | string | Алгоритм объединения скоров (rsf или rrf) |
| alpha | number | Вес семантического поиска против BM25 |
| embeddingModel | string | ONNX модель E5-Small |

## 3. Пример кода конфигурации
Ниже приведен пример функции инициализации:

\`\`\`javascript
export function initEngine(options = {}) {
  const db = getDatabase();
  console.log("RAG Engine Initialized with options:", options);
  return { status: "ready", db };
}
\`\`\`
`;

  console.log("Ingesting sample document into SQLite RAG storage...");
  const ingRes = await ingestDocument({
    content: sampleDoc,
    type: "text",
    title: "Руководство по архитектуре RAG и HTTP клиенту",
    path: "virtual://docs/rag_architecture_guide.md",
    generateEmbeddings: false,
  });

  const exportPath = exportDocumentToFile(ingRes.docId, null, db);

  console.log(`\n✅ Document ingested successfully! Doc ID: ${ingRes.docId}`);
  console.log(`✅ Pretty-printed multiline JSON exported to: ${exportPath}\n`);
}

run().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
