const envServerUrl = (import.meta as unknown as { env?: { VITE_HIPIPLAY_SERVER_URL?: string } }).env?.VITE_HIPIPLAY_SERVER_URL;
export const HIPIPLAY_SERVER_URL = envServerUrl || '/hipiplay-server';

export type ServerPhase = 'BETTING' | 'RACE' | 'RESULTS';

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




export type ServerPublicRaceHistory = {
  raceNumber: number;
  winners: number[];
};

export type ServerHistoryResponse = {
  ok: boolean;
  history: ServerPublicRaceHistory[];
};

export async function getServerRaceHistory(): Promise<ServerPublicRaceHistory[]> {
  const response = await fetch(`${HIPIPLAY_SERVER_URL}/api/history`, {
    method: 'GET',
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`No se pudo consultar el historial del servidor. HTTP ${response.status}`);
  }

  const data = (await response.json()) as ServerHistoryResponse;

  if (!data?.ok || !Array.isArray(data.history)) {
    throw new Error('El servidor respondió un historial inválido.');
  }

  return data.history;
}


export type ServerPlayerSettlement = {
  betId: string;
  horseId: number;
  horseName?: string;
  amount: number;
  won: boolean;
  payout: number;
  multiplier?: number;
};

export type ServerPlayerResult = {
  ok: boolean;
  available: boolean;
  raceNumber?: number;
  roundId?: number;
  playerId: string;
  won?: boolean;
  totalBetAmount?: number;
  totalPayout?: number;
  multiplier?: number;
  phase?: string;
  message?: string;
  winners?: {
    position: number;
    horseId: number;
    name?: string;
    color?: string;
  }[];
  settlements?: ServerPlayerSettlement[];
};

export async function getServerPlayerResult(playerId: string): Promise<ServerPlayerResult> {
  const response = await fetch(HIPIPLAY_SERVER_URL + '/api/player/result/' + encodeURIComponent(playerId), {
    method: 'GET',
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error('No se pudo consultar el resultado del jugador. HTTP ' + response.status);
  }

  const data = (await response.json()) as ServerPlayerResult;

  if (!data?.ok) {
    throw new Error(data?.message || 'El servidor respondió un resultado inválido.');
  }

  return data;
}
