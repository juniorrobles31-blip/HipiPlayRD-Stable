import { nanoid } from 'nanoid';
import { z } from 'zod';
import { appendAudit, sha256 } from './audit.js';
import { getWallet, loadDb, saveDb } from './db.js';
import { Database, DerbyRace, WalletMode } from './types.js';
import { rotateWalletState, validateWalletIntent } from './wallet.js';

const RACE_DURATION_MS = Number(process.env.RACE_DURATION_MS || 60_000);
const BET_CLOSE_BEFORE_REVEAL_MS = Number(process.env.BET_CLOSE_BEFORE_REVEAL_MS || 5_000);
const OWNER_PERCENTAGE = Number(process.env.MINUTE_OWNER_PERCENTAGE || 10);
const SERVER_SECRET = process.env.DERBY_SERVER_SECRET || 'local-dev-derby-secret-change-me';

const nowIso = () => new Date().toISOString();
const floorToRaceStart = (time = Date.now()) => Math.floor(time / RACE_DURATION_MS) * RACE_DURATION_MS;

function raceCode(startMs: number) {
  return `DERBY-${new Date(startMs).toISOString().replace(/[-:TZ.]/g, '').slice(0, 12)}`;
}

function createRace(startMs: number): DerbyRace {
  const id = `race_${startMs}`;
  const startsAt = new Date(startMs).toISOString();
  const revealsAt = new Date(startMs + RACE_DURATION_MS).toISOString();
  const betClosesAt = new Date(startMs + RACE_DURATION_MS - BET_CLOSE_BEFORE_REVEAL_MS).toISOString();
  const seedCommit = sha256(`${id}:${startsAt}:${SERVER_SECRET}`);

  return {
    id,
    code: raceCode(startMs),
    status: Date.now() >= startMs + RACE_DURATION_MS ? 'locked' : 'betting',
    startsAt,
    betClosesAt,
    revealsAt,
    seedCommit,
    totalVolume: 0,
    totalRealVolume: 0,
    totalWinnersPaid: 0,
    totalBurned: 0,
    ownerMinuteAmount: 0,
    createdAt: nowIso()
  };
}

function getRaceByStart(db: Database, startMs: number) {
  let race = db.derbyRaces.find(r => r.id === `race_${startMs}`);
  if (!race) {
    race = createRace(startMs);
    db.derbyRaces.push(race);
    appendAudit(db, 'DERBY_RACE_CREATED', race.id, {
      id: race.id,
      code: race.code,
      startsAt: race.startsAt,
      betClosesAt: race.betClosesAt,
      revealsAt: race.revealsAt,
      seedCommit: race.seedCommit
    });
  }
  return race;
}

function shuffleFromSeed(seed: string) {
  const horses = [1, 2, 3, 4, 5, 6];
  for (let i = horses.length - 1; i > 0; i--) {
    const hash = sha256(`${seed}:${i}`);
    const n = parseInt(hash.slice(0, 12), 16);
    const j = n % (i + 1);
    [horses[i], horses[j]] = [horses[j], horses[i]];
  }
  return horses;
}

function takeBalance(db: Database, userId: string, mode: WalletMode, amount: number) {
  const wallet = getWallet(db, userId);
  if (mode === 'demo') {
    if (wallet.demoBalance < amount) throw new Error('Balance demo insuficiente');
    wallet.demoBalance -= amount;
    return wallet;
  }
  if (wallet.realBalance < amount) throw new Error('Balance real insuficiente');
  wallet.realBalance -= amount;
  return wallet;
}

function addBalance(db: Database, userId: string, mode: WalletMode, amount: number) {
  const wallet = getWallet(db, userId);
  if (mode === 'demo') wallet.demoBalance += amount;
  else wallet.realBalance += amount;
  return wallet;
}

function registerGiftWager(db: Database, userId: string, amount: number) {
  const wallet = getWallet(db, userId);
  if (wallet.giftLocked <= 0 || wallet.giftWagerRequired <= 0) return wallet;
  wallet.giftWagerProgress += amount;
  if (wallet.giftWagerProgress >= wallet.giftWagerRequired) {
    wallet.realBalance += wallet.giftLocked;
    wallet.giftLocked = 0;
    wallet.giftWagerRequired = 0;
    wallet.giftWagerProgress = 0;
  }
  return wallet;
}

function findMinuteOwner(db: Database) {
  const candidates = [...db.poolScores]
    .filter(s => s.scoreCount > 0)
    .sort((a, b) => b.scoreCount - a.scoreCount || String(a.firstReachedAt || '').localeCompare(String(b.firstReachedAt || '')));
  return candidates[0] || null;
}

