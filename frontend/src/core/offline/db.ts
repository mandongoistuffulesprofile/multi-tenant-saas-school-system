export interface OutboxRecord {
  id?: number;
  endpoint: string;
  payload: any;
  idempotencyKey: string;
  createdAt: number;
  status: 'PENDING' | 'SYNCED' | 'FAILED';
}

const KEY = 'CBCInstituteOfflineDB_outbox';

export const db = {
  async all(): Promise<OutboxRecord[]> {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  },
  async add(rec: Omit<OutboxRecord, 'id'>): Promise<void> {
    const list = await this.all();
    list.push({ ...rec, id: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list));
  },
  async clear(): Promise<void> { localStorage.removeItem(KEY); },
};

export async function requestStoragePersistence() {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persisted();
    if (!isPersisted) await navigator.storage.persist();
  }
}
