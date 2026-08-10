# Сводный план работ по аудиту `@lotargo/memory_plugin@1.5.3`

**Дата синтеза:** 2026-08-10
**Источники:** `audit_publish.md`, `audit_security.md`, `audit_code_quality.md`, `audit_tests.md`, `audit_docs.md`
**HEAD на момент аудита:** `1cc8db5` · Node 26.1.0 / npm 11.13.0

---

## 0. Сводный вердикт

| Область | Вердикт | Блокеры |
|---------|---------|---------|
| Публикация npm | Возможна после фикса `engines` | 1 (B1) |
| Безопасность | Блокирующих (RCE/эксфильтрация) нет | 0, но 2 High |
| Качество кода | Зрелое, `node --check` 56/56 OK | 0, но 2 Critical |
| Тесты | 11/11 PASS, exit 0, 47.84 c | 0 |
| Документация | Ядро достоверно, 4 ложных утверждения | 0 |

**Итого задач:** 41 · Блокеры 1 · Critical 3 · High 4 · Medium 12 · Low 21

---

## 1. BLOCKER — обязательно до публикации

- [x] **B1. `engines` + Node >= 22.5.0.** `node:sqlite` (`mcp-server/db/database.js:1`) появился только в Node 22.5.0; README заявляет >= 18.0.0, поля `engines` в `package.json` нет → `ERR_UNKNOWN_BUILTIN_MODULE` на Node 18/20/21/22.0–22.4.
  - [x] Добавить в `package.json`: `"engines": { "node": ">=22.5.0" }`
  - [x] `README.md:14` — обновить бейдж `node >=18.0.0` → `>=22.5.0`
  - [x] `README.md:52` — «Node.js: 18.0.0 or higher» → «22.5.0 or higher»
  - [ ] (опц.) Graceful fallback на `better-sqlite3`/`@libsql/local` через динамический импорт в try/catch

---

## 2. CRITICAL

- [x] **C1. `PRAGMA busy_timeout` отсутствует** — `mcp-server/db/database.js:156-159`. По умолчанию `busy_timeout=0` → мгновенный `database is locked` при конкуренции (фон-синк, инжест, MCP-вызовы). Добавить `localDb.exec("PRAGMA busy_timeout = 5000;");`
- [x] **C2. Утечка соединений при смене режима** — `mcp-server/db/database.js:203-205, 214-216`. `getDatabase()` при смене `mode` перезаписывает `dbInstance` без `close()`; старый `DatabaseSync` + Turso-клиент остаются открытыми. Вызывать `dbInstance.close()` перед переприсваиванием.
- [x] **C3. Отсутствие `engines`** (дубль B2 из audit_publish) — покрывается B1. `npm` не предупредит о минимальной версии Node.

---

## 3. HIGH

### Безопасность

- [x] **H1. Произвольное чтение файлов через `ingest_document type="file"`** — `mcp-server/tools/rag_tools.js:12-46`, `mcp-server/ingest/pipeline.js:33-41`. Читается **любой** путь с диска (`~/.ssh/id_rsa`, `.env`, `/etc/passwd`) → в RAG-базу → в облако при `hybrid-sync`. Усугубляется prompt injection.
  - [x] Ограничить чтение каталогом проекта/рабочей директории (или allowlist `paths` в конфиге)
  - [x] Либо: полный путь только при явном флаге `allowAnyPath: true`
  - [ ] Документировать риск в README
- [x] **H2. Ложное заявление README о «DPAPI / OS Secret Store»** — `README.md:141` vs `mcp-server/config/auth_store.js:62-104`. Фактически самописный AES-256-GCM + PBKDF2(10000, sha256), ключ выводится из fingerprint = machineId+hostname+username+platform+arch, где все компоненты **публично читаемы любым локальным процессом** (HKLM MachineGuid / world-readable `/etc/machine-id`). Grep `dpapi|keytar|safeStorage|Secret Store` = 0 совпадений.
  - [ ] Вариант A: перейти на ОС-хранилище (DPAPI/`safeStorage`, Keychain, Secret Service)
  - [x] Вариант B: честно переформулировать README → «AES-256-GCM + PBKDF2, ключ привязан к machine fingerprint»
  - [x] Поднять итерации PBKDF2 (OWASP ≥ 600k для PBKDF2-SHA256)

### Качество кода

- [ ] **H3. Дублирование 880+ строк логики MCP-инструментов** — `opencode-plugin/index.js:49-58, 121-129, 281-1166`. Плагин перереализует все 14 инструментов + `resolveFactIndex` + `requireProjectKey`, дублируя `mcp-server/tools/*`. Багфиксы в `mcp-server/tools/` не попадают в плагин. Вынести единые обработчики и импортировать.
- [ ] **H4. Top-Level Await + побочные эффекты при импорте** — `opencode-plugin/index.js:1-46`. Динамические `await import(...)` на верхнем уровне блокируют загрузку модуля; `process.on("exit", ...)` при импорте → дублирование слушателей/утечки. Перевести на статический ESM-импорт, подписку перенести в `MemoryPlugin`.

