# Аудит документации `@lotargo/memory_plugin` против кода

Дата: 2026-08-08
Метод: сверка README.md, docs/BENCHMARKS.md, skills/using-memory/SKILL.md с кодом
(mcp-server/**/*.js, opencode-plugin/index.js) и артефактами бенчмарков (dev_docs/benchmark_*.json).
Статус: FINAL.

---

## 1. Вердикт

Ядро README (архитектура, 3 слоя, git-identity, факты, RAG, конфиг) — достоверно.
Но есть 4 ложных технических утверждения, 2 неверных числа инструментов,
7 команд CLI, описанных как работающие через `memory_plugin`, но не маршрутизируемых им,
и серьёзная внутренняя несогласованность цифр в BENCHMARKS.md (нерепроизводимые таблицы
baseline и bge-m3, перепутанный параметр RRF k, перемешивание прогонов 07-30 и 08-07).

---

## 2. Фактические ошибки (заявление vs код)

### 2.1 README.md — «15 MCP tools» (строка 147)

> «The plugin registers **15 MCP tools** accessible across all connected AI environments»

- Реально MCP-сервер регистрирует **14** инструментов:
  memory_tools.js:37-441 (remember, recall, get_fact, forget, update_fact, memory_info — 6),
  identity_tools.js:8-202 (link_knowledge + link/unlink/relink_project_memory — 4),
  rag_tools.js:12-169 (ingest_document, query_knowledge_base, reindex_knowledge_base, manage_knowledge_base — 4).
  Итого `registerAllTools` (tools/index.js:5-8): 6+4+4 = **14**.
- OpenCode-плагин регистрирует **16** (opencode-plugin/index.js:257-1167) — те же 14 плюс
  `list-mcp-tools` и `mcp-reminder`.
- Таблицы самого README (строки 151-183) перечисляют **16** инструментов.
- `list-mcp-tools`/`mcp-reminder` — это helper-инструменты ТОЛЬКО OpenCode-плагина (MCP_SERVERS,
  opencode-plugin/index.js:203-214 — статический список; в MCP stdio они не экспортируются),
  поэтому «accessible across all connected AI environments» неверно и по счёту, и по категории.
- Правка: «14 MCP tools (+2 OpenCode-plugin helper tools)».

### 2.2 README.md — «Windows DPAPI / OS Secret Store» (строка 141)

> «Cloud authentication tokens and secrets are stored securely using platform-native
> hardware-bound encryption (Windows DPAPI / OS Secret Store)»

- Реально config/auth_store.js:29-83,85-119 — AES-256-GCM (iv:authTag:cipher) с ключом,
  выводимым через PBKDF2 (sha256, 10000 итераций) из machine fingerprint
  (win32: `reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid`,
  linux: /etc/machine-id, darwin: IOPlatformUUID; auth_store.js:33-54).
- Ни dpapi, ни keytar, ни safeStorage, ни OS Secret Store в репозитории нет (grep по всему коду — 0 совпадений).
- Правка: «AES-256-GCM + PBKDF2, ключ привязан к machine fingerprint (MachineGuid / machine-id)».

### 2.3 README.md — Circuit Breaker «fail over to the local database cache» (строка 136)

> «If the primary cloud database endpoint is unreachable ... queries seamlessly fail over
> to the local database cache.»

- Реально database.js:58-59,162-198 — после 3 неудач (consecutiveFailures >= 3) переключение идёт
  на `failoverClient`, созданный из `config.failoverUrl` (второй облачный Turso/Fly.io эндпоинт),
  а НЕ на локальный кэш. Локальная SQLite в only-cloud даже не открывается (localDb = null).
- `failoverUrl` по умолчанию `""` (config_manager.js:23) → failover выключен по умолчанию.
- Правка: «переключается на failover-эндпоинт (failoverUrl, Fly.io+LiteFS); выключен по умолчанию».

### 2.4 README.md — «Dual-Source Failover Model Fetching ... GitHub Repository Mirror» (строка 347)

> «Primary model weights are fetched from HuggingFace CDN with automatic failover to GitHub Repository Mirror.»

- Реально ml/model_manager.js:73 и 397 — только `env.remoteHost = "https://huggingface.co"`.
  Никакого GitHub-mirror в ml/ нет. Единственные github-ссылки в mcp-server — URL бенчмарк-корпуса
  (benchmarks/fetch_real_corpus.js:21-63, raw.githubusercontent.com).
- Правка: «веса моделей скачиваются с huggingface.co».

### 2.5 README.md — CLI: 7 команд не работают через `memory_plugin` (строки 193-212)

- README: `memory_plugin <command> [options]` для link / unlink / relink / identity /
  migrate_titles / enable-prompt / disable-prompt.
- Реально mcp-server/index.js:10-30 маршрутизирует только setup/install/--setup/-s и
  cli/config/--cli/-c/login/logout/auth-status/auth_status/auth. Аргумент `link` ни под одно
  условие не попадает → процесс стартует как MCP-сервер и «зависает» на stdin.
