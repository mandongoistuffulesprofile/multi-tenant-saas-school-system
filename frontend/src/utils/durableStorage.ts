/**
 * PWA Durable Storage & Versioned Client-Side Outbox
 * Prevents OS storage eviction on low-spec Android devices (Tecno/Infinix).
 */

export const SCHEMA_VERSION = "1.0.0";

export interface OutboxRecord<T> {
  id: string;
  schemaVersion: string;
  endpoint: string;
  payload: T;
  retryCount: number;
  timestamp: string;
}

export const requestDurableStorage = async (): Promise<boolean> => {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persisted();
    if (!isPersisted) {
      return await navigator.storage.persist();
    }
    return isPersisted;
  }
  return false;
};

export const enqueueOutboxRecord = <T>(endpoint: string, payload: T): void => {
  try {
    const queue: OutboxRecord<T>[] = JSON.parse(localStorage.getItem('edu_pwa_outbox') || '[]');
    const newRecord: OutboxRecord<T> = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      schemaVersion: SCHEMA_VERSION,
      endpoint,
      payload,
      retryCount: 0,
      timestamp: new Date().toISOString()
    };
    queue.push(newRecord);
    localStorage.setItem('edu_pwa_outbox', JSON.stringify(queue));
  } catch (err) {
    console.error('Failed to enqueue outbox record:', err);
  }
};

export const getPendingOutboxCount = (): number => {
  try {
    const queue = JSON.parse(localStorage.getItem('edu_pwa_outbox') || '[]');
    return queue.length;
  } catch {
    return 0;
  }
};
