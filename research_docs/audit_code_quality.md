# Отчёт о качестве кода и аудита pre-publish: `@lotargo/memory_plugin`

**Дата проведения аудита:** 8 августа 2026 г.  
**Целевой репозиторий:** `F:\projects\plugins\memory`  
**Аудируемые исходные файлы:** `mcp-server/**/*.js`, `opencode-plugin/index.js`, `tests/**/*.js`  

---

## 1. Вердикт (Verdict)

Кодовая база находится в относительно зрелом состоянии, архитектура проекта разбита на модули (хранилище фактов, RAG-индексация, интеграция с Turso/SQLite, плагин для OpenCode). Синтаксических ошибок при синтаксическом разборе Node.js не выявлено (`node --check` успешно прошел по всем 56 файлам).

**Ключевые риски и выводы:**
1. **Блокировки SQLite:** Отсутствие директивы `PRAGMA busy_timeout = 5000;` в `mcp-server/db/database.js` создаёт высокий риск падения транзакций с ошибкой `database is locked` при параллельных операциях (фоновая синхронизация, инжест документов и вызов MCP-инструментов).
2. **Масштабное дублирование кода:** В `opencode-plugin/index.js` продублировано более 880 строк логики выполнения MCP-инструментов (`remember`, `recall`, `get_fact`, `forget`, `update_fact`, `memory_info`, `link_knowledge`, `ingest_document`, `query_knowledge_base`, `manage_knowledge_base`, `reindex_knowledge_base`, `link_project_memory`, `unlink_project_memory`, `relink_project_memory`), а также вспомогательные функции `resolveFactIndex` и `requireProjectKey`.
3. **Утечки соединений DB:** В `getDatabase()` при изменении режима работы (`mode`) в процессе выполнения создаётся новый экземпляр `DatabaseWrapper`, при этом старое соединение SQLite/Turso не закрывается.
4. **Проверка заявлений о regex:** Заявление о наличии "сломанного регулярного выражения" в `mcp-server/tools/helpers.js` **опровергнуто**. Единственный регулярное выражение `/^\d+$/` корректно и безопасно.

---

## 2. Критические замечания (Critical)

