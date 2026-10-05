import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { getConfig, updateConfig } from '../config/config_manager.js';
import { MEMORY_DIR } from '../memory.js';
import { withSnapshotLock } from '../storage/snapshot_lock.js';
import { getCloudSnapshots, manageSnapshots } from '../admin/cloud_snapshots.js';
import { getAuthStatus, loginWithDatabaseToken, logoutFromCloud, resolveCloudSecrets } from '../admin/auth.js';
import { registerWebStartup } from '../dashboard/runtime.js';
import { isValidModelId } from '../ml/model_manager.js';

const field = (key, label, group, type, hint, rules = {}) => ({ key, label, group, type, hint, ...rules });
// This allowlist is also the UI form contract. Credentials and migration flags
// never pass through the generic configuration editor.
export const SETTINGS_FIELDS = Object.freeze([
  field('fusionAlgorithm', 'Алгоритм поиска', 'search', 'select', 'Объединение текстового и векторного поиска.', { options: [['rsf','RSF'],['rrf','RRF'],['semantic_only','Векторный'],['lexical_only','Текстовый']] }),
  field('alpha', 'Вес векторного поиска', 'search', 'number', 'Для RSF: от 0 до 1.', { min: 0, max: 1, step: 0.05 }),
  field('policyExpansion', 'Раскрывать таблицы и код', 'search', 'boolean', 'Добавлять контекст родительской таблицы или кода к найденному фрагменту.'),
  field('vectorScanLimit', 'Лимит векторных кандидатов', 'search', 'number', '0 — без ограничения.', { min: 0, max: 100000000, step: 1 }),
  field('embeddingModel', 'Embedding-модель', 'models', 'text', 'ID модели Hugging Face. Смена требует переиндексации; сохранение не скачивает модель.'),
  field('vectorDimension', 'Размерность векторов', 'models', 'number', '0 — определять по модели. Смена требует переиндексации.', { min: 0, max: 65536, step: 1 }),
  field('rerankerModel', 'Reranker-модель', 'models', 'text', 'ID cross-encoder модели или none.'),
  field('rerankerEnabled', 'Включить reranker', 'models', 'boolean', 'Пересчитывать оценки первых результатов.'),
  field('rerankerTopN', 'Результатов для reranker', 'models', 'number', 'От 1 до 100.', { min: 1, max: 100, step: 1 }),
  field('batchSize', 'Размер batch', 'models', 'number', 'Количество чанков за один проход модели.', { min: 1, max: 256, step: 1 }),
  field('executionDevice', 'Устройство', 'models', 'select', 'GPU / WebGPU — экспериментальный режим.', { options: [['cpu','CPU / RAM'],['webgpu','GPU / WebGPU']] }),
  field('onnxThreads', 'Потоки CPU', 'models', 'number', '0 — автоматически.', { min: 0, max: 16, step: 1 }),
  field('gpuAttentionBudget', 'GPU attention budget', 'models', 'number', 'Бюджет обработки batch на GPU.', { min: 1000000, max: 16000000, step: 1 }),
  field('modelUnloadTimeoutMinutes', 'Выгрузка при простое, минут', 'models', 'number', '0 — не выгружать. До 1440 минут, как в CLI. Применяется владельцем модели.', { min: 0, max: 1440, step: 1 }),
  field('webPort', 'Порт панели', 'web', 'number', '0 — автоматически. Новый порт применяется после перезапуска панели.', { min: 0, max: 65535, step: 1 }),
  field('webAutoStart', 'Автозапуск панели', 'web', 'boolean', 'При запуске клиента; на Windows также при входе пользователя. Выключение оставляет текущую панель открытой.'),
  field('ingestAllowedPaths', 'Дополнительные каталоги источников', 'sources', 'paths', 'По одному абсолютному пути в строке.'),
  field('ingestAllowAnyPath', 'Разрешить источники из любых каталогов', 'sources', 'boolean', 'Расширяет доступ к файлам за пределы проекта и указанных каталогов.'),
]);

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const version = config => createHash('sha256').update(JSON.stringify(config)).digest('hex');
const keys = (input, allowed) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) fail('INVALID', 'Неизвестное поле запроса.');
};
function expected(input) {
  if (typeof input.expectedVersion !== 'string' || version(getConfig()) !== input.expectedVersion) fail('CONFLICT', 'Настройки изменились в другом клиенте. Обновите значения перед сохранением.');
}
function endpoint(raw) {
  try {
    const url = new URL(raw);
    if (!['libsql:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' && url.pathname !== '') throw new Error();
    return raw;
  } catch { fail('INVALID', 'Укажите URL базы libsql:// или https:// без токена, пути и параметров.'); }
}
function safeEndpoint(raw) { try { return endpoint(raw); } catch { return ''; } }

export function readSettings() {
  const config = getConfig(), auth = getAuthStatus(), state = getCloudSnapshots().state();
  return {
    version: version(config), fields: SETTINGS_FIELDS,
    values: Object.fromEntries(SETTINGS_FIELDS.map(({key}) => [key, config[key]])),
    storage: { mode: config.mode, syncMode: config.snapshotSyncMode, intervalHours: config.snapshotIntervalHours,
      legacyCloudBackupRequired: config.legacyCloudBackupRequired, legacyCloudRestoreRequired: config.legacyCloudRestoreRequired },
    cloud: { source: auth.source, configured: auth.configured, authorized: auth.authorized, dbUrl: safeEndpoint(auth.dbUrl), username: auth.username, checked: false },
    snapshots: { nextDueAt: state.nextDueAt, nextAttemptAt: state.nextAttemptAt, lastUploadedId: state.lastUploadedId,
      pendingId: state.pendingId, quotaBlocked: state.quotaBlocked, failures: state.failures,
      lastError: state.lastError ? 'Последняя отправка завершилась ошибкой. Повторите отправку или проверьте подключение.' : null,
      legacyCloudBackupId: state.legacyCloudBackupId || null },
    observedAt: new Date().toISOString(),
  };
}

export function validateFields(fields) {
  keys(fields, SETTINGS_FIELDS.map(field => field.key));
  if (!Object.keys(fields).length) fail('INVALID', 'Нет изменённых настроек.');
  for (const [key, value] of Object.entries(fields)) {
    const rule = SETTINGS_FIELDS.find(field => field.key === key);
    if (rule.type === 'boolean' && typeof value !== 'boolean' || rule.type === 'select' && !rule.options.some(([option]) => option === value)) fail('INVALID', `${rule.label}: недопустимое значение.`);
    if (rule.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < rule.min || value > rule.max || rule.step === 1 && !Number.isInteger(value))) fail('INVALID', `${rule.label}: укажите число от ${rule.min} до ${rule.max}.`);
    if (rule.type === 'text' && (!isValidModelId(value) && !(key==='rerankerModel' && value==='none'))) fail('INVALID', `${rule.label}: укажите ID модели вида organization/model.`);
    if (rule.type === 'paths' && (!Array.isArray(value) || value.length > 100 || value.some(path => typeof path !== 'string' || path.length > 4096 || !/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(path) || /[\r\n\0]/.test(path)))) fail('INVALID', `${rule.label}: нужны абсолютные пути.`);
  }
  const next = { ...getConfig(), ...fields };
  if (next.rerankerEnabled && next.rerankerModel === 'none') fail('INVALID', 'Выберите reranker-модель перед включением.');
}

