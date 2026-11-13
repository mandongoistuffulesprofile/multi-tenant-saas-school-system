// IndexedDB offline-first storage + sync queue for S2 Teacher PWA.
// Database is namespaced per tenant: skulapp_offline_<tenant_id>, version 1.

const DB_VERSION = 1;

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
  created_at: string;
  retries: number;
  last_attempt?: string | null;
}

type StoreName = "assessment_results" | "attendance_marks" | "sync_queue";

const STORE_SCHEMAS: Record<StoreName, { keyPath: string; autoIncrement: boolean }> = {
  assessment_results: { keyPath: "id", autoIncrement: false },
  attendance_marks: { keyPath: "id", autoIncrement: false },
  sync_queue: { keyPath: "id", autoIncrement: true },
};

let dbPromise: Promise<IDBDatabase> | null = null;
let currentTenantId: string | null = null;

function getDBName(tenantId: string): string {
  return `skulapp_offline_${tenantId}`;
}

function openDB(tenantId: string): Promise<IDBDatabase> {
  if (dbPromise && currentTenantId === tenantId) return dbPromise;
  currentTenantId = tenantId;
  const dbName = getDBName(tenantId);
  dbPromise = new Promise((resolve, reject) => {
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
  return dbPromise;
}

async function tx<T>(tenantId: string, store: StoreName, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => void): Promise<T | undefined> {
  const database = await openDB(tenantId);
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
  const database = await openDB(tenantId);
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

/* ============ Record access ============ */

export async function getAssessmentResults(tenantId: string): Promise<StoredRecord<any>[]> {
  return getAll(tenantId, "assessment_results");
}
export async function saveAssessmentResult(tenantId: string, result: any, opts?: { enqueue?: boolean }): Promise<void> {
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
export async function deleteAssessmentResult(tenantId: string, id: ID): Promise<void> {
  await deleteRecord(tenantId, "assessment_results", id);
}

export async function getAttendanceMarks(tenantId: string): Promise<StoredRecord<any>[]> {
  return getAll(tenantId, "attendance_marks");
}
export async function saveAttendanceMark(tenantId: string, mark: any, opts?: { enqueue?: boolean }): Promise<void> {
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
export async function deleteAttendanceMark(tenantId: string, id: ID): Promise<void> {
  await deleteRecord(tenantId, "attendance_marks", id);
}

export async function clearOfflineData(tenantId: string): Promise<void> {
  for (const store of ["assessment_results", "attendance_marks", "sync_queue"] as StoreName[]) {
    await clearStore(tenantId, store);
  }
}

/* ============ Sync queue ============ */

const QUEUE_STORE = "sync_queue";

async function enqueueOp(tenantId: string, op: Omit<QueuedOp, "id" | "created_at" | "retries">): Promise<void> {
  await tx(tenantId, QUEUE_STORE, "readwrite", (os) =>
    os.add({ ...op, id: crypto.randomUUID(), created_at: new Date().toISOString(), retries: 0 })
  );
}

export async function getQueue(tenantId: string): Promise<QueuedOp[]> {
  return (await getAll(tenantId, QUEUE_STORE)) as QueuedOp[];
}

export async function removeFromQueue(tenantId: string, id: ID): Promise<void> {
  await deleteRecord(tenantId, QUEUE_STORE, id);
}

export async function bumpRetry(tenantId: string, id: ID): Promise<void> {
  const database = await openDB(tenantId);
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

/* ============ Read-only collection cache ============ */

// API reads fail closed offline (the service worker answers /api with 503),
// so the marking screen needs the last successful register/learner list to
// render after a cold offline reload.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function cacheCollection<T>(tenantId: string, name: string, rows: T[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      `skulapp_cache_${tenantId}_${name}`,
      JSON.stringify({ saved_at: Date.now(), rows }),
    );
  } catch {
    /* quota/private mode: cache is best-effort */
  }
}

export function readCachedCollection<T>(tenantId: string, name: string): T[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(`skulapp_cache_${tenantId}_${name}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { saved_at?: number; rows?: T[] };
    if (!Array.isArray(parsed?.rows)) return null;
    if (Date.now() - Number(parsed.saved_at ?? 0) > CACHE_TTL_MS) {
      localStorage.removeItem(`skulapp_cache_${tenantId}_${name}`);
      return null;
    }
    return parsed.rows;
  } catch {
    return null;
  }
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
