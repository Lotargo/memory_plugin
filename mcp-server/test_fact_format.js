import assert from "node:assert";
import {
  parseFactEntry,
  factText,
  factMeta,
  formatFactEntry,
  withMeta,
  nextFactId,
  ttlMs,
  isExpiredLine,
  isKeepFact,
  isSuperseded,
  matchesQuery,
  matchesTags,
  inDateRange,
  metaBadges,
  displayFact,
} from "./fact_format.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
};

const PLAIN = "- [2026-08-01 12:03] user prefers TypeScript";
const META = "- [2026-08-02 06:08] engine uses zod v4 <!-- id:8f3a2c, ttl:90d, keep:1, supersedes:a1b2c3, tags:pref,arch -->";

// --- parseFactEntry / factText / factMeta ---
{
  const p = parseFactEntry(PLAIN);
  assert.equal(p.date, "2026-08-01");
  assert.equal(p.time, "12:03");
  assert.equal(p.text, "user prefers TypeScript");
  assert.deepEqual(p.meta, {});
  assert.equal(parseFactEntry("not a fact"), null);
  ok("parseFactEntry: plain entry + non-entry null");

  const pm = parseFactEntry(META);
  assert.equal(pm.text, "engine uses zod v4");
  assert.deepEqual(pm.meta, { id: "8f3a2c", ttl: "90d", keep: "1", supersedes: "a1b2c3", tags: "pref,arch" });
  assert.equal(factText(META), "engine uses zod v4");
  assert.equal(factText(PLAIN), "user prefers TypeScript");
  assert.equal(factText("garbage line"), "garbage line");
  assert.equal(factMeta(PLAIN).keep, undefined);
  assert.equal(factMeta(META).keep, "1");
  ok("parseFactEntry: meta comment parsed, text stripped; factText/ factMeta fallbacks");

  const unknown = "- [2026-08-02 06:08] text <!-- unknown:x, keep:1 -->";
  assert.equal(factText(unknown), "text");
  assert.deepEqual(factMeta(unknown), { keep: "1" });
  ok("unknown meta keys ignored, known keys kept");
}

// --- formatFactEntry round-trip ---
{
  const line = formatFactEntry({ date: "2026-08-02", time: "06:08", text: "engine uses zod v4", meta: { id: "8f3a2c", ttl: "90d", keep: "1", supersedes: "a1b2c3", tags: "pref,arch" } });
  assert.equal(line, META);
  assert.equal(formatFactEntry({ date: "2026-08-01", time: "12:03", text: "user prefers TypeScript" }), PLAIN);
  assert.deepEqual(parseFactEntry(formatFactEntry(parseFactEntry(META))).meta, parseFactEntry(META).meta);
  ok("formatFactEntry round-trips (meta + plain)");

  const noKeep = formatFactEntry({ date: "2026-08-02", time: "06:08", text: "x", meta: { keep: "", tags: "a" } });
  assert.equal(noKeep, "- [2026-08-02 06:08] x <!-- tags:a -->");
  ok("falsy meta values omitted");
}

// --- withMeta ---
{
  assert.equal(withMeta(PLAIN, { keep: "1" }), "- [2026-08-01 12:03] user prefers TypeScript <!-- keep:1 -->");
  assert.equal(withMeta(META, { keep: null }), "- [2026-08-02 06:08] engine uses zod v4 <!-- id:8f3a2c, ttl:90d, supersedes:a1b2c3, tags:pref,arch -->");
  assert.equal(withMeta("garbage", { keep: "1" }), "garbage");
  ok("withMeta adds / removes keys, non-fact unchanged");
}

// --- nextFactId ---
{
  const ids = new Set();
  for (let i = 0; i < 500; i++) ids.add(nextFactId([]));
  assert.equal(ids.size, 500);
  const first = nextFactId([META]);
  assert.notEqual(first, "8f3a2c");
  ok("nextFactId unique over 500 draws and avoids existing ids");
}

// --- ttlMs ---
{
  assert.equal(ttlMs("90d"), 90 * 86400e3);
  assert.equal(ttlMs("2w"), 2 * 7 * 86400e3);
  assert.equal(ttlMs("24h"), 24 * 3600e3);
  assert.equal(ttlMs("1m"), 30 * 86400e3);
  assert.equal(ttlMs("7"), 7 * 86400e3);
  assert.equal(ttlMs(""), null);
  assert.equal(ttlMs("abc"), null);
  assert.equal(ttlMs(null), null);
  ok("ttlMs units h/d/w/m + bare number + invalid");
}

