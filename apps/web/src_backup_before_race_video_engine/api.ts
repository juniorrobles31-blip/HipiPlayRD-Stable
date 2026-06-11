const API_BASE = '/api';

export type Wallet = {
  userId: string;
  demoBalance: number;
  realBalance: number;
  giftLocked: number;
  giftWagerRequired: number;
  giftWagerProgress: number;
  stateId?: string;
  movementNonce?: number;
  signatureScheme?: string;
  lastMovementId?: string;
  lastSignature?: string;
  lastRotatedAt?: string;
};

export type Bet = {
  id: string;
  game: string;
  mode: 'demo' | 'real';
  amount: number;
  selection: unknown;
  result: unknown;
  payout: number;
  profitLoss: number;
  createdAt: string;
};

export type DerbyRace = {
  id: string;
  code: string;
  status: 'betting' | 'locked' | 'revealed';
  startsAt: string;
  betClosesAt: string;
  revealsAt: string;
  seedCommit: string;
  serverSeed?: string;
  resultOrder?: number[];
  top3?: number[];
  totalVolume: number;
  totalRealVolume: number;
  totalWinnersPaid: number;
  totalBurned: number;
  ownerMinuteAmount: number;
  ownerUserId?: string;
  auditHash?: string;
  createdAt: string;
  revealedAt?: string;
};

export type DerbyBet = {
  id: string;
  raceId: string;
  raceCode: string;
  userId: string;
  mode: 'demo' | 'real';
  selectedHorse: number;
  amount: number;
  status: 'pending' | 'won' | 'lost';
  resultOrder?: number[];
  payout: number;
  profitLoss: number;
  createdAt: string;
  resolvedAt?: string;
};

export function getToken() { return localStorage.getItem('juega123_token'); }
export function setToken(token: string) { localStorage.setItem('juega123_token', token); }
export function logout() { localStorage.removeItem('juega123_token'); }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((options.headers as Record<string, string>) || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === 'ERROR') throw new Error(data.message || 'Error de API');
  return data as T;
}

export const api = {
  login: (username: string, password: string) => request<{status: string; token: string; user: any; wallet: Wallet}>('/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password })
  }),
  me: () => request<{status: string; user: any; wallet: Wallet}>('/me'),
  history: () => request<{status: string; wallet: Wallet; bets: Bet[]}>('/games/history'),
  bet: (payload: any) => request<any>('/games/bet', { method: 'POST', body: JSON.stringify(payload) }),
  currentRace: () => request<{status: string; race: DerbyRace; previousRace: DerbyRace; myBet: DerbyBet | null; wallet: Wallet; serverTime: number}>('/races/current'),
  derbyBet: (payload: {mode: 'demo' | 'real'; amount: number; horse: number; intent?: any}) => request<{status: string; race: DerbyRace; bet: DerbyBet; wallet: Wallet; audit: any; serverTime: number}>('/races/bet', { method: 'POST', body: JSON.stringify(payload) }),
  derbyHistory: () => request<{status: string; wallet: Wallet; bets: DerbyBet[]; races: DerbyRace[]}>('/races/history'),
  createReferral: () => request<any>('/referral/create', { method: 'POST', body: JSON.stringify({ baseUrl: location.origin }) }),
  confirmPurchase: (token: string, amount: number) => request<any>('/referral/purchase-confirm', { method: 'POST', body: JSON.stringify({ token, amount }) }),
  pool: () => request<any>('/pool/current'),
  closePool: () => request<any>('/pool/close', { method: 'POST' }),
  audits: () => request<any>('/audits/pending'),

  currentSeed: () => request<any>('/local-first/current-seed'),
  syncMovement: (movement: any) => request<any>('/local-first/sync-movement', { method: 'POST', body: JSON.stringify({ movement }) }),
  syncBatch: (movements: any[]) => request<any>('/local-first/sync-batch', { method: 'POST', body: JSON.stringify({ movements }) })
};
