import { api } from './api';
import { dbGetAll, dbPut, SyncQueueItem } from './localDb';

export async function pendingSyncItems() {
  const items = await dbGetAll<SyncQueueItem>('sync_queue');
  return items.filter(i => i.status === 'pending' || i.status === 'failed').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function syncOne(item: SyncQueueItem) {
  try {
    const res = await api.syncMovement(item.payload);
    item.status = 'synced';
    item.syncedAt = new Date().toISOString();
    item.error = undefined;
    item.payload.syncStatus = 'synced';
    item.payload.txHash = res.audit?.chainHash || res.txHash;
    await dbPut('ledger_movements', item.payload);
    await dbPut('sync_queue', item);
    return { ok: true, item, response: res };
  } catch (err) {
    item.status = 'failed';
    item.error = err instanceof Error ? err.message : 'Error sincronizando movimiento';
    await dbPut('sync_queue', item);
    return { ok: false, item, error: item.error };
  }
}

export async function syncPendingQueue(limit = 10) {
  const items = (await pendingSyncItems()).slice(0, limit);
  const results = [];
  for (const item of items) results.push(await syncOne(item));
  return results;
}
