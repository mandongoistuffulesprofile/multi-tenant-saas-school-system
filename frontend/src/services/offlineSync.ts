/**
 * Offline Sync Service for Teacher PWA (Kenyan CBC Assessment)
 * Uses IndexedDB to store assessments locally when internet is offline,
 * and automatically replays events with UUID deduplication when back online.
 */

export interface AssessmentEvent {
  student_id: string;
  learning_area: string;
  strand: string;
  sub_strand: string;
  performance_level: 1 | 2 | 3 | 4; // 1:BE, 2:AE, 3:ME, 4:EE
  sync_id: string; // Unique UUID for idempotency
}

const DB_NAME = 'SchoolCBC_PWA';
const STORE_NAME = 'pending_assessments';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'sync_id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeAssessmentOffline(event: AssessmentEvent): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(event);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function syncPendingAssessments(apiBaseUrl: string, token: string): Promise<number> {
  const db = await openDB();
  const events: AssessmentEvent[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  if (events.length === 0) return 0;

  const response = await fetch(`${apiBaseUrl}/api/v1/cbc/assessments/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ events }),
  });

  if (!response.ok) {
    throw new Error(`Sync failed with status ${response.status}`);
  }

  // Clear pending items from IndexedDB
  const clearTx = db.transaction(STORE_NAME, 'readwrite');
  clearTx.objectStore(STORE_NAME).clear();

  return events.length;
}
