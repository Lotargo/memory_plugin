# Аудит готовности к публикации npm: `@lotargo/memory_plugin@1.5.3`

Дата: 2026-08-08
Способ проверки: `npm pack --dry-run`, `npm audit`, чтение package.json / исходников, grep по импортам.
Команда проверки: FINAL pre-publish audit.

---

## 1. Итоговый вердикт

**Публикация возможна, но ОДИН блокер перед публикацией обязателен к исправлению:**
реальное требование к версии Node.js — **>= 22.5.0** (из-за `node:sqlite`), тогда как README декларирует **Node >= 18.0.0**, а `engines` в package.json отсутствует. Без правки package.json (`engines`) и README установленный из npm-тарболла пакет **молча падает** (`ERR_UNKNOWN_BUILTIN_MODULE`) на Node 18/20/21 и Node 22.0–22.4.

Всё остальное — в порядке: `npm pack --dry-run` собирает 44 файла, все runtime-файлы присутствуют, ничего лишнего (benchmarks/tests/docs/*.db/вложенные package.json) не упаковывается, все внешние импорты покрыты `dependencies`, шебанги и `bin`/`main` корректны, `preinstall` не может жёстко уронить установку, SKILL.md упаковывается. Есть 4 high- и 1 moderate-адвизории в npm audit (2 с недоступным фиксом: `xlsx` — прямая зависимость, `sharp` — транзитивная через `@huggingface/transformers`).

---

## 2. Blocker / Critical

### B1. [BLOCKER] `node:sqlite` требует Node >= 22.5.0, а заявлен Node >= 18 — runtime-падение после установки
- **Описание:** `mcp-server/db/database.js` на верхнем уровне (статический импорт, без try/catch) импортирует `DatabaseSync` из `node:sqlite`. Модуль `node:sqlite` появился только в Node 22.5.0 (экспериментальный; стабильный — с 22.13/23.4). На Node 18/20/21 и 22.0–22.4 любой импорт `db/database.js` бросает `ERR_UNKNOWN_BUILTIN_MODULE`.
- **Доказательство:**
  - `mcp-server/db/database.js:1` — `import { DatabaseSync } from "node:sqlite";`
  - `mcp-server/db/database.js:156` — `localDb = new DatabaseSync(dbPath);`
  - `opencode-plugin/index.js:658, 686, 704, 890, 1004, 1079, 1112` — инструменты плагина динамически импортируют `db/database.js` (падение при каждом вызове, связанном с БД).
- **Заявленные требования:** `README.md:14` (бейдж `node >=18.0.0`), `README.md:52` («Node.js: 18.0.0 or higher»). Поле `engines` в package.json отсутствует.
- **Влияние:** установка из npm-тарболла проходит, но плагин/MCP-сервер на Node <22.5 полностью неработоспособен при любой работе с памятью.
- **Рекомендация (минимально до публикации):**
  1. добавить в package.json: `"engines": { "node": ">=22.5.0" }`;
  2. поправить README (бейдж и пункт «Node.js: 18.0.0 or higher» → «>=22.5.0»);
  3. в идеале — graceful fallback на `better-sqlite3`/`@libsql/local`, если `node:sqlite` недоступен (обернуть импорт в try/catch динамический).

### B2. [CRITICAL] Нет поля `engines` в package.json (расходимость с README)
- **Описание:** отсутствие `engines` означает, что `npm` не предупредит пользователя о минимальной версии Node; пакет тихо падает на неподдерживаемых версиях.
- **Доказательство:** `package.json` (весь файл, 83 строки) — поля `engines` нет; README заявляет Node >=18.
- **Рекомендация:** `"engines": { "node": ">=22.5.0" }` (см. B1). Публиковать в следующем мажорном/минорном обновлении после правки.

---

## 3. Warnings

### W1. npm audit: 4 high + 1 moderate
- **Доказательство:** вывод `npm audit` от 2026-08-08:
  - `xlsx *` — **high**, Prototype Pollution (GHSA-4r6h-8v6p-xvw6) и ReDoS (GHSA-5pgg-2g8v-p4x9). **Прямая зависимость** (`package.json:80`, `"xlsx": "^0.18.5"`), фикса в npm нет (уязвимость актуальна для всех версий xlsx на npm).
  - `sharp <0.35.0` — **high**, CVE-2026-33327/33328/35590/35591, «No fix available». Транзитивная: `@huggingface/transformers@3.8.1` (lock) → `sharp`.
  - `fast-uri 3.0.0–3.1.4` — **high**, host confusion (GHSA-7p8r-x3mc-p8w7). Транзитивная: `@modelcontextprotocol/sdk` → `ajv` (package-lock.json:876–896) → `fast-uri` (package-lock.json:1234). Фикс — `npm audit fix`.
  - `hono <=4.12.33` — **moderate**, 4 адвизории (ReDoS CORS, cross-user data disclosure, Proxy Helper, DoS Language middleware). Транзитивная: `@modelcontextprotocol/sdk` (package-lock.json:882, 892). Фикс — `npm audit fix`.
- **Рекомендация:** прогнать `npm audit fix` (закроет fast-uri/hono при обновлении SDK). Для `xlsx` и `sharp`: зафиксировать в RELEASE-NOTES/README риск; рассмотреть замену `xlsx` на `exceljs` (или SheetJS CDN) и опцию отключения image-моделей, чтобы `sharp` не тянулся (`@huggingface/transformers` притягивает его для image-задач, но в RAG используется только feature-extraction).

### W2. MCP-сервер отдаёт неверную версию (1.5.2 вместо 1.5.3)
- **Доказательство:** `mcp-server/index.js:50` — `version: "1.5.2"` хардкод; package.json:3 — `"version": "1.5.3"`. Также `mcp-server/package.json:3` — `"version": "1.5.2"` (не упаковывается).
- **Влияние:** клиенты MCP увидят несоответствие версии.
- **Рекомендация:** либо читать версию из `../package.json` (`new URL`/`import.meta`), либо обновить до 1.5.3.

---

## 4. Info / опциональные улучшения

### I1. `preinstall` не может жёстко уронить установку — OK
- `package.json:8` — `"preinstall": "node mcp-server/preinstall.js || true"`.
- `mcp-server/preinstall.js` (48 строк): все внешние операции (`execSync` PowerShell/`ps`) обёрнуты в try/catch, используются только node-встроенные модули (`child_process`), ранний выход в CI (`CI`/`CONTINUOUS_INTEGRATION`/`DEBIAN_FRONTEND`/`/app`), блок убийства процессов — только при `npm_config_global=true` или `MEMORY_PREINSTALL_FORCE=true`. Скрипт упаковывается в тарболл (в whitelist `mcp-server/preinstall.js`). Fail-safe подтверждён.

### I2. Шебанги и bin — OK
- `mcp-server/index.js:1` — `#!/usr/bin/env node` ✓
- `mcp-server/cli.js:1` — `#!/usr/bin/env node` ✓
- `package.json:12-16` — bin-записи (`memory_plugin`, `memory-agent` → `mcp-server/index.js`; `memory-cli` → `mcp-server/cli.js`) указывают на файлы, которые упаковываются ✓

### I3. `main` — OK
- `package.json:6` — `"main": "opencode-plugin/index.js"`; файл есть на диске (53.8 kB) и упаковывается ✓. Плагин читает корневой `package.json` через `new URL("../package.json", import.meta.url)` (opencode-plugin/index.js:680) — он в тарболле ✓.

### I4. `type: "module"` — OK
- `package.json:5` — `"type": "module"`; все runtime-файлы используют ESM, все относительные импорты с явным `.js` (необходимо в ESM) ✓. Динамические импорты плагина (opencode-plugin/index.js:1-5, 41, 658…) тоже ESM-совместимы ✓.

### I5. Все внешние импорты покрыты `dependencies` — OK, недостающих зависимостей нет
- `@modelcontextprotocol/sdk` → mcp-server/index.js:2-3 (в deps `^1.29.0`) ✓
- `@libsql/client` → mcp-server/db/database.js:8 (deps `^0.17.4`) ✓
- `@huggingface/transformers` → mcp-server/ml/model_manager.js:68, 393 (динамический импорт; deps `^3.3.3`) ✓
- `pdf-parse` → mcp-server/ingest/normalizer.js:2 (deps `^2.4.5`) ✓
- `mammoth` → mcp-server/ingest/normalizer.js:3 (deps `^1.12.0`) ✓
- `xlsx` → mcp-server/ingest/normalizer.js:4 (deps `^0.18.5`) ✓
- `zod/v4` → mcp-server/tools/{rag_tools,memory_tools,helpers,identity_tools}.js (deps `zod ^4.1.0`; субпуть `/v4` существует в zod 4.x) ✓
- В `opencode-plugin/index.js` внешних пакетов нет — только relative и node-встроенные ✓.
- `require(...)` внешних пакетов в runtime-файлах отсутствует (grep не дал совпадений) ✓.

### I6. Node-совместимость синтаксиса (помимо B1)
- Node 20+/22+ API (`findLast`, `toSorted`, `toReversed`, `withResolvers`, `import.meta.dirname`, `Array.fromAsync`, `navigator`) в runtime-файлах не найдены (grep по mcp-server и opencode-plugin — 0 совпадений). `structuredClone`, `AbortController`, `fs.cp` доступны с Node 16/17. **Единственный узел жёсткого требования — `node:sqlite` (B1).**

### I7. Список файлов: ничего лишнего, всё нужное на месте
- Упаковываются: 44 файла — все runtime-модули mcp-server (admin, cli, config, db, graph, ingest, ml, retrieval, storage, tools + корневые .js), opencode-plugin/index.js, skills/using-memory/SKILL.md, README.md, LICENSE, package.json.
- **Не упаковываются** (корректно): `mcp-server/benchmarks/**`, `tests/`, `docs/`, `dev_docs/`, `assets/`, `scripts/`, `*.db` (`local_test.db`), вложенные `mcp-server/package.json` и `mcp-server/package-lock.json` (исключены и через `.npmignore:3-4`, и через отсутствие в whitelist `files`).
- **Whitelist-пути, отсутствующие на диске:** не выявлены — каждый каталог/файл из `package.json:17-38` имеет реальные файлы ✓.
- **Runtime .js вне whitelist:** не выявлены; единственные `.js` вне whitelist — benchmarks и вложенный package-lock (не runtime) ✓.
- `skills/using-memory/SKILL.md` упаковывается (18.8 kB), `.npmignore` его не исключает ✓. `LICENSE` (1.1 kB, MIT) упаковывается ✓.

### I8. repository — OK
- `package.json:70-73` — `https://github.com/Lotargo/memory_pugin.git`, совпадает с git-идентичностью проекта `git:github.com/lotargo/memory_pugin` (различие только в регистре) ✓. `publishConfig.access: public` для скоупа ✓.

### I9. Устаревший вложенный `mcp-server/package.json`
- `mcp-server/package.json` (не упаковывается): имя `memory-mcp-server@1.5.2`, неполный набор зависимостей (нет `@libsql/client`, `mammoth`, `pdf-parse`, `xlsx`). Источник путаницы/дрейфа версий. Рекомендация: удалить файл и `mcp-server/package-lock.json`, оставив единый корневой manifest.

### I10. Размер
- Тарболл 120.6 kB / распаковано 452.8 kB — компактно; тяжёлые зависимости (onnxruntime-node, sharp) ставятся npm при установке, в тарболл не входят ✓.

---

## 5. Выдержка из `npm pack --dry-run`

```
@lotargo/memory_plugin@1.5.3
Tarball Contents:
  LICENSE, README.md, package.json
  mcp-server/admin/{auth,snapshot}.js
  mcp-server/cli.js
  mcp-server/cli/{direct_commands,quick_stats,ui}.js
  mcp-server/cli/handlers/{cloud_actions,diagnostics_actions,engine_actions,prompt_actions,storage_actions}.js
  mcp-server/config/{auth_store,config_manager}.js
  mcp-server/db/{database,migrations,sync_queue}.js
  mcp-server/fact_format.js, identity.js, index.js
  mcp-server/graph/{graph_extractor,knowledge_linker}.js
  mcp-server/ingest/{chunker,exporter,normalizer,pipeline,sentence_segmenter}.js
  mcp-server/memory.js
  mcp-server/ml/{gpu_monitor,model_manager}.js
  mcp-server/preinstall.js, prompt_manager.js
  mcp-server/retrieval/retriever.js
  mcp-server/setup.js
  mcp-server/storage/blob_store.js
  mcp-server/tools/{helpers,identity_tools,index,memory_tools,rag_tools}.js
  opencode-plugin/index.js
  skills/using-memory/SKILL.md
Tarball Details:
  package size: 120.6 kB, unpacked: 452.8 kB, total files: 44
```

Не упаковано (проверено по тарболлу): benchmarks/*, tests/, docs/, dev_docs/, assets/, local_test.db, mcp-server/package.json, mcp-server/package-lock.json — соответствует ожиданиям.

---

## Приоритет действий перед публикацией
1. **(Blocker)** Добавить `"engines": { "node": ">=22.5.0" }` + поправить README (Node >= 22.5). Опционально — fallback для `node:sqlite`.
2. **(Warning)** `npm audit fix`; задокументировать `xlsx` (high, без фикса) и `sharp` (high, без фикса).
3. **(Warning)** Синхронизировать версию в `mcp-server/index.js:50`.
4. **(Info)** Удалить устаревший `mcp-server/package.json` (+ lock), если не нужен локальной разработке.
