import { SCHEMA_VERSION, OutboxRecord } from './durableStorage';

export interface SyncStatus {
  isSyncing: boolean;
  pendingCount: number;
  lastSyncedAt: Date | null;
  error: string | null;
}

type SyncListener = (status: SyncStatus) => void;

class PWAOfflineSyncEngine {
  private listeners: SyncListener[] = [];
  private isSyncing = false;
  private syncTimer: any = null;

  constructor() {
    this.initListeners();
  }

  private initListeners() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.drainQueue());
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'TRIGGER_OUTBOX_DRAIN') {
            this.drainQueue();
          }
        });
      }
      // Periodic check every 30 seconds
      this.syncTimer = setInterval(() => this.drainQueue(), 30000);
    }
  }

  public subscribe(fn: SyncListener) {
    this.listeners.push(fn);
    this.notify();
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private notify(error: string | null = null) {
    const queue = this.getQueue();
    const status: SyncStatus = {
      isSyncing: this.isSyncing,
      pendingCount: queue.length,
      lastSyncedAt: new Date(),
      error,
    };
    this.listeners.forEach((fn) => fn(status));
  }

  private getQueue(): OutboxRecord<any>[] {
    try {
      return JSON.parse(localStorage.getItem('edu_pwa_outbox') || '[]');
    } catch {
      return [];
    }
  }

  private setQueue(queue: OutboxRecord<any>[]) {
    localStorage.setItem('edu_pwa_outbox', JSON.stringify(queue));
    this.notify();
  }

  public async drainQueue() {
    if (!navigator.onLine || this.isSyncing) return;

    const queue = this.getQueue();
    if (queue.length === 0) return;

    this.isSyncing = true;
    this.notify();

    try {
      const recordsToSync = queue.map((q) => q.payload);

      const response = await fetch('/api/v1/sync/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Schema-Version': SCHEMA_VERSION,
        },
        body: JSON.stringify({
          schema_version: SCHEMA_VERSION,
          records: recordsToSync,
        }),
      });

      if (response.ok) {
        // Clear synced items
        this.setQueue([]);
        this.notify(null);
      } else if (response.status === 426) {
        // Upgrade Required / Schema drift
        this.notify('Toleo la programu limepitwa na wakati. Tafadhali sasisha (Schema Upgrade Required).');
      } else {
        this.notify('Seva haipatikani kwa sasa. Jaribio litafanyika tena.');
      }
    } catch (err) {
      this.notify('Mtandao uko chini. Rekodi zimehifadhiwa salama kwenye simu.');
    } finally {
      this.isSyncing = false;
      this.notify();
    }
  }
}

export const syncEngine = new PWAOfflineSyncEngine();
