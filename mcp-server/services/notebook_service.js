// Structured Notebook contract shared by local adapters. No HTTP or UI rules.
import { readFile } from "node:fs/promises";
import { readMemory, writeMemory, listProjectStores, MEMORY_DIR, GLOBAL_KEY, notebookVersion, memoryFileName, today } from "../memory.js";
import { parseFactEntry, factTitle, factBody, factMeta, formatFactEntry, isDirectiveFact, isDisabledFact, isExpiredLine, isSuperseded, nextFactId, ttlMs } from "../fact_format.js";
import { getConfig } from "../config/config_manager.js";
import { getDatabase } from "../db/database.js";
import { listIdentities } from "../identity.js";
import { buildPersonaOverlayBlock, syncPersonaPrompts } from "../prompt_manager.js";
import { withSnapshotLock } from "../storage/snapshot_lock.js";

export function serviceError(code, message) { return Object.assign(new Error(message), { code }); }

function requireLocalMode() {
  const mode = getConfig().mode;
  const supported = ["only-local", "cloud-snapshots"];
  if (!supported.includes(mode)) {
    throw serviceError("UNSUPPORTED", `Panel editing is not yet available in ${mode}. Use the existing CLI; no mode was changed.`);
  }
}

export async function listNotebookTargets() {
  requireLocalMode();
  const stores = await listProjectStores();
  const identities = await listIdentities(await getDatabase());
  const targets = [{ key: GLOBAL_KEY, name: "Глобальная память", aliases: [], legacy: false }];
  for (const store of stores) {
    const identity = identities.find(item => item.key === store.key);
    targets.push({ key: store.key, name: identity?.name || store.basename, aliases: identity?.aliases || [], legacy: store.legacy,
      unavailable: memoryFileName(store.key) !== store.file ? "Store header does not match its filename; migration required." : null });
  }
  for (const identity of identities) {
    if (!targets.some(item => item.key === identity.key)) targets.push({ key: identity.key, name: identity.name, aliases: identity.aliases, legacy: false });
  }
  // Distinct keys mapping to the same legacy filename must never be writable.
  for (const target of targets) {
    if (targets.some(other => other.key !== target.key && memoryFileName(other.key) === memoryFileName(target.key))) {
      target.unavailable = "Conflicting store identities map to the same file.";
    }
  }
  return targets;
}

async function requireTarget(key) {
  if (typeof key !== "string" || !key) throw serviceError("INVALID", "An explicit store key is required.");
  const target = (await listNotebookTargets()).find(item => item.key === key);
  if (!target) throw serviceError("NOT_FOUND", "Unknown store key. Select an existing project or global memory.");
  if (target.unavailable) throw serviceError("UNSUPPORTED", target.unavailable);
  return target;
}

function record(line, index, links) {
  const parsed = parseFactEntry(line);
  if (!parsed) return { ref: `legacy:${index}`, invalid: true, body: line, reasons: ["invalid"] };
  const meta = factMeta(line);
  return { ref: meta.id ? `id:${meta.id}` : `legacy:${index}`, id: meta.id || null, title: factTitle(line), body: factBody(line),
    date: parsed.date, time: parsed.time, meta, kind: isDirectiveFact(line) ? "directive" : "fact",
    reasons: [isExpiredLine(line) && "expired", isSuperseded(line) && "superseded", isDisabledFact(line) && "disabled"].filter(Boolean),
    links: links.filter(link => link.fact_text === factBody(line) || link.fact_text === parsed.text).map(link => ({ id: link.id, docId: link.doc_id, title: link.doc_title, startLine: link.start_line, endLine: link.end_line })) };
}

export async function readNotebook({ key }) {
  const target = await requireTarget(key);
  const entries = await readMemory(key);
  const links = await (await getDatabase()).prepare("SELECT k.*, d.title AS doc_title FROM knowledge_links k LEFT JOIN documents d ON d.id = k.doc_id WHERE k.fact_key = ?").all(key);
  return { target, readOnly: false, version: notebookVersion(entries), records: entries.map((line, index) => record(line, index, links)), observedAt: new Date().toISOString() };
}

export async function notebookOverview() {
  const config = getConfig();
  const version = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")).version;
  const base = { version, mode: config.mode, readOnly: false, memoryDir: MEMORY_DIR, observedAt: new Date().toISOString(),
    models: "not-observed", cloud: "not-queried", clients: "not-observed" };
  try {
    const targets = await listNotebookTargets();
    return { ...base, targets };
  } catch (error) { return { ...base, targets: [], unavailable: error.message }; }
}

function textField(value, label, { empty = false, max = 50000 } = {}) {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || /[\r\n]|<!--|-->/.test(value)) {
    throw serviceError("INVALID", `${label}: use ${empty ? "" : "nonempty "}single-line text (up to ${max} characters), without metadata comments.`);
  }
  return value.trim();
}