export async function settingsRequest(input) {
  if (input?.action === 'read') { keys(input, ['action']); return readSettings(); }
  return withSnapshotLock(join(MEMORY_DIR, 'storage', 'settings'), async () => {
    if (input?.action === 'save') {
      keys(input, ['action','expectedVersion','fields']); expected(input); validateFields(input.fields);
      const previous = getConfig();
      if (Object.hasOwn(input.fields, 'webAutoStart')) registerWebStartup({ remove: !input.fields.webAutoStart });
      updateConfig(input.fields);
      const reindexRequired = ['embeddingModel','vectorDimension'].some(key => Object.hasOwn(input.fields, key) && input.fields[key] !== previous[key]);
      return { status: 'saved', reindexRequired, restartRequired: Object.hasOwn(input.fields,'webPort') && input.fields.webPort !== previous.webPort, settings: readSettings() };
    }
    if (input?.action === 'switch-mode') {
      keys(input, ['action','expectedVersion','mode']); expected(input);
      if (!['only-local','cloud-snapshots'].includes(input.mode)) fail('INVALID', 'Доступны only-local и cloud-snapshots.');
      let result;
      if (input.mode === 'cloud-snapshots') result = await manageSnapshots({ action:'enable' });
      else { updateConfig({mode:'only-local'}); result = {status:'saved'}; }
      return { ...result, settings: readSettings() };
    }
    if (input?.action === 'configure-snapshots') {
      keys(input, ['action','expectedVersion','syncMode','intervalHours']); expected(input);
      if (!['manual','scheduled','off'].includes(input.syncMode) || typeof input.intervalHours !== 'number' || !Number.isFinite(input.intervalHours) || input.intervalHours <= 0 || input.intervalHours * 3600000 > Number.MAX_SAFE_INTEGER) fail('INVALID','Интервал снимков должен быть положительным числом часов.');
      if (getConfig().mode !== 'cloud-snapshots') fail('INVALID','Сначала включите облачные снимки.');
      const result = await manageSnapshots({ action:'configure', syncMode:input.syncMode, intervalHours:input.intervalHours });
      return {status:'saved', ...result, settings:readSettings()};
    }
    if (input?.action === 'cloud-login') {
      keys(input, ['action','expectedVersion','dbUrl','token']); expected(input); endpoint(input.dbUrl);
      if (typeof input.token !== 'string' || !input.token.trim() || input.token.length > 16384 || /[\r\n\0]/.test(input.token)) fail('INVALID','Введите токен базы.');
      if (getAuthStatus().source === 'env') fail('INVALID','Подключение задано окружением. Измените переменные окружения перед заменой.');
      await loginWithDatabaseToken({dbUrl:input.dbUrl,token:input.token.trim(),validate:false});
      getCloudSnapshots().close();
      return {status:'saved', settings:readSettings()};
    }
    if (input?.action === 'cloud-logout') {
      keys(input, ['action','expectedVersion']); expected(input);
      logoutFromCloud(); getCloudSnapshots().close();
      return {status:'saved',settings:readSettings()};
    }
    if (input?.action === 'cloud-check') {
      keys(input, ['action']);
      let client, timeout;
      try {
        const secrets = await resolveCloudSecrets();
        if (!secrets?.dbUrl || !secrets?.token) fail('INVALID','Сначала настройте облачное подключение.');
        endpoint(secrets.dbUrl);
        const {createClient} = await import('@libsql/client');
        client = createClient({url:secrets.dbUrl,authToken:secrets.token});
        await Promise.race([client.execute('SELECT 1'),new Promise((_, reject) => {timeout=setTimeout(() => reject(new Error('timeout')),10000);})]);
        return {status:'connected',observedAt:new Date().toISOString()};
      } catch(error) {
        if(error.code === 'INVALID') throw error;
        fail('UNAVAILABLE','Не удалось подключиться к облаку. Проверьте URL, токен и сеть.');
      } finally {clearTimeout(timeout);client?.close();}
    }
    fail('INVALID','Неизвестное действие настроек.');
  });
}

