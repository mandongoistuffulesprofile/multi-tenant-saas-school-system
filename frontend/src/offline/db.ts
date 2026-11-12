import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { v4 as uuidv4 } from 'uuid';

export interface AssessmentRecord {
  id: string;
  tenantId: string;
  learnerId: string;
  learningAreaId: string;
  strandId: string;
  subStrandId?: string;
  rubricLevel: 'EE' | 'ME' | 'AE' | 'BE';
  score: number;
  maxScore: number;
  remarks: string;
  clientUpdatedAt: number;
  changeVector: number;
  syncStatus: 'SYNCED' | 'DIRTY' | 'CONFLICT';
  deviceId?: string;
  eventId?: string;
}

export interface AttendanceRecord {
  id: string;
  tenantId: string;
  learnerId: string;
  registerId: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
  remarks: string;
  clientUpdatedAt: number;
  changeVector: number;
  syncStatus: 'SYNCED' | 'DIRTY' | 'CONFLICT';
  deviceId?: string;
}

interface ShuleYetuDB extends DBSchema {
  assessments: {
    key: string;
    value: AssessmentRecord;
    indexes: { 'by-sync': string; 'by-learner': string; 'by-change-vector': number };
  };
  attendance: {
    key: string;
    value: AttendanceRecord;
    indexes: { 'by-sync': string; 'by-learner': string; 'by-change-vector': number };
  };
  syncQueue: {
    key: string;
    value: SyncQueueItem;
    indexes: { 'by-status': number };
  };
}

export interface SyncQueueItem {
  id: string;
  entityType: 'ASSESSMENT' | 'ATTENDANCE';
  entityId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  payload: AssessmentRecord | AttendanceRecord;
  createdAt: number;
  retryCount: number;
  lastError?: string;
}

let dbInstance: IDBPDatabase<ShuleYetuDB> | null = null;

export async function getDB(): Promise<IDBPDatabase<ShuleYetuDB>> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB<ShuleYetuDB>('shule_yetu_offline', 2, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        const assessmentStore = db.createObjectStore('assessments', { keyPath: 'id' });
        assessmentStore.createIndex('by-sync', 'syncStatus');
        assessmentStore.createIndex('by-learner', 'learnerId');
        assessmentStore.createIndex('by-change-vector', 'changeVector');

        const attendanceStore = db.createObjectStore('attendance', { keyPath: 'id' });
        attendanceStore.createIndex('by-sync', 'syncStatus');
        attendanceStore.createIndex('by-learner', 'learnerId');
        attendanceStore.createIndex('by-change-vector', 'changeVector');

        const queueStore = db.createObjectStore('syncQueue', { keyPath: 'id' });
        queueStore.createIndex('by-status', 'retryCount');
      }

      if (oldVersion < 2) {
        const assessmentStore = transaction.objectStore('assessments');
        if (!assessmentStore.indexNames.contains('by-change-vector')) {
          assessmentStore.createIndex('by-change-vector', 'changeVector');
        }

        const attendanceStore = transaction.objectStore('attendance');
        if (!attendanceStore.indexNames.contains('by-change-vector')) {
          attendanceStore.createIndex('by-change-vector', 'changeVector');
        }
      }
    },
  });

  return dbInstance;
}

export async function recordAssessment(
  record: Omit<AssessmentRecord, 'id' | 'clientUpdatedAt' | 'changeVector' | 'syncStatus'> & { id?: string }
): Promise<AssessmentRecord> {
  const db = await getDB();
  const now = Date.now();
  const entry: AssessmentRecord = {
    ...record,
    id: record.id || uuidv4(),
    clientUpdatedAt: now,
    changeVector: now,
    syncStatus: 'DIRTY',
  };
  await db.put('assessments', entry);
  await enqueueSync('ASSESSMENT', entry.id, 'CREATE', entry);
  return entry;
}

export async function updateAssessment(
  id: string,
  updates: Partial<Omit<AssessmentRecord, 'id' | 'tenantId' | 'clientUpdatedAt' | 'changeVector' | 'syncStatus'>>
): Promise<AssessmentRecord | null> {
  const db = await getDB();
  const existing = await db.get('assessments', id);
  if (!existing) return null;

  const now = Date.now();
  const updated: AssessmentRecord = {
    ...existing,
    ...updates,
    clientUpdatedAt: now,
    changeVector: now,
    syncStatus: 'DIRTY',
  };
  await db.put('assessments', updated);
  await enqueueSync('ASSESSMENT', id, 'UPDATE', updated);
  return updated;
}

