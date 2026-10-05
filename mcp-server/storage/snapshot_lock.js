import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

const ownedLocks = new AsyncLocalStorage();

// Shared by Notebook writes and full snapshots. OS process liveness, rather
// than elapsed time, prevents a slow upload from losing its lock.
export async function withSnapshotLock(directory, work) {
  const lockKey = path.resolve(directory);
  if (ownedLocks.getStore()?.get(lockKey)?.active) {
    if (fs.existsSync(path.join(directory, '.knowledge-journal.json'))) {
      const { recoverKnowledge } = await import('./knowledge_recovery.js'); await recoverKnowledge(directory);
    }
    return work();
  }
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
        if (readError.code !== "ENOENT") {
          let modified;
          try { modified = fs.statSync(file).mtimeMs; }
          catch (statError) { if (statError.code === 'ENOENT') continue; throw statError; }
          if (Date.now() - modified > 60_000) throw new Error("Invalid snapshot lock; inspect it before retrying");
        }
      }
      if (Date.now() - started > 30_000) throw new Error("Memory snapshot operation is busy; retry later");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  const ownership = { active: true };
  const inherited = new Map(ownedLocks.getStore() || []);
  inherited.set(lockKey, ownership);
  try { return await ownedLocks.run(inherited, async () => {
    if (fs.existsSync(path.join(directory, '.knowledge-journal.json'))) {
      const { recoverKnowledge } = await import('./knowledge_recovery.js');
      await recoverKnowledge(directory);
    }
    return work();
  }); }
  finally {
    ownership.active = false;
    if (JSON.parse(fs.readFileSync(file, "utf8")).token === token) fs.unlinkSync(file);
  }
}

export function atomicWrite(file, data, { renameRetries = 0 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, 'wx');
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    for (let attempt=0;;attempt++) {
      try {fs.renameSync(temp, file);break;}
      catch(error) {
        if(process.platform!=='win32' || !['EPERM','EACCES','EBUSY'].includes(error.code) || attempt>=renameRetries)throw error;
        // A short native read/antivirus handle can deny Windows replacement.
        // Keep the same durable staged file; never remove the destination.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
      }
    }
  }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
