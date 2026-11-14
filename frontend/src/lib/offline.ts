// IndexedDB offline-first storage + sync queue for S2 Teacher PWA.
// Database is namespaced per tenant: skulapp_offline_<tenant_id>, version 1.

const DB_VERSION = 2;

type ID = string;

interface StoredRecord<T> {
  id: ID;
  payload: T;
  state: "pending" | "synced" | "conflict";
  updated_at: string;
  device_id?: string | null;
}

export interface QueuedOp {
  id: ID;
  type: "create" | "update" | "delete";
  endpoint: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  payload: unknown;
  idempotency_key?: string | null;
  created_at: string;
  retries: number;
  last_attempt?: string | null;
}

type StoreName = "assessment_results" | "attendance_marks" | "sync_queue" | "reference_cache";

const STORE_SCHEMAS: Record<StoreName, { keyPath: string; autoIncrement: boolean }> = {
  assessment_results: { keyPath: "id", autoIncrement: false },
  attendance_marks: { keyPath: "id", autoIncrement: false },
  sync_queue: { keyPath: "id", autoIncrement: true },
  // Last successful copy of read-only reference data (registers, rosters,
  // assessment events) so a teacher can open a marking screen with no network.
  reference_cache: { keyPath: "key", autoIncrement: false },
};

const TENANT_KEY = "skulapp_offline_current_tenant";

let dbPromiseByTenant: Map<string, Promise<IDBDatabase>> = new Map();
let attachedTenantId: string | null = null;

function getDBName(tenantId: string): string {
  return `skulapp_offline_${tenantId}`;
}

function ensureTenantDB(tenantId: string): Promise<IDBDatabase> {
  let p = dbPromiseByTenant.get(tenantId);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const dbName = getDBName(tenantId);
      const req = indexedDB.open(dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, schema] of Object.entries(STORE_SCHEMAS)) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: schema.keyPath, autoIncrement: schema.autoIncrement });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("IndexedDB blocked"));
    });
    dbPromiseByTenant.set(tenantId, p);
  }
  return p;
}