export async function recordAttendance(
  record: Omit<AttendanceRecord, 'id' | 'clientUpdatedAt' | 'changeVector' | 'syncStatus'> & { id?: string }
): Promise<AttendanceRecord> {
  const db = await getDB();
  const now = Date.now();
  const entry: AttendanceRecord = {
    ...record,
    id: record.id || uuidv4(),
    clientUpdatedAt: now,
    changeVector: now,
    syncStatus: 'DIRTY',
  };
  await db.put('attendance', entry);
  await enqueueSync('ATTENDANCE', entry.id, 'CREATE', entry);
  return entry;
}

export async function updateAttendance(
  id: string,
  updates: Partial<Omit<AttendanceRecord, 'id' | 'tenantId' | 'clientUpdatedAt' | 'changeVector' | 'syncStatus'>>
): Promise<AttendanceRecord | null> {
  const db = await getDB();
  const existing = await db.get('attendance', id);
  if (!existing) return null;

  const now = Date.now();
  const updated: AttendanceRecord = {
    ...existing,
    ...updates,
    clientUpdatedAt: now,
    changeVector: now,
    syncStatus: 'DIRTY',
  };
  await db.put('attendance', updated);
  await enqueueSync('ATTENDANCE', id, 'UPDATE', updated);
  return updated;
}

async function enqueueSync(
  entityType: 'ASSESSMENT' | 'ATTENDANCE',
  entityId: string,
  operation: 'CREATE' | 'UPDATE' | 'DELETE',
  payload: AssessmentRecord | AttendanceRecord
): Promise<void> {
  const db = await getDB();
  const item: SyncQueueItem = {
    id: uuidv4(),
    entityType,
    entityId,
    operation,
    payload,
    createdAt: Date.now(),
    retryCount: 0,
  };
  await db.put('syncQueue', item);
}

export async function getPendingAssessments(tenantId: string): Promise<AssessmentRecord[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('assessments', 'by-sync', 'DIRTY');
  return all.filter((a) => a.tenantId === tenantId);
}

export async function getPendingAttendance(tenantId: string): Promise<AttendanceRecord[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('attendance', 'by-sync', 'DIRTY');
  return all.filter((a) => a.tenantId === tenantId);
}

export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  const db = await getDB();
  return db.getAllFromIndex('syncQueue', 'by-status');
}

export async function markSynced(entityType: 'ASSESSMENT' | 'ATTENDANCE', id: string): Promise<void> {
  const db = await getDB();
  const storeName = entityType === 'ASSESSMENT' ? 'assessments' : 'attendance';
  const record = await db.get(storeName, id);
  if (record) {
    record.syncStatus = 'SYNCED';
    await db.put(storeName, record);
  }
}

export async function markConflict(entityType: 'ASSESSMENT' | 'ATTENDANCE', id: string): Promise<void> {
  const db = await getDB();
  const storeName = entityType === 'ASSESSMENT' ? 'assessments' : 'attendance';
  const record = await db.get(storeName, id);
  if (record) {
    record.syncStatus = 'CONFLICT';
    await db.put(storeName, record);
  }
}

export async function removeFromQueue(queueId: string): Promise<void> {
  const db = await getDB();
  await db.delete('syncQueue', queueId);
}

export async function incrementRetry(queueId: string, error?: string): Promise<void> {
  const db = await getDB();
  const item = await db.get('syncQueue', queueId);
  if (item) {
    item.retryCount += 1;
    if (error) item.lastError = error;
    await db.put('syncQueue', item);
  }
}

export async function clearOfflineData(tenantId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['assessments', 'attendance', 'syncQueue'], 'readwrite');

  const assessments = await tx.objectStore('assessments').getAll();
  for (const a of assessments) {
    if (a.tenantId === tenantId) {
      await tx.objectStore('assessments').delete(a.id);
    }
  }

  const attendance = await tx.objectStore('attendance').getAll();
  for (const a of attendance) {
    if (a.tenantId === tenantId) {
      await tx.objectStore('attendance').delete(a.id);
    }
  }

  await tx.objectStore('syncQueue').clear();
  await tx.done;
}