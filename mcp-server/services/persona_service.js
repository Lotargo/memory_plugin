// Read-only preview. Builders are shared with the actual client adapters.
import { readMemory, notebookVersion, MEMORY_DIR, GLOBAL_KEY } from '../memory.js';
import { factMeta, factTitle, factBody, isDirectiveFact, isExpiredLine, isSuperseded, isDisabledFact } from '../fact_format.js';
import { buildPersonaOverlayBlock, activePersonaDirectives } from '../prompt_manager.js';
import { buildMemoryContext, buildOpenCodeV2MemoryContext, buildSystemMemoryOverlay, partitionMemoryEntries } from '../context/opencode_context.js';
import { readNotebook, listNotebookTargets, serviceError } from './notebook_service.js';
import { withSnapshotLock } from '../storage/snapshot_lock.js';
import { compilePersona, renderClaudePersona } from '../context/persona_context.js';
import { isNativePersonaEnabled } from './persona_delivery_service.js';

export const PERSONA_CLIENTS = [
  { id: 'opencode', name: 'OpenCode', builder: 'native' },
  { id: 'codex', name: 'Codex', builder: 'managed-global' },
  { id: 'claude', name: 'Claude Code', builder: 'managed-global' },
  { id: 'gemini', name: 'Gemini CLI', builder: 'managed-global' },
  { id: 'antigravity', name: 'Antigravity', builder: 'managed-global' },
];

export async function previewPersonaContext({ key, client = 'opencode' } = {}) {
  const selectedClient = PERSONA_CLIENTS.find(item => item.id === client);
  if (!selectedClient) throw serviceError('INVALID', 'Select a supported persona client.');
  return withSnapshotLock(MEMORY_DIR, async () => {
    // Require the exact target through the existing contract before any read.
    const selected = await readNotebook({ key });
    const global = key === GLOBAL_KEY ? selected : await readNotebook({ key: GLOBAL_KEY });
    const now = Date.now(), directives = [], unavailable = [];
    const stores = new Map();
    for (const target of await listNotebookTargets()) {
      if (target.unavailable) { unavailable.push({ key: target.key, name: target.name, code: 'UNSUPPORTED' }); continue; }
      try {
        const lines = target.notebookAvailable === false ? [] : await readMemory(target.key);
        stores.set(target.key, lines);
        const partition = selectedClient.builder === 'native' ? partitionMemoryEntries(lines, now) : null;
        const active = new Set(partition ? partition.directives : activePersonaDirectives(lines, now));
        const facts = new Set(partition?.facts || []);
        const inScope = target.key === GLOBAL_KEY || target.key === key;
        const clientScope = selectedClient.builder === 'native' || target.key === GLOBAL_KEY;
        for (const [index, line] of lines.entries()) {
          if (!isDirectiveFact(line)) continue;
          const meta = factMeta(line), included = inScope && clientScope && active.has(line);
          const reasons = [!inScope && 'other_scope', inScope && !clientScope && 'client_scope',
            isExpiredLine(line, now) && 'expired', isSuperseded(line) && 'superseded', isDisabledFact(line) && 'disabled'].filter(Boolean);
          directives.push({ key: target.key, scopeName: target.name, ref: meta.id ? `id:${meta.id}` : `legacy:${index}`,
            fingerprint: notebookVersion([line]),
            id: meta.id || null, title: factTitle(line), body: factBody(line), included, reasons,
            contextRole: included ? 'directive' : inScope && clientScope && facts.has(line) ? 'fact' : 'excluded',
            legacy: meta.kind !== 'directive', protected: meta.keep === '1' });
        }
      } catch (error) {
        // Never turn an unavailable selected scope into an empty successful preview.
        if (target.key === key || target.key === GLOBAL_KEY) throw error;
        unavailable.push({ key: target.key, name: target.name, code: error.code || 'UNAVAILABLE' });
      }
    }
    const globalLines = stores.get(GLOBAL_KEY) || [], projectLines = key === GLOBAL_KEY ? [] : stores.get(key) || [];
    const native = selectedClient.builder === 'native';
    const field = compilePersona(globalLines, now);
    return { client: selectedClient, clients: PERSONA_CLIENTS, target: selected.target,
      persona: field.persona, personaSourceIds: field.sourceIds,
      projectPersona: compilePersona(projectLines, now).persona,
      nativeDeliveryEnabled: isNativePersonaEnabled(selectedClient.id),
      adapter: { mode: selectedClient.id === 'claude' ? 'output-style-or-global-instructions'
        : native ? 'native-context' : selectedClient.id === 'codex' ? 'global-instructions' : 'shared-global-instructions',
        text: selectedClient.id === 'claude' ? renderClaudePersona(field.persona) : buildPersonaOverlayBlock(globalLines, now) },
      versions: { global: global.version, selected: selected.version }, observedAt: new Date(now).toISOString(),
      directives, unavailable,
      // Preserve the original generic preview fields for existing adapters.
      global: buildPersonaOverlayBlock(globalLines, now), project: buildPersonaOverlayBlock(projectLines, now),
      blocks: native ? [
        { id: 'system', label: 'Системные инструкции (OpenCode V1/V2)', text: buildSystemMemoryOverlay(globalLines, projectLines, key, now) },
        { id: 'memory', label: 'Память сессии (базовая OpenCode V1)', text: buildMemoryContext(globalLines, projectLines, key, null, now) },
        { id: 'memory-v2', label: 'Память сессии (OpenCode V1/V2 из пакета)', text: buildOpenCodeV2MemoryContext(globalLines, projectLines, key, now) },
      ] : [{ id: 'managed', label: 'Global persona overlay', text: buildPersonaOverlayBlock(globalLines, now) }],
      injection: { limit: null, scopeKeys: !native || key === GLOBAL_KEY ? [GLOBAL_KEY] : [GLOBAL_KEY, key] },
      coverage: native ? 'native-builders' : 'partial-managed-template',
      partial: !native || unavailable.length > 0,
      // This is proposed context, never proof of an active session or agent usage.
      activeSession: 'not-observed', agentUsage: 'not-observed' };
  });
}
