export type DemoProfileCacheRecord = {
  playerId: string;
  profile: {
    publicId?: string;
    transferId?: string;
    balance?: number;
    accountType?: string;
    accountStatus?: string;
    security?: string;
    phone?: string;
    email?: string;
    profileCompleted?: boolean;
    profileLocked?: boolean;
    createdAt?: string | null;
    lockedAt?: string | null;
    updatedAt?: string | null;
  };
  syncedAt: string;
};

const DB_NAME = 'hipiplay-profile-db';
const DB_VERSION = 1;
const STORE_NAME = 'profiles';

function openProfileDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, {
          keyPath: 'playerId'
        });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(
        request.error ||
        new Error('No se pudo abrir la base local del perfil.')
      );
    };
  });
}

export async function readDemoProfileCache(
  playerId: string
): Promise<DemoProfileCacheRecord | null> {
  if (!playerId || typeof indexedDB === 'undefined') {
    return null;
  }

  const database = await openProfileDatabase();

  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(
        STORE_NAME,
        'readonly'
      );

      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(playerId);

      request.onsuccess = () => {
        resolve(
          (request.result as DemoProfileCacheRecord | undefined) ||
          null
        );
      };

      request.onerror = () => {
        reject(
          request.error ||
          new Error('No se pudo leer el perfil local.')
        );
      };
    });
  } finally {
    database.close();
  }
}

export async function writeDemoProfileCache(
  playerId: string,
  profile: DemoProfileCacheRecord['profile']
): Promise<void> {
  if (
    !playerId ||
    !profile ||
    typeof indexedDB === 'undefined'
  ) {
    return;
  }

  const database = await openProfileDatabase();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        STORE_NAME,
        'readwrite'
      );

      const store = transaction.objectStore(STORE_NAME);

      store.put({
        playerId,
        profile,
        syncedAt: new Date().toISOString()
      } satisfies DemoProfileCacheRecord);

      transaction.oncomplete = () => resolve();

      transaction.onerror = () => {
        reject(
          transaction.error ||
          new Error('No se pudo guardar el perfil local.')
        );
      };

      transaction.onabort = () => {
        reject(
          transaction.error ||
          new Error('Se canceló el guardado local del perfil.')
        );
      };
    });
  } finally {
    database.close();
  }
}