- Все 7 команд реализованы только в mcp-server/cli/direct_commands.js:14-313 и запускаются
  через bin `memory-cli` → cli.js:14-16 (handleDirectCommands). `memory_plugin login|logout|auth-status`
  работают (попадают в маршрут runCli → handleDirectCommands).
- Правка: в таблице CLI разделить `memory_plugin` и `memory-cli`, либо добавить маршрутизацию в index.js.

### 2.6 README.md — TUI Diagnostics: бенчмарки и «clear corpus cache» не существуют (строка 231)

> «Run in-process search quality benchmarks, execute verification queries, clear corpus cache,
> and reset config to factory defaults.»

- Реально cli.js:275-293 и cli/handlers/diagnostics_actions.js:9-107 — в меню Diagnostics только
  `[SEARCH] test`, `[GRAPH] graph_test`, `[RESET] reset`. Ни in-process бенчмарков, ни очистки
  корпус-кэша в TUI нет (бенчмарки — только `npm run benchmark`).
- Даже hint самой категории (cli.js:56) «Benchmarks, search verification, cache, and config reset» завышает.
- Правка: «execute verification queries and reset config to factory defaults».

### 2.7 README.md — путь хранения памяти (строка 346)

> «the memory directory (`$MEMORY_DIR` or `%LOCALAPPDATA%\opencode\memory`)»

- Реально память.js resolveMemoryDir (memory.js:7-23): $MEMORY_DIR → OPENCODE_CONFIG_DIR/memory →
  legacy `~/.config/opencode/memory` (если существует — на win32 он ВЫИГРЫВАЕТ) →
  win32 `%LOCALAPPDATA%\opencode\memory` (только когда legacy-папки нет) → XDG.
- `%LOCALAPPDATA%`-ветка активна не всегда, а `OPENCODE_CONFIG_DIR` и legacy-фолбэк не упомянуты.

---

## 3. BENCHMARKS.md — внутренняя несогласованность и нерепроизводимость

Эталонный прогон: dev_docs/benchmark_2026-08-07T01-36-45-352Z.json
(e5-small, 32 docs / 281 sections / 1202 microChunks, n=21;
bm25 0.6706/0.7619/0.6934; vector 0.8135/1/0.8612; rrf 0.881/0.9524/0.8997; rsf 0.9286/1/0.9473).

### 3.1 Таблица Baseline §5.1 (строки 79-82) — не подтверждается ни одним JSON

> BM25 0.4325 / 52.38% / 0.4553; Dense 0.6048/71.43%/0.6309; RRF 0.6183/76.19%/0.6526; RSF 0.6325/76.19%/0.6642

- Прогоны 07-29 (27 docs/321 sections/520 chunks): bm25 0.4802/0.5714/0.5029; vector 0.6048/0.7143/0.6309;
  rrf 0.6206/0.7619/0.6547; rsf 0.6087/0.7619/0.6466. Значения 0.4325, 0.6183, 0.6325, 0.4553, 0.6526, 0.6642
  не встречаются ни в одном сохранённом JSON. Таблица нерепроизводима из артефактов.

### 3.2 Таблица bge-m3 §5.3 (строки 103-108) — не подтверждается ни одним JSON

> «30 real technical documents»; Dense 0.4476/57.10%/0.4779; RRF 0.7183/81.00%/0.7410; RSF 0.7540/81.00%/0.7681

- Файл эпохи bge-m3 dev_docs/benchmark_2026-08-07T01-27-31-630Z.json — **провальный прогон**:
  все метрики 0, все 21 запрос MISSED, `winner: "bm25"`, docTokens 0 (похоже на падение при загрузке модели).
- Прогоны 07-30 (30 docs/353 sections) дают vec 0.3667–0.5571, rrf 0.4817–0.581, rsf 0.4817–0.5873 — ни одно
  не совпадает с §5.3. При этом BM25 0.6706 в §5.3 заимствован из финального e5-прогона (32 docs).
  Таблица смешана/нерепроизводима.

### 3.3 RRF: метка «k=10» при реальных цифрах k=60 (строки 94, 133; README строка 339)

- rrfGrid (01:36 JSON): k=10 → 0.8905/1/0.9181; k=60 → 0.881/0.9524/0.8997. Отчётные 0.8810 — это результат
  **k=60**, а не k=10.
- Runtime RRF: k=60 (retriever.js:101 default, retriever.js:263 hardcode; quality_evaluator.js:300 defaultRrfK=60).
- Первопричина — баг генератора отчёта run_benchmarks.js:179: строка RRF подписывается `k=${bestRrfK.k}` (=10),
  хотя цифры взяты с runtime-k (60). Баг тиражируется в benchmark_results.md:54, BENCHMARKS.md и README.

