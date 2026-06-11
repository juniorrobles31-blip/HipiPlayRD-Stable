export type HorseNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type BetSource = 'local' | 'public' | 'synced' | 'blockchain';

export type DerbyMarketExposure = {
  raceId: string;
  totals: Record<number, number>;
  counts: Record<number, number>;
  totalBets: number;
  totalVolume: number;
  closedByCap: boolean;
  lastUpdatedAt: number;
};

export const MARKET_CONFIG = {
  raceDurationMs: 60_000,
  minBetsToResolve: 8,
  minVolumeToResolve: 2_000,
  maxBetsPerRace: 250,
  maxVolumePerRace: 250_000,
  topCount: 3,
};

export function createEmptyExposure(raceId: string): DerbyMarketExposure {
  return {
    raceId,
    totals: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    totalBets: 0,
    totalVolume: 0,
    closedByCap: false,
    lastUpdatedAt: Date.now(),
  };
}

export function getMarketStatus(exposure: DerbyMarketExposure) {
  const reachedMaxBets = exposure.totalBets >= MARKET_CONFIG.maxBetsPerRace;
  const reachedMaxVolume = exposure.totalVolume >= MARKET_CONFIG.maxVolumePerRace;
  const canResolve = exposure.totalBets >= MARKET_CONFIG.minBetsToResolve || exposure.totalVolume >= MARKET_CONFIG.minVolumeToResolve;

  if (reachedMaxBets) return { canAcceptBet: false, canResolve, label: 'Tope de apuestas alcanzado', reason: 'se alcanzó el máximo de apuestas' };
  if (reachedMaxVolume) return { canAcceptBet: false, canResolve, label: 'Tope de volumen alcanzado', reason: 'se alcanzó el máximo de monedas' };
  if (!canResolve) return { canAcceptBet: true, canResolve: false, label: 'Esperando mercado', reason: 'faltan apuestas para calcular resultado' };
  return { canAcceptBet: true, canResolve: true, label: 'Mercado válido', reason: 'hay participación suficiente' };
}

export function addBetToExposure(
  exposure: DerbyMarketExposure,
  horse: number,
  amount: number,
  userId = 'anonymous',
  source: BetSource = 'local'
): DerbyMarketExposure {
  void userId;
  void source;
  const safeHorse = Math.min(6, Math.max(1, Number(horse || 1)));
  const safeAmount = Math.max(0, Math.floor(Number(amount || 0)));

  if (exposure.totalBets >= MARKET_CONFIG.maxBetsPerRace || exposure.totalVolume >= MARKET_CONFIG.maxVolumePerRace) {
    return { ...exposure, closedByCap: true, lastUpdatedAt: Date.now() };
  }

  const nextTotals = { ...exposure.totals };
  const nextCounts = { ...exposure.counts };
  nextTotals[safeHorse] = (nextTotals[safeHorse] || 0) + safeAmount;
  nextCounts[safeHorse] = (nextCounts[safeHorse] || 0) + 1;

  const nextTotalBets = exposure.totalBets + 1;
  const nextTotalVolume = exposure.totalVolume + safeAmount;

  return {
    ...exposure,
    totals: nextTotals,
    counts: nextCounts,
    totalBets: nextTotalBets,
    totalVolume: nextTotalVolume,
    closedByCap: nextTotalBets >= MARKET_CONFIG.maxBetsPerRace || nextTotalVolume >= MARKET_CONFIG.maxVolumePerRace,
    lastUpdatedAt: Date.now(),
  };
}

export function calculateLeastBetTop3(exposure: DerbyMarketExposure): number[] {
  return [1, 2, 3, 4, 5, 6]
    .sort((a, b) => {
      const totalDiff = (exposure.totals[a] || 0) - (exposure.totals[b] || 0);
      if (totalDiff !== 0) return totalDiff;
      const countDiff = (exposure.counts[a] || 0) - (exposure.counts[b] || 0);
      if (countDiff !== 0) return countDiff;
      return a - b;
    })
    .slice(0, MARKET_CONFIG.topCount);
}

function seededShuffle(seed: string, horses: number[]) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const arr = [...horses];
  for (let i = arr.length - 1; i > 0; i--) {
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    const j = Math.abs(hash) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function buildResultOrderFromExposure(exposure: DerbyMarketExposure, seed: string): number[] {
  const top3 = calculateLeastBetTop3(exposure);
  const rest = [1, 2, 3, 4, 5, 6].filter(h => !top3.includes(h));
  return [...seededShuffle(`${seed}:top3`, top3), ...seededShuffle(`${seed}:rest`, rest)];
}
