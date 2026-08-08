# План исправлений по результатам аудита

Дата: 2026-08-08
Статус: фазы 1–5 выполнены, осталась финальная верификация (фаза 6)

Аудит выявил критичные баги (missing `await`), уязвимости (OAuth CSRF, SSRF, утечки ресурсов) и большой объём мёртвого кода. План разбит на фазы; каждая фаза завершается прогоном тестов (`npm test` / `node tests/run_all.js`).

---

## Фаза 1 — Критичные баги: missing `await`

| № | Файл | Что чиним |
|---|------|-----------|
| 1.1 | `mcp-server/tools/memory_tools.js:123` | `await linkFactToDocument(...)` — сейчас floating promise, try/catch не ловит async-ошибку, `linkRes.docTitle` = undefined |
| 1.2 | `opencode-plugin/index.js:359` | то же в `remember`-туле |
| 1.3 | `opencode-plugin/index.js:755, 768, 773` | `link_knowledge`: все 3 ветки (`link` / `get_doc_links` / `list_links`) без `await` → `JSON.stringify(Promise)` = `{}` |
| 1.4 | `opencode-plugin/index.js:652-655` | `update_fact`: `db.prepare(...).run()` без `await` → `res.changes` undefined |
| 1.5 | `opencode-plugin/index.js:680-684` | `memory_info`: `.get()` без `await` → все счётчики undefined. Методы `DatabaseWrapper` async во **всех** режимах, не только only-cloud |
| 1.6 | `opencode-plugin/index.js:881-908` | `manage_knowledge_base` (stats / list / read_document): `.get()/.all()` без `await` |

Верификация: тест-сьют + ручной вызов тулов `remember`, `update_fact`, `memory_info`, `link_knowledge`, `manage_knowledge_base`.

**Статус: ВЫПОЛНЕНО.** Подтверждено smoke-тестом через opencode-plugin: `remember` возвращает `[Linked to Doc]`, `link_knowledge` (link/list_links/get_doc_links) возвращает реальные ссылки с `docTitle`, `update_fact` — `1 doc link(s) updated`, `memory_info` и `manage_knowledge_base` — корректные числа.

---

## Фаза 2 — Безопасность (HIGH)

| № | Файл | Что чиним |
|---|------|-----------|
| 2.1 | `mcp-server/admin/auth.js` | OAuth CSRF: `state` генерируется (стр. 373), но не проверяется в callback loopback-сервера. Сгенерировать ожидаемый `state`, сравнивать с `url.searchParams.get("state")` до принятия токена |
| 2.2 | `mcp-server/db/database.js:184-185` | Миграционный `cloudDbWrapper` не закрывается → утечка клиента. Вызвать `cloudDbWrapper.close()` после `runMigrations` |
| 2.3 | `mcp-server/db/database.js:235` | `closeDatabase()` определён, но нигде не вызывается. Добавить shutdown-хуки (`SIGINT`/`SIGTERM`/`exit`) в точке входа MCP-сервера и opencode-plugin |
| 2.4 | `mcp-server/admin/auth.js:10` | `TURSO_API_BASE` из env — решение: оставить (удобно для тестов), но задокументировать; либо ограничить. Согласовать с пользователем |

Верификация: тест-сьют, ручной прогон OAuth-логина.

**Статус: ВЫПОЛНЕНО.** 2.1 — `auth.js:38` сверяет `state` из callback; 2.2 — `cloudDbWrapper.close()` в `database.js:191`; 2.3 — shutdown-хуки в `mcp-server/index.js:34,39` и `opencode-plugin/index.js:40`; 2.4 — `TURSO_API_BASE` оставлен (задокументирован в коде).

---

## Фаза 3 — Средние риски

| № | Файл | Что чиним |
|---|------|-----------|
| 3.1 | `mcp-server/ingest/pipeline.js:80` | Хардкод 384-d буфера. Взять размерность из фактического вектора модели (проверить вывод `embed()`), а не константу |
| 3.2 | `mcp-server/retrieval/retriever.js:48-78` | Vector search грузит всю БД в память. Как минимум: лимит строк + ранний выход; как опция — sqlite-vec. Согласовать объём |

Верификация: ingestion + retrieval на реальном тексте.

**Статус: ВЫПОЛНЕНО.** 3.1 — размерность берётся из фактического вектора модели (`vectorToBuffer`/`vectorDim = queryVector.length`), хардкода 384 нет; 3.2 — `retriever.js:48-63` лимит через конфиг `vectorScanLimit`.

---

## Фаза 4 — Полировка предыдущих правок (из git diff)

