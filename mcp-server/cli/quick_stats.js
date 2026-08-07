import { getDatabase } from "../db/database.js";
import { readMemoryRaw, GLOBAL_KEY, projectKey } from "../memory.js";

let _quickStatsCache = null;
let _quickStatsAt = 0;
const QUICK_STATS_TTL_MS = 3_000; // 3s — enough for one submenu round-trip

export function invalidateQuickStats() {
  _quickStatsCache = null;
  _quickStatsAt = 0;
}

export async function getQuickStats() {
  const now = Date.now();
  if (_quickStatsCache && (now - _quickStatsAt) < QUICK_STATS_TTL_MS) {
    return _quickStatsCache;
  }
  let docCount = 0;
  let chunkCount = 0;
  try {
    const db = await getDatabase();
    const docRow = await db.prepare("SELECT COUNT(*) as cnt FROM documents").get();
    docCount = docRow ? docRow.cnt : 0;
    const chunkRow = await db.prepare("SELECT COUNT(*) as cnt FROM micro_chunks").get();
    chunkCount = chunkRow ? chunkRow.cnt : 0;
  } catch (e) {}

  let factCount = 0;
  try {
    const projKey = await projectKey(null, null);
    const globalF = await readMemoryRaw(GLOBAL_KEY);
    const projF = await readMemoryRaw(projKey);
    factCount = (globalF ? globalF.length : 0) + (projF ? projF.length : 0);
  } catch (e) {}

  _quickStatsCache = { docCount, chunkCount, factCount };
  _quickStatsAt = now;
  return _quickStatsCache;
}
