import { getPendingEvaluations, clearSyncedEvaluations } from './offlineDb';

export class SyncManager {
  static init(tenantID) {
    window.addEventListener('online', () => {
      console.log('🌐 Network restored. Initiating automatic background sync...');
      this.flushQueue(tenantID);
    });
  }

  static async flushQueue(tenantID) {
    if (!navigator.onLine) return;

    const pending = await getPendingEvaluations();
    if (pending.length === 0) return;

    try {
      const payload = {
        evaluations: pending.map(({ student_id, strand_id, rating, comments }) => ({
          student_id,
          strand_id,
          rating,
          comments,
        })),
      };

      const res = await fetch('/api/v1/tenant/cbc/evaluations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantID,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const idsToRemove = pending.map((item) => item.local_id);
        await clearSyncedEvaluations(idsToRemove);
        console.log(`✅ Synced ${pending.length} offline evaluations successfully.`);
      }
    } catch (err) {
      console.error('⚠️ Background sync failed. Retrying on next connection:', err);
    }
  }
}
