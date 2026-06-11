export type WalletMode = 'demo' | 'real';

export type LocalWalletState = {
  userId: string;
  walletStateId: string;
  demoBalance: number;
  realBalance: number;
  giftBalance: number;
  nonce: number;
  lastMovementId?: string;
  lastSignature?: string;
  updatedAt: string;
};

export type LocalLedgerMovement = {
  movementId: string;
  userId: string;
  type: 'BET_PLACED' | 'BET_WON' | 'BET_LOST_BURN' | 'GIFT_UNLOCKED' | 'MANUAL_ADJUSTMENT';
  raceId?: string;
  raceCode?: string;
  mode: WalletMode;
  amountSpent: number;
  amountAdded: number;
  balanceBefore: number;
  balanceAfter: number;
  previousWalletStateId: string;
  newWalletStateId: string;
  nonce: number;
  payloadHash: string;
  signature: string;
  signatureScheme: string;
  deviceKeyHash: string;
  createdAt: string;
  syncStatus: 'pending' | 'synced' | 'failed';
  txHash?: string;
};

export type LocalDerbyBet = {
  id: string;
  userId: string;
  raceId: string;
  raceCode: string;
  selectedHorse: number;
  amount: number;
  mode: WalletMode;
  status: 'pending' | 'won' | 'lost';
  payout: number;
  profitLoss: number;
  createdAt: string;
  resolvedAt?: string;
  resultOrder?: number[];
  betMovementId: string;
  resultMovementId?: string;
};

export type SyncQueueItem = {
  id: string;
  movementId: string;
  payload: LocalLedgerMovement;
  status: 'pending' | 'synced' | 'failed';
  createdAt: string;
  syncedAt?: string;
  error?: string;
};

const DB_NAME = 'juega123_local_first_wallet';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('wallet_state')) db.createObjectStore('wallet_state', { keyPath: 'userId' });
      if (!db.objectStoreNames.contains('ledger_movements')) db.createObjectStore('ledger_movements', { keyPath: 'movementId' });
      if (!db.objectStoreNames.contains('derby_bets')) {
        const store = db.createObjectStore('derby_bets', { keyPath: 'id' });
        store.createIndex('by_race', 'raceId');
        store.createIndex('by_user', 'userId');
      }
      if (!db.objectStoreNames.contains('sync_queue')) db.createObjectStore('sync_queue', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function dbPut<T>(store: string, value: T): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value as any);
    req.onsuccess = () => resolve(value);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function dbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function dbDelete(store: string, key: IDBValidKey) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function clearLocalFirstDb() {
  const db = await openDb();
  const stores = ['wallet_state', 'ledger_movements', 'derby_bets', 'sync_queue', 'settings'];
  await Promise.all(stores.map(store => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  })));
  db.close();
}
