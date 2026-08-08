# Аудит безопасности @lotargo/memory_plugin

- **Репозиторий**: `F:\projects\plugins\memory` (git), HEAD `1cc8db5`
- **Дата**: 2026-08-08
- **Метод**: статический анализ `mcp-server/**/*.js`, `opencode-plugin/index.js`, README, package.json + эмпирическая проверка (Node 26.1.0): URL-нормализация для SSRF, grep по секретам/DPAPI, реестр MCP-инструментов. Runtime-тесты не выполнялись (см. audit_tests.md).
- **Статус**: FINAL.

---

## 1. Вердикт

Блокирующих проблем безопасности (RCE, неконтролируемая эксфильтрация, несанкционированный доступ к облаку) **не выявлено**. Отмечены:

| # | Уровень | Проблема |
|---|---------|----------|
| H1 | **Высокий** | Произвольное чтение файлов через `ingest_document type="file"` без allowlist |
| H2 | **Высокий** | Ложное заявление README об «DPAPI / OS Secret Store»; фактически самописный AES-256-GCM с выводимым ключом из публичных значений системы |
| M1 | Средний | SSRF: обход блокировки loopback через IPv6 `[::1]` и IPv4-mapped `[::ffff:127.0.0.1]`; нет проверки DNS-rebinding и IPv6 link-local/ULA |
| M2 | Средний | Токены Turso передаются через argv (`setup --api-key`, `memory-cli login --api-token`) |
| M3 | Средний | zod v4 отклоняет `""` для опциональных чисел (offset/limit/startLine/endLine/dimension) — падения в реальных вызовах LLM |
| M4 | Низкий | GPU-трассировка выводит `console.log` в stdout (достижимо только из бенчмарков, в MCP-пути выключено) |
| L1–L6 | Низкие | `.env` открытым текстом, права файла секретов, строковая проверка пути снапшотов, zip-bomb при распаковке, утечка listener'а AbortController, блокировка секретов при смене hostname/username |

---

## 2. Высокие

### H1. Произвольное чтение файлов: `ingest_document type="file"` без allowlist

- **Описание:** инструмент MCP `ingest_document` (rag_tools.js:12-46) принимает `content`/`path` и при `type="file"` читает **любой** путь с диска (pipeline.js:33-41):
  - `const filePath = effectivePath || content;`
  - `if (needsRead && filePath) { ... content = await readFile(filePath, isBinary ? null : "utf-8"); effectivePath = filePath; }`
- **Без ограничений** на каталог: агент (или контекст с prompt injection) может прочитать `/etc/passwd`, `~/.ssh/id_rsa`, `~/.env`, любые исходники и положить содержимое в RAG-базу, откуда оно извлекается через `query_knowledge_base` / `read_document` и в `hybrid-sync`-режиме уходит в облако.
- **Доказательство:** rag_tools.js:22-36 (schema: `content` string, `type` enum, `path` optStr), pipeline.js:33-41 (readFile без проверки пути), pipeline.js:47 (blob сохраняется), pipeline.js:51 (docPath = эффективный путь).
- **Влияние:** полное чтение любых файлов, доступных процессу; в связке с облачной синхронизацией — канал эксфильтрации. Хоть запускает его обычно сам пользователь, уязвимость усугубляется prompt injection в RAG-агентах.
- **Рекомендация:**
  1. Для `type="file"` ограничить чтение каталогом проекта/рабочей директории (или явным `paths` в конфиге);
  2. либо переименовать семантику: `type="file"` = «только в пределах PROJECT_DIR/MEMORY_DIR», полный путь требовать флага `allowAnyPath: true`;
  3. документировать риск в README.

### H2. Ложное заявление README об «DPAPI / OS Secret Store» — самописная криптосхема с выводимым ключом

