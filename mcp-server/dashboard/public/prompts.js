import { dateText, formatText, serviceText, setText, t } from './i18n.js';
const $ = id => document.getElementById(id);
const ownership = { 'unchanged-owned': t('m596'), 'externally-edited': t('m597'), untracked: t('m598') };

export function createPromptAdmin({ api, node, openDialog }) {
  const dialog = $('promptsDialog');
  let status = null, preview = null, sequence = 0, pending = false;
  function reset() { preview = null; $('promptsPreviewContent').replaceChildren(); $('promptsApply').disabled = true; }
  function error(problem) {
    $('promptsError').hidden = !problem;
    setText($('promptsError'), !problem ? '' : problem.code === 'CONFLICT'
      ? t('m599')
      : problem.code === 'RECOVERY_REQUIRED' ? t('m600')
      : t('m601', problem.code || t('m205'), serviceText(problem.message)));
  }
  function busy(value) {
    pending = value; dialog.setAttribute('aria-busy', String(value)); $('promptsLoading').hidden = !value;
    for (const id of ['promptsClient', 'promptsOperation', 'promptsRefresh', 'promptsReview', 'promptsClose']) $(id).disabled = value;
    $('promptsApply').disabled = value || !preview?.canApply || !preview.changed;
  }
  function renderStatus() {
    const box = $('promptsStatus'); box.replaceChildren();
    if (!status) return;
    box.append(node('p', t('m602', dateText(new Date(status.observedAt), 'toLocaleString')), 'caption'));
    box.append(node('p', t('m603'), 'caption'));
    if (status.recoveryRequired) box.append(node('p', t('m604'), 'inline-error'));
    const list = node('ul', null, 'prompt-status-list');
    for (const item of status.items) {
      const li = node('li'); li.append(node('strong', item.name), node('p', item.filePath, 'caption prompt-path'));
      li.append(node('p', item.unavailable ? t('m605', item.code)
        : formatText`${item.exists ? t('m606') : t('m607')} · prompt: ${item.prompt ? t('m608') : t('m609')} · persona: ${item.persona ? t('m608') : t('m609')}`));
      if (!item.unavailable) li.append(node('p', item.integration.pluginManaged ? t('m610')
        : formatText`${ownership[item.ownership]}. ${item.integration.conflict ? t('m611') : ''}`, 'caption'));
      list.append(li);
    }
    const selected = status.items.find(item => item.id === $('promptsClient').value);
    if (selected) {
      const card = node('div', null, 'prompt-selected-status');
      card.append(node('strong', selected.name), node('p', selected.filePath, 'caption prompt-path'));
      card.append(node('p', selected.unavailable ? t('m605', selected.code) : formatText`${selected.exists ? t('m606') : t('m607')} · prompt: ${selected.prompt ? t('m608') : t('m609')} · persona: ${selected.persona ? t('m608') : t('m609')}`));
      if (!selected.unavailable) card.append(node('p', selected.integration.pluginManaged ? t('m612') : ownership[selected.ownership], 'caption'));
      box.append(card);
    }
    const all = node('details'); all.append(node('summary', t('m613')), list); box.append(all);
  }
  async function load() {
    const current = ++sequence; reset(); error(null); setText($('promptsResult'), ''); busy(true);
    try {
      const result = await api('/api/prompts');
      if (current !== sequence || !dialog.open) return;
      status = result; renderStatus();
    } catch (problem) { if (current === sequence) error(problem); }
    finally { if (current === sequence) busy(false); }
  }
  function fileDetails(label, text) {
    const details = node('details'); details.append(node('summary', label), node('pre', text || t('m614'), 'knowledge-text')); return details;
  }
  $('promptsReview').addEventListener('click', async () => {
    const current = ++sequence; reset(); error(null); setText($('promptsResult'), ''); busy(true);
    try {
      const result = await api('/api/prompts', { action: 'preview', client: $('promptsClient').value, operation: $('promptsOperation').value });
      if (current !== sequence || !dialog.open) return;
      preview = result;
      const box = $('promptsPreviewContent');
      box.append(node('h3', formatText`${result.target.name} · ${result.target.filePath}`), node('p', ownership[result.ownership], 'caption'));
      if (!result.canApply) box.append(node('p', t('m615'), 'inline-error'));
      else box.append(node('p', result.proposed.removeFile ? t('m616')
        : result.changed ? t('m617') : t('m469')));
      box.append(node('p', t('m618'), 'caption'));
      box.append(fileDetails(t('m619', result.current.hash || t('m170')), result.current.text));
      box.append(fileDetails(result.proposed.exists ? t('m620') : t('m621'), result.proposed.text));
      box.append(fileDetails(t('m622'), result.operation === 'enable' ? result.prompt.expectedBlock : t('m623')));
      box.append(fileDetails(t('m624'), result.operation === 'disable' ? t('m625') : result.persona.expectedBlock));
      if (result.target.includeSupported) {
        box.append(node('p', t('m626', result.sharedPrompt.path, result.sharedPrompt.changes
          ? t('m627') : !result.canApply ? t('m628')
            : result.sharedPrompt.exists ? t('m629') : t('m630')), 'caption prompt-path'));
        box.append(fileDetails(t('m631'), result.sharedPrompt.text));
        if (result.sharedPrompt.changes) box.append(fileDetails(t('m632'), result.sharedPrompt.proposedText));
      }
    } catch (problem) { if (current === sequence) error(problem); }
    finally { if (current === sequence) busy(false); }
  });
  $('promptsApply').addEventListener('click', async () => {
    if (pending || !preview?.canApply || !preview.changed) return;
    const input = { action: 'apply', client: preview.target.id, operation: preview.operation, previewToken: preview.previewToken, confirm: true };
    busy(true); error(null);
    try {
      const result = await api('/api/prompts', input); reset();
      setText($('promptsResult'), t('m633', result.name, result.status, result.backup ? t('m634', result.backup) : ''));
      status = await api('/api/prompts'); renderStatus();
    } catch (problem) { reset(); error(problem); }
    finally { busy(false); }
  });
  for (const id of ['promptsClient', 'promptsOperation']) $(id).addEventListener('change', () => { sequence++; reset(); renderStatus(); error(null); setText($('promptsResult'), ''); });
  $('promptsRefresh').addEventListener('click', load);
  $('promptsClose').addEventListener('click', () => { if (!pending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => { sequence++; reset(); });
  return { open() { openDialog('promptsDialog'); void load(); } };
}
