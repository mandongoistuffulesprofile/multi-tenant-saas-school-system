// IndexedDB offline-first storage + sync queue for S2 Teacher PWA.
// Single database: skulapp_offline, version 1.

const DB_NAME = "skulapp_offline";
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

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
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

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => void): Promise<T | undefined> {
  const database = await openDB();
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

async function getAll<T>(store: StoreName): Promise<T[]> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const t = database.transaction([store], "readonly");
    const os = t.objectStore(store);
    const req = os.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function putRecord<T>(store: StoreName, record: StoredRecord<T>): Promise<void> {
  await tx(store, "readwrite", (os) => os.put(record));
}

async function deleteRecord(store: StoreName, id: ID): Promise<void> {
  await tx(store, "readwrite", (os) => os.delete(id));
}

async function clearStore(store: StoreName): Promise<void> {
  await tx(store, "readwrite", (os) => os.clear());
}

/* ============ Record access ============ */

export async function getAssessmentResults(): Promise<StoredRecord<any>[]> {
  return getAll("assessment_results");
}
export async function saveAssessmentResult(result: any): Promise<void> {
  await putRecord("assessment_results", {
    id: result.id ?? crypto.randomUUID(),
    payload: result,
    state: "pending",
    updated_at: new Date().toISOString(),
    device_id: result.device_id ?? null,
  });
  await enqueueOp({ type: "create", endpoint: "/assessment/results", method: "POST", payload: result });
}
export async function deleteAssessmentResult(id: ID): Promise<void> {
  await deleteRecord("assessment_results", id);
}

export async function getAttendanceMarks(): Promise<StoredRecord<any>[]> {
  return getAll("attendance_marks");
}
export async function saveAttendanceMark(mark: any): Promise<void> {
  await putRecord("attendance_marks", {
    id: mark.id ?? crypto.randomUUID(),
    payload: mark,
    state: "pending",
    updated_at: new Date().toISOString(),
    device_id: mark.device_id ?? null,
  });
  await enqueueOp({ type: "create", endpoint: "/attendance/marks", method: "POST", payload: mark });
}
export async function deleteAttendanceMark(id: ID): Promise<void> {
  await deleteRecord("attendance_marks", id);
}

export async function clearOfflineData(): Promise<void> {
  (["assessment_results", "attendance_marks", "sync_queue"] as StoreName[]).forEach((store) => {
    clearStore(store);
  });
}

/* ============ Sync queue ============ */

const QUEUE_STORE = "sync_queue";

async function enqueueOp(op: Omit<QueuedOp, "id" | "created_at" | "retries">): Promise<void> {
  await tx(QUEUE_STORE, "readwrite", (os) =>
    os.add({ ...op, id: crypto.randomUUID(), created_at: new Date().toISOString(), retries: 0 })
  );
}

export async function getQueue(): Promise<QueuedOp[]> {
  return (await getAll(QUEUE_STORE)) as QueuedOp[];
}

export async function removeFromQueue(id: ID): Promise<void> {
  await deleteRecord(QUEUE_STORE, id);
}

export async function bumpRetry(id: ID): Promise<void> {
  const database = await openDB();
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

export const DEVICE_ID = "unknown";
