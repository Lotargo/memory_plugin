import { dateText, formatText, scopeText, serviceText, setText, t } from './i18n.js';
const $ = id => document.getElementById(id);
export function createMaintenance({ api, node, openDialog, allowDiscard, closeNavigation, scopeKey, onSaved }) {
  const dialog = $('maintenanceDialog');
  let status = null, ragStatus = null, preview = null, pending = false, sequence = 0;
  const rag = () => $('maintenanceOperation').value.startsWith('rag-');
  const endpoint = () => rag() ? '/api/rag-maintenance' : '/api/maintenance';
  function reset() { preview = null; $('maintenancePreview').replaceChildren(); $('maintenanceApply').disabled = true; }
  function error(problem) {
    $('maintenanceError').hidden = !problem;
    setText($('maintenanceError'), !problem ? '' : problem.code === 'CONFLICT'
      ? t('m441')
      : formatText`${problem.code || t('m205')}: ${serviceText(problem.message)}`);
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
    setText($('maintenanceHint'), rag()
      ? t('m442')
      : operation.startsWith('migrate-')
      ? t('m443')
      : t('m444'));
    if (rag() && ragStatus?.migrationRequired) setText($('maintenanceHint'), t('m445'));
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
    setText($('maintenanceReview'), request.operation === 'export' ? t('m446') : t('m447'));
  }
  async function load() {
    const current = ++sequence; reset(); error(null); busy(true);
    try {
      const results = await Promise.allSettled([api('/api/maintenance'), api('/api/rag-maintenance')]); if (current !== sequence || !dialog.open) return;
      if (results[1].status === 'fulfilled') {
        ragStatus = results[1].value; const selected = $('maintenanceRagSnapshot').value;
        $('maintenanceRagSnapshot').replaceChildren(...ragStatus.snapshots.filter(item => !item.unavailable).map(item => {
          const option = node('option', formatText`${item.fileName} · ${dateText(new Date(item.observedAt), 'toLocaleString')} · ${item.id}`); option.value = item.id; return option;
        }));
        if (ragStatus.snapshots.some(item => item.id === selected && !item.unavailable)) $('maintenanceRagSnapshot').value = selected;
        $('maintenanceRagReceipts').hidden = !ragStatus.receipts.length;
        $('maintenanceRagReceiptList').replaceChildren(...ragStatus.receipts.map(item => node('li', formatText`${item.operation} · ${dateText(new Date(item.observedAt), 'toLocaleString')} · ${item.operationId} · ZIP: ${item.backup}`)));
        if (ragStatus.snapshots.some(item => item.unavailable)) error({code:'RECOVERY_REQUIRED',message:t('m448')});
      } else { ragStatus = null; error(results[1].reason); }
      if (results[0].status !== 'fulfilled') { status = null; error(results[0].reason); controls(); return; }
      const result = results[0].value;
      status = result; const target = $('maintenanceTarget').value || scopeKey();
      $('maintenanceTarget').replaceChildren(...result.targets.filter(item => !item.unavailable && item.notebookAvailable !== false).map(item => {
        const option = node('option', formatText`${scopeText(item)} · ${item.key}`); option.value = item.key; return option;
      }));
      if (result.targets.some(item => item.key === target && !item.unavailable)) $('maintenanceTarget').value = target;
      $('maintenanceBackup').replaceChildren(...result.backups.filter(item => !item.unavailable).map(item => {
        const option = node('option', formatText`${dateText(new Date(item.observedAt), 'toLocaleString')} · ${item.id}`); option.value = item.id; return option;
      }));
      if (result.unavailable) error({ code: result.unavailable, message: t('m449') });
      if (result.backups.some(item => item.unavailable)) error({ code: 'RECOVERY_REQUIRED', message: t('m450') });
      controls();
    } catch (problem) { if (current === sequence) { status = null; error(problem); } }
    finally { if (current === sequence) busy(false); }
  }
  $('openMaintenance').addEventListener('click', async () => {
    if (!(await allowDiscard())) return; closeNavigation(); openDialog('maintenanceDialog'); setText($('maintenanceResult'), ''); await load();
    if (dialog.open && !pending) $('maintenanceOperation').focus();
  });
  $('maintenanceReview').addEventListener('click', async () => {
    const current = ++sequence; reset(); error(null); setText($('maintenanceResult'), ''); busy(true);
    try {
      if (input().operation === 'export') {
        const result = await api(endpoint(), {action:'export'}); await download(result.snapshotId);
        setText($('maintenanceResult'), t('m451', result.outputPath, result.snapshotId));
        await load(); return;
      }
      const result = await api(endpoint(), { action: 'preview', ...input() });
      if (current !== sequence || !dialog.open) return; preview = result;
      const box = $('maintenancePreview'); box.append(node('h3', formatText`${rag() ? t('m452') : result.scope === 'configuration' ? t('m453') : input().key === 'global' ? t('m31') : result.scope} · ${result.changed ? t('m454') : t('m80')}`));
      if (rag()) {
        const names = {documents:t('m455'),sections:t('m456'),medium_chunks:t('m457'),micro_chunks:t('m458'),document_scopes:t('m459'),knowledge_links:t('m460'),graph_edges:t('m461'),rag_document_tombstones:t('m462')};
        const list = node('ul'); for (const key of Object.keys(result.before)) list.append(node('li', formatText`${names[key]}: ${result.before[key]} → ${result.after[key]}`)); box.append(list);
        for (const [heading,items] of [[t('m463'),result.documents],[t('m464'),result.incomingDocuments],[t('m465'),result.removedLinks],[t('m466'),result.linkReviews]]) {
          const details = node('details'); details.append(node('summary', formatText`${heading}: ${items.length}`),node('pre',JSON.stringify(items,null,2),'knowledge-text'));box.append(details);
        }
        box.append(node('p', t('m467', result.vectorsCleared, result.vectorsCleared ? t('m468') : '')));
      }
      if (!result.changed) box.append(node('p', t('m469')));
      for (const item of result.changes || []) {
        const details = node('details'); details.append(node('summary', result.scope === 'configuration' ? serviceText(item.label) : item.label || item.ref),
          node('pre', t('m470', typeof item.before === 'string' ? item.before : JSON.stringify(item.before), typeof item.after === 'string' ? item.after : JSON.stringify(item.after)), 'knowledge-text')); box.append(details);
      }
      box.append(node('p', t('m471', dateText(new Date(result.observedAt), 'toLocaleString')), 'caption'));
    } catch (problem) { if (current === sequence) error(problem); }
    finally { if (current === sequence) { busy(false); if(dialog.open) $('maintenanceReview').focus(); } }
  });
  $('maintenanceApply').addEventListener('click', async () => {
    if (pending || !preview?.changed) return;
    const request = { action: 'apply', ...input(), previewToken: preview.previewToken, confirm: true }; busy(true); error(null);
    try {
      const result = await api(endpoint(), request); reset();
      setText($('maintenanceResult'), t('m472', result.status === 'saved' ? t('m342') : t('m80'), result.backup || t('m234'), result.operationId ? t('m473', result.operationId) : t('m474'), result.reindexRequired ? t('m475') : ''));
      await load();
      // A refresh failure cannot turn a committed mutation into an apparent failure.
      try { await onSaved(); } catch { error({ code: 'UNAVAILABLE', message: t('m476') }); }
    } catch (problem) { reset(); error(problem); if (rag() && (!problem.status || problem.status >= 500)) setText($('maintenanceResult'), t('m477')); }
    finally { busy(false); if (dialog.open) $('maintenanceReview').focus(); }
  });
  async function download(snapshotId) {
    const link=node('a');link.href=formatText`/api/rag-maintenance/download?snapshotId=${encodeURIComponent(snapshotId)}`;link.download=formatText`rag_${snapshotId}.json.gz`;
    document.body.append(link);link.click();link.remove();
  }
  $('maintenanceRagDownload').addEventListener('click',async()=>{busy(true);error(null);try{await download($('maintenanceRagSnapshot').value);}catch(problem){error(problem);}finally{busy(false);}});
  $('maintenanceRagFile').addEventListener('change',async()=>{
    const file=$('maintenanceRagFile').files[0];if(!file)return;sequence++;reset();error(null);busy(true);
    try {
      if(file.size>32*1024*1024)throw Object.assign(new Error(t('m478')),{code:'INVALID'});
      setText($('maintenanceResult'), t('m479'));
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error(t('m480')));reader.readAsDataURL(file);});
      const result=await api('/api/rag-maintenance',{action:'stage',fileName:file.name,data});await load();$('maintenanceRagSnapshot').value=result.snapshotId;
      setText($('maintenanceResult'), t('m481', file.name));$('maintenanceRagFile').removeAttribute('aria-invalid');
    }catch(problem){error(problem);$('maintenanceRagFile').setAttribute('aria-invalid','true');}
    finally{$('maintenanceRagFile').value='';busy(false);if(dialog.open)$('maintenanceReview').focus();}
  });
  for (const id of ['maintenanceOperation','maintenanceTarget','maintenanceBackup','maintenanceRagSnapshot','maintenanceRagMode']) $(id).addEventListener('change', () => { sequence++; reset(); error(null); setText($('maintenanceResult'), ''); controls(); });
  $('maintenanceRefresh').addEventListener('click', load);
  $('maintenanceClose').addEventListener('click', () => { if (!pending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    sequence++; reset();
    if (!$('openMaintenance').getClientRects().length) $('navigation').focus();
  });
}