function settleRace(db: Database, race: DerbyRace) {
  if (race.status === 'revealed') return race;

  const revealMs = new Date(race.revealsAt).getTime();
  if (Date.now() < revealMs) {
    if (Date.now() >= new Date(race.betClosesAt).getTime()) race.status = 'locked';
    return race;
  }

  const serverSeed = sha256(`${race.id}:${race.startsAt}:${SERVER_SECRET}:revealed`);
  const resultOrder = shuffleFromSeed(serverSeed);
  const top3 = resultOrder.slice(0, 3);
  const raceBets = db.derbyBets.filter(b => b.raceId === race.id);

  let totalVolume = 0;
  let totalRealVolume = 0;
  let totalWinnersPaid = 0;
  let totalBurned = 0;

  for (const bet of raceBets) {
    if (bet.status !== 'pending') continue;

    totalVolume += bet.amount;
    if (bet.mode === 'real') totalRealVolume += bet.amount;

    const won = top3.includes(bet.selectedHorse);
    bet.resultOrder = resultOrder;
    bet.resolvedAt = nowIso();

    if (won) {
      const payout = bet.amount * 2;
      bet.status = 'won';
      bet.payout = payout;
      bet.profitLoss = payout - bet.amount;
      addBalance(db, bet.userId, bet.mode, payout);
      rotateWalletState(db, bet.userId, 'DERBY_WIN_PAYOUT', {
        amount: payout,
        mode: bet.mode,
        payload: { raceId: race.id, raceCode: race.code, betId: bet.id, selectedHorse: bet.selectedHorse, payout, resultOrder, top3 }
      });
      totalWinnersPaid += payout;
    } else {
      bet.status = 'lost';
      bet.payout = 0;
      bet.profitLoss = -bet.amount;
      totalBurned += bet.amount;
      db.tokenBurns.push({
        id: nanoid(),
        raceId: race.id,
        userId: bet.userId,
        betId: bet.id,
        mode: bet.mode,
        amountBurned: bet.amount,
        reason: 'DERBY_TOP3_LOSS_BURN',
        createdAt: nowIso()
      });
    }

    if (bet.mode === 'real') registerGiftWager(db, bet.userId, bet.amount);
  }

  race.status = 'revealed';
  race.serverSeed = serverSeed;
  race.resultOrder = resultOrder;
  race.top3 = top3;
  race.totalVolume = totalVolume;
  race.totalRealVolume = totalRealVolume;
  race.totalWinnersPaid = totalWinnersPaid;
  race.totalBurned = totalBurned;
  race.revealedAt = nowIso();

  const owner = findMinuteOwner(db);
  const ownerPrize = Number((totalRealVolume * (OWNER_PERCENTAGE / 100)).toFixed(2));
  race.ownerMinuteAmount = ownerPrize;

  if (owner && ownerPrize > 0) {
    const wallet = getWallet(db, owner.userId);
    wallet.giftLocked += ownerPrize;
    wallet.giftWagerRequired += ownerPrize * 2;
    rotateWalletState(db, owner.userId, 'MINUTE_OWNER_GIFT_LOCKED', {
      amount: ownerPrize,
      mode: 'real',
      payload: { raceId: race.id, raceCode: race.code, ownerPrize, percentage: OWNER_PERCENTAGE }
    });
    race.ownerUserId = owner.userId;
    db.minuteOwnerPayouts.push({
      id: nanoid(),
      raceId: race.id,
      ownerUserId: owner.userId,
      sourceType: 'pool_score',
      baseAmount: totalRealVolume,
      percentage: OWNER_PERCENTAGE,
      payoutAmount: ownerPrize,
      status: 'gift_locked',
      createdAt: nowIso()
    });
  }

  const audit = appendAudit(db, 'DERBY_RACE_REVEALED', race.id, {
    race,
    bets: raceBets,
    tokenBurns: db.tokenBurns.filter(b => b.raceId === race.id),
    minuteOwnerPayouts: db.minuteOwnerPayouts.filter(p => p.raceId === race.id)
  });
  race.auditHash = audit.chainHash;
  return race;
}

export function ensureDerbyState() {
  const db = loadDb();
  const currentStart = floorToRaceStart();
  const previousStart = currentStart - RACE_DURATION_MS;

  const previousRace = getRaceByStart(db, previousStart);
  settleRace(db, previousRace);
  const currentRace = getRaceByStart(db, currentStart);
  settleRace(db, currentRace);

  saveDb(db);
  return { currentRace, previousRace };
}

