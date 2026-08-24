// Shared fact-line format + metadata parsing for the Notebook Layer 1 store.
//
// A fact line looks like:
//   - [2026-08-02 06:08] text here <!-- id:8f3a2c, ttl:90d, keep:1, supersedes:a1b2c3, tags:pref,arch -->
// The trailing HTML comment carries optional metadata. It is invisible in
// Markdown, so the store stays a single plain Markdown file. Older lines
// without a comment parse to empty metadata and stay fully compatible.
//
// Metadata keys:
//   id           short random id (e.g. "8f3a2c")
//   ttl          time-to-live, e.g. "90d", "2w", "24h", "12m" (m=month ~30d)
//   keep         "1" = protected fact: forget refuses to delete without force
//   supersedes   id (or number/text) this fact replaces
//   supersededBy id of the fact that replaced this one
//   tags         comma-separated free-form tags for recall filtering
//   kind         "fact" = descriptive context, "directive" = active personalization/working instruction

const META_KEYS = ["id", "ttl", "keep", "supersededBy", "supersedes", "tags", "inject", "kind"];

const LEGACY_DIRECTIVE_TAGS = new Set([
  "persona",
  "behavior",
  "behaviour",
  "speech",
  "style",
  "tone",
  "preference",
  "preferences",
  "pref",
  "instruction",
  "instructions",
  "directive",
]);

const ENTRY_RE = /^- \[(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\]\s+(.*)$/;

// Parse a raw entry line into { line, date, time, text, meta }.
// Returns null if the line is not a fact entry.
export function parseFactEntry(line) {
  line = String(line).replace(/\r$/, "");
  const m = ENTRY_RE.exec(line);
  if (!m) return null;
  const [, date, time, rest] = m;
  let text = rest;
  const meta = {};
  const cm = /^(.*?)\s*<!--\s*(.*?)\s*-->$/.exec(rest);
  if (cm) {
    // Values may themselves contain commas (e.g. "tags:pref,arch"), so scan
    // for known "key:" tokens instead of splitting the comment on commas.
    const raw = cm[2];
    const keyRe = new RegExp(`(${META_KEYS.join("|")})\\s*:`, "g");
    const found = [];
    let fm;
    while ((fm = keyRe.exec(raw))) {
      found.push({ key: fm[1], valStart: fm.index + fm[0].length, tokenStart: fm.index });
    }
    for (let i = 0; i < found.length; i++) {
      const valEnd = i + 1 < found.length ? found[i + 1].tokenStart : raw.length;
      const v = raw.slice(found[i].valStart, valEnd).replace(/[,\s]+$/, "").trim();
      if (v !== "") {
        meta[found[i].key] = v;
      }
    }
    if (Object.keys(meta).length) text = cm[1];
  }
  return { line, date, time, text, meta };
}

// Display text of a fact line (metadata comment stripped).
export function factText(line) {
  const p = parseFactEntry(line);
  return p ? p.text : line;
}

// Metadata object of a fact line (empty if none / unparsable).
export function factMeta(line) {
  const p = parseFactEntry(line);
  return p ? p.meta : {};
}

// Format a fact line from parts. `meta` entries with falsy values are omitted.
export function formatFactEntry({ date, time, text, meta = {} }) {
  let out = `- [${date} ${time}] ${text}`;
  const pairs = [];
  for (const k of META_KEYS) {
    if (meta[k]) pairs.push(`${k}:${meta[k]}`);
  }
  if (pairs.length) out += ` <!-- ${pairs.join(", ")} -->`;
  return out;
}

// Return a new line with `patch` applied to the metadata. Patch values that are
// null/undefined/"" remove the corresponding key. Non-fact lines are returned
// unchanged.
export function withMeta(line, patch) {
  const p = parseFactEntry(line);
  if (!p) return line;
  const meta = { ...p.meta };
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v === null || v === undefined || v === "") delete meta[k];
    else meta[k] = String(v);
  }
  return formatFactEntry({ date: p.date, time: p.time, text: p.text, meta });
}

// Generate a short random id that is unique within the given entries.
export function nextFactId(entries) {
  let id;
  do {
    id = Math.random().toString(36).slice(2, 8);
  } while (entries.some((e) => factMeta(e).id === id));
  return id;
}

const TTL_UNITS = { h: 3600e3, d: 86400e3, w: 7 * 86400e3, m: 30 * 86400e3 };

