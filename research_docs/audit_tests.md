# QA: Финальная пред-релизная проверка @lotargo/memory_plugin

- **Репозиторий**: `F:\projects\plugins\memory` (git), HEAD `1cc8db5`
- **Окружение**: Windows, Node `v26.1.0`, npm `11.13.0`, ESM (`type: module`)
- **Дата**: 2026-08-08
- **Роль проверки**: runtime-верификация без изменений кода/тестов (только запуск и отчёт)

---

## 1. Вердикт

**К релизу ПРОПУСКАТЬ — блокирующих ошибок нет.** Все 11 тестовых наборов прошли
(единый прогон `run_all.js` — exit 0 за 47.84 c; каждый файл также запущен отдельно — все PASS).

Выявлены **неблокирующие** проблемы, которые рекомендуется исправить **до публикации**:

| # | Проблема | Важность |
|---|----------|----------|
| 1 | **README утверждает «15 MCP tools»**, фактически: MCP-сервер = **14**, плагин opencode = **16**, таблица в README = **16 строк**. Число 15 не совпадает ни с чем. | Средняя (документация) |
| 2 | **`tests/unit/unit_audit_fixes.test.js` нарушает герметичность**: статический импорт `config_manager.js` до установки `process.env.MEMORY_DIR`, из-за чего `updateConfig/resetConfig` **реально перезаписывают** `C:\Users\etotm\.config\opencode\memory\config.json` (подтверждено mtime файла 11:32:31 = время прогона теста). Аналогичный латентный риск записи blob в реальный `storage/blobs` у `unit_audit_fixes` и `expanded_features` (customDb задан, `customBlobDir` — нет). | Средняя (качество тестов, CI/локальный прогон) |
| 3 | `--help` / `--version` не обрабатываются ни в `mcp-server/index.js`, ни в `cli.js` (exit 0, но без usage-текста; сервер просто стартует). | Низкая |
| 4 | Версия MCP-сервера захардкожена `1.5.2` в `index.js:50`, а `package.json` — `1.5.3`. Расхождение. | Низкая |

---

## 2. Матрица тестов (полный прогон)

**Единый прогон**: `node tests/run_all.js` → **EXIT 0, 47.84 c**, «ALL TEST SUITES PASSED».

| Файл | Результат | Замечания | Длительность |
|------|-----------|-----------|--------------|
| `tests/unit/fact_format.test.js` | ✅ PASS | 14 assertion-ов | 0.14 c |
| `tests/unit/identity.test.js` | ✅ PASS | git-идентичность, temp-репо | 0.87 c |
| `tests/unit/project_identity.test.js` | ✅ PASS | 5 сценариев | 1.07 c |
| `tests/unit/unit_audit_fixes.test.js` | ✅ PASS | 11 проверок; **пишет config.json в реальную конфигурацию** (см. §6) | 1.09 c |
| `tests/unit/chunker.test.js` | ✅ PASS | 13 assertion-ов | 0.15 c |
| `tests/integration/expanded_features.test.js` | ✅ PASS | 3 сценария (мультияз. символы, нормализация, xlsx/mammoth) | 1.26 c |
| `tests/integration/memory_verification.test.js` | ✅ PASS | 7 проверок (fact KV + RAG/GraphRAG/CAS) | 1.31 c |
| `tests/integration/mcp_tools.test.js` | ✅ PASS | 13 проверок через реальный MCP-stdio субпроцесс | 15.99 c |
| `tests/integration/reverse_sync.test.js` | ✅ PASS | 6 сценариев (hybrid-sync, конфликты) | 4.70 c |
| `tests/integration/rag_mcp_tools.test.js` | ✅ PASS | 14 проверок через MCP-stdio (BM25, link_knowledge, manage_kb) | 16.56 c |
| `tests/cloud/phase1_cloud.test.js` | ✅ PASS | 3 сценария; **Turso замокан локально** (без реальной сети) | 1.59 c |
| **ИТОГО** | ✅ **11/11 PASS** | `run_all.js` exit 0 | 47.84 c |

Время индивидуальных прогонов — сумма отдельно запущенных файлов; в полном прогоне
суммарно ≈ 47.84 c (накладные расходы на запуск субпроцессов MCP-сервера).