function editedLine(line, input, entries) {
  const parsed = line ? parseFactEntry(line) : null;
  if (line && !parsed) throw serviceError("UNSUPPORTED", "Malformed legacy record must be repaired before editing.");
  const allowed = new Set(["title", "body", "kind", "tags", "ttl", "keep", "disabled"]);
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !allowed.has(key))) throw serviceError("INVALID", "Unknown record fields.");
  const meta = { ...parsed?.meta };
  const title = textField(input.title ?? (line ? factTitle(line) : ""), "Title", { max: 500 });
  if (title.includes("*")) throw serviceError("INVALID", "Title cannot contain asterisks.");
  const body = textField(input.body ?? (line ? factBody(line) : ""), "Body");
  if (input.kind !== undefined) {
    if (!["fact", "directive"].includes(input.kind)) throw serviceError("INVALID", "Invalid kind.");
    meta.kind = input.kind;
  } else if (!line) meta.kind = "fact";
  for (const flag of ["keep", "disabled"]) if (input[flag] !== undefined) {
    if (typeof input[flag] !== "boolean") throw serviceError("INVALID", `${flag} must be boolean.`);
    if (input[flag]) meta[flag] = "1"; else delete meta[flag];
  }
  if (input.tags !== undefined) {
    meta.tags = textField(input.tags, "Tags", { empty: true, max: 1000 });
    if (meta.tags.includes(":")) throw serviceError("INVALID", "Tags cannot contain colons.");
  }
  if (input.ttl !== undefined) {
    meta.ttl = textField(input.ttl, "TTL", { empty: true, max: 20 });
    if (meta.ttl && !(ttlMs(meta.ttl) > 0)) throw serviceError("INVALID", "TTL must be positive, e.g. 90d, 2w or 24h.");
  }
  if (!meta.id) meta.id = nextFactId(entries);
  const [date, time] = today().split(" ");
  const result = formatFactEntry({ date: parsed?.date || date, time: parsed?.time || time, text: `**${title}** — ${body}`, meta });
  if (meta.disabled && !isDirectiveFact(result)) throw serviceError("INVALID", "Only directives can be disabled. Enable it before changing its kind.");
  return result;
}

// Optimistic whole-store version protects ID-less legacy rows and previews too.
// Linked-body updates/deletion are deliberately unavailable in this increment:
// the existing text-keyed graph needs a transactional migration contract first.
export async function mutateNotebook(request) {
  return withSnapshotLock(MEMORY_DIR, () => mutateLocked(request));
}

async function mutateLocked({ key, expectedVersion, action, ref, fields, confirmDelete = false, confirmProtected = false }) {
  requireLocalMode();
  await requireTarget(key);
  const entries = await readMemory(key);
  if (typeof expectedVersion !== "string" || expectedVersion !== notebookVersion(entries)) throw serviceError("CONFLICT", "Notebook changed. Reload and review your edit again.");
  if (!["create", "update", "delete"].includes(action)) throw serviceError("INVALID", "Unknown action.");
  let index = -1;
  if (action !== "create") {
    if (typeof ref !== "string") throw serviceError("INVALID", "Record reference is required.");
    const matches = entries.map((line, i) => ({ ref: factMeta(line).id ? `id:${factMeta(line).id}` : `legacy:${i}`, i })).filter(item => item.ref === ref);
    if (matches.length !== 1) throw serviceError("CONFLICT", "Record is missing or its ID is ambiguous.");
    index = matches[0].i;
  }
  const oldLine = entries[index];
  const nextLine = action === "delete" ? null : editedLine(oldLine, fields, entries);
  if (action === "create" && entries.some(line => factBody(line).toLowerCase().trim() === factBody(nextLine).toLowerCase().trim())) {
    throw serviceError("INVALID", "A record with this body already exists in this store.");
  }
  if (action === "delete") {
    if (confirmDelete !== true) throw serviceError("CONFIRMATION", "Confirm deletion of this record in this store.");
    if (factMeta(oldLine).keep === "1" && confirmProtected !== true) throw serviceError("CONFIRMATION", "Separately confirm deletion of this protected record.");
  }
  if (oldLine) {
    const oldText = parseFactEntry(oldLine)?.text || oldLine;
    const rows = await (await getDatabase()).prepare("SELECT id, fact_text FROM knowledge_links WHERE fact_key = ? AND (fact_text = ? OR fact_text = ?)").all(key, factBody(oldLine), oldText);
    if (rows.length && (action === "delete" || factBody(oldLine) !== factBody(nextLine) || (rows.some(row => row.fact_text === oldText) && oldText !== parseFactEntry(nextLine).text))) {
      throw serviceError("UNSUPPORTED", "This record has source links. Changes to linked text and deletion await the shared link migration service; metadata can be edited.");
    }
  }
  if (action === "create") entries.push(nextLine);
  else if (action === "delete") entries.splice(index, 1);
  else entries[index] = nextLine;
  await writeMemory(key, entries, { expectedVersion, localOnly: true });
  const result = { status: "saved", key, ref: nextLine ? `id:${factMeta(nextLine).id}` : null, persona: [], contextNotice: "Existing agent sessions may retain old context; refresh the client context." };
  if (key === GLOBAL_KEY && ((oldLine && isDirectiveFact(oldLine)) || (nextLine && isDirectiveFact(nextLine)))) {
    if (process.env.MEMORY_DISABLE_PERSONA_SYNC === "1") result.persona = [{ status: "disabled_by_environment" }];
    else try {
      result.persona = await syncPersonaPrompts();
      if (result.persona.some(item => item.status === "failed")) result.status = "partial";
    } catch { result.status = "partial"; result.persona = [{ status: "failed" }]; }
  }
  return { ...result, notebook: await readNotebook({ key }) };
}

export async function previewNotebookPersona({ key }) {
  await requireTarget(key);
  const global = await readMemory(GLOBAL_KEY);
  const project = key === GLOBAL_KEY ? [] : await readMemory(key);
  return { global: buildPersonaOverlayBlock(global), project: buildPersonaOverlayBlock(project),
    coverage: "Managed prompt builder: global directives. Project block is a preview; project injection depends on the client (OpenCode supports it). This is not observed agent usage." };
}
