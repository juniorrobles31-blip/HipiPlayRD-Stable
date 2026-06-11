import type { LocalUser } from './localUserDb';

const API_BASE = '/api';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include'
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || data?.status === 'ERROR') {
    throw new Error(data?.message || 'Error de API');
  }

  return data as T;
}

export async function registerUserInBackend(localUser: LocalUser) {
  return request<{
    status: 'OK';
    user: {
      id: string;
      username: string;
      coins: number;
      role: 'player' | 'admin';
    };
  }>('/users/register', {
    method: 'POST',
    body: JSON.stringify({
      localUserId: localUser.localUserId,
      username: localUser.username,
      deviceId: localUser.deviceId
    })
  });
}

export async function getBackendUser(serverUserId: string) {
  return request<{
    status: 'OK';
    user: {
      id: string;
      username: string;
      coins: number;
      role: 'player' | 'admin';
    };
  }>('/users/me', {
    headers: {
      'x-user-id': serverUserId
    }
  });
}
