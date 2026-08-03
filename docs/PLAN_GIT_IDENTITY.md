# План: Схема фактов + инъекция по заголовкам и Git-based Project Identity

Дата: 2026-08-03. Статус: **DRAFT v2** (переработан после уточнений; утверждённые решения отмечены, реализация не начата).

## Проблема

1. **Инъекция всего подряд**: сейчас в `<MEMORY>` инжектятся ВСЕ глобальные воспоминания (полным текстом), и то же планировалось для проектной памяти. Пока фактов мало — ок, но при сотнях записей это переполняет контекстное окно и тратит токены на архив/заметки, которые агенту в данный момент не нужны.
2. **Привязка к пути**: проектная память привязана к каноническому абсолютному пути (`canonicalPath`): `f:/projects/plugins/memory` на Windows и `/home/u/dev/memory_plugin` на Linux — это **разные сторы** для одного проекта. Путь не переносим между машинами/ОС, меняется при переименовании/переезде каталога, а ключ зависит от того, какая подпапка репозитория была открыта (`repo/` vs `repo/src/` — разные ключи).

## Решения (утверждены пользователем)

### Часть A — общие принципы (и global, и project)
- [x] **Полная переработка схемы фактов**: каждый факт имеет **заголовок** (title) + **содержимое** (content). `remember` получает обязательный `title`.
- [x] **Инъекция по заголовкам**: в `<MEMORY>` инжектятся только заголовки, НЕ тексты фактов. Полный текст агент получает через инструменты.
- [x] **Лимит инъекции**: по умолчанию инжектятся только первые N заголовков (N=10, настраиваемо). При 100 фактах в сторе инжектится «10 из 100 воспоминаний» — агент видит счётчик и понимает, что есть ещё.
- [x] **Выборка через инструмент**: агент может запросить внутри инструмента заголовки ИЛИ полные записи (заголовок + содержимое), а также любой диапазон (например, с 11 по 40), а не только первые 10.
- [x] Схема применяется **и к глобальной, и к проектной памяти** единообразно.
- [x] Глобальная память перестаёт инжектиться целиком — те же правила лимита/заголовков.

### Часть B — проектная память (git identity)
- [x] **Git-first всегда**: источник истины проекта — git-репозиторий, а не директория.
- [x] **Без path-привязки**: если в директории нет git — проектной памяти нет (работает только global). `remember(scope:project)` вне git возвращает агенту понятную ошибку.
- [x] **Реестр identity — в SQLite** (`project_identities` + `project_aliases`), не JSON: плагин мультиюзерный и облачный, приватные пути разработчика не должны утекать в общий конфиг и мешать другим пользователям. Алиасы синхронизируются через облачную таблицу `notebooks` пользователя.
- [x] **Инструменты линковки** для ИИ-агента: `link_project_memory` / `unlink_project_memory` / `relink_project_memory` — агент вызывает их автоматически и по просьбе пользователя (случай «сначала открыли без git, потом завели репу», миграция старых путевых сторов, перепривязка на другую репу).

---

# ЧАСТЬ A — Общая работа (global + project), выполняется первой

## A1. Схема факта: заголовок + содержимое (`mcp-server/fact_format.js`, `remember`)

Формат строки факта (обратно совместим с текущим single-line):

```
- [2026-08-02 06:08] **Заголовок** — текст факта. <!-- id:8f3a2c, ttl:90d, keep:1, inject:1, tags:pref,arch -->
```

- [ ] `fact_format.js`: новые функции `factTitle(line)` (текст до ` — ` / первой дефиниции, либо до первого `.`), `factBody(line)`; парсинг и форматирование. Старые строки без `**Заголовок**` читаются как legacy (title = первые слова body).
- [ ] `remember`: обязательный параметр `title` (и для global, и для project); сохраняется как `**Title**`-префикс строки.
- [ ] `update_fact`: поддержка изменения `title`.
- [ ] `forget`/`update_fact`/`recall`/KB-линковка — работают с новым форматом без поломок (id/метаданные не меняются).