---

## 4. MEDIUM

### Безопасность

- [x] **M1. SSRF: обход loopback-блокировки через IPv6** — `mcp-server/ingest/normalizer.js:33-68`. Эмпирически подтверждено (Node 26.1.0):
  - `http://[::1]/` → hostname `"[::1]"` со скобками → `=== "::1"` не срабатывает
  - `http://[::ffff:127.0.0.1]/` → `"[::ffff:7f00:1]"` → обход
  - `http://[::ffff:169.254.169.254]/` → обход блокировки cloud-metadata
  - [x] Сравнивать hostname без скобок, использовать `node:net.isIP()` + `ipaddr.js`/`isPrivate` для IPv4/IPv6/mapped
  - [x] Пост-резолв-проверка фактического IP (`dns.lookup` + повторный `isPrivate`) — защита от DNS-rebinding
  - [x] Блокировать `fe80::/10`, `fc00::/7`, `::/8`, `::ffff:`-формы
- [x] **M2. Токены Turso через argv** — `mcp-server/setup.js:18-20,31-38`, `mcp-server/cli/direct_commands.js:228-258`. Токен виден в `ps`/Task Manager/shell history/CI-логах. Перевести на stdin (`promptText`, как уже сделано в `cloud_actions.js`) и env `TURSO_API_TOKEN`.
- [x] **M3. zod v4: `""` для опциональных чисел → «Expected number»** — `mcp-server/tools/helpers.js:7` (`optNum`). Затронуты `startLine`/`endLine` (identity_tools.js:58-59), `offset`/`limit` (memory_tools.js:160-161), `dimension`, `topK`. Заменить на `z.coerce.number().optional().nullable()`.
- [x] **M4. GPU-трассировка пишет в stdout** — `mcp-server/ml/gpu_monitor.js:138-161`, `model_manager.js:375-377`. В MCP-пути недостижимо (`embedBatch(..., false)`), но риск при будущем включении. Печатать в stderr либо явно передавать `traceOptions: false`.

### Публикация

- [ ] **M5. `npm audit`: 4 high + 1 moderate**
  - [ ] `npm audit fix` → закроет `fast-uri` (host confusion) и `hono` (4 адвизории) через обновление MCP SDK
  - [ ] `xlsx *` (high, Prototype Pollution + ReDoS, фикса нет) — задокументировать в RELEASE-NOTES; рассмотреть замену на `exceljs`
  - [ ] `sharp <0.35.0` (high, 4 CVE, «No fix available», транзитивно через `@huggingface/transformers`) — задокументировать; рассмотреть опцию отключения image-моделей
- [x] **M6. Версия MCP-сервера 1.5.2 vs package.json 1.5.3** — `mcp-server/index.js:50`. Читать версию из корневого `package.json` через `new URL(..., import.meta.url)` либо обновить хардкод.

### Тесты

- [ ] **M7. `tests/unit/unit_audit_fixes.test.js` пишет в РЕАЛЬНЫЙ конфиг** — статические импорты `config_manager.js` до установки `process.env.MEMORY_DIR`; `updateConfig`/`resetConfig` перезаписали `C:\Users\etotm\.config\opencode\memory\config.json` (подтверждено mtime 11:32:31). Задать `MEMORY_DIR = <tmp>` до импортов.
- [ ] **M8. Латентный риск записи blob в реальный `storage/blobs`** — `unit_audit_fixes.test.js` и `tests/integration/expanded_features.test.js`: `customDb` задан, `customBlobDir` — нет. Передавать `customBlobDir`.

### Документация

- [x] **M9. README:147 «15 MCP tools»** — не совпадает ни с чем: MCP-сервер = **14**, opencode-плагин = **16**, таблица README = 16 строк. Исправить на «14 MCP tools (+2 OpenCode-plugin helper tools)». Утверждение «accessible across all connected AI environments» неверно для `list-mcp-tools`/`mcp-reminder`.
- [ ] **M10. README:136 Circuit Breaker «fail over to the local database cache»** — реально `database.js:58-59,162-198` переключается на `failoverClient` из `config.failoverUrl` (второй облачный эндпоинт), а не на локальный кэш; в `only-cloud` локальная SQLite вообще не открывается. `failoverUrl` по умолчанию `""` → failover выключен.
- [ ] **M11. README:347 «GitHub Repository Mirror» для весов моделей** — реально `ml/model_manager.js:73,397` использует только `env.remoteHost = "https://huggingface.co"`. Убрать упоминание зеркала.
- [ ] **M12. README:193-212 — 7 CLI-команд не работают через `memory_plugin`** — `link`/`unlink`/`relink`/`identity`/`migrate_titles`/`enable-prompt`/`disable-prompt` реализованы только в `cli/direct_commands.js:14-313` (bin `memory-cli`). `mcp-server/index.js:10-30` их не маршрутизирует → процесс стартует как MCP-сервер и виснет на stdin. Развести `memory_plugin` / `memory-cli` в таблице либо добавить маршрутизацию.

