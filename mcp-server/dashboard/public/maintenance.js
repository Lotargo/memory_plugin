const $ = id => document.getElementById(id);
export function createMaintenance({ api, node, openDialog, allowDiscard, closeNavigation, scopeKey, onSaved }) {
  const dialog = $('maintenanceDialog');
  let status = null, ragStatus = null, preview = null, pending = false, sequence = 0;
  const rag = () => $('maintenanceOperation').value.startsWith('rag-');
  const endpoint = () => rag() ? '/api/rag-maintenance' : '/api/maintenance';
  function reset() { preview = null; $('maintenancePreview').replaceChildren(); $('maintenanceApply').disabled = true; }
  function error(problem) {
    $('maintenanceError').hidden = !problem;
    $('maintenanceError').textContent = !problem ? '' : problem.code === 'CONFLICT'
      ? 'Состояние изменилось в другом клиенте. Обновите состояние и проверьте изменения снова.'
      : `${problem.code || 'Ошибка'}: ${problem.message}`;
  }
  function input() {
    const operation = $('maintenanceOperation').value;
    if (rag()) return { operation: operation.slice(4), ...(operation === 'rag-import' ? { snapshotId: $('maintenanceRagSnapshot').value, mode: $('maintenanceRagMode').value } : {}) };
    return { operation, ...(operation.startsWith('migrate-') ? { key: operation === 'migrate-persona' ? 'global' : $('maintenanceTarget').value } : {}),
      ...(operation === 'restore-settings' ? { backupId: $('maintenanceBackup').value } : {}) };
  }
  function controls() {
    const operation = $('maintenanceOperation').value;
    $('maintenanceTargetField').hidden = !operation.startsWith('migrate-');
    $('maintenanceBackupField').hidden = operation !== 'restore-settings';
    for (const id of ['maintenanceRagFileField','maintenanceRagSnapshotField','maintenanceRagModeField']) $(id).hidden = operation !== 'rag-import';
    if (operation === 'migrate-persona') $('maintenanceTarget').value = 'global';
    $('maintenanceHint').textContent = rag()
      ? 'Все локальные области RAG. Notebook и проекты сохраняются. Импорт заменяет затронутые документы целиком, включая чанки и области; режим полной замены и сброс удаляют отсутствующие источники и их ссылки Notebook. Перед изменением создаётся проверенный полный ZIP. Файлы неиспользуемых blobs остаются для отдельной очистки. Экспорт сохраняет только RAG.'
      : operation.startsWith('migrate-')
      ? 'Один Notebook. Даты, keep, TTL, история и источники сохраняются. Перед записью создаётся проверенный полный ZIP. Синхронизацию файлов клиентов выполните отдельно в разделе «Инструкции».'
      : 'Поиск, модели и доступ к источникам. Режим хранения, облачное подключение, расписание снимков, порт и автозапуск сохраняются. Модели в процессах и существующие векторы не меняются. Есть резервная копия для восстановления.';
    if (rag() && ragStatus?.migrationRequired) $('maintenanceHint').textContent = 'Сначала подготовьте связи в разделе «Знания → Подготовить связи». После этого станут доступны экспорт, импорт и сброс RAG. Выбранный файл можно проверить заранее.';
    busy(pending);
  }
  function busy(value) {
    pending = value; dialog.setAttribute('aria-busy', String(value));
    for (const id of ['maintenanceOperation','maintenanceTarget','maintenanceBackup','maintenanceRefresh','maintenanceClose','maintenanceRagFile','maintenanceRagSnapshot','maintenanceRagMode']) $(id).disabled = value;
    const request = input(), unavailable = rag() ? !ragStatus || ragStatus.migrationRequired || request.operation === 'import' && !request.snapshotId : !status || request.operation.startsWith('migrate-') && (!request.key || status.unavailable)
      || request.operation === 'restore-settings' && !request.backupId;
    $('maintenanceReview').disabled = value || !!unavailable;
    $('maintenanceTarget').disabled = value || request.operation === 'migrate-persona';
    $('maintenanceApply').disabled = value || !preview?.changed;
    $('maintenanceRagDownload').disabled = value || !$('maintenanceRagSnapshot').value;
    $('maintenanceReview').textContent = request.operation === 'export' ? 'Создать и скачать экспорт' : 'Проверить изменения';
  }
  async function load() {
    const current = ++sequence; reset(); error(null); busy(true);
    try {
      const results = await Promise.allSettled([api('/api/maintenance'), api('/api/rag-maintenance')]); if (current !== sequence || !dialog.open) return;
      if (results[1].status === 'fulfilled') {
        ragStatus = results[1].value; const selected = $('maintenanceRagSnapshot').value;
        $('maintenanceRagSnapshot').replaceChildren(...ragStatus.snapshots.filter(item => !item.unavailable).map(item => {
          const option = node('option', `${item.fileName} · ${new Date(item.observedAt).toLocaleString('ru')} · ${item.id}`); option.value = item.id; return option;
        }));
        if (ragStatus.snapshots.some(item => item.id === selected && !item.unavailable)) $('maintenanceRagSnapshot').value = selected;
        $('maintenanceRagReceipts').hidden = !ragStatus.receipts.length;
        $('maintenanceRagReceiptList').replaceChildren(...ragStatus.receipts.map(item => node('li', `${item.operation} · ${new Date(item.observedAt).toLocaleString('ru')} · ${item.operationId} · ZIP: ${item.backup}`)));
        if (ragStatus.snapshots.some(item => item.unavailable)) error({code:'RECOVERY_REQUIRED',message:'Повреждённые входные снимки исключены из списка.'});
      } else { ragStatus = null; error(results[1].reason); }
      if (results[0].status !== 'fulfilled') { status = null; error(results[0].reason); controls(); return; }
      const result = results[0].value;
      status = result; const target = $('maintenanceTarget').value || scopeKey();
      $('maintenanceTarget').replaceChildren(...result.targets.filter(item => !item.unavailable && item.notebookAvailable !== false).map(item => {
        const option = node('option', `${item.name} · ${item.key}`); option.value = item.key; return option;
      }));
      if (result.targets.some(item => item.key === target && !item.unavailable)) $('maintenanceTarget').value = target;
      $('maintenanceBackup').replaceChildren(...result.backups.filter(item => !item.unavailable).map(item => {
        const option = node('option', `${new Date(item.observedAt).toLocaleString('ru')} · ${item.id}`); option.value = item.id; return option;
      }));
      if (result.unavailable) error({ code: result.unavailable, message: 'Notebook недоступен; операции с настройками остаются доступны.' });
      if (result.backups.some(item => item.unavailable)) error({ code: 'RECOVERY_REQUIRED', message: 'Есть повреждённые резервные копии настроек. Они исключены из списка восстановления.' });
      controls();
    } catch (problem) { if (current === sequence) { status = null; error(problem); } }
    finally { if (current === sequence) busy(false); }
  }
  $('openMaintenance').addEventListener('click', async () => {
    if (!(await allowDiscard())) return; closeNavigation(); openDialog('maintenanceDialog'); $('maintenanceResult').textContent = ''; await load();
    if (dialog.open && !pending) $('maintenanceOperation').focus();
  });
  $('maintenanceReview').addEventListener('click', async () => {
    const current = ++sequence; reset(); error(null); $('maintenanceResult').textContent = ''; busy(true);
    try {
      if (input().operation === 'export') {
        const result = await api(endpoint(), {action:'export'}); await download(result.snapshotId);
        $('maintenanceResult').textContent = `Экспорт сохранён: ${result.outputPath}. ID: ${result.snapshotId}.`;
        await load(); return;
      }
      const result = await api(endpoint(), { action: 'preview', ...input() });
      if (current !== sequence || !dialog.open) return; preview = result;
      const box = $('maintenancePreview'); box.append(node('h3', `${rag() ? 'Все локальные области RAG' : result.scope === 'configuration' ? 'Настройки' : result.scope} · ${result.changed ? 'Есть изменения' : 'Без изменений'}`));
      if (rag()) {
        const names = {documents:'Документы и Notes',sections:'Разделы',medium_chunks:'Средние чанки',micro_chunks:'Микрочанки',document_scopes:'Привязки областей',knowledge_links:'Ссылки Notebook',graph_edges:'Рёбра графа',rag_document_tombstones:'Метки удалённых источников'};
        const list = node('ul'); for (const key of Object.keys(result.before)) list.append(node('li', `${names[key]}: ${result.before[key]} → ${result.after[key]}`)); box.append(list);
        for (const [heading,items] of [['Заменяемые и удаляемые источники',result.documents],['Входящие источники',result.incomingDocuments],['Удаляемые или изменяемые ссылки Notebook',result.removedLinks],['Ссылки, требующие проверки',result.linkReviews]]) {
          const details = node('details'); details.append(node('summary', `${heading}: ${items.length}`),node('pre',JSON.stringify(items,null,2),'knowledge-text'));box.append(details);
        }
        box.append(node('p', `Очищаемые несовместимые векторы: ${result.vectorsCleared}.${result.vectorsCleared ? ' После импорта выполните переиндексацию в разделе «Модели».' : ''}`));
      }
      if (!result.changed) box.append(node('p', 'Изменений нет.'));
      for (const item of result.changes || []) {
        const details = node('details'); details.append(node('summary', item.label || item.ref),
          node('pre', `Сейчас:\n${typeof item.before === 'string' ? item.before : JSON.stringify(item.before)}\n\nПосле:\n${typeof item.after === 'string' ? item.after : JSON.stringify(item.after)}`, 'knowledge-text')); box.append(details);
      }
      box.append(node('p', `Проверено: ${new Date(result.observedAt).toLocaleString('ru')}`, 'caption'));
    } catch (problem) { if (current === sequence) error(problem); }
    finally { if (current === sequence) { busy(false); if(dialog.open) $('maintenanceReview').focus(); } }
  });
  $('maintenanceApply').addEventListener('click', async () => {
    if (pending || !preview?.changed) return;
    const request = { action: 'apply', ...input(), previewToken: preview.previewToken, confirm: true }; busy(true); error(null);
    try {
      const result = await api(endpoint(), request); reset();
      $('maintenanceResult').textContent = `${result.status === 'saved' ? 'Сохранено' : 'Без изменений'}. Резервная копия: ${result.backup || 'не нужна'}.${result.operationId ? ` ID операции: ${result.operationId}. Notebook сохранён; неиспользуемые blobs оставлены.` : ' Модели в процессах и файлы клиентов не синхронизированы.'}${result.reindexRequired ? ' Требуется переиндексация знаний.' : ''}`;
      await load();
      // A refresh failure cannot turn a committed mutation into an apparent failure.
      try { await onSaved(); } catch { error({ code: 'UNAVAILABLE', message: 'Изменения сохранены; обновить основной экран не удалось.' }); }
    } catch (problem) { reset(); error(problem); if (rag() && (!problem.status || problem.status >= 500)) $('maintenanceResult').textContent = 'Если ответ потерян, обновите состояние и проверьте последние завершённые операции перед повтором.'; }
    finally { busy(false); if (dialog.open) $('maintenanceReview').focus(); }
  });
  async function download(snapshotId) {
    const link=node('a');link.href=`/api/rag-maintenance/download?snapshotId=${encodeURIComponent(snapshotId)}`;link.download=`rag_${snapshotId}.json.gz`;
    document.body.append(link);link.click();link.remove();
  }
  $('maintenanceRagDownload').addEventListener('click',async()=>{busy(true);error(null);try{await download($('maintenanceRagSnapshot').value);}catch(problem){error(problem);}finally{busy(false);}});
  $('maintenanceRagFile').addEventListener('change',async()=>{
    const file=$('maintenanceRagFile').files[0];if(!file)return;sequence++;reset();error(null);busy(true);
    try {
      if(file.size>32*1024*1024)throw Object.assign(new Error('Файл превышает 32 МиБ.'),{code:'INVALID'});
      $('maintenanceResult').textContent='Проверяется файл снимка…';
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Не удалось прочитать файл.'));reader.readAsDataURL(file);});
      const result=await api('/api/rag-maintenance',{action:'stage',fileName:file.name,data});await load();$('maintenanceRagSnapshot').value=result.snapshotId;
      $('maintenanceResult').textContent=`Файл проверен: ${file.name}. Теперь проверьте изменения.`;$('maintenanceRagFile').removeAttribute('aria-invalid');
    }catch(problem){error(problem);$('maintenanceRagFile').setAttribute('aria-invalid','true');}
    finally{$('maintenanceRagFile').value='';busy(false);if(dialog.open)$('maintenanceReview').focus();}
  });
  for (const id of ['maintenanceOperation','maintenanceTarget','maintenanceBackup','maintenanceRagSnapshot','maintenanceRagMode']) $(id).addEventListener('change', () => { sequence++; reset(); error(null); $('maintenanceResult').textContent = ''; controls(); });
  $('maintenanceRefresh').addEventListener('click', load);
  $('maintenanceClose').addEventListener('click', () => { if (!pending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    sequence++; reset();
    if (!$('openMaintenance').getClientRects().length) $('navigation').focus();
  });
}
