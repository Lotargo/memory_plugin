import { manageSnapshots, stopSnapshotScheduler } from "../admin/cloud_snapshots.js";

const HELP = `Snapshot commands (all projects, no automatic cloud restore):
  snapshots status
  snapshots enable                     Back up local/legacy cloud; former cloud-only needs restore
  snapshots configure manual|off
  snapshots configure scheduled <hours>  e.g. 0.5, 24, 168
  snapshots create [--force]            Local checkpoint only
  snapshots upload                     One current archive, unchanged state skipped
  snapshots list [--location local|cloud] [--limit 100] [--before <ISO-date>]
  snapshots restore <id> [--location local|cloud] [--confirm <token>|--yes]
  snapshots delete --from <ISO-date> --to <ISO-date> [--location local|cloud|both]
  snapshots delete --older-than <N>d|m|y [--location local|cloud|both] [--yes]
  snapshots pin <id> [--location local|cloud] [--unpin]
Restore/delete preview by default. --yes explicitly applies the displayed preview.
Pinned, latest successful and pending snapshots are protected by default;
--include-protected overrides these protections. Dates are [from,to), UTC if no zone.`;

export function snapshotDate(value) {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value || "");
  if (!match || (match[2] && (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] || 0) > 59))) throw new Error(`Invalid ISO date: ${value}`);
  const day = Date.parse(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== match[1]) throw new Error(`Invalid ISO date: ${value}`);
  const n = Date.parse(match[2] && !match[5] ? `${value}Z` : value);
  if (!Number.isSafeInteger(n)) throw new Error(`Invalid date: ${value}`);
  return n;
}
export function olderThan(value, now = Date.now()) {
  const match = /^(\d+)(d|m|y)$/.exec(value || "");
  if (!match || Number(match[1]) < 1) throw new Error("--older-than expects positive days/months/years, e.g. 7d, 3m, 1y");
  const result = new Date(now), amount = Number(match[1]);
  if (match[2] === "d") result.setUTCDate(result.getUTCDate() - amount);
  else {
    // Clamp month/year subtraction at month end (March 31 -> February 28).
    const day = result.getUTCDate(); result.setUTCDate(1);
    if (match[2] === "m") result.setUTCMonth(result.getUTCMonth() - amount);
    else result.setUTCFullYear(result.getUTCFullYear() - amount);
    const end = new Date(result); end.setUTCMonth(end.getUTCMonth() + 1, 0);
    result.setUTCDate(Math.min(day, end.getUTCDate()));
  }
  if (!Number.isSafeInteger(result.getTime()) || result.getTime() < 0) throw new Error("Deletion age is outside supported date range");
  return result.getTime();
}
export async function handleSnapshotCommands(argv) {
  const args = argv.slice(1), action = args.shift();
  if (!action || ["help", "--help", "-h"].includes(action)) { console.log(HELP); return true; }
  try {
    const options = {
      status: [], enable: [], configure: [], create: ["--force"], upload: ["--force"],
      list: ["--location", "--limit", "--before"],
      restore: ["--location", "--confirm", "--yes"],
      delete: ["--location", "--from", "--to", "--older-than", "--include-protected", "--confirm", "--yes"],
      pin: ["--location", "--unpin"],
    };
    if (!Object.hasOwn(options, action)) throw new Error(`Unknown snapshot action: ${action}`);
    const switches = new Set(["--force", "--yes", "--include-protected", "--unpin"]);
    const seen = new Set(), positional = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg.startsWith("-")) { positional.push(arg); continue; }
      if (!options[action].includes(arg)) throw new Error(`Unknown option for ${action}: ${arg}`);
      if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
      seen.add(arg);
      if (!switches.has(arg) && (!args[++i] || args[i].startsWith("--"))) throw new Error(`Missing ${arg} value`);
    }
    const count = action === "configure" ? (positional[0] === "scheduled" ? 2 : 1) : ["restore", "pin"].includes(action) ? 1 : 0;
    if (positional.length !== count) throw new Error(`Invalid positional arguments for ${action}`);
    if (seen.has("--yes") && seen.has("--confirm")) throw new Error("Use --yes OR --confirm");
    const value = flag => {
      const index = args.indexOf(flag);
      if (index < 0) return undefined;
      if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing ${flag} value`);
      return args[index + 1];
    };
    const request = { action };
    const location = value("--location"); if (location) request.location = location;
    if (["restore", "pin"].includes(action)) request.id = positional[0];
    if (action === "configure") { request.syncMode = positional[0]; request.intervalHours = positional[1] === undefined ? 24 : Number(positional[1]); }
    if (action === "list") {
      if (value("--limit")) request.limit = Number(value("--limit"));
      if (value("--before")) request.before = snapshotDate(value("--before"));
    }
    if (action === "delete") {
      if (value("--older-than") && (value("--from") || value("--to"))) throw new Error("Use a period OR --older-than");
      if (!value("--older-than") && (!value("--from") || !value("--to"))) throw new Error("Specify --from and --to OR --older-than");
      request.from = value("--from") ? snapshotDate(value("--from")) : 0;
      request.to = value("--older-than") ? olderThan(value("--older-than")) : snapshotDate(value("--to"));
      request.includeProtected = args.includes("--include-protected");
    }
    if (action === "pin") request.pinned = !args.includes("--unpin");
    if (["create", "upload"].includes(action)) request.force = args.includes("--force");
    if (value("--confirm")) request.confirmToken = value("--confirm");
    const result = await manageSnapshots(request);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "preview" && args.includes("--yes")) console.log(JSON.stringify(await manageSnapshots({ ...request, confirmToken: result.confirmToken }), null, 2));
    if (result.status === "local-only") process.exitCode = 1;
  } catch (error) { console.error(`Snapshots: ${error.message}`); process.exitCode = 1; }
  finally { stopSnapshotScheduler(); }
  return true;
}