export async function snapshotRequest(input) {
  const allowed = {
    list:['action','location','limit'], create:['action'], upload:['action'],
    restore:['action','id','location','confirmToken'], pin:['action','id','location','pinned'],
    delete:['action','location','from','to','includeProtected','confirmToken'],
  };
  if (!Object.hasOwn(allowed,input?.action)) fail('INVALID','Неизвестное действие снимков.');
  keys(input,allowed[input.action]);
  if (input.location !== undefined && !(input.action === 'delete' ? ['local','cloud','both'] : ['local','cloud']).includes(input.location)) fail('INVALID','Неизвестное расположение снимка.');
  if (['restore','pin'].includes(input.action) && (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id))) fail('INVALID','Неверный ID снимка.');
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)) fail('INVALID','Лимит от 1 до 100.');
  for (const key of ['pinned','includeProtected']) if(input[key] !== undefined && typeof input[key] !== 'boolean') fail('INVALID','Неверное логическое значение.');
  if (input.confirmToken !== undefined && (typeof input.confirmToken !== 'string' || !/^[a-f0-9]{64}$/.test(input.confirmToken))) fail('INVALID','Неверный токен предпросмотра.');
  if (input.action === 'delete' && (!Number.isSafeInteger(input.from) || !Number.isSafeInteger(input.to) || input.from < 0 || input.to <= input.from)) fail('INVALID','Укажите корректный период удаления.');
  try {
    const result = await manageSnapshots(input);
    // Cloud error messages can contain URLs/credentials. Do not expose them.
    if (result.status === 'local-only') return {...result,reason:'Отправка не завершена. Локальный снимок сохранён; проверьте подключение или квоту.'};
    return result;
  } catch(error) {
    if (error.code && ['INVALID','CONFLICT','MIGRATION_REQUIRED','RECOVERY_REQUIRED'].includes(error.code)) throw error;
    if (/stale/.test(error.message)) fail('CONFLICT','Предпросмотр устарел. Подготовьте его повторно.');
    fail('UNAVAILABLE','Операция со снимком не завершена. Проверьте подключение и доступность снимка.');
  }
}
