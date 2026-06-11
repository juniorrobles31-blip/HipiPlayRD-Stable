import type { Wallet } from './api';

type WalletIntentPayload = {
  movementType: string;
  userId: string;
  previousStateId?: string;
  movementNonce: number;
  raceId: string;
  raceCode: string;
  mode: "demo" | "real";
  amount: number;
  horse: number;
  timestamp: string;
  [key: string]: unknown;
};

type WalletIntent = {
  payload: WalletIntentPayload;
  signature: string;
  signatureScheme: string;
};

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function buildDerbyBetIntent(params: {
  wallet: Wallet;
  userId: string;
  raceId: string;
  raceCode: string;
  mode: 'demo' | 'real';
  amount: number;
  horse: number;
}): Promise<WalletIntent> {
  const payload = {
    movementType: 'DERBY_BET_INTENT',
    userId: params.userId,
    previousStateId: params.wallet.stateId,
    movementNonce: (params.wallet.movementNonce ?? 0) + 1,
    raceId: params.raceId,
    raceCode: params.raceCode,
    mode: params.mode,
    amount: params.amount,
    horse: params.horse,
    timestamp: new Date().toISOString()
  };

  return {
    payload,
    signature: await sha256Hex(stableStringify(payload)),
    signatureScheme: 'J123-SHA256-MVP'
  };
}
