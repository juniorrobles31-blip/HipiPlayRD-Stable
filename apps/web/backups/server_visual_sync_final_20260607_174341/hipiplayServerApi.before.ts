export const HIPIPLAY_SERVER_URL = 'http://uribepro2.ddns.net:4000';

export type ServerPhase = 'BETTING' | 'RACE';

export type ServerHorse = {
  id: number;
  name: string;
  color: string;
};

export type ServerTotal = {
  horseId: number;
  name: string;
  color: string;
  totalAmount: number;
  totalBets: number;
};

export type ServerWinner = {
  position: number;
  horseId: number;
  name: string;
  color: string;
  totalAmount: number;
  totalBets: number;
};

export type ServerRaceState = {
  ok: boolean;
  serverTime: number;
  roundId: number;
  phase: ServerPhase;
  secondsRemaining: number;
  bettingSeconds: number;
  raceSeconds: number;
  raceStartedAt: number | null;
  horses: ServerHorse[];
  totals: ServerTotal[];
  totalBetsReceived: number;
  winners: ServerWinner[];
};

export type ServerBetPayload = {
  playerId: string;
  horseId: number;
  amount: number;
  clientName?: string;
};

export type ServerBetResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  bet?: {
    id: string;
    roundId: number;
    playerId: string;
    clientName: string;
    horseId: number;
    horseName: string;
    amount: number;
    createdAt: string;
  };
  state?: ServerRaceState;
};

export async function getServerRaceState(): Promise<ServerRaceState> {
  const response = await fetch(`${HIPIPLAY_SERVER_URL}/api/state`, {
    method: 'GET',
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`No se pudo consultar el servidor. HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data?.ok) {
    throw new Error('El servidor respondió un estado inválido.');
  }

  return data as ServerRaceState;
}

export async function sendServerBet(payload: ServerBetPayload): Promise<ServerBetResponse> {
  const response = await fetch(`${HIPIPLAY_SERVER_URL}/api/bet`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || data?.message || 'No se pudo registrar la apuesta.');
  }

  return data as ServerBetResponse;
}

export function getServerTop3(state: ServerRaceState | null): number[] {
  if (!state?.winners?.length) return [];

  return state.winners
    .sort((a, b) => a.position - b.position)
    .map((winner) => winner.horseId)
    .slice(0, 3);
}