### [CRITICAL-1] Отсутствие `PRAGMA busy_timeout` в настройках SQLite
- **Описание:** При инициализации локальной базы данных SQLite (`DatabaseSync`) устанавливаются `PRAGMA foreign_keys = ON;` и `PRAGMA journal_mode = WAL;`, однако не задается `PRAGMA busy_timeout`. По умолчанию в SQLite `busy_timeout` равен 0. В случае даже кратковременной конкуренции за запись (например, параллельный `BEGIN IMMEDIATE;` в инжесте или фоновом `sync_queue`) SQLite мгновенно выбрасывает исключение `database is locked` вместо ожидания освобождения блокировки.
- **Файл и строка:** [mcp-server/db/database.js:156-159](file:///f:/projects/plugins/memory/mcp-server/db/database.js#L156-L159)
- **Рекомендуемый фикс:**
```javascript
localDb = new DatabaseSync(dbPath);
localDb.exec("PRAGMA foreign_keys = ON;");
localDb.exec("PRAGMA journal_mode = WAL;");
localDb.exec("PRAGMA busy_timeout = 5000;");
```

### [CRITICAL-2] Утечка соединений и файлов БД при смене режима (`forceMode` / `config.mode`)
- **Описание:** В функции `getDatabase()` проверяется `if (dbInstance && dbInstance.mode === mode) return dbInstance;`. Если режим изменился (например, с `only-local` на `hybrid-sync`), функция вызывает `openDatabase(null, mode)`, которая перезаписывает глобальную переменную `dbInstance = wrappedDb` без предварительного вызова `dbInstance.close()`. Старый дескриптор `DatabaseSync` и сетевой клиент Turso остаются открытыми в памяти.
- **Файл и строка:** [mcp-server/db/database.js:203-205](file:///f:/projects/plugins/memory/mcp-server/db/database.js#L203-L205), [mcp-server/db/database.js:214-216](file:///f:/projects/plugins/memory/mcp-server/db/database.js#L214-L216)
- **Рекомендуемый фикс:** Перед переприсваиванием `dbInstance = wrappedDb` проверять наличие старого `dbInstance` и вызывать `dbInstance.close()`.

---

## 3. Замечания высокой важности (High)

### [HIGH-1] Тотальное дублирование логики MCP-инструментов в OpenCode-плагине
- **Описание:** Файл `opencode-plugin/index.js` полностью перереализует логику выполнения всех 14 инструментов (`remember`, `recall`, `get_fact`, `forget`, `update_fact`, `memory_info`, `link_knowledge`, `ingest_document`, `query_knowledge_base`, `manage_knowledge_base`, `reindex_knowledge_base`, `link_project_memory`, `unlink_project_memory`, `relink_project_memory`), а также функции `resolveFactIndex` (строки 49-58) и `requireProjectKey` (строки 121-129). Это дублирует код из `mcp-server/tools/helpers.js`, `memory_tools.js`, `identity_tools.js` и `rag_tools.js`. Любые исправления багов или доработки в `mcp-server/tools/` не попадут в плагин OpenCode.
- **Файл и строка:** [opencode-plugin/index.js:49-58](file:///f:/projects/plugins/memory/opencode-plugin/index.js#L49-L58), [opencode-plugin/index.js:121-129](file:///f:/projects/plugins/memory/opencode-plugin/index.js#L121-L129), [opencode-plugin/index.js:281-1166](file:///f:/projects/plugins/memory/opencode-plugin/index.js#L281-L1166)
- **Рекомендуемый фикс:** Вынести единые обработчики инструментов из `mcp-server/tools/` и импортировать их в `opencode-plugin/index.js`, убрав дублирование кода.

### [HIGH-2] Top-Level Await и побочные эффекты при импорте модуля плагина
- **Описание:** В `opencode-plugin/index.js` на верхнем уровне используются динамические `await import(...)` (строки 1-38) и вешается обработчик завершения процесса `process.on("exit", ...)` (строки 40-46). Поскольку плагин загружается прямо в процессе AI-агента, использование top-level await блокирует загрузку модуля, а подписка на `process.on("exit")` при импорте модуля может привести к дублированию слушателей или утечкам памяти при многократном импорте.
- **Файл и строка:** [opencode-plugin/index.js:1-46](file:///f:/projects/plugins/memory/opencode-plugin/index.js#L1-L46)
- **Рекомендуемый фикс:** Использовать стандартный статический `import` ESM на верхнем уровне, а подписку на `process.on("exit")` перенести внутрь функции инициализации `MemoryPlugin`.

---

## 4. Замечания средней важности (Medium)

### [MEDIUM-1] Неиспользуемые импорты (Unused Imports)
- **Описание:** Выявлено несколько неиспользуемых импортов, засоряющих область видимости:
  1. `mcp-server/ml/model_manager.js:14`: `import { GpuMonitor, ExecutionTracer } from "./gpu_monitor.js";` — ни `GpuMonitor`, ни `ExecutionTracer` не используются в файле.
  2. `mcp-server/cli/ui.js:6`: `import { getModelStorageInfo } from "../ml/model_manager.js";` — не используется.
  3. `mcp-server/db/sync_queue.js:2`: `basename` из `"path"`; строка 7: `storeFilePath` из `"../memory.js"` — не используются.
  4. `mcp-server/ingest/pipeline.js:3`: `embedText` из `"../ml/model_manager.js"` — не используется.
  5. `mcp-server/retrieval/retriever.js:3`: `getRelatedSymbols` из `"../graph/graph_extractor.js"` — не используется.
  6. `mcp-server/storage/blob_store.js:1`: `access` из `"node:fs/promises"` — не используется.
- **Файл и строка:** [mcp-server/ml/model_manager.js:14](file:///f:/projects/plugins/memory/mcp-server/ml/model_manager.js#L14), [mcp-server/cli/ui.js:6](file:///f:/projects/plugins/memory/mcp-server/cli/ui.js#L6), [mcp-server/db/sync_queue.js:2](file:///f:/projects/plugins/memory/mcp-server/db/sync_queue.js#L2), [mcp-server/ingest/pipeline.js:3](file:///f:/projects/plugins/memory/mcp-server/ingest/pipeline.js#L3), [mcp-server/retrieval/retriever.js:3](file:///f:/projects/plugins/memory/mcp-server/retrieval/retriever.js#L3), [mcp-server/storage/blob_store.js:1](file:///f:/projects/plugins/memory/mcp-server/storage/blob_store.js#L1)
- **Рекомендуемый фикс:** Удалить неиспользуемые импорты.

### [MEDIUM-2] Блокировка повторной инициализации при ошибке (`dbLastFailAt`)
- **Описание:** В `getDatabase()` при ошибке инициализации выставляется `dbLastFailAt = Date.now()`, после чего все последующие вызовы в течение 5 секунд (`DB_FAIL_COOLDOWN_MS`) мгновенно выбрасывают ошибку `"Database initialization failed recently..."`. Если ошибка была кратковременной, это блокирует любые попытки работы с локальной базой данных.
- **Файл и строка:** [mcp-server/db/database.js:219-221](file:///f:/projects/plugins/memory/mcp-server/db/database.js#L219-L221)
- **Рекомендуемый фикс:** Применять таймаут кулдауна только к сбоям авторизации/сети облачной Turso, не блокируя повторное открытие локальной файла SQLite.

---

## 5. Замечания низкой важности (Low)

### [LOW-1] Избыточный вызов `parseInt` перед regex в `resolveFactIndex`
- **Описание:** В `resolveFactIndex` сначала выполняется `const num = parseInt(trimmed, 10);`, и лишь затем вычисляется `/^\d+$/.test(trimmed)`. Выполнение `parseInt` на произвольной строке до регулярного выражения невредно, но порядок логичнее изменить (проверять регулярку первой).
- **Файл и строка:** [mcp-server/tools/helpers.js:33-34](file:///f:/projects/plugins/memory/mcp-server/tools/helpers.js#L33-L34), [opencode-plugin/index.js:52-53](file:///f:/projects/plugins/memory/opencode-plugin/index.js#L52-L53)
- **Рекомендуемый фикс:** Сначала проверять `/^\d+$/.test(trimmed)`, а затем выполнять `parseInt`.

### [LOW-2] Вызовы `console.error` в модулях фоновой обработки
- **Описание:** В `mcp-server/memory.js` (строки 109, 120, 170, 182, 213) и `mcp-server/ingest/pipeline.js` (строки 158, 229, 309) при ошибках облачной синхронизации используется `console.error`. Это выводится в `stderr`, что не ломает stdio MCP (JSON-RPC идет в `stdout`), однако логирование лучше централизовать через утилиту логирования.
- **Файл и строка:** [mcp-server/memory.js:109](file:///f:/projects/plugins/memory/mcp-server/memory.js#L109), [mcp-server/ingest/pipeline.js:158](file:///f:/projects/plugins/memory/mcp-server/ingest/pipeline.js#L158)
- **Рекомендуемый фикс:** Использовать единый настраиваемый логгер.

---

## 6. Результаты проверки `node --check`

В рамках аудита выполнен автоматический запуск `node --check` для всех `.js` файлов в директориях `mcp-server`, `opencode-plugin` и `tests`.

- **Всего проверено файлов:** 56
- **Ошибок синтаксиса (Parse failures):** 0
- **Статус:** **100% УСПЕШНО**

---

## 7. Вердикт по регулярному выражению в `tools/helpers.js`

- **Заявление:** Файл `tools/helpers.js` содержит сломанное регулярное выражение (broken regex).
- **Вердикт:** **ОПРОВЕРГНУТО (REFUTED)**.
- **Доказательство:** В файле [mcp-server/tools/helpers.js](file:///f:/projects/plugins/memory/mcp-server/tools/helpers.js) присутствует ровно один регуляторный литерал на строке 34:
```javascript
if (/^\d+$/.test(trimmed) && num >= 1 && num <= entries.length) return num - 1;
```
Данное регулярное выражение проверяет, состоит ли строка `trimmed` строго из одной или более десятичных цифр (ASCII `0-9`). Выражение корректно заэкранировано (`\d`), имеет якоря начала (`^`) и конца (`$`) строки, не содержит поддеревьев с катастрофическим возвратом (catastrophic backtracking) и выполняется за время $O(N)$. Сбой синтаксиса или логики отсутствует.
