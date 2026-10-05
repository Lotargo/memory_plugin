// Terminal adapter for the same scoped Notebook contract as the dashboard.
import { readNotebook, mutateNotebook } from '../services/notebook_service.js';
import { memoryFileName } from '../memory.js';
import { selectSimpleMenu, promptText, waitForEnter } from './ui.js';

const terminalUi = { selectSimpleMenu, promptText, waitForEnter,
  clear: () => console.clear(), log: message => console.log(message) };
const accepted = answer => /^(y|yes)$/i.test(answer.trim());
const back = answer => answer.action === 'back' || answer.value === 'back' || answer.value === 'cancel';
const label = record => record.title ? `**${record.title}** — ${record.body}` : record.body;
const badges = record => [record.meta?.keep === '1' && 'KEEP', record.kind === 'directive' && 'DIRECTIVE',
  ...(record.reasons || []).map(reason => reason.toUpperCase())].filter(Boolean);

function reportSaved(result, ui) {
  if (result.status === 'partial') {
    ui.log('\n  [PARTIAL] Notebook saved; client persona synchronization failed.');
    for (const target of result.persona.filter(target => target.status === 'failed')) {
      ui.log(`  - ${target.name || 'Persona'}: ${target.error || 'Synchronization failed; retry sync-persona.'}`);
    }
  } else ui.log('\n  [OK] Notebook change saved.');
  ui.log(`  ${result.contextNotice}\n`);
}

// UI injection exercises the actual menu adapter against an isolated engine,
// without replacing storage, link maintenance, confirmation or conflict rules.
export async function browseNotebookFacts(key, title, ui = terminalUi) {
  if (!key) {
    ui.log('\n  [UNAVAILABLE] Current directory has no Git project. Select global memory or a known store.\n');
    await ui.waitForEnter();
    return;
  }
  while (true) {
    let notebook;
    try { notebook = await readNotebook({ key }); }
    catch (error) {
      ui.log(`\n  [${error.code || 'ERROR'}] ${error.message}\n`);
      await ui.waitForEnter();
      return;
    }
    if (notebook.readOnly || !notebook.records.length) {
      ui.clear();
      ui.log(`\n  [*] Notebook [${key}]: ${notebook.readOnly ? 'knowledge-only scope; Notebook unavailable' : 'no saved facts'}.\n`);
      await ui.waitForEnter();
      return;
    }
    const selected = await ui.selectSimpleMenu({
      title: `NOTEBOOK FACTS [${title}]`, subtitle: `Store: ${key} | Total facts: ${notebook.records.length}`,
      items: [...notebook.records.map((record, index) => ({ label: `${index + 1}. ${label(record)}`,
        value: record.ref, badge: badges(record).join(' ') || undefined,
        info: `Manage ${record.ref} from ${memoryFileName(key)}; ${record.links?.length || 0} source link(s)` })),
      { label: '< Back', value: 'back' }],
    });
    if (back(selected)) return;
    const matches = notebook.records.filter(record => record.ref === selected.value);
    if (matches.length !== 1) {
      ui.log('\n  [CONFLICT] Record reference is missing or ambiguous. Reload and review the store.\n');
      await ui.waitForEnter();
      continue;
    }
    const record = matches[0], protectedRecord = record.meta?.keep === '1';
    const action = await ui.selectSimpleMenu({ title: 'FACT ACTION',
      subtitle: `Store: ${key} | ${record.ref} | ${label(record)} [${badges(record).join('] [')}]`,
      items: [
        ...(!record.invalid ? [
          { label: '[UPDATE] Edit fact title and body', value: 'update', info: 'Keep date, metadata and source identity' },
          { label: protectedRecord ? '[UNPROTECT] Remove keep protection' : '[PROTECT] Mark as important (keep)',
            value: protectedRecord ? 'unprotect' : 'protect', info: 'Change protection through the shared Notebook service' },
        ] : []),
        { label: '[DELETE] Delete this fact from store', value: 'delete', info: 'Review store, record and source links before confirming' },
        { label: '< Cancel / Back', value: 'cancel' },
      ],
    });
    if (back(action)) return;
    if (action.action !== 'select') continue;
    const request = { key, ref: record.ref, expectedVersion: notebook.version };
    try {
      if (action.value === 'update') {
        const title = await ui.promptText('New title (ENTER keeps the current title):');
        const body = await ui.promptText('New body (ENTER cancels the edit):');
        if (!body) continue;
        Object.assign(request, { action: 'update', fields: { body, ...(title ? { title } : {}) } });
      } else if (['protect', 'unprotect'].includes(action.value)) {
        Object.assign(request, { action: 'update', fields: { keep: action.value === 'protect' } });
      } else if (action.value === 'delete') {
        ui.log(`\n  Delete ${record.ref} from [${key}]: ${label(record)}`);
        ui.log(`  This removes the record and its ${record.links?.length || 0} source link(s); documents remain.\n`);
        if (!accepted(await ui.promptText('Confirm deletion of this record from this store? (y/N):'))) continue;
        if (protectedRecord && !accepted(await ui.promptText('This record has KEEP protection. Separately confirm protected deletion? (y/N):'))) continue;
        Object.assign(request, { action: 'delete', confirmDelete: true, confirmProtected: protectedRecord });
      } else continue;
      const result = await mutateNotebook(request);
      ui.clear();
      reportSaved(result, ui);
    } catch (error) {
      ui.log(`\n  [${error.code || 'ERROR'}] ${error.message}`);
      ui.log('  Reload and review the current record and its links before trying again.\n');
    }
    await ui.waitForEnter();
  }
}
