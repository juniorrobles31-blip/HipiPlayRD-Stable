import { initMobileDb } from './hipiplayDb';
import type { LocalUser } from './localUserDb';

type BackendUser = {
  id: string;
  username: string;
  coins: number;
  role: 'player' | 'admin';
};

const DB_NAME = 'hipiplay_mobile_db';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function persistMobileSessionToIndexedDb(
  localUser: LocalUser,
  backendUser: BackendUser
) {
  await initMobileDb();

  const db = await openDb();
  const now = new Date().toISOString();

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['users', 'wallet', 'app_meta'], 'readwrite');

    tx.objectStore('users').put({
      localUserId: localUser.localUserId,
      serverUserId: backendUser.id,
      username: backendUser.username,
      deviceId: localUser.deviceId,
      coins: backendUser.coins,
      syncStatus: 'synced',
      createdAt: localUser.createdAt || now,
      updatedAt: now
    });

    tx.objectStore('wallet').put({
      userId: backendUser.id,
      localUserId: localUser.localUserId,
      coins: backendUser.coins,
      lastSyncedCoins: backendUser.coins,
      updatedAt: now
    });

    tx.objectStore('app_meta').put({
      key: 'last_user_sync',
      value: {
        username: backendUser.username,
        serverUserId: backendUser.id,
        localUserId: localUser.localUserId,
        syncedAt: now
      },
      updatedAt: now
    });

    tx.oncomplete = () => {
      db.close();
      resolve();
    };

    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };

    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