- **Заявление:** README.md:141 — «secrets are stored securely using **platform-native hardware-bound encryption (Windows DPAPI / OS Secret Store)**».
- **Реальность:** config/auth_store.js — самописная схема:
  - `deriveEncryptionKey` (auth_store.js:76-82): `crypto.pbkdf2Sync(fingerprint, salt, 10000, 32, "sha256")`;
  - `encryptData`/`decryptData` (86-104): AES-256-GCM, формат `iv_hex:authTag_hex:cipher_hex`, файл `MEMORY_DIR/auth_secrets.enc` (auth_store.js:8);
  - ключ выводится из **fingerprint = machineId + hostname + username + platform + arch** (auth_store.js:62-72), где:
    - win32: `MachineGuid` из `HKLM\SOFTWARE\Microsoft\Cryptography` — **реестр HKLM читается всеми локальными пользователями**;
    - linux: `/etc/machine-id` — **world-readable**;
    - darwin: `IOPlatformUUID` через `ioreg` (также читаемо локально).
- **Вывод:** ключ вычислим **любым локальным процессом/пользователем** машины (все компоненты fingerprint публично доступны). Это защита от *случайного копирования файла* (защита на диске), но **не** «платформенная аппаратная привязка» и не аналог DPAPI/Secret Store. Поиск `dpapi|keytar|safeStorage|Secret Store` по всему репозиторию — **0 совпадений**.
- **Побочные риски:**
  - **Блокировка секретов:** смена `hostname`/`username`/MachineGuid → ключ меняется → `auth_secrets.enc` не расшифруется навсегда (auth_store.js:199-207: «file was encrypted with a different machine key»). Данные (Turso-токен/сессия) теряются, нужен повторный login.
  - **PBKDF2 10000 итераций** — ниже современных рекомендаций (OWASP ≥ 600k для PBKDF2-SHA256); для локального сценария не критично, т.к. пароль = fingerprint, но лучше DPAPI.
  - Linux: если machine-id нет → `"no-machine-id"` → энтропия ключа падает до hostname+username.
- **Рекомендация:**
  1. на win32/macOS использовать ОС-хранилище (DPAPI через `node-keytar`/`safeStorage`, Keychain); на Linux — Secret Service;
  2. либо честно переформулировать README: «AES-256-GCM + PBKDF2, ключ привязан к machine fingerprint»;
  3. поднять итерации PBKDF2 и задать `mode: 0o600` для `auth_secrets.enc` (см. L2).

---

## 3. Средние

### M1. SSRF: обход loopback-блокировки через IPv6

- **Код:** normalizer.js:33-68 `validateUrlForSsrf`. Блок-лист — `hostname === "localhost"|"127.0.0.1"|"::1"|"169.254.169.254"|"metadata.google.internal"` + префиксы `127./10./192.168./172.16-31./169.254./0.`.
- **Эмпирическая проверка (Node 26.1.0)** — URL-нормализация ломает блокировку:
  - `http://[::1]/` → `hostname = "[::1]"` (с квадратными скобками) → сравнение `=== "::1"` **никогда не срабатывает** → **обход loopback**;
  - `http://[0:0:0:0:0:0:0:1]/` → `hostname = "[::1]"` → то же обход;
  - `http://[::ffff:127.0.0.1]/` → `hostname = "[::ffff:7f00:1]"` → **обход loopback через IPv4-mapped IPv6**;
  - `http://[::ffff:169.254.169.254]/` → не блокируется → обход блокировки **metadata-сервиса** через IPv6-mapped.
- **Чего НЕТ:** проверки IPv6 link-local `fe80::/10` и ULA `fc00::/7`; проверки **после резолва DNS** (только строковая проверка hostname → DNS-rebinding `evil.com → 127.0.0.1` не ловится).
- **Смягчается:** integer/hex/octal IP (`2130706433`, `0x7f000001`, `0177.0.0.1`) и trailing-dot (`127.0.0.1.`) URL-нормализация **сводит к `127.0.0.1`**, который блокируется. Redirect'ы перепроверяются на каждом хопе (макс. 3, таймаут 15 с каждый) — нормалиizer.js:91-105.
- **Влияние:** `ingest_document type="url"` может достучаться до `[::1]` (localhost) и, при наличии IPv6-доступа, до link-local/ULA хостов в локальной сети — внутренний сетевой скан/чтение. Доступ к cloud-metadata через `[::ffff:169.254.169.254]` вероятен в средах с IPv4-mapped IPv6.
- **Рекомендация:**
  1. сравнивать **нормализованный** hostname без скобок (`strip brackets`), использовать `node:net.isIP()` и `isPrivate`/`ipaddr.js` для всех форм (IPv4, IPv6, mapped);
  2. после резолва проверять фактический IP-адрес (`dns.lookup` + повторная проверка `isPrivate`);
  3. блокировать `fe80::/10`, `fc00::/7`, `::/8` (кроме глобальных) и `::ffff:`-формы.

