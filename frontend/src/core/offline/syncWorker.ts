import { db } from './db';

export async function safeApiDispatch(endpoint: string, payload: any, tenantId: number) {
  const idempotencyKey = `${tenantId}-${endpoint}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  if (!navigator.onLine) {
    await db.add({ endpoint, payload, idempotencyKey, createdAt: Date.now(), status: 'PENDING' });
    return { success: true, queuedOffline: true };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey,
        'X-Tenant-ID': tenantId.toString(),
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('Network response failed');
    return await response.json();
  } catch {
    await db.add({ endpoint, payload, idempotencyKey, createdAt: Date.now(), status: 'PENDING' });
    return { success: true, queuedOffline: true, error: 'Network dropped, stored in local outbox.' };
  }
}