// Parse "90d" | "2w" | "24h" | "12m" (m = ~30 days) into milliseconds. Null if invalid.
export function ttlMs(ttl) {
  const m = /^(\d+)\s*([hdwm])?$/.exec(String(ttl || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const u = m[2] || "d";
  return n * (TTL_UNITS[u] || TTL_UNITS.d);
}

// True if the fact line has a ttl and it has elapsed relative to `now` (ms).
export function isExpiredLine(line, now = Date.now()) {
  const p = parseFactEntry(line);
  if (!p || !p.meta.ttl) return false;
  const ms = ttlMs(p.meta.ttl);
  if (!ms) return false;
  const ts = new Date(`${p.date}T${p.time}:00`).getTime();
  if (Number.isNaN(ts)) return false;
  return now > ts + ms;
}

// True if the fact is protected from deletion (keep:1).
export function isKeepFact(line) {
  return factMeta(line).keep === "1";
}

// True if the fact has been superseded by another fact.
export function isSuperseded(line) {
  return Boolean(factMeta(line).supersededBy);
}

// Explicit kind metadata is authoritative. Legacy stores predate `kind`, so
// well-known personalization tags and inject:1 remain a compatibility bridge.
// kind:fact can explicitly opt a tagged item out of directive semantics.
export function isDirectiveFact(line) {
  const meta = factMeta(line);
  if (meta.kind === "directive") return true;
  if (meta.kind === "fact") return false;
  if (meta.inject === "1") return true;
  const tags = String(meta.tags || "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  return tags.some((tag) => LEGACY_DIRECTIVE_TAGS.has(tag));
}

// Keyword match: space-separated terms, all must be present (case-insensitive).
// Also matches against the fact's id and tags.
export function matchesQuery(factLine, query) {
  const q = String(query || "").trim();
  if (!q) return true;
  const p = parseFactEntry(factLine);
  if (!p) return false;
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${p.text} ${p.meta.id || ""} ${p.meta.tags || ""} ${p.date}`.toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

// Tag filter: comma-separated requested tags; match if ANY fact tag equals or
// contains a requested tag (case-insensitive).
export function matchesTags(factLine, tagsStr) {
  const want = String(tagsStr || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!want.length) return true;
  const have = (factMeta(factLine).tags || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!have.length) return false;
  return want.some((w) => have.some((h) => h === w || h.includes(w) || w.includes(h)));
}

// Date-range filter. `since`/`until` are "YYYY-MM-DD" (inclusive).
export function inDateRange(factLine, since, until) {
  const p = parseFactEntry(factLine);
  if (!p) return false;
  if (since && p.date < since) return false;
  if (until && p.date > until) return false;
  return true;
}

// Human-readable badges for a fact line, e.g. ["EXPIRED", "KEEP", "SUPERSEDED"].
export function metaBadges(factLine, now = Date.now()) {
  const badges = [];
  if (isExpiredLine(factLine, now)) badges.push("EXPIRED");
  if (isKeepFact(factLine)) badges.push("KEEP");
  if (isSuperseded(factLine)) badges.push("SUPERSEDED");
  if (isDirectiveFact(factLine)) badges.push("DIRECTIVE");
  return badges;
}

// Display text of a fact line with badges appended, e.g.
//   "user prefers TS  [EXPIRED] [KEEP]"
export function displayFact(factLine, now = Date.now()) {
  const text = factText(factLine);
  const badges = metaBadges(factLine, now);
  return badges.length ? `${text}  [${badges.join("] [")}]` : text;
}

// Part A1: Title + Body support

export function factTitle(line) {
  const p = parseFactEntry(line);
  if (!p) return "";
  const text = p.text;
  const m = /^\*\*([^*]+)\*\*\s*(?:—|--|-|:)?\s*(.*)$/.exec(text);
  if (m) {
    return m[1].trim();
  }
  const parts = text.split(/(?:\s*(?:—|--)\s*|\s+-\s+|\.)/);
  if (parts.length > 0 && parts[0].trim()) {
    return parts[0].trim();
  }
  return text.trim();
}

export function factBody(line) {
  const p = parseFactEntry(line);
  if (!p) return "";
  const text = p.text;
  const m = /^\*\*([^*]+)\*\*\s*(?:—|--|-|:)?\s*(.*)$/.exec(text);
  if (m) {
    return m[2].trim();
  }
  return text;
}

export function autoGenerateTitle(fact) {
  const f = String(fact || "").trim();
  const m = /^\*\*([^*]+)\*\*\s*(?:—|--|-|:)?\s*(.*)$/.exec(f);
  if (m) {
    return m[1].trim();
  }
  const parts = f.split(/(?:\s*(?:—|--)\s*|\s+-\s+|\.)/);
  if (parts.length > 0 && parts[0].trim()) {
    return parts[0].trim();
  }
  return f.slice(0, 50).trim();
}

export function withTitleAndBody(line, { title, body }) {
  const p = parseFactEntry(line);
  if (!p) return line;
  const currentTitle = factTitle(line);
  const currentBody = factBody(line);

  const newTitle = title !== undefined && title !== null ? String(title).trim() : currentTitle;
  const newBody = body !== undefined && body !== null ? String(body).trim() : currentBody;

  const newText = `**${newTitle}** — ${newBody}`;
  return formatFactEntry({ date: p.date, time: p.time, text: newText, meta: p.meta });
}

// Return a new line where a legacy fact WITHOUT a `**Title**` prefix gets one
// auto-generated (first phrase of the body). Lines that already have a title or
// are not fact entries are returned unchanged.
export function withTitle(line) {
  const p = parseFactEntry(line);
  if (!p) return line;
  if (/^\*\*[^*]+\*\*/.test(p.text)) return line;
  const title = autoGenerateTitle(p.text);
  if (!title) return line;
  return formatFactEntry({ date: p.date, time: p.time, text: `**${title}** — ${p.text}`, meta: p.meta });
}