export function currentDerby(userId?: string) {
  const db = loadDb();
  const currentStart = floorToRaceStart();
  const previousStart = currentStart - RACE_DURATION_MS;
  const previousRace = settleRace(db, getRaceByStart(db, previousStart));
  const race = settleRace(db, getRaceByStart(db, currentStart));

  const myBet = userId
    ? db.derbyBets.find(b => b.userId === userId && b.raceId === race.id) || null
    : null;

  const previousMyBet = userId
    ? db.derbyBets.find(b => b.userId === userId && b.raceId === previousRace.id) || null
    : null;

  const lastBet = userId
    ? db.derbyBets.filter(b => b.userId === userId).slice(-1)[0] || null
    : null;

  const wallet = userId ? getWallet(db, userId) : null;
  const serverTime = Date.now();
  saveDb(db);
  return { race, previousRace, myBet, previousMyBet, lastBet, wallet, serverTime };
}

const walletIntentSchema = z.object({
  payload: z.object({
    movementType: z.string(),
    userId: z.string(),
    previousStateId: z.string(),
    movementNonce: z.number().int().positive(),
    raceId: z.string().optional(),
    raceCode: z.string().optional(),
    mode: z.enum(['demo', 'real']).optional(),
    amount: z.number().optional(),
    horse: z.number().optional(),
    timestamp: z.string()
  }),
  signature: z.string().min(32),
  signatureScheme: z.literal('J123-SHA256-MVP')
});

const derbyBetSchema = z.object({
  mode: z.enum(['demo', 'real']),
  amount: z.number().positive(),
  horse: z.number().int().min(1).max(6),
  walletIntent: walletIntentSchema
});

export function placeDerbyBet(userId: string, body: unknown) {
  const input = derbyBetSchema.parse(body);
  const db = loadDb();
  const currentStart = floorToRaceStart();
  const race = settleRace(db, getRaceByStart(db, currentStart));

  if (race.status !== 'betting' || Date.now() >= new Date(race.betClosesAt).getTime()) {
    race.status = 'locked';
    saveDb(db);
    throw new Error('Las apuestas de esta carrera ya cerraron. Espera la próxima carrera.');
  }

  validateWalletIntent(db, userId, input.walletIntent, {
    movementType: 'DERBY_BET_INTENT',
    raceId: race.id,
    raceCode: race.code,
    mode: input.mode,
    amount: input.amount,
    horse: input.horse
  });

  const existing = db.derbyBets.find(b => b.userId === userId && b.raceId === race.id && b.mode === input.mode);
  if (existing) throw new Error('Ya tienes una apuesta registrada en esta carrera para este modo.');

  takeBalance(db, userId, input.mode, input.amount);

  const bet = {
    id: nanoid(),
    raceId: race.id,
    raceCode: race.code,
    userId,
    mode: input.mode,
    selectedHorse: input.horse,
    amount: input.amount,
    status: 'pending' as const,
    payout: 0,
    profitLoss: -input.amount,
    createdAt: nowIso()
  };

  db.derbyBets.push(bet);
  race.totalVolume += input.amount;
  if (input.mode === 'real') race.totalRealVolume += input.amount;

  const audit = appendAudit(db, 'DERBY_BET_PLACED', bet.id, {
    race: { id: race.id, code: race.code, seedCommit: race.seedCommit, betClosesAt: race.betClosesAt, revealsAt: race.revealsAt },
    bet
  });

  const walletRotation = rotateWalletState(db, userId, 'DERBY_BET_DEBIT', {
    amount: input.amount,
    mode: input.mode,
    signature: input.walletIntent.signature,
    payload: { raceId: race.id, raceCode: race.code, betId: bet.id, selectedHorse: input.horse, amount: input.amount, mode: input.mode }
  });

  const wallet = getWallet(db, userId);
  saveDb(db);
  return { race, bet, wallet, audit, walletMovement: walletRotation.movement, serverTime: Date.now() };
}

export function derbyHistory(userId: string) {
  const db = loadDb();
  const currentStart = floorToRaceStart();
  settleRace(db, getRaceByStart(db, currentStart - RACE_DURATION_MS));
  settleRace(db, getRaceByStart(db, currentStart));
  const wallet = getWallet(db, userId);
  const bets = db.derbyBets.filter(b => b.userId === userId).slice(-25).reverse();
  const races = db.derbyRaces.slice(-15).reverse();
  saveDb(db);
  return { wallet, bets, races };
}