---

## 3. `node --check` (синтаксис)

Прогнано **58 файлов** по каталогам `mcp-server/`, `opencode-plugin/`, `tests/` (рекурсивно, без `node_modules`).

**Результат: ALL_OK — 0 ошибок парсинга.**

---

## 4. CLI smoke-тесты

| Команда | Exit | Время | Комментарий |
|---------|------|-------|-------------|
| `node mcp-server/index.js --help` | 0 | 0.71 c | **Usage-текст НЕ выводится**: `--help` игнорируется, сервер просто стартует и завершается по EOF stdin (`memory-agent MCP server running, data dir: C:\Users\etotm\.config\opencode\memory`) |
| `node mcp-server/cli.js --help` | 0 | 1.89 c | `--help` игнорируется; запускается интерактивное TUI-меню (рендер прошёл, выход 0) |
| `node mcp-server/index.js --version` | 0 | 0.67 c | Флаг **не поддерживается** (аналог `--help`); захардкоженная версия сервера — `1.5.2`, `package.json` — `1.5.3` |

Вывод: флаги `--help`/`--version` обрабатываются в `index.js` только частично
(есть `setup/install/--setup/-s` и `cli/config/--cli/-c/login/...`), `--help`/`--version`
в списках отсутствуют. Крахов нет, exit 0.

---

## 5. Реестр MCP-инструментов vs README

### Фактический реестр MCP-сервера (`mcp-server/tools/*.js`, подтверждено скриптом-заглушкой: `registerAllTools` + mock-server)

**14 инструментов:**

- **Memory (6)**: `remember`, `recall`, `get_fact`, `forget`, `update_fact`, `memory_info`
- **Identity (4)**: `link_knowledge`, `link_project_memory`, `unlink_project_memory`, `relink_project_memory`
- **RAG (4)**: `ingest_document`, `query_knowledge_base`, `reindex_knowledge_base`, `manage_knowledge_base`

### Плагин opencode (`opencode-plugin/index.js`, секция `tool:`)

**16 инструментов** = 14 выше + **`list-mcp-tools`**, **`mcp-reminder`**.

### README (`README.md:147`)

Заявлено: «The plugin registers **15 MCP tools**» по 4 категориям.
Фактическая таблица в README содержит **16 строк**:
категория 1 — 6, категория 2 — 3, категория 3 — 5, категория 4 — 2.

### Сравнение

| Источник | Количество | Статус |
|----------|-----------|--------|
| README (утверждение) | 15 | ❌ не совпадает ни с чем |
| README (таблица) | 16 | ✅ = плагину opencode (16) |
| MCP-сервер (`mcp-server`) | 14 | ❌ не 15 (отсутствуют `list-mcp-tools`, `mcp-reminder` — это helper-инструменты opencode-плагина) |
| Плагин opencode | 16 | ✅ = таблице README |

**Вывод**: заявка «15» — ошибка. Корректные значения: MCP-сервер = 14,
opencode-плагин = 16 (таблица README верна, число 15 — артефакт). Требуется правка
одной строки в README перед публикацией (рекомендуется «14 MCP tools + 2 агент-хелпера» или просто «16»).

---

## 6. Герметичность тестов

### Паттерн «env до импорта» (✅ корректно)

| Тест | Механизм |
|------|----------|
| `memory_verification`, `reverse_sync`, `project_identity` | `process.env.MEMORY_DIR = <tmp>` **перед** динамическим `import(...)` модулей |
| `mcp_tools`, `rag_mcp_tools` | запуск **субпроцесса** `mcp-server/index.js` с `env: { ...process.env, MEMORY_DIR: <tmp> }` — изоляция на уровне процесса |
| `phase1_cloud` | `MEMORY_DIR` + `TURSO_LOCATION` на верхнем уровне **до** динамических импортов; Turso-API замокан локальным `http.createServer` |
| `fact_format`, `chunker`, `identity` | чистые функции / `identity.js` вообще не импортирует DB/config |

### Нарушения (⚠️ флаги)