---

## 5. LOW

### Безопасность

- [ ] **L1. `.env` открытым текстом** — `auth_store.js:123-174`. Документированный headless-фолбэк, но «секреты не хранятся в открытом виде» неверно. Пометить в README как исключение из шифрования.
- [x] **L2. Права файла секретов** — `auth_store.js:228` `writeFileSync(SECRETS_FILE, encrypted)` без `{ mode: 0o600 }` → на Linux 0644, другие локальные пользователи могут читать `auth_secrets.enc`. Добавить `mode: 0o600` + `chmod` для существующего.
- [x] **L3. Строковая проверка пути снапшотов** — `admin/snapshot.js` `validateSnapshotPath`: `startsWith(dir + sep)` без `realpath`. Symlink/junction выводят за `EXPORTS_DIR`. Добавить `fs.realpathSync`.
- [x] **L4. Распаковка без лимита размера (zip-bomb)** — `storage/blob_store.js:51` `gunzipSync` + `import_snapshot` без ограничения выходного размера. Лимитировать `unpacked.length`.
- [x] **L5. Утечка listener'а AbortController** — `db/database.js` `runWithRetry`: новый контроллер на попытку, listener не снимается. Добавить `removeEventListener`.
- [x] **L6. Смена hostname/username блокирует секреты навсегда** — `auth_store.js:66-67,199-207`. Исключить volatile-компоненты из fingerprint (оставить machineId).

### Качество кода

- [ ] **L7. Неиспользуемые импорты (6 шт.)**
  - [ ] `mcp-server/ml/model_manager.js:14` — `GpuMonitor`, `ExecutionTracer`
  - [ ] `mcp-server/cli/ui.js:6` — `getModelStorageInfo`
  - [ ] `mcp-server/db/sync_queue.js:2,7` — `basename`, `storeFilePath`
  - [ ] `mcp-server/ingest/pipeline.js:3` — `embedText`
  - [ ] `mcp-server/retrieval/retriever.js:3` — `getRelatedSymbols`
  - [ ] `mcp-server/storage/blob_store.js:1` — `access`
- [x] **L8. `dbLastFailAt` блокирует локальную БД на 5 с** — `db/database.js:219-221`. Применять cooldown только к сбоям облачной Turso, не блокируя переоткрытие локального SQLite-файла.
- [x] **L9. Порядок `parseInt` / regex в `resolveFactIndex`** — `tools/helpers.js:33-34`, `opencode-plugin/index.js:52-53`. Сначала `/^\d+$/.test()`, затем `parseInt`.
- [ ] **L10. `console.error` вместо единого логгера** — `mcp-server/memory.js:109,120,170,182,213`, `ingest/pipeline.js:158,229,309`. Централизовать через настраиваемый логгер (stdio MCP не ломается — идёт в stderr).

### CLI / инфраструктура

- [ ] **L11. `--help` / `--version` не обрабатываются** — `mcp-server/index.js`, `mcp-server/cli.js`: exit 0, но usage не выводится; `index.js` просто стартует сервер, `cli.js` открывает TUI.
- [ ] **L12. Устаревший вложенный `mcp-server/package.json`** — `memory-mcp-server@1.5.2`, неполные зависимости (нет `@libsql/client`, `mammoth`, `pdf-parse`, `xlsx`), источник дрейфа версий. Удалить вместе с `mcp-server/package-lock.json` (в тарболл не входят).
- [ ] **L13. Пустые каталоги `%TEMP%\mcp-tools-*` после тестов** — неполная очистка из-за lock SQLite на Windows.

### Документация — README

- [ ] **L14. README:346 — путь хранения памяти** — не упомянуты `OPENCODE_CONFIG_DIR` и legacy-фолбэк `~/.config/opencode/memory`, который на win32 **выигрывает** у `%LOCALAPPDATA%` (`memory.js:7-23`).
- [ ] **L15. README:231 — TUI Diagnostics** — «benchmarks» и «clear corpus cache» не существуют; реально только `test`, `graph_test`, `reset` (`cli.js:275-293`, `diagnostics_actions.js:9-107`). Правка и hint `cli.js:56`.
- [ ] **L16. README:156 — `update_fact`** — не задокументирован параметр `title` (`memory_tools.js:391`).
- [ ] **L17. README:299-311 — конфиг** — не упомянуты `vectorScanLimit` (50000), `injectLimit` (10), `conflictStrategy` ("merge"), `tursoUrl`, `failoverUrl`, `authorized`, `username` (`config_manager.js:7-26`).
- [ ] **L18. README:261,269 — GraphRAG** — «across 10 programming languages» при 9 пунктах списка / 11 языках; «C#: methods and properties» завышено — свойства без `(...)` не захватываются (`graph_extractor.js:8,18-30`).
- [ ] **L19. README:348 «Zero Telemetry»** — верно, но не оговорено, что при первом запуске модель качается с huggingface.co.

