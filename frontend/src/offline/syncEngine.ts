import { getDB, AssessmentRecord, AttendanceRecord, SyncQueueItem } from './db';

interface PushPayload {
  mutations: Array<{
    id: string;
    entityType: 'ASSESSMENT' | 'ATTENDANCE';
    tenantId: string;
    learnerId: string;
    learningAreaId?: string;
    strandId?: string;
    subStrandId?: string;
    rubricLevel?: 'EE' | 'ME' | 'AE' | 'BE';
    score?: number;
    maxScore?: number;
    remarks?: string;
    registerId?: string;
    status?: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
    clientUpdatedAt: number;
    changeVector: number;
    deviceId?: string;
    eventId?: string;
  }>;
}

interface PushResponse {
  applied: Array<{ id: string; serverChangeVector: number }>;
  conflicts: Array<{
    id: string;
    serverRecord: AssessmentRecord | AttendanceRecord;
    resolution: 'SERVER_WINS' | 'CLIENT_WINS';
  }>;
  failed: Array<{ id: string; error: string }>;
}

interface SyncResult {
  synced: number;
  conflicts: number;
  failed: number;
}

let syncInProgress = false;
const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 2000;

function getTenantId(): string | null {
  return localStorage.getItem('shule_tenant_id');
}

function getAuthToken(): string | null {
  return localStorage.getItem('shule_auth_token');
}

function getDeviceId(): string {
  let id = localStorage.getItem('shule_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('shule_device_id', id);
  }
  return id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPushPayload(queue: SyncQueueItem[]): PushPayload {
  return {
    mutations: queue.map((item) => {
      const payload = item.payload as AssessmentRecord | AttendanceRecord;
      return {
        id: item.entityId,
        entityType: item.entityType,
        tenantId: payload.tenantId,
        learnerId: payload.learnerId,
        learningAreaId: 'learningAreaId' in payload ? payload.learningAreaId : undefined,
        strandId: 'strandId' in payload ? payload.strandId : undefined,
        subStrandId: 'subStrandId' in payload ? payload.subStrandId : undefined,
        rubricLevel: 'rubricLevel' in payload ? payload.rubricLevel : undefined,
        score: 'score' in payload ? payload.score : undefined,
        maxScore: 'maxScore' in payload ? payload.maxScore : undefined,
        remarks: 'remarks' in payload ? payload.remarks : undefined,
        registerId: 'registerId' in payload ? payload.registerId : undefined,
        status: 'status' in payload ? payload.status : undefined,
        clientUpdatedAt: payload.clientUpdatedAt,
        changeVector: payload.changeVector,
        deviceId: payload.deviceId,
        eventId: 'eventId' in payload ? payload.eventId : undefined,
      };
    }),
  };
}

async function applyServerResolution(
  conflict: PushResponse['conflicts'][0],
  serverRecord: AssessmentRecord | AttendanceRecord
): Promise<void> {
  const db = await getDB();
  const storeName = 'rubricLevel' in serverRecord ? 'assessments' : 'attendance';
  
  // Server wins - overwrite local with server version
  const mergedRecord = {
    ...serverRecord,
    syncStatus: 'SYNCED' as const,
    changeVector: serverRecord.changeVector + 1,
  };
  
  await db.put(storeName, mergedRecord);
}

async function applyClientResolution(
  conflict: PushResponse['conflicts'][0],
  localRecord: AssessmentRecord | AttendanceRecord
): Promise<void> {
  // Client wins - we already have the local version, just update changeVector
  const db = await getDB();
  const storeName = 'rubricLevel' in localRecord ? 'assessments' : 'attendance';
  
  const mergedRecord = {
    ...localRecord,
    syncStatus: 'DIRTY' as const, // Will be re-synced
    changeVector: localRecord.changeVector + 1,
  };
  
  await db.put(storeName, mergedRecord);
}

export async function synchronizeAssessments(apiBaseUrl: string): Promise<SyncResult> {
  	if (syncInProgress) {
	    return { synced: 0, conflicts: 0, failed: 0 };
	  }

  const tenantId = getTenantId();
  const token = getAuthToken();

  if (!tenantId || !token) {
    return { synced: 0, conflicts: 0, failed: 0 };
  }

  	  syncInProgress = true;

  try {
    const db = await getDB();
    const queue: SyncQueueItem[] = await db.getAllFromIndex('syncQueue', 'by-status');
    const pending: SyncQueueItem[] = queue.filter((item: SyncQueueItem) => item.retryCount < MAX_RETRIES);
    const exhausted: SyncQueueItem[] = queue.filter((item: SyncQueueItem) => item.retryCount >= MAX_RETRIES);

    let synced = 0;
    let conflicts = 0;
    let failed = exhausted.length;

    if (pending.length === 0) {
      return { synced: 0, conflicts: 0, failed };
    }

    const payload = buildPushPayload(pending);
    const deviceId = getDeviceId();

    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Device-ID': deviceId,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Sync push rejected: ${response.statusText}`);
      }

      const data: PushResponse = await response.json();

      // Process applied records
      for (const applied of data.applied) {
        const queueItem = pending.find((q) => q.entityId === applied.id);
        if (queueItem) {
          await db.delete('syncQueue', queueItem.id);
          await markSynced(queueItem.entityType, applied.id);
          synced++;
        }
      }

      // Process conflicts
      for (const conflict of data.conflicts) {
        const queueItem = pending.find((q) => q.entityId === conflict.id);
        if (queueItem) {
          await db.delete('syncQueue', queueItem.id);
          
          if (conflict.resolution === 'SERVER_WINS') {
            await applyServerResolution(conflict, conflict.serverRecord);
          } else {
            // Get local record from the queue item's entity store; the
            // resolution direction says nothing about which store to read.
            const storeName = queueItem.entityType === 'ASSESSMENT' ? 'assessments' : 'attendance';
            const localRecord = await db.get(storeName, conflict.id);
            if (localRecord) {
              await applyClientResolution(conflict, localRecord);
            }
          }
          conflicts++;
        }
      }

      // Process failed items
      for (const failedItem of data.failed) {
        const queueItem = pending.find((q) => q.entityId === failedItem.id);
        if (queueItem) {
          await incrementRetry(queueItem.id, failedItem.error);
          failed++;
        }
      }
    } catch (err) {
      // Network error - bump retry on every pending item
      for (const item of pending) {
        await incrementRetry(item.id, err instanceof Error ? err.message : 'Network error');
        failed++;
      }
      await sleep(Math.min(BACKOFF_BASE_MS * 2 ** (pending[0]?.retryCount || 0), 30000));
    }

    return { synced, conflicts, failed };
  } finally {
    	    syncInProgress = false;
  }
}

