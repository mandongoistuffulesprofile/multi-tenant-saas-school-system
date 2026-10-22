// Sync service: replays the IndexedDB write queue when connectivity returns.
// Optimistic writes go to IndexedDB immediately; the sync worker drains the queue.

import { api } from "./api";
import { getQueue, removeFromQueue, bumpRetry, isOnline, DEVICE_ID, QueuedOp } from "./offline";
import { toast } from "./toast";

const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 2000;

let syncing = false;
let listeners: (() => void)[] = [];

export function onSyncChange(fn: () => void) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((f) => f !== fn); };
}
function emit() { listeners.forEach((f) => f()); }

export function isSyncing() { return syncing; }

export { getQueue };
export type { QueuedOp };

export async function syncNow(): Promise<{ synced: number; failed: number }> {
  if (syncing || !isOnline()) return { synced: 0, failed: 0 };
  syncing = true;
  emit();
  let synced = 0;
  let failed = 0;

  try {
    const queue = await getQueue();
    for (const op of queue) {
      if (op.retries >= MAX_RETRIES) {
        failed += 1;
        continue;
      }
      try {
        let res;
        if (op.method === "POST") res = await api.post(op.endpoint, op.payload);
        else if (op.method === "PUT") res = await api.put(op.endpoint, op.payload);
        else if (op.method === "PATCH") res = await api.patch(op.endpoint, op.payload);
        else res = await api.delete(op.endpoint);
        if (res.status >= 200 && res.status < 300) {
          await removeFromQueue(op.id);
          synced += 1;
        } else {
          await bumpRetry(op.id);
          failed += 1;
        }
      } catch {
        await bumpRetry(op.id);
        failed += 1;
        // exponential backoff between failures
        await sleep(Math.min(BACKOFF_BASE_MS * 2 ** op.retries, 30000));
      }
    }
  } finally {
    syncing = false;
    emit();
  }
  if (synced > 0) toast(`Synced ${synced} change(s)`, { type: "success", duration: 3000 });
  if (failed > 0) toast(`${failed} change(s) pending retry`, { type: "warning", duration: 4000 });
  return { synced, failed };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export function installSyncHooks(): () => void {
  const handleOnline = () => { syncNow(); };
  const handleVisibility = () => {
    if (!document.hidden && isOnline()) syncNow();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);
  }
  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    }
  };
}

export async function queueCount(): Promise<number> {
  return (await getQueue()).length;
}

export { DEVICE_ID };
