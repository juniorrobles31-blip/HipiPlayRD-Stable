import { sha256Hex } from './signing';

export type LocalRaceSeed = {
  raceId: string;
  code: string;
  startsAt: string;
  betClosesAt: string;
  revealsAt: string;
  seed: string;
  seedCommit: string;
  serverTime: number;
};

const ROUND_MS = 60_000;
const BET_CLOSE_MS = 55_000;

function pad(n: number) { return String(n).padStart(2, '0'); }

export async function deriveLocalRaceSeed(now = Date.now()): Promise<LocalRaceSeed> {
  const roundStart = Math.floor(now / ROUND_MS) * ROUND_MS;
  const d = new Date(roundStart);
  const code = `DERBY-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  const seed = await sha256Hex(`${code}:JUEGA123_DERBY_MINUTE_PUBLIC_SEED_V1`);
  const seedCommit = await sha256Hex(seed);
  return {
    raceId: code,
    code,
    startsAt: new Date(roundStart).toISOString(),
    betClosesAt: new Date(roundStart + BET_CLOSE_MS).toISOString(),
    revealsAt: new Date(roundStart + ROUND_MS).toISOString(),
    seed,
    seedCommit,
    serverTime: now
  };
}

export function seconds(ms: number) { return Math.max(0, Math.ceil(ms / 1000)); }

export function racePhase(seed: LocalRaceSeed, now = Date.now()) {
  const close = new Date(seed.betClosesAt).getTime();
  const reveal = new Date(seed.revealsAt).getTime();
  if (now < close) return 'betting' as const;
  if (now < reveal) return 'locked' as const;
  return 'revealed' as const;
}

export function progressOf(seed: LocalRaceSeed, now = Date.now()) {
  const start = new Date(seed.startsAt).getTime();
  const reveal = new Date(seed.revealsAt).getTime();
  return Math.max(0, Math.min(1, (now - start) / Math.max(1, reveal - start)));
}

function seededNumber(seed: string, index: number) {
  let h = 2166136261;
  const str = `${seed}:${index}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function resultOrderFromSeed(seed: string) {
  return [1,2,3,4,5,6]
    .map((horse, index) => ({ horse, score: seededNumber(seed, index) }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.horse);
}

export function top3FromSeed(seed: string) {
  return resultOrderFromSeed(seed).slice(0, 3);
}
