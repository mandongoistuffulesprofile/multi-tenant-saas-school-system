const DB_NAME = 'SchoolCBC_DB';
const DB_VERSION = 1;
const STORE_NAME = 'rubric_assessments';

export const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('tenantId', 'tenantId', { unique: false });
        store.createIndex('syncStatus', 'syncStatus', { unique: false });
        store.createIndex('learnerSubstrand', ['studentId', 'subStrandId'], { unique: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveAssessmentOffline = async (assessment) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const record = {
      ...assessment,
      id: `${assessment.tenantId}_${assessment.studentId}_${assessment.subStrandId}`,
      syncStatus: 'pending',
      updatedAt: new Date().toISOString()
    };

    const request = store.put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
};

export const getPendingAssessments = async (tenantId) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const pending = request.result.filter(
        (r) => r.tenantId === tenantId && r.syncStatus === 'pending'
      );
      resolve(pending);
    };
    request.onerror = () => reject(request.error);
  });
};

export const markAssessmentsSynced = async (ids) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    ids.forEach((id) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        if (getReq.result) {
          const updated = { ...getReq.result, syncStatus: 'synced' };
          store.put(updated);
        }
      };
    });

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
};
