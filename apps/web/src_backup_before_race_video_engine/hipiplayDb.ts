export type SyncStatus = 'pending' | 'synced' | 'error';

export type MobileUser = {
  localUserId: string;
  serverUserId?: string | null;
  username: string;
  deviceId: string;
  coins: number;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
};

export type MobileWallet = {
  userId: string;
  localUserId: string;
  coins: number;
  lastSyncedCoins: number;
  updatedAt: string;
};

export type CoinMovement = {
  id: string;
  userId: string;
  type: 'BUY_COINS' | 'BET_PLACED' | 'BET_WON' | 'ADMIN_ADJUSTMENT';
  amount: number;
  reason: string;
  syncStatus: SyncStatus;
  createdAt: string;
};

export type LocalBet = {
  id: string;
  userId: string;
  raceId: string;
  horseNumber: number;
  amount: number;
  status: 'pending' | 'confirmed' | 'rejected' | 'paid';
  syncStatus: SyncStatus;
  createdAt: string;
};

export type SyncItem = {
  id: string;
  type: 'CREATE_USER' | 'BUY_COINS' | 'PLACE_BET' | 'CLAIM_PRIZE' | 'UPDATE_BALANCE';
  payload: unknown;
  userId?: string;
  deviceId?: string;
  status: SyncStatus;
  createdAt: string;
  syncedAt?: string;
  serverResult?: unknown;
};

const DB_NAME = 'hipiplay_mobile_db';
const DB_VERSION = 1;

const STORES = {
  users: 'users',
  devices: 'devices',
  wallet: 'wallet',
  coinMovements: 'coin_movements',
  bets: 'bets',
  raceCache: 'race_cache',
  syncQueue: 'sync_queue',
  appMeta: 'app_meta'
} as const;

function now() {
  return new Date().toISOString();
}

export function createLocalId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createStore(
  db: IDBDatabase,
  name: string,
  keyPath: string,
  indexes: Array<{ name: string; keyPath: string; options?: IDBIndexParameters }> = []
) {
  if (db.objectStoreNames.contains(name)) return;

  const store = db.createObjectStore(name, { keyPath });

  for (const index of indexes) {
    store.createIndex(index.name, index.keyPath, index.options);
  }
}

export function openMobileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;

      createStore(db, STORES.users, 'localUserId', [
        { name: 'serverUserId', keyPath: 'serverUserId' },
        { name: 'username', keyPath: 'username' },
        { name: 'deviceId', keyPath: 'deviceId' },
        { name: 'syncStatus', keyPath: 'syncStatus' }
      ]);

      createStore(db, STORES.devices, 'deviceId', [
        { name: 'userId', keyPath: 'userId' }
      ]);

      createStore(db, STORES.wallet, 'userId', [
        { name: 'localUserId', keyPath: 'localUserId' }
      ]);

      createStore(db, STORES.coinMovements, 'id', [
        { name: 'userId', keyPath: 'userId' },
        { name: 'syncStatus', keyPath: 'syncStatus' },
        { name: 'createdAt', keyPath: 'createdAt' }
      ]);

      createStore(db, STORES.bets, 'id', [
        { name: 'userId', keyPath: 'userId' },
        { name: 'raceId', keyPath: 'raceId' },
        { name: 'status', keyPath: 'status' },
        { name: 'syncStatus', keyPath: 'syncStatus' }
      ]);

      createStore(db, STORES.raceCache, 'raceId', [
        { name: 'status', keyPath: 'status' },
        { name: 'updatedAt', keyPath: 'updatedAt' }
      ]);

      createStore(db, STORES.syncQueue, 'id', [
        { name: 'status', keyPath: 'status' },
        { name: 'type', keyPath: 'type' },
        { name: 'createdAt', keyPath: 'createdAt' }
      ]);

      createStore(db, STORES.appMeta, 'key');
    };
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openMobileDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = action(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);

    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function initMobileDb() {
  const db = await openMobileDb();
  db.close();
}

export async function putRecord<T>(storeName: string, value: T): Promise<T> {
  await withStore(storeName, 'readwrite', (store) => store.put(value));
  return value;
}

export async function getRecord<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return withStore<T | undefined>(storeName, 'readonly', (store) => store.get(key));
}

export async function getAllRecords<T>(storeName: string): Promise<T[]> {
  return withStore<T[]>(storeName, 'readonly', (store) => store.getAll());
}

export async function saveMobileUser(user: MobileUser) {
  return putRecord(STORES.users, {
    ...user,
    updatedAt: now()
  });
}

export async function getMobileUsers() {
  return getAllRecords<MobileUser>(STORES.users);
}

export async function getPrimaryMobileUser() {
  const users = await getMobileUsers();
  return users[0] || null;
}

export async function saveMobileWallet(wallet: MobileWallet) {
  return putRecord(STORES.wallet, {
    ...wallet,
    updatedAt: now()
  });
}

export async function getMobileWallet(userId: string) {
  return getRecord<MobileWallet>(STORES.wallet, userId);
}

export async function addCoinMovement(input: Omit<CoinMovement, 'id' | 'createdAt'>) {
  const movement: CoinMovement = {
    ...input,
    id: createLocalId('coin-movement'),
    createdAt: now()
  };

  await putRecord(STORES.coinMovements, movement);
  return movement;
}

export async function addLocalBet(input: Omit<LocalBet, 'id' | 'createdAt'>) {
  const bet: LocalBet = {
    ...input,
    id: createLocalId('bet'),
    createdAt: now()
  };

  await putRecord(STORES.bets, bet);
  return bet;
}

export async function addSyncItem(input: Omit<SyncItem, 'id' | 'status' | 'createdAt'>) {
  const item: SyncItem = {
    ...input,
    id: createLocalId('sync'),
    status: 'pending',
    createdAt: now()
  };

  await putRecord(STORES.syncQueue, item);
  return item;
}

export async function getPendingSyncItems() {
  const items = await getAllRecords<SyncItem>(STORES.syncQueue);
  return items.filter((item) => item.status === 'pending');
}

export async function markSyncItemSynced(id: string, serverResult?: unknown) {
  const item = await getRecord<SyncItem>(STORES.syncQueue, id);
  if (!item) return null;

  const updated: SyncItem = {
    ...item,
    status: 'synced',
    syncedAt: now(),
    serverResult
  };

  await putRecord(STORES.syncQueue, updated);
  return updated;
}

export async function setAppMeta(key: string, value: unknown) {
  return putRecord(STORES.appMeta, {
    key,
    value,
    updatedAt: now()
  });
}

export async function getAppMeta<T>(key: string) {
  const record = await getRecord<{ key: string; value: T; updatedAt: string }>(STORES.appMeta, key);
  return record?.value;
}

export async function migrateLegacyLocalUserToIndexedDb() {
  const raw = localStorage.getItem('hipiplay_local_user');
  if (!raw) return null;

  try {
    const legacyUser = JSON.parse(raw) as MobileUser;

    await saveMobileUser(legacyUser);

    const userId = legacyUser.serverUserId || legacyUser.localUserId;

    await saveMobileWallet({
      userId,
      localUserId: legacyUser.localUserId,
      coins: legacyUser.coins || 0,
      lastSyncedCoins: legacyUser.coins || 0,
      updatedAt: now()
    });

    await setAppMeta('last_legacy_user_migration', now());

    return legacyUser;
  } catch {
    return null;
  }
}