### M2. Токены Turso через argv

- **Доказательство:**
  - setup.js:18-20,31-38 — `--api-key <TURSO_API_TOKEN>` из `process.argv` → `loginWithApiToken({ token: apiKeyArg })`;
  - cli/direct_commands.js:228-258 — `memory login --token|--api-token|--api-key <TOKEN>`: токен читается из `process.argv`.
- **Влияние:** токен виден в списке процессов (`ps`, Task Manager), в shell history, в логах CI. При headless-использовании в Docker/CI — утечка в артефакты сборки.
- **Рекомендация:** для интерактивного ввода использовать stdin (`promptText` — так уже сделано в cli/handlers/cloud_actions.js для `api_token`), для CI — только env (`TURSO_API_TOKEN`). Поддержать `--token` из env, а не из argv.

### M3. zod v4: `""` для опциональных чисел → «Expected number»

- **Код:** tools/helpers.js:7 — `optNum = () => z.number().optional().nullable()`.
- **Проблема:** многие LLM-обёртки инструментов передают `""` вместо пропущенного числа. В zod v4 `z.number()` **отклоняет** `""` (в отличие от `z.coerce.number()`). Затронуты поля:
  - `startLine`/`endLine` (tools/identity_tools.js:58-59, link_knowledge);
  - `offset`/`limit` (tools/memory_tools.js:160-161, recall);
  - `dimension` (reindex), `limit`/`topK` (query_knowledge_base).
- **Влияние:** случайные ошибки «Expected number, received string» в реальных вызовах агентов — отказ/фрустрация, частичная недоступность функциональности.
- **Рекомендация:** `optNum` заменить на `z.coerce.number().optional().nullable()` (или `z.union([z.number(), z.literal("")]).transform(v => v === "" ? undefined : v)`).

### M4. GPU-трассировка пишет в stdout (только из бенчмарков)

- **Код:** ml/gpu_monitor.js:138-161 `printTraceReport` → `console.log`; ml/model_manager.js:375-377 печатает отчёт при `traceOptions.verboseTrace`.
- **Достижимость в MCP-пути:** НЕТ. В mcp-server/pipeline.js:72 и :269 вызовы `embedBatch(batchTexts, false)` и `embedBatch(texts, false, ...)` идут **без** traceOptions (default `{}` → `enableTrace` falsy). `verboseTrace: true` задаётся только в benchmarks/gpu_profile_benchmark.js:24-26,133-134.
- **Влияние:** в штатном MCP-сервере stdout чист (index.js:57 использует `console.error`), протокол stdio не ломается. Остаётся риском при будущем включении трассировки в инструментах.
- **Рекомендация:** печатать трассировку только в stderr, либо передавать `traceOptions` явно `false` из всех вызовов MCP-инструментов.

---

## 4. Низкие / Info