async function tx<T>(tenantId: string, store: StoreName, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => void): Promise<T | undefined> {
  const database = await ensureTenantDB(tenantId);
  return new Promise((resolve, reject) => {
    const t = database.transaction([store], mode);
    const os = t.objectStore(store);
    try {
      fn(os);
    } catch (e) {
      t.abort();
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(undefined);
    t.onerror = () => reject(t.error);
  });
}

async function getAll<T>(tenantId: string, store: StoreName): Promise<T[]> {
  const database = await ensureTenantDB(tenantId);
  return new Promise((resolve, reject) => {
    const t = database.transaction([store], "readonly");
    const os = t.objectStore(store);
    const req = os.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function putRecord<T>(tenantId: string, store: StoreName, record: StoredRecord<T>): Promise<void> {
  await tx(tenantId, store, "readwrite", (os) => os.put(record));
}

async function deleteRecord(tenantId: string, store: StoreName, id: ID): Promise<void> {
  await tx(tenantId, store, "readwrite", (os) => os.delete(id));
}

async function clearStore(tenantId: string, store: StoreName): Promise<void> {
  await tx(tenantId, store, "readwrite", (os) => os.clear());
}

/* ============ Tenant-scoped offline service ============ */

/**
 * The offline layer is already namespaced by tenant at the IndexedDB level,
 * but shared staffroom PCs still leak data when the UI caches a tenant id once
 * and never re-derives it on auth/visibility change. This small service makes
 * the tenant boundary explicit: modules attach to a tenant, and the app detaches
 * on logout so no queued ops from the previous session can be replayed under the
 * next login.
 */
export async function attachOfflineTenant(tenantId: string): Promise<void> {
  if (!tenantId) throw new Error("offline: tenantId required");
  await ensureTenantDB(tenantId);
  attachedTenantId = tenantId;
}

export async function detachOfflineTenant(): Promise<void> {
  if (!attachedTenantId) return;
  try {
    await clearOfflineData(attachedTenantId);
  } catch {
    /* best-effort: a shared PC still needs the current tenant gone */
  }
  attachedTenantId = null;
}

export function currentOfflineTenantId(): string | null {
  return attachedTenantId;
}

export async function getOfflineTenantIdFromStorage(): Promise<string | null> {
  try {
    if (typeof localStorage === "undefined") return null;
    const tenant = localStorage.getItem(TENANT_KEY);
    if (!tenant) return null;
    const parsed = JSON.parse(tenant);
    return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export async function rememberOfflineTenant(tenantId: string): Promise<void> {
  if (!tenantId) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(TENANT_KEY, JSON.stringify(tenantId));
  } catch {
    /* ignore */
  }
}

export async function forgetOfflineTenantStorage(): Promise<void> {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(TENANT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Modules that persist offline records should go through the attached tenant
 * rather than passing around a cached tenant id.
 */
export async function recordOfflineAssessment(tenantId: string, result: any, opts?: { enqueue?: boolean }): Promise<void> {
  const id = String(result.id ?? crypto.randomUUID());
  const payload = { ...result, id, client_uuid: result.client_uuid ?? id };
  const shouldEnqueue = opts?.enqueue !== false;
  await putRecord(tenantId, "assessment_results", {
    id,
    payload,
    state: shouldEnqueue ? "pending" : "synced",
    updated_at: new Date().toISOString(),
    device_id: payload.device_id ?? null,
  });
  if (shouldEnqueue) {
    await enqueueOp(tenantId, { type: "create", endpoint: "/assessment/results", method: "POST", payload });
  }
}

export async function recordOfflineAttendance(tenantId: string, mark: any, opts?: { enqueue?: boolean }): Promise<void> {
  const id = String(mark.id ?? crypto.randomUUID());
  const payload = { ...mark, id, client_uuid: mark.client_uuid ?? id, client_ts: mark.client_ts ?? new Date().toISOString() };
  const shouldEnqueue = opts?.enqueue !== false;
  await putRecord(tenantId, "attendance_marks", {
    id,
    payload,
    state: shouldEnqueue ? "pending" : "synced",
    updated_at: new Date().toISOString(),
    device_id: payload.device_id ?? null,
  });
  if (shouldEnqueue) {
    await enqueueOp(tenantId, { type: "create", endpoint: "/attendance/marks", method: "POST", payload });
  }
}

/* ============ Legacy record access (tenant-aware) ============ */

/** Persist one assessment result for the attached tenant (offline-first). */
export async function saveAssessmentResult(
  tenantId: string,
  result: any,
  opts?: { enqueue?: boolean },
): Promise<void> {
  await recordOfflineAssessment(tenantId, result, opts);
}

/** Persist one attendance mark for the attached tenant (offline-first). */
export async function saveAttendanceMark(
  tenantId: string,
  mark: any,
  opts?: { enqueue?: boolean },
): Promise<void> {
  await recordOfflineAttendance(tenantId, mark, opts);
}

export async function getAssessmentResults(tenantId: string): Promise<StoredRecord<any>[]> {
  return getAll(tenantId, "assessment_results");
}
export async function getAttendanceMarks(tenantId: string): Promise<StoredRecord<any>[]> {
  return getAll(tenantId, "attendance_marks");
}

export async function deleteAssessmentResult(tenantId: string, id: ID): Promise<void> {
  await deleteRecord(tenantId, "assessment_results", id);
}

export async function deleteAttendanceMark(tenantId: string, id: ID): Promise<void> {
  await deleteRecord(tenantId, "attendance_marks", id);
}

/**
 * Reference data a teacher needs before they can mark anything: the register
 * list, the roster, the assessment events. It is cached on every successful
 * read so a later cold start with no network can still open the screen, and it
 * is labelled with when it was saved so the UI can say how old it is instead of
 * pretending it is live.
 */
export async function cacheReference<T>(tenantId: string, key: string, payload: T): Promise<void> {
  if (!tenantId) return;
  await tx(tenantId, "reference_cache", "readwrite", (os) =>
    os.put({ key, payload, cached_at: new Date().toISOString() })
  );
}

export async function readReference<T>(
  tenantId: string,
  key: string,
): Promise<{ data: T; cachedAt: string } | null> {
  if (!tenantId) return null;
  const database = await ensureTenantDB(tenantId);
  return new Promise((resolve, reject) => {
    const t = database.transaction(["reference_cache"], "readonly");
    const req = t.objectStore("reference_cache").get(key);
    req.onsuccess = () => {
      const row = req.result as { key: string; payload: T; cached_at: string } | undefined;
      resolve(row ? { data: row.payload, cachedAt: row.cached_at } : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearOfflineData(tenantId: string): Promise<void> {
  if (!tenantId) return;
  for (const store of ["assessment_results", "attendance_marks", "sync_queue", "reference_cache"] as StoreName[]) {
    await clearStore(tenantId, store);
  }
}

/* ============ Sync queue ============ */

const QUEUE_STORE = "sync_queue";

async function enqueueOp(tenantId: string, op: Omit<QueuedOp, "id" | "created_at" | "retries">): Promise<void> {
  const intentKey =
    (op as any)?.idempotency_key ??
    (() => {
      const p = op.payload as any;
      if (p?.id != null) return String(p.id);
      if (p?.entity_id != null) return String(p.entity_id);
      return crypto.randomUUID();
    })();

  await tx(tenantId, QUEUE_STORE, "readwrite", (os) =>
    os.add({ ...op, id: crypto.randomUUID(), idempotency_key: intentKey, created_at: new Date().toISOString(), retries: 0 })
  );
}

export async function getQueue(tenantId: string): Promise<QueuedOp[]> {
  if (!tenantId) return [];
  return (await getAll(tenantId, QUEUE_STORE)) as QueuedOp[];
}

export async function removeFromQueue(tenantId: string, id: ID): Promise<void> {
  await deleteRecord(tenantId, QUEUE_STORE, id);
}

export async function bumpRetry(tenantId: string, id: ID): Promise<void> {
  const database = await ensureTenantDB(tenantId);
  await new Promise((resolve, reject) => {
    const t = database.transaction([QUEUE_STORE], "readwrite");
    const os = t.objectStore(QUEUE_STORE);
    const req = os.get(id);
    req.onsuccess = () => {
      const op = req.result as QueuedOp | undefined;
      if (!op) { resolve(undefined); return; }
      op.retries += 1;
      op.last_attempt = new Date().toISOString();
      os.put(op);
      t.oncomplete = () => resolve(undefined);
      t.onerror = () => reject(t.error);
    };
    req.onerror = () => reject(req.error);
  });
}


export function isOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

const DEVICE_ID_KEY = "edu_device_id";

export function getDeviceId(): string {
  if (typeof localStorage === "undefined") return "unknown";
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    try {
      localStorage.setItem(DEVICE_ID_KEY, id);
    } catch {
      /* storage unavailable — fall back to in-memory id */
    }
  }
  return id;
}
