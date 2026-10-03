import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

const ownedLocks = new AsyncLocalStorage();

// Shared by Notebook writes and full snapshots. OS process liveness, rather
// than elapsed time, prevents a slow upload from losing its lock.
export async function withSnapshotLock(directory, work) {
  const lockKey = path.resolve(directory);
  if (ownedLocks.getStore()?.get(lockKey)?.active) return work();
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, ".snapshot.lock");
  const token = randomUUID();
  const started = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(file, "wx");
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
      fs.closeSync(fd);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(fs.readFileSync(file, "utf8"));
        try { process.kill(owner.pid, 0); }
        catch (probe) { if (probe.code === "ESRCH") fs.unlinkSync(file); }
      } catch (readError) {
        // A just-created file can still be empty. Never steal a live lock.
        if (readError.code !== "ENOENT" && Date.now() - fs.statSync(file).mtimeMs > 60_000) {
          throw new Error("Invalid snapshot lock; inspect it before retrying");
        }
      }
      if (Date.now() - started > 30_000) throw new Error("Memory snapshot operation is busy; retry later");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  const ownership = { active: true };
  const inherited = new Map(ownedLocks.getStore() || []);
  inherited.set(lockKey, ownership);
  try { return await ownedLocks.run(inherited, work); }
  finally {
    ownership.active = false;
    if (JSON.parse(fs.readFileSync(file, "utf8")).token === token) fs.unlinkSync(file);
  }
}

export function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, data); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
