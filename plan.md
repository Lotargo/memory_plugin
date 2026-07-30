# GPU Acceleration с автоматическим fallback на CPU

## Статус

### Выполнено ✅

- [x] **Депенденси** — `onnxruntime-node` обновлён до `^1.27.0` (DirectML включён в Windows x64 binary)
- [x] **Конфиг** — добавлено поле `executionDevice: "auto"` в `config_manager.js`
- [x] **Детекция провайдеров** — `detectAvailableProviders()` в `model_manager.js`:
  - Использует `listSupportedBackends()` API
  - Правильно отфильтровывает `webgpu` в Node.js (нет `navigator.gpu`)
  - Поддерживает `dml` / `cuda` / `cpu` с приоритетом
  - Кэширует результат (один раз на процесс)
- [x] **Cascade fallback** — `getExtractor()` и `getReranker()`:
  - Сначала пробует `bestProvider` (DML на Windows)
  - При ошибке — fallback на CPU
  - Затем fallback на модель по умолчанию
- [x] **`getDeviceInfo()`** — экспортирует детальную информацию:
  - `activeDevice`, `configuredDevice`, `detectedBest`
  - `availableProviders`, `isGpuActive`, `displayName`, `status`
  - Корректно показывает состояние до загрузки модели
- [x] **CLI header panel** — `cli.js` отображает текущий engine и доступные провайдеры

### Выполнено ✅

- [x] **Tensor compat fix** — `patch-package` применён к `@xenova/transformers/src/utils/tensor.js`:
  - После `Object.assign(this, ortTensor)` явно копируются прототипные геттеры `data`/`location`
  - Добавлен `patch-package` в devDependencies + `postinstall` hook в package.json
  - Неактуальный runtime-патч `ONNX.Tensor` удалён из `model_manager.js`
- [x] **Verification Plan**
  - [x] CLI header показывает `⚡ Engine: DirectML (GPU) [dml, cpu]`
  - [x] Smoke test: `embedText("Hello")` — вектор 1024 dims (модель из конфига)
  - [x] `cosineSimilarity(v1, v1) ≈ 1.0000`
  - [x] `cosineSimilarity("Hello", "Bonjour") ≈ 0.9346` (>0.7)

## Текущее состояние кода

### [MODIFY] [model_manager.js](file:///f:/projects/plugins/memory/mcp-server/ml/model_manager.js)

**Реализовано:**
- `detectAvailableProviders()` — probe через `listSupportedBackends()` + фильтр webgpu
- `configureOnnxBackend(provider)` — устанавливает `executionProviders` массив (dml/cuda/cpu). Tensor compat — через patch-package.
- `getExtractor()`, `getReranker()` — cascade fallback логика
- `getDeviceInfo()` — диагностическая информация

### [MODIFY] [package.json](file:///f:/projects/plugins/memory/mcp-server/package.json)

```json
"onnxruntime-node": "^1.27.0",
"devDependencies": {
  "patch-package": "^8.0.1"
},
"scripts": {
  "postinstall": "patch-package"
},
"overrides": {
  "onnxruntime-node": "$onnxruntime-node",
  "onnxruntime-common": "1.27.0",
  "onnxruntime-web": "1.27.0"
}
```

Патч: `patches/@xenova+transformers+2.17.2.patch` — фикс копирования прототипных геттеров `data`/`location` после `Object.assign`.

### [MODIFY] [config_manager.js](file:///f:/projects/plugins/memory/mcp-server/config/config_manager.js)

```js
executionDevice: "auto", // "auto" | "dml" (DirectML/Windows GPU) | "cpu"
```

### [MODIFY] [cli.js](file:///f:/projects/plugins/memory/mcp-server/cli.js)

Header panel показывает `⚡ Engine: DirectML (GPU) [dml, cpu]` или `● Engine: CPU [cpu]`.

## Verification Plan (полностью выполнен)

### Автоматические тесты

- [x] `node mcp-server/index.js cli` — header panel показывает `⚡ Engine: DirectML (GPU)`
- [x] Smoke test: `embedText("Hello")` возвращает вектор (модель из конфига, GPU active)
- [x] `cosineSimilarity(v1, v1) ≈ 1.0000` (идентичный текст)
- [x] `cosineSimilarity("Hello", "Bonjour") ≈ 0.9346` (>0.7, семантическая близость)

### Ручная проверка

- [x] При наличии GPU используется DirectML
- [x] Embedding quality не деградирует (те же веса модели)

> **Benchmark CPU vs DML** — отложено по решению пользователя.