## A2. Инъекция: заголовки + лимит + счётчик (`opencode-plugin/index.js`)

- [ ] `## Global` и `## Project` инжектят **только заголовки** фактов, по умолчанию первые N (конфиг `injectLimit`, default 10), newest-first.
- [ ] Счётчик: строка «…и ещё 90 из 100 воспоминаний» (или `10 of 100 memories`) под списком заголовков. Если фактов ≤ N — счётчик не выводится.
- [ ] Порядок в `<MEMORY>`: `## Global` (заголовки) → `## Project: <git-key/name>` (заголовки) → (далее знания/KB).
- [ ] Дубликация текста факта между global и project недопустима.
- [ ] При `projectKey === null` (нет git) — только `## Global`.
- [ ] Авто-обновление: при смене `directory` внутри сессии (переход между репозиториями) — пересчёт identity и пере-инъекция; старый проект не должен «протекать» в новый контекст.
- [ ] Флаг `inject:1` (опциональный приоритет): факты с `inject:1` инжектятся ПОЛНЫМИ (заголовок+содержимое) и в приоритете (занимают слоты лимита первыми, остальные слоты — новейшие заголовки). Это механизм «всегда держи в контексте» поверх дефолтной схемы «первые N заголовков». Для global и project одинаково.

## A3. Инструмент выборки (расширение `recall` + `get_fact`)

- [ ] `recall`: новые параметры `mode: "headers"|"full"` (default `headers`), `offset` (default 0), `limit` (default 10). «Headers» — только заголовки + id + бейджи; «full» — заголовок + содержимое. Так агент запрашивает «11-40» через `offset:10, limit:30, mode:headers|full`.
- [ ] Новый инструмент `get_fact({ id })` — полная запись (заголовок+содержимое+метаданные) одного факта по id; быстрый способ развернуть конкретную запись из инъекции.
- [ ] `recall` по-прежнему ищет по `query`/`tags`/`since`/`until` (поиск идёт по заголовку И содержимому).
- [ ] Метаданные-бейджи в выводе: `[inject]` / `[archive]`, `[keep]`, дата, tags.

## A4. Миграция существующих фактов

- [ ] При чтении: legacy-строки без `**Title**` получают title = первая фраза содержимого (до первой точки/дефиса), не трогая текст.
- [ ] Опциональный `migrate_titles` (CLI/инструмент): массово проставить заголовки в старые сторы.
- [ ] Порядок сортировки: newest-first по дате факта (уже есть в формате).

## A5. Тесты Части A

- [ ] `test_inject_model.js` (unit): `factTitle`/`factBody` для нового и legacy-формата; `remember` с/без title; `inject:1` в метаданных; сборка секции инъекции (заголовки, лимит, счётчик «N of M», приоритет inject:1); `recall` mode/offset/limit; `get_fact`.
- [ ] Plugin-level (tmp OPENCODE_CONFIG_DIR): инъекция global показывает только заголовки первых N + счётчик при >N фактах; проект с git-identity — отдельная секция заголовков; без git — только global.

---

# ЧАСТЬ B — Проектная память: Git-based identity (после Части A)

## Идентичность: ключи

| Ситуация | Ключ | Переносим |
|---|---|---|
| Есть remote | `git:<нормализованный remote url>` (host+path в lowercase, без схемы/`.git`/креды/`git@`) | да, одинаковый на всех машинах |
| Git без remote | `git:local:<basename-toplevel>` | ограниченно (по имени репо) |
| Нет git | проектной памяти нет (`null`) | — |

Разрешение: `git rev-parse --show-toplevel` от `directory` (фолбэк `worktree`) → все remotes (`git config --get-regexp 'remote\..*\.url'`) → нормализация → кандидаты-алиасы (`remote`, `basename`, `canonicalPath`) → lookup → канонический ключ. Открытие любой подпапки репозитория даёт один стор → проектные воспоминания автоподгружаются.

## B1. SQLite-схема (миграция)

