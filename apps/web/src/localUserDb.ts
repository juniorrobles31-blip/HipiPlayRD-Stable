export type LocalUser = {
  localUserId: string;
  serverUserId?: string | null;
  username: string;
  deviceId: string;
  coins: number;
  syncStatus: 'pending' | 'synced' | 'error';
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY = 'hipiplay_local_user';

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createLocalUser(username: string): LocalUser {
  const now = new Date().toISOString();

  const user: LocalUser = {
    localUserId: createId('local-user'),
    serverUserId: null,
    username,
    deviceId: createId('device'),
    coins: 0,
    syncStatus: 'pending',
    createdAt: now,
    updatedAt: now
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  return user;
}

export function getLocalUser(): LocalUser | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as LocalUser;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function saveLocalUser(user: LocalUser) {
  const updatedUser: LocalUser = {
    ...user,
    updatedAt: new Date().toISOString()
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedUser));
  return updatedUser;
}

export function clearLocalUser() {
  localStorage.removeItem(STORAGE_KEY);
}

export function attachServerUserId(serverUserId: string) {
  const user = getLocalUser();
  if (!user) return null;

  return saveLocalUser({
    ...user,
    serverUserId,
    syncStatus: 'synced'
  });
}
