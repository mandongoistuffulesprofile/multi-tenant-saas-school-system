// Sync service: replays the IndexedDB write queue when connectivity returns.
// Optimistic writes go to IndexedDB immediately; the sync worker drains the
// queue by POSTing a batch to the backend /sync/push endpoint, which applies
// items idempotently, detects conflicts, and never overwrites one side
// silently.

import { api } from "./api";
import { getQueue, removeFromQueue, bumpRetry, isOnline, getDeviceId, QueuedOp, getAssessmentResults, getAttendanceMarks, clearOfflineData } from "./offline";
import { useAuthStore } from "./authStore";
import { toast } from "./toast";

const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 2000;

const ENTITY_BY_ENDPOINT: Record<string, string> = {
  "/assessment/results": "ASSESSMENT_RESULT",
  "/attendance/marks": "ATTENDANCE_MARK",
};

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

function getTenantId(): string | null {
  return useAuthStore.getState().tenantId;
}

function syncItemFor(op: QueuedOp) {
  const entityType = ENTITY_BY_ENDPOINT[op.endpoint] || "ATTENDANCE_MARK";
  const p = (op.payload as Record<string, unknown> | undefined) ?? {};
  const clientUUID = p.id ?? op.id;
  const clientVersion = typeof p.version === "number" ? p.version : (typeof p.client_version === "number" ? p.client_version : 0);
  return {
    entity_type: entityType,
    entity_id: String(p.entity_id ?? ""),
    client_uuid: String(clientUUID),
    client_version: clientVersion,
    payload: op.payload,
  };
}

export async function syncNow(): Promise<{ synced: number; failed: number; conflicts: number }> {
  const tenantId = getTenantId();
  if (!tenantId) return { synced: 0, failed: 0, conflicts: 0 };
  if (syncing || !isOnline()) return { synced: 0, failed: 0, conflicts: 0 };
  syncing = true;
  emit();
  let synced = 0;
  let failed = 0;
  let conflicts = 0;

  try {
    const queue = await getQueue(tenantId);
    const pending = queue.filter((op) => op.retries < MAX_RETRIES);
    const exhausted = queue.filter((op) => op.retries >= MAX_RETRIES);
    failed += exhausted.length;

    if (pending.length > 0) {
      const items = pending.map(syncItemFor);
      const opByClientUUID = new Map<string, string>();
      pending.forEach((op) => {
        opByClientUUID.set(String((op.payload as Record<string, unknown> | undefined)?.id ?? op.id), op.id);
      });

      try {
        const res = await api.post("/sync/push", {
          device_id: getDeviceId(),
          sync_type: "PUSH",
          items,
        });

        const results = res.data?.results ?? [];
        const appliedUUIDs = new Set<string>();
        const conflictUUIDs = new Set<string>();

        for (const r of results) {
          const uuid = String(r?.client_uuid);
          const status = String(r?.status || "").toUpperCase();
          if (status === "APPLIED") {
            appliedUUIDs.add(uuid);
          } else if (status === "CONFLICT") {
            conflictUUIDs.add(uuid);
          }
        }

        // Remove applied items. Conflicts are recorded server-side and
        // surfaced in Sync Centre; remove from local queue to avoid endless
        // replays of the same conflicting client_uuid.
        for (const op of pending) {
          const uuid = String((op.payload as Record<string, unknown> | undefined)?.id ?? op.id);
          if (appliedUUIDs.has(uuid)) {
            await removeFromQueue(tenantId, op.id);
            synced += 1;
          } else if (conflictUUIDs.has(uuid)) {
            await removeFromQueue(tenantId, op.id);
            conflicts += 1;
          } else {
            await bumpRetry(tenantId, op.id);
            failed += 1;
          }
        }
      } catch {
        // Network error while pushing: bump retry on every pending item and
        // back off; keep the session alive (no logout).
        for (const op of pending) {
          await bumpRetry(tenantId, op.id);
          failed += 1;
        }
        await sleep(Math.min(BACKOFF_BASE_MS * 2 ** (pending[0]?.retries || 0), 30000));
      }
    }
  } finally {
    syncing = false;
    emit();
  }
  if (synced > 0) toast(`Synced ${synced} change(s)`, { type: "success", duration: 3000 });
  if (conflicts > 0) toast(`${conflicts} change(s) need your resolution`, { type: "warning", duration: 4000 });
  if (failed > 0) toast(`${failed} change(s) pending retry`, { type: "warning", duration: 4000 });
  return { synced, failed, conflicts };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Register a Background Sync tag so the browser fires our outbox drain when
 * connectivity returns — even if the user killed the tab. Best-effort: the
 * call is a no-op when the browser doesn't support it (Safari).
 */
export function registerBackgroundSync(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => {
      // @ts-expect-error — sync is Chrome/Android-first; feature-detect.
      if (typeof reg.sync !== 'undefined' && typeof reg.sync.register === 'function') {
        // @ts-expect-error
        reg.sync.register('sync-outbox').catch(() => { /* unsupported */ });
      }
    })
    .catch(() => { /* SW not ready */ });
}

/**
 * Install the in-page hooks: online/visibility flush + SW message relay.
 * Returns a disposer.
 */
export function installSyncHooks(): () => void {
  const handleOnline = () => { syncNow(); };
  const handleVisibility = () => {
    if (!document.hidden && isOnline()) syncNow();
  };
  const handleMessage = (event: MessageEvent) => {
    if (event.data?.type === 'TRIGGER_OUTBOX_DRAIN' && isOnline()) {
      syncNow();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", () => emit());
    document.addEventListener("visibilitychange", handleVisibility);
    navigator.serviceWorker?.addEventListener?.("message", handleMessage);
  }
  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", () => emit());
      document.removeEventListener("visibilitychange", handleVisibility);
    }
  };
}

export async function queueCount(): Promise<number> {
  const tenantId = getTenantId();
  if (!tenantId) return 0;
  return (await getQueue(tenantId)).length;
}

export { getDeviceId };