async function markSynced(entityType: 'ASSESSMENT' | 'ATTENDANCE', id: string): Promise<void> {
  const db = await getDB();
  const storeName = entityType === 'ASSESSMENT' ? 'assessments' : 'attendance';
  const record = await db.get(storeName, id);
  if (record) {
    record.syncStatus = 'SYNCED';
    await db.put(storeName, record);
  }
}

async function incrementRetry(queueId: string, error: string): Promise<void> {
  const db = await getDB();
  const item = await db.get('syncQueue', queueId);
  if (item) {
    item.retryCount += 1;
    item.lastError = error;
    await db.put('syncQueue', item);
  }
}

export function isSyncing(): boolean {
  return syncInProgress;
}

export function registerBackgroundSync(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  
  navigator.serviceWorker.ready
    .then((reg) => {
      if ('sync' in reg && typeof (reg as any).sync.register === 'function') {
        (reg as any).sync.register('sync-outbox').catch(() => {
          // Background sync not supported
        });
      }
    })
    .catch(() => {
      // SW not ready
    });
}

export function installSyncHooks(onSyncComplete?: (result: SyncResult) => void): () => void {
  const handleOnline = async () => {
    const result = await synchronizeAssessments(import.meta.env.VITE_API_BASE_URL || '');
    if (onSyncComplete) onSyncComplete(result);
  };

  const handleVisibility = () => {
    if (!document.hidden && navigator.onLine) {
      handleOnline();
    }
  };

  const handleMessage = (event: MessageEvent) => {
    if (event.data?.type === 'TRIGGER_OUTBOX_DRAIN' && navigator.onLine) {
      handleOnline();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', () => {});
    document.addEventListener('visibilitychange', handleVisibility);
    navigator.serviceWorker?.addEventListener?.('message', handleMessage);
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', () => {});
      document.removeEventListener('visibilitychange', handleVisibility);
      navigator.serviceWorker?.removeEventListener?.('message', handleMessage);
    }
  };
}