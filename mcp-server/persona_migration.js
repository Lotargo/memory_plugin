import { factMeta, factTitle, isDirectiveFact, withMeta } from "./fact_format.js";
import { GLOBAL_KEY, readMemory, writeMemory } from "./memory.js";
import { syncPersonaPrompts } from "./prompt_manager.js";

// Convert compatibility-only persona detection into explicit semantic metadata.
// Explicit kind values are authoritative and are therefore never changed.
export function markLegacyPersonaDirectives(entries) {
  const migrated = [];
  const nextEntries = entries.map((entry) => {
    const meta = factMeta(entry);
    if (meta.kind || !isDirectiveFact(entry)) return entry;

    migrated.push({
      id: meta.id || null,
      title: factTitle(entry) || "Untitled directive",
    });
    return withMeta(entry, { kind: "directive" });
  });

  return {
    entries: nextEntries,
    migrated,
    changed: migrated.length,
  };
}

export async function migrateLegacyPersonaDirectives({
  dryRun = false,
  readGlobal = () => readMemory(GLOBAL_KEY),
  writeGlobal = (entries) => writeMemory(GLOBAL_KEY, entries),
  syncPersona = () => syncPersonaPrompts(),
} = {}) {
  const result = markLegacyPersonaDirectives(await readGlobal());
  if (!dryRun) {
    if (result.changed > 0) await writeGlobal(result.entries);
    await syncPersona();
  }
  return { ...result, dryRun };
}