```sql
CREATE TABLE IF NOT EXISTS project_identities (
  key           TEXT PRIMARY KEY,          -- 'git:github.com/lotargo/memory_plugin'
  name          TEXT NOT NULL,             -- display name (basename репо)
  primary_remote TEXT,                     -- нормализованный главный remote
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_aliases (
  alias        TEXT PRIMARY KEY,           -- 'path:f:/projects/...' | remote | basename
  identity_key TEXT NOT NULL REFERENCES project_identities(key) ON DELETE CASCADE,
  kind         TEXT NOT NULL,              -- 'remote' | 'path' | 'basename'
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_aliases_identity ON project_aliases(identity_key);
```

Реестр живёт в локальном SQLite (все режимы, кроме only-cloud — там remote-зеркало через `notebooks`). Алиасы вида `path:` не являются «хранилищем памяти», это только индекс для обнаружения identity.

## B2. Компоненты

### B2.1 `mcp-server/identity.js` (новый модуль, ядро)
- [ ] `detectGitToplevel(dir)` — `execFile('git', ['rev-parse','--show-toplevel'])`, фолбэк: walk-up по `.git` (файл/каталог) без вызова бинаря.
- [ ] `getRemoteUrls(toplevel)` — `git config --get-regexp`, фолбэк: парсинг `.git/config`.
- [ ] `normalizeRemoteUrl(url)` — снять `scheme`, `git@`, креды, `.git`, trailing `/`; host+path → lowercase. Unit-тестируемая чистая функция.
- [ ] `resolveProjectIdentity(dir)` — async, кэш по canonical path (инвалидация при `git remote`/`git init` — флаг `bustIdentityCache()`); возвращает `{ key, name, primaryRemote } | null`.
- [ ] Registry API (поверх `db/database.js`): `upsertIdentity`, `registerAlias`, `unregisterAlias`, `lookupByCandidates`, `listIdentities`, `removeIdentity`.

### B2.2 Миграция БД (`mcp-server/db/migrations.js`)
- [ ] Новая миграция `project_identities` + `project_aliases` (схема выше, `IF NOT EXISTS`).

### B2.3 `mcp-server/memory.js`
- [ ] `projectKey(worktree, directory)` → читает кэш identity; вне git возвращает `null`.
- [ ] `scopeKey(scope, dir)` → `global` → `GLOBAL_KEY`; `project` → git-key или `null`.
- [ ] `buildMemoryContent`/заголовок стора: `# Memory: <basename>` без `<!-- path: -->`; вместо path-метки — `<!-- key: git:... -->`.
- [ ] `readMemory(null)` / `writeMemory(null, ...)` корректно обрабатывают `null` (пусто / ошибка).
- [ ] `maybeMigrateLegacy` / `migrateLegacyStore` переориентируются на git-identity (мигрируют в git-стор, а не в path-стор).

### B2.4 MCP-инструменты (`mcp-server/index.js` + зеркало в `opencode-plugin/index.js`)
- [ ] `link_project_memory({ directory?, remote? })` — детект git, upsert identity, регистрация алиасов (все remotes + basename + canonicalPath), опциональный merge legacy/path-стора (дедуп по тексту факта, сохраняя id/даты). Возвращает `{ key, name, aliases, migrated }`.
- [ ] `unlink_project_memory({ directory? })` — удалить алиас `path` (и по запросу `--purge` identity); стор остаётся в БД.
- [ ] `relink_project_memory({ directory?, remote? })` — перенести существующий стор в другой identity (merge фактов в target-key + алиасы).
- [ ] `remember`/`recall`/`forget`/`update_fact`/`link_knowledge` — обрабатывают `scopeKey === null` (вне git): понятная ошибка агенту («нет git-репозитория; создайте репу или вызовите link_project_memory»).
- [ ] `memory_info` — секция Identity: текущий `key`, `name`, remote, статус (git/no-git), количество известных identity/алиасов.