1. **`tests/unit/unit_audit_fixes.test.js` — ПИШЕТ в реальный конфиг-каталог:**
   - статические импорты (в т.ч. `config_manager.js`, `database.js`, `pipeline.js`) выполняются **до** какой-либо установки env; `process.env.MEMORY_DIR` в файле вообще не задаётся;
   - `MEMORY_DIR` фиксируется при загрузке модуля (`memory.js:25`) → `CONFIG_FILE = C:\Users\etotm\.config\opencode\memory\config.json`;
   - вызовы `updateConfig({alpha:0.85})` и `resetConfig()` (`config_manager.js:67` `writeFileSync`) **реально перезаписали** реальный `config.json` — подтверждено: `LastWriteTime = 08.08.2026 11:32:31`, совпадает с временем прогона теста;
   - `ingestDocument({customDb, generateEmbeddings:false})` без `customBlobDir` → blob пишется в `BLOBS_DIR` реального каталога (`storage/blobs`). В этом прогоне содержимое дедуплицировалось (mtime каталога 11:07 < старта тестов), новых файлов нет, но риск латентный.
2. **`tests/integration/expanded_features.test.js`** — статические импорты без env; DB герметична (`getDatabase(TEST_DB_PATH)` + `customDb`), но тот же латентный риск записи blob в реальный `storage/blobs` (`customBlobDir` не передан).

### Проверка утечек данных

Поиск тестовых фактов (`vanilla`, `matcha`, `alpha workspace`, `reindex`, `audit test`)
в реальных `global.md` и `git_github_com_lotargo_memory_pugin.md` — **утечек нет**.

Замечание: в реальном каталоге присутствуют устаревшие файлы `git_local_memory_verification_*.md`
(07.08) — следы более ранней, негерметичной версии `memory_verification.test.js`;
текущая версия герметична (env задаётся до динамических импортов).

---

## 7. Окружение / сеть / эмбеддинги

- **Все тесты с эмбеддингами используют `generateEmbeddings: false`** (подтверждено в
  `rag_mcp_tools.test.js:144,170,227,242` и `memory_verification.test.js:110,140`).
  → **Скачивание ONNX-моделей не требуется — набор тестов работает офлайн.**
- Путь эмбеддингов (модель + векторы) набором тестов **не покрывается**: в
  `unit_audit_fixes.test.js` переиндексация проверяется через фейковый `embedFn`
  (`reindexEmbeddings({embedFn: fakeEmbed, customDb})`), а не через `@huggingface/transformers`.
- Локальный кэш моделей существует: `C:\Users\etotm\.config\opencode\memory\storage\models\Xenova\`
  (`multilingual-e5-small`, `bge-m3`, `all-MiniLM-L6-v2` и др.). В прогонах не использовался.
- Cloud-тест не обращается к реальному Turso: `TURSO_API_BASE` указывает на локальный
  mock-HTTP-сервер, `dbUrl` «libsql://memory-testuser-testorg.turso.io» — ответ мока.
- Вспомогательные находки: после `mcp_tools`-тестов на Windows остаются пустые каталоги
  `%TEMP%\mcp-tools-*` (неполная очистка из-за lock SQLite); на результат не влияет.
- Синтаксис всех 58 JS-файлов валиден (`node --check` без ошибок).
- `preinstall.js` — безопасный no-op при запуске вне `npm i -g` (exit 0, без вывода).
- `setup.js` — при прямом запуске `node mcp-server/setup.js --help` ничего не делает
  (exit 0, 0.09 c): `runSetup` только экспортируется и вызывается через
  `index.js setup|install|--setup|-s`. Флаги (из кода): `--opencode`, `--claude`,
  `--codex`, `--antigravity`, `--gemini`, `--local`, `--api-key <TOKEN>`, `--mode <...>`.
  Живой конфиг при проверке **не трогался**.

---

### Рекомендации перед публикацией

1. README: исправить «15 MCP tools» → «14 MCP tools + 2 Agent-helper» или «16».
2. `unit_audit_fixes.test.js`: установить `process.env.MEMORY_DIR = <tmp>` (и/или передавать
   `customBlobDir`) до статических импортов; то же для `expanded_features.test.js`.
3. `index.js`: синхронизировать версию сервера с `package.json` (1.5.3).
4. По желанию: обрабатывать `--help`/`--version` в `index.js`/`cli.js`.