| № | Файл | Что чиним |
|---|------|-----------|
| 4.1 | `mcp-server/admin/snapshot.js` + `tools/rag_tools.js` | Allowlist путей регистрировать **один раз** в начале `registerRagTools`, а не лениво в `import_snapshot`. Сейчас защита неоднородна (CLI/opencode-plugin не регистрируют; export до первого import не ограничен, после — начинает падать). Убрать лишний re-export `ensureExportsDir` |
| 4.2 | `mcp-server/ingest/normalizer.js` | Редирект: зациклить до 3 хопов с валидацией каждого; обернуть второй `fetch` в try/catch |

Верификация: export/import снапшота из CLI и MCP; ingestion URL с multi-hop.

**Статус: ВЫПОЛНЕНО.** 4.1 — allowlist регистрируется один раз в начале `registerRagTools` (`rag_tools.js:9-10`), re-export `ensureExportsDir` убран (теперь обычный `import`); 4.2 — `normalizer.js:83-103` до 3 редиректов с SSRF-валидацией каждого.

---

## Фаза 5 — Dead code / неиспользуемые функции (LOW)

Кандидаты (только удаление, без рефакторинга):
- `memory.js`: `slugify`, `isSimpleKey()`
- `fact_format.js`: `withTitleAndBody`, `ttlMs`
- `identity.js`: `lookupByCandidates`, `bustIdentityCache`, `getRemoteUrls`, `detectGitToplevel`
- `db/database.js`: `DB_PATH`, `STORAGE_DIR` (проверить), `closeDatabase` (останется после фазы 2.3)
- `db/sync_queue.js`: `resetReverseSyncThrottle`, `syncFromCloud`, `triggerBackgroundSync` — **проверить**: используются тестами, удалять только если не экспортятся наружу
- `config/auth_store.js`: `encryptData`, `decryptData`
- `config/config_manager.js`: `DEFAULT_CONFIG`, `saveConfig`
- `storage/blob_store.js`: `hashContent`, `getBlobPath`, `blobExists`
- `admin/auth.js`: `TURSO_API_BASE` (зависит от 2.4), `startAuthLoopbackServer`, `validateTursoToken`, `listOrganizations`, `listDatabases`, `createDatabase`, `createGroup`, `createDatabaseToken`, `invalidateResolvedCache`
- `cli/ui.js`: панель-хелперы (часть используется CLI — проверить каждый)
- `graph/graph_extractor.js`: `extractSymbolsFromContent`, `getRelatedSymbols`
- `ingest/chunker.js`: `estimateTokens`, `parseSections`, `extractMediumBlocks`, `createSmallChunks`, `createMicroChunks`
- `ingest/exporter.js`: `EXPORTS_DIR`, `exportDocumentToJsonString`
- `ingest/normalizer.js`: `cleanHtml`, `extractTitle`, `stripMarkdownBadgesAndNoise`, `parseSpreadsheet`, `validateUrlForSsrf`
- `ml/gpu_monitor.js`: `getGpuUtilizationAsync`
- `ml/model_manager.js`: `ensureValidModelDirectory`, `getExtractor`, `resetExtractor`, `formatInputText`, `bufferToVector`, `getReranker`
- `retrieval/retriever.js`: `sanitizeFtsQuery`, `bm25Search`, `vectorSearch`, `rrfFusion`, `rsfFusion`
- `prompt_manager.js`: `PROMPT_BLOCK`, `PROMPT_FILE`, `getGlobalPromptTargets`, `syncPromptFile`, `getGlobalPromptStatus`

Верификация: после удаления — полный прогон тестов; `rg` по каждому удалённому имени.

**Статус: ВЫПОЛНЕНО ЧАСТИЧНО.** Проверка показала: список аудита — ложные срабатывания. Большинство «неиспользуемых» экспортов — внутренние хелперы, используемые в своём же файле (например `slugify`, `encryptData`, `saveConfig`, `cleanHtml`, `validateTursoToken`) или тестами/бенчмарками (`bm25Search`, `vectorSearch`, `rrfFusion`, `syncFromCloud`, `resetReverseSyncThrottle`, `sanitizeFtsQuery`, `extractTitle`, `exportDocumentToJsonString` и др.). Удалять их нельзя — сломаются тесты. Удалены только по-настоящему мёртвые функции: `isSimpleKey()` (`memory.js`), `localFilePath()` (`db/sync_queue.js`) + неиспользуемый импорт `memoryFileName`.

---

## Фаза 6 — Финальная верификация

1. `node tests/run_all.js` — все сьюты зелёные
2. Ручной smoke: `memory_info`, `remember` с `docId`, `link_knowledge` list/get, `update_fact`, `manage_knowledge_base` stats
3. `git diff` — ревью изменений, без секретов в коммите
4. Обновить `docs/AUDIT_FIX_PLAN.md` (статусы фаз)