### B2.5 Плагин (`opencode-plugin/index.js`)
- [ ] Прогрев identity-кэша на старте сессии (async в `MemoryPlugin`).
- [ ] Авто-инъекция проектной секции (см. A2): заголовки первых N фактов стора + счётчик; секция появляется, только если в сторе есть факты; при `projectKey === null` — только `## Global`.
- [ ] Экспорт инструментов link/unlink/relink (обёртки над mcp-server).

### B2.6 CLI (`mcp-server/cli.js`)
- [ ] Подкоманды/меню: `[PROJECT] Link to git repo`, `Unlink`, `Relink`, `Show identity`.
- [ ] `memory-cli link [--dir] [--remote]`, `unlink`, `relink`, `identity` в `--non-interactive` режиме.

### B2.7 Облако / sync
- [ ] Ключи `notebooks` → `git:...`: облако становится слоем переноса между машинами (тот же ключ виден на любой машине, reverse-sync/конфликты работают кросс-машино).
- [ ] `project_aliases` синхронизируются как часть notebook-данных пользователя (без приватных путей разработчика).

## Миграция существующих данных (проектные сторы)

- [ ] Путевые сторы (`<!-- path: ... -->`) остаются читаемыми; при обнаружении git в той же директории агент вызывает `link_project_memory` → merge в git-стор с дедупом.
- [ ] Legacy basename-сторы (unbound) → через `link_project_memory` в git-identity.
- [ ] Collision-guard сохраняется: не сливать в identity, если basename-стор неоднозначен (уже привязан к другой репе).

## Тестирование Части B

### Модульные (unit, без сети/диска, tmp MEMORY_DIR)
- [ ] `test_identity.js`: `normalizeRemoteUrl` (https/ssh/git@/креды/.git/trailing slash/регистр), деривация ключа `git:`/`git:local:`, registry CRUD на tmp-sqlite (upsert, alias lookup, cascade delete), `detectGitToplevel` на фейковых репах (`git init`).

### Регрессионные
- [ ] `test_project_identity.js` (заменяет `test_project_scoping.js`): реальные `git init` + `git remote add`, проверки: (1) один remote на разных путях → один ключ; (2) подпапка репо → тот же ключ, что и toplevel; (3) нет git → `projectKey() === null`, `remember(project)` возвращает ошибку, global работает; (4) link → алиасы зарегистрированы, повторный link идемпотентен; (5) unlink → алиас удалён, identity/стор в БД; (6) relink → факты перенесены в target-key; (7) миграция legacy/path-стора с дедупом.
- [ ] Существующие сюиты остаются зелёными: `test_phase1..4`, `test_phase1..3_cloud`, `test_reverse_sync`, `test_fact_format`, `test_memory_verification`, `test_mcp_tools`, `test_live_turso` (адаптация там, где hardcoded path-ключи).

### Смоук-тесты с реальным поведением и облаком (LIVE)
- [ ] `test_live_identity_turso.mjs` (по образцу `test_live_turso.mjs`, копирует реальные `config.json`+`auth_secrets.enc` в tmp MEMORY_DIR):
  - link_project_memory в реальной репе → ключ `git:github.com/lotargo/memory_plugin`;
  - `remember(scope:project)` в hybrid-sync → ноутбук с ключом `git:...` появляется в реальном Turso (проверка через отдельное only-cloud подключение);
  - открытие подпапки репо → тот же ключ (reverse-sync подтягивает облачный стор);
  - `recall(scope:project)` возвращает факты; очистка временных ноутбуков из облака.
- [ ] Прогон `verify_all` (полный набор регрессий) в CI/локально.

## Критерии готовности

- [ ] Все чекбоксы выше отмечены.
- [ ] `node --check` по изменённым файлам, все модульные+регрессионные тесты зелёные.
- [ ] LIVE-смоук с реальным Turso прошёл (link + write + cross-path read + cleanup).
- [ ] README/dev_docs обновлены (разделы «Fact schema: title + body», «Injection: headers + limit», «Project identity»).
