# RAG Memory Notes — локальный чек-лист тестирования

> Короткая инструкция для агента-тестировщика. Цель — проверить текущий `main` перед release-подготовкой. **Не публиковать релиз, не менять версию пакета и не выполнять `npm publish`.**

## 1. Подготовка

- [ ] Обновить локальный `main` и убедиться, что нет случайных незакоммиченных изменений.
- [ ] Проверить Node.js: требуется `>= 22.5.0`.
- [ ] Установить зависимости, если они ещё не установлены: `npm install`.
- [ ] Зафиксировать SHA тестируемого commit: `git rev-parse HEAD`.

## 2. Сначала новые RAG Memory Notes suites

Запустить по отдельности, чтобы при падении сразу было видно проблемный слой:

```bash
node tests/unit/rag_memory_notes.test.js
node tests/integration/rag_memory_notes.test.js
node tests/integration/rag_memory_notes_mcp.test.js
node tests/integration/rag_cloud_portability.test.js
```

- [ ] `rag_memory_notes` unit — PASS
- [ ] core/OpenCode integration — PASS
- [ ] stdio MCP integration — PASS
- [ ] hybrid / only-cloud portability — PASS

При падении **не ограничиваться последней строкой**: сохранить название suite, полный exception/stack и шаг, на котором тест остановился.

## 3. Полный regression

```bash
npm test
```

- [ ] Все **22 suites** прошли.
- [ ] Старый Notebook memory не сломан.
- [ ] Обычный RAG/document ingestion не сломан.
- [ ] Table/code policy retrieval не сломан.
- [ ] Reverse-sync старых Notebook-фактов не сломан.

После полного suite дополнительно:

```bash
npm run smoke
```

- [ ] Реальные ONNX embeddings загружаются и smoke-test проходит.

## 4. Минимальный ручной сценарий

В реальном агенте с установленным plugin/MCP:

- [ ] Создать длинную заметку через `remember_note` с уникальной контрольной фразой.
- [ ] Выполнить `query_knowledge_base(..., resultMode="index")` по смысловому парафразу, а не по точной контрольной фразе.
- [ ] Убедиться, что результат содержит `doc_id`, title, `source_type=note`, kind/tags и **не возвращает полный body**.
- [ ] Выполнить `manage_knowledge_base(action="read_document", docId=...)` и убедиться, что возвращается полный исходный текст заметки.
- [ ] Перезапустить агента/MCP и повторить поиск + `read_document`.
- [ ] Проверить project note: она видна в своём Git-проекте и не видна в другом project scope.
- [ ] Проверить global note: она доступна из проекта при `scope="all"`.
- [ ] Связать короткий Notebook fact с note через `link_knowledge`; удалить note и убедиться, что сам Notebook fact сохранился.

## 5. Что особенно проверить при cloud/hybrid

- [ ] Fresh local store восстанавливает note из LibSQL/Turso без смены `doc_id`.
- [ ] После восстановления работает полный `read_document`, а не только поиск по чанкам.
- [ ] Удаление note на одной машине распространяется на stale-копию через tombstone.
- [ ] Удалённый raw blob не появляется в cloud повторно после запуска старой машины.
- [ ] В `only-cloud` удаление локального blob-cache не ломает `read_document`: raw заново материализуется из `rag_blobs`.

## 6. Правила при обнаружении ошибки

- [ ] Сначала воспроизвести ошибку повторно тем же тестом.
- [ ] Зафиксировать: commit SHA, OS, Node.js version, suite/команду, stack trace и фактический результат.
- [ ] Определить минимальный слой проблемы: note ingestion / retrieval / raw blob / scope / MCP / OpenCode / sync / tombstone.
- [ ] Если вносится исправление — делать минимальный patch без рефакторинга соседнего кода.
- [ ] После исправления повторно запустить упавший suite.
- [ ] Затем снова выполнить `npm test`.
- [ ] Не отмечать тест как PASS только по статическому просмотру кода.

## 7. Финальный отчёт агенту/разработчику

Заполнить после проверки:

```text
Commit: <sha>
OS: <...>
Node: <...>

New RAG Notes suites: PASS / FAIL
Full npm test (22 suites): PASS / FAIL
ONNX smoke: PASS / FAIL
Manual save -> index -> raw -> restart: PASS / FAIL
Project/global isolation: PASS / FAIL
Hybrid/cloud portability: PASS / FAIL
Delete/tombstone: PASS / FAIL

Failures:
- <suite / step>
- <exact error>
- <reproduction>
- <minimal suspected cause>

Changes made during testing:
- none / <commit(s)>

Verdict:
- READY FOR RELEASE PREP
or
- NOT READY: <blocking items>
```

**Главное правило:** итогом тестирования должен быть воспроизводимый технический результат, а не просто сообщение «вроде работает».