- **L1. `.env` открытым текстом** — auth_store.js:123-174: `resolveEnvSecrets` читает `MEMORY_DIR/.env` (TURSO_DB_URL/TURSO_DB_TOKEN/TURSO_API_TOKEN) как есть. Документированный headless-фолбэк, но «секреты не хранятся в открытом виде» неверно для env-пути. Рекомендация: пометить в README, что `.env`/env — исключение из шифрования.
- **L2. Права файла секретов** — auth_store.js:228 `fs.writeFileSync(SECRETS_FILE, encrypted)` без `{ mode: 0o600 }`; на Linux файл создаётся с umask (обычно 0644) → **другие локальные пользователи могут читать** `auth_secrets.enc` (и, зная fingerprint из L2/H2, расшифровать). Рекомендация: `mode: 0o600` (и `chmod` для существующего).
- **L3. Строковая проверка пути снапшотов** — admin/snapshot.js `validateSnapshotPath`: `resolved.startsWith(dir + sep) || resolved === dir` без `realpath`. Символические ссылки/джункции (Windows) могут вывести за пределы `EXPORTS_DIR`/`MEMORY_DIR`. Рекомендация: `fs.realpathSync` перед проверкой.
- **L4. Распаковка без лимита размера** — blob_store.js:51 `gunzipSync` и импорт снапшота без ограничения выходного размера → zip-bomb на `import_snapshot`/чтении блоба. Рекомендация: проверять `gz.length`/`unpacked.length` и лимитировать.
- **L5. Утечка listener'а AbortController** — db/database.js `runWithRetry`: новый `AbortController` на каждую попытку, listener не снимается после успеха (мелкая утечка памяти в цикле retry). Рекомендация: `controller.signal.removeEventListener`.
- **L6. Смена hostname/username блокирует секреты** — следствие H2: fingerprint включает `hostname` и `username` (auth_store.js:66-67) → переименование машины/пользователя делает `auth_secrets.enc` нечитаемым навсегда. Рекомендация: исключить volatile-компоненты из fingerprint (оставить machineId).

---

## 5. Что проверено и ОК (положительные результаты)

- **SQL-инъекций нет:** все запросы — prepared statements (`?` + args); FTS-запрос санитизируется `sanitizeFtsQuery` (retriever.js:6-12, только `[A-Za-z0-9_\u0400-\u04FF\s]`); миграции — статический DDL (migrations.js, database.js:103-110). Никакой конкатенации пользовательского ввода в SQL.
- **Секретов в коде нет:** grep `(api[_-]?key|token|secret|password)\s*=\s*['"][^'"]{6,}` по репозиторию — **0 совпадений**.
- **Командная инъекция отсутствует:** git-вызовы — `execFileAsync("git", [args], {cwd})` с массивом аргументов, без shell (identity.js); `execSync` в auth_store.js использует статические команды без пользовательского ввода.
- **stdout MCP-канала чист:** index.js:57 — только `console.error` (stderr); в MCP-инструментах `console.log` отсутствует; gpu-трассировка в MCP-пути выключена (M4).
- **Пути памяти экранируются:** ключи `slugify` (memory.js) — недопустимые символы → `_`, оба вида слэшей экранируются → path traversal через recall/forget/link не подтверждён.
- **Cloud-транспорт:** `@libsql/client` с `{ url, authToken }` (database.js:194) — TLS; circuit breaker (3 попытки/10 с, failoverClient, cooldown) + фолбэк на локальную базу; при недоступности облака — `only-local`-режим (database.js:199-201).
- **OAuth-цикл:** loopback `127.0.0.1:48900` + `expectedState` (CSRF) (admin/auth.js:31-42); порт фиксированный — минимизирует риск перехвата.
- **Конфиг не хранит токены:** config_manager.js:27-36 — whitelist ключей, `tursoUrl` валидируется `libsql://|http(s)://`, токены в config.json не пишутся («never persist tokens into config.json»).
- **Экспорт/бэкап:** exporter.js — prepared statements; `manage_knowledge_base` delete/import ограничены зарегистрированными каталогами (rag_tools.js:7-10).

---

## 6. Приоритеты исправления

1. **(H1)** `ingest_document type="file"`: allowlist путей / флаг явного разрешения + README-предупреждение.
2. **(H2)** Либо ОС-хранилище (DPAPI/Keychain/Secret Service), либо честная формулировка README:141 + поднять PBKDF2, `mode:0o600` (L2), убрать hostname/username из fingerprint (L6).
3. **(M1)** SSRF: нормализация без скобок, `net.isIP`+`isPrivate` для IPv4/IPv6/mapped, пост-резолв-проверка, блокировка `fe80/10`,`fc00/7`,`::/8`, `::ffff:`.
4. **(M2)** Токены — только stdin/env, не argv.
5. **(M3)** `optNum` → coerce.
6. **(L3/L4/L5)** realpath-проверка снапшотов, лимиты распаковки, очистка listener'ов.