// --- isExpiredLine ---
{
  const now = Date.parse("2026-08-02T06:08:00Z");
  assert.equal(isExpiredLine("- [2026-01-01 00:00] old <!-- ttl:30d -->", now), true);
  assert.equal(isExpiredLine("- [2026-07-20 00:00] recent <!-- ttl:7d -->", now), true);
  assert.equal(isExpiredLine("- [2026-07-20 00:00] within <!-- ttl:30d -->", now), false);
  assert.equal(isExpiredLine("- [2026-07-15 00:00] within <!-- ttl:90d -->", now), false);
  assert.equal(isExpiredLine(PLAIN, now), false);
  assert.equal(isExpiredLine("- [2026-07-01 00:00] bad ttl <!-- ttl:xyz -->", now), false);
  ok("isExpiredLine respects ttl + now, ignores missing/invalid ttl");
}

// --- isKeepFact / isSuperseded ---
{
  assert.equal(isKeepFact(META), true);
  assert.equal(isKeepFact(PLAIN), false);
  assert.equal(isSuperseded(META), false);
  assert.equal(isSuperseded("- [2026-08-02 06:08] old <!-- supersededBy:9f31bd -->"), true);
  ok("isKeepFact / isSuperseded");
}

// --- matchesQuery ---
{
  assert.equal(matchesQuery(META, "zod"), true);
  assert.equal(matchesQuery(META, "ZOD v4"), true);
  assert.equal(matchesQuery(META, "zod engine"), true);
  assert.equal(matchesQuery(META, "zod missing"), false);
  assert.equal(matchesQuery(META, "8f3a2c"), true);
  assert.equal(matchesQuery(META, "pref"), true);
  assert.equal(matchesQuery(META, "2026-08-02"), true);
  assert.equal(matchesQuery(META, ""), true);
  assert.equal(matchesQuery("garbage", "x"), false);
  ok("matchesQuery: all-terms, case-insensitive, id/tags/date haystack, empty=all");
}

// --- matchesTags ---
{
  assert.equal(matchesTags(META, "pref"), true);
  assert.equal(matchesTags(META, "PREF"), true);
  assert.equal(matchesTags(META, "arch"), true);
  assert.equal(matchesTags(META, "pref,arch"), true);
  assert.equal(matchesTags(META, "pref,missing"), true);
  assert.equal(matchesTags(META, "missing"), false);
  assert.equal(matchesTags(META, "arc"), true);
  assert.equal(matchesTags(META, ""), true);
  assert.equal(matchesTags(PLAIN, "pref"), false);
  ok("matchesTags: ANY match, case-insensitive, substring both directions");
}

// --- inDateRange ---
{
  assert.equal(inDateRange(META, "2026-08-01", "2026-08-03"), true);
  assert.equal(inDateRange(META, "2026-08-02", "2026-08-02"), true);
  assert.equal(inDateRange(META, "2026-08-03", undefined), false);
  assert.equal(inDateRange(META, undefined, "2026-08-01"), false);
  assert.equal(inDateRange(META, undefined, undefined), true);
  assert.equal(inDateRange("garbage", undefined, undefined), false);
  ok("inDateRange inclusive since/until");
}

// --- metaBadges / displayFact ---
{
  const now = Date.parse("2026-08-02T06:08:00Z");
  assert.deepEqual(metaBadges(META, now), ["KEEP"]);
  assert.deepEqual(metaBadges("- [2026-01-01 00:00] x <!-- ttl:30d -->", now), ["EXPIRED"]);
  assert.deepEqual(metaBadges("- [2026-01-01 00:00] x <!-- ttl:30d, supersededBy:9f31bd -->", now), ["EXPIRED", "SUPERSEDED"]);
  assert.deepEqual(metaBadges(PLAIN, now), []);
  assert.equal(displayFact(PLAIN, now), "user prefers TypeScript");
  assert.equal(displayFact(META, now), "engine uses zod v4  [KEEP]");
  ok("metaBadges ordering + displayFact text+badges");

  // superseded facts are filtered out of <MEMORY> context in buildMemoryContext;
  // here we only assert the raw predicate
  assert.equal(isSuperseded("- [2026-08-01 00:00] old <!-- supersededBy:x -->"), true);
}

console.log(`\n  ${passed} fact_format assertions passed.`);