### Документация — BENCHMARKS.md

- [ ] **L20. Нерепроизводимые таблицы**
  - [ ] §5.1 Baseline (строки 79-82) — значения 0.4325/0.6183/0.6325/0.4553/0.6526/0.6642 не встречаются ни в одном сохранённом JSON
  - [ ] §5.3 bge-m3 (строки 103-108) — файл эпохи bge-m3 (`benchmark_2026-08-07T01-27-31-630Z.json`) — провальный прогон (все метрики 0, 21/21 MISSED); BM25 0.6706 заимствован из e5-прогона
  - [ ] §4 корпус (строка 61) — «27 repositories, 353 sections, 558 micro-chunks» не совпадает ни с одним JSON (07-29: 27/321/520; 07-30: 30/353/3036; финал: 32/281/1202)
  - [ ] §5.4 (строка 122) — 1203 → **1202** vectors
  - [ ] §7 (строки 153-154) — 0.8333/0.9206 из прогона 07-30 смешаны с 0.8135/0.9286 из финального 08-07
- [ ] **L21. Баг генератора отчёта: RRF подписан `k=10` при цифрах `k=60`** — `benchmarks/run_benchmarks.js:179`. Runtime RRF = k=60 (`retriever.js:101,263`, `quality_evaluator.js:300`). Баг тиражирован в `benchmark_results.md:54`, `BENCHMARKS.md:94,133`, `README.md:339`. Исправить подпись и перегенерировать отчёты.

---

## 6. Проверено и OK (регрессий не допускать)

- [x] SQL-инъекций нет — везде prepared statements, FTS санитизируется `sanitizeFtsQuery` (`retriever.js:6-12`)
- [x] Секретов в коде нет — grep по репозиторию 0 совпадений
- [x] Командной инъекции нет — `execFileAsync("git", [args], {cwd})` без shell
- [x] stdout MCP-канала чист — только `console.error` (`index.js:57`)
- [x] Path traversal через recall/forget/link не подтверждён — `slugify` экранирует
- [x] Cloud-транспорт TLS + circuit breaker + фолбэк на `only-local`
- [x] OAuth loopback `127.0.0.1:48900` + `expectedState` (CSRF)
- [x] Конфиг не хранит токены — whitelist ключей, валидация `tursoUrl`
- [x] `node --check` — 56/58 файлов, 0 ошибок парсинга
- [x] Тесты — 11/11 PASS, `run_all.js` exit 0, 47.84 c, офлайн (`generateEmbeddings: false`)
- [x] Утечек тестовых фактов в реальные `global.md` / project-store нет
- [x] `npm pack --dry-run` — 44 файла, 120.6 kB / 452.8 kB; ничего лишнего (benchmarks/tests/docs/*.db не упакованы)
- [x] Шебанги, `bin`, `main`, `type: module` — корректны
- [x] Все внешние импорты покрыты `dependencies`
- [x] `preinstall` fail-safe (`|| true` + try/catch + ранний выход в CI)
- [x] Все локальные ссылки в README резолвятся; имена 16 инструментов в SKILL.md совпадают с кодом
- [x] Regex в `tools/helpers.js:34` (`/^\d+$/`) — заявление о «broken regex» **ОПРОВЕРГНУТО**
- [x] Заголовочные цифры README (0.6706/0.8135/0.8810/0.9286) точно совпадают с эталонным JSON `2026-08-07T01-36-45`

---

## 7. Рекомендуемый порядок выполнения

- [x] **Этап 1 — разблокировать публикацию:** B1 → C3, M6, M9
- [ ] **Этап 2 — безопасность:** H1, H2, M1, M2, M3, L1–L6
- [x] **Этап 3 — стабильность рантайма:** C1, C2, L8, L5
- [ ] **Этап 4 — тесты и герметичность:** M7, M8, L13
- [ ] **Этап 5 — документация:** M10, M11, M12, L14–L19
- [ ] **Этап 6 — бенчмарки:** L21 → L20 (перегенерация отчётов)
- [ ] **Этап 7 — рефакторинг:** H3, H4, L7, L9, L10, L11, L12
- [ ] **Этап 8 — зависимости:** M5 (`npm audit fix` + документирование xlsx/sharp)
