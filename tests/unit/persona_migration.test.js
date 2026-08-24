import assert from "node:assert";
import { factMeta } from "../../mcp-server/fact_format.js";
import {
  markLegacyPersonaDirectives,
  migrateLegacyPersonaDirectives,
} from "../../mcp-server/persona_migration.js";

const legacyPersona = "- [2026-08-22 10:00] **Tone** — Use concise Russian <!-- id:tone1, tags:persona,tone -->";
const legacyInject = "- [2026-08-22 10:01] **Style** — Be direct <!-- id:style1, inject:1 -->";
const explicitDirective = "- [2026-08-22 10:02] **Behavior** — Ask useful questions <!-- id:behavior1, kind:directive -->";
const explicitFact = "- [2026-08-22 10:03] **History** — Former style <!-- id:history1, tags:persona, kind:fact -->";
const ordinaryFact = "- [2026-08-22 10:04] **Stack** — Use Node.js <!-- id:stack1, tags:arch -->";

export async function runPersonaMigrationTests() {
  console.log("--- Running Unit Tests: persona_migration ---");

  const first = markLegacyPersonaDirectives([
    legacyPersona,
    legacyInject,
    explicitDirective,
    explicitFact,
    ordinaryFact,
  ]);
  assert.strictEqual(first.changed, 2);
  assert.deepStrictEqual(first.migrated.map((item) => item.id), ["tone1", "style1"]);
  assert.strictEqual(factMeta(first.entries[0]).kind, "directive");
  assert.strictEqual(factMeta(first.entries[1]).kind, "directive");
  assert.strictEqual(first.entries[2], explicitDirective);
  assert.strictEqual(first.entries[3], explicitFact, "explicit kind:fact must remain authoritative");
  assert.strictEqual(first.entries[4], ordinaryFact);

  const second = markLegacyPersonaDirectives(first.entries);
  assert.strictEqual(second.changed, 0, "migration must be idempotent");
  assert.deepStrictEqual(second.entries, first.entries);

  let writes = 0;
  let syncs = 0;
  const dryRun = await migrateLegacyPersonaDirectives({
    dryRun: true,
    readGlobal: async () => [legacyPersona],
    writeGlobal: async () => { writes += 1; },
    syncPersona: async () => { syncs += 1; },
  });
  assert.strictEqual(dryRun.changed, 1);
  assert.strictEqual(writes, 0, "dry run must not write memory");
  assert.strictEqual(syncs, 0, "dry run must not rewrite client prompts");

  let stored = [legacyPersona];
  const applied = await migrateLegacyPersonaDirectives({
    readGlobal: async () => stored,
    writeGlobal: async (entries) => { writes += 1; stored = entries; },
    syncPersona: async () => { syncs += 1; },
  });
  assert.strictEqual(applied.changed, 1);
  assert.strictEqual(writes, 1);
  assert.strictEqual(syncs, 1);
  assert.strictEqual(factMeta(stored[0]).kind, "directive");

  await migrateLegacyPersonaDirectives({
    readGlobal: async () => stored,
    writeGlobal: async () => { writes += 1; },
    syncPersona: async () => { syncs += 1; },
  });
  assert.strictEqual(writes, 1, "an idempotent rerun must not rewrite the Notebook");
  assert.strictEqual(syncs, 2, "an explicit apply should still refresh managed prompts");

  console.log("✅ ALL PERSONA MIGRATION TESTS PASSED!");
}

if (process.argv[1] && process.argv[1].endsWith("persona_migration.test.js")) {
  runPersonaMigrationTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
