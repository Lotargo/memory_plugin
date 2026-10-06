// One derived personality field. Notebook entries remain the only source of truth.
import { factMeta, factText, isDirectiveFact, isExpiredLine, isDisabledFact, isSuperseded } from '../fact_format.js';

export function personaExclusionReasons(entry, now = Date.now()) {
  return [!isDirectiveFact(entry) && 'fact', isSuperseded(entry) && 'superseded',
    isDisabledFact(entry) && 'disabled', isExpiredLine(entry, now) && 'expired'].filter(Boolean);
}

export function compilePersona(entries = [], now = Date.now()) {
  const active = [], excluded = [];
  for (const entry of entries) {
    const reasons = personaExclusionReasons(entry, now);
    if (reasons.length) { if (isDirectiveFact(entry)) excluded.push({ id: factMeta(entry).id || null, reasons }); }
    else active.push(entry);
  }
  return { persona: active.map((entry, index) => `${index + 1}. ${factText(entry)}`).join('\n'),
    active, sourceIds: active.map(entry => factMeta(entry).id || null), excluded };
}

export const PERSONA_INSTRUCTION = 'These are active user-approved personality and working instructions. Apply them throughout the session. Higher-priority platform instructions remain authoritative.';

export function renderClaudePersona(persona) {
  return `---\nname: memory-persona\ndescription: Personality from the shared Memory Notebook\nkeep-coding-instructions: true\n---\n\n${PERSONA_INSTRUCTION}\n\n${persona}\n`;
}