### 3.4 Корпус §4 (строка 61): «27 repositories, 353 sections, 558 micro-chunks»

- Ни один сохранённый прогон не совпадает: 07-29 → 27/321/520; 07-30 → 30/353/3036 (и 1503);
  финальный → 32/281/1202. «353 sections и 558 micro-chunks» не существует ни в одном JSON.

### 3.5 §5.4 (строка 122): «Total Micro-Chunks Vectorized: 1,203 vectors»

- Оба 08-07 JSON: corpus.microChunks = 1202; benchmark_results.md:28-29 тоже 1202. Ошибка на единицу.

### 3.6 Выводы §7 (строки 153-154): «0.6048 → 0.8333» и «0.9206 MRR@5»

- 0.8333 и 0.9206 — из прогона 2026-07-30T03-10-36 (vec 0.8333, rsf 0.9206), а таблицы §5.2/§5.4 и README
  показывают 0.8135 / 0.9286 (финальный прогон 08-07). Документ молча смешивает два разных прогона.

---

## 4. Мелкие расхождения / устаревшее

1. **update_fact**: README-таблица (строка 156) указывает `id, newText, scope`, но в zod-схеме есть
   ещё `title` (memory_tools.js:391) — параметр не задокументирован.
2. **Версия MCP-сервера**: mcp-server/index.js:50 — `version: "1.5.2"`, package.json — 1.5.3
   (memory_info читает package.json, поэтому сам tool корректен; устарела строка в index.js).
3. **Конфиг**: README-таблица (строки 299-311) не упоминает ключи `vectorScanLimit` (50000),
   `injectLimit` (10), `conflictStrategy` ("merge"), `tursoUrl`, `failoverUrl`, `authorized`, `username`
   (config_manager.js:7-26).
4. **GraphRAG**: README (строка 261) — «across 10 programming languages», но маркированный список
   содержит 9 пунктов; при раздельном счёте языков — 11 (JS, TS, Python, Go, Rust, C++, Java, Kotlin,
   C#, PHP, Ruby). Строка 269 «C#: ... methods and properties» завышена: свойства (`public string X { get; set; }`,
   без `(...)`) паттернами graph_extractor.js:18-30 не захватываются (регэксп методов требует скобок;
   `get`/`set` — в ignoredKeywords, graph_extractor.js:8).
5. **«Zero Telemetry»** (README:348): фактически верно — телеметрии нет, но при первом запуске модель
   скачивается с huggingface.co (сеть), что не оговорено.

---

## 5. Битые ссылки

- Все локальные ссылки резолвятся: assets/hero.jpg ✓, assets/title.svg ✓, LICENSE ✓,
  docs/BENCHMARKS.md ✓, skills/using-memory/SKILL.md ✓.
- Ссылок на удалённый docs/AUDIT_FIX_PLAN.md в README/BENCHMARKS нет ✓.
- SKILL.md: имена всех 16 инструментов совпадают с кодом (опечаток нет) ✓.

---

## 6. Вердикт по бенчмаркам

- Заголовочные цифры README (0.6706 / 0.8135 / 0.8810 / 0.9286) и §5.2/§5.4 BENCHMARKS.md **точно совпадают**
  с эталонным JSON 2026-08-07T01-36-45 (включая bootstrap CI, categoryBreakdown и paired t-тесты).
  Это реальный, воспроизводимый результат e5-small.
- Проблемы — вокруг него: baseline §5.1 и bge-m3 §5.3 ничем не подтверждены; RRF подписан не тем k;
  выводы смешивают прогоны; корпус §4 устарел; 1203 vs 1202.

---

## 7. Рекомендации

1. run_benchmarks.js:179 — подписывать RRF тем k, которое реально использовалось (60), либо выводить
   лучший результат сетки отдельно; перегенерировать benchmark_results.md и BENCHMARKS.md.
2. mcp-server/index.js:50 — версия 1.5.3.
3. README:141 — заменить «DPAPI / OS Secret Store» на AES-256-GCM + PBKDF2/machine fingerprint.
4. README:147 — «14 MCP tools (+2 OpenCode helper)», привести таблицы в соответствие.
5. README:136 — failover на failoverUrl (не «local cache»), off по умолчанию; README:347 — убрать
   «GitHub Repository Mirror».
6. README:200-212 — развести `memory_plugin` и `memory-cli` (7 команд только через memory-cli),
   либо добавить маршрутизацию в mcp-server/index.js:10-30.
7. README:231 — убрать «benchmarks» и «clear corpus cache» из TUI Diagnostics.
8. BENCHMARKS §4/§5.1/§5.3 — привести к сохранившимся артефактам либо архивировать недостающие
   прогоны; §5.4 — 1203 → 1202; §7 — унифицировать 0.8333/0.9206 с финальным прогоном (0.8135/0.9286).
9. README:346 — упомянуть OPENCODE_CONFIG_DIR и legacy-фолбэк в приоритете пути.
