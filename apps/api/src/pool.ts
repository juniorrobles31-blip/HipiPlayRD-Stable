import { nanoid } from 'nanoid';
import { appendAudit } from './audit.js';
import { getWallet, loadDb, saveDb } from './db.js';

const now = () => new Date().toISOString();
const DEFAULT_PERCENTAGE = 5;

function getOpenRound(db: ReturnType<typeof loadDb>) {
  let round = db.poolRounds.find(r => r.status === 'open');
  if (!round) {
    round = {
      id: nanoid(),
      code: `POOL-${Date.now()}`,
      startedAt: now(),
      status: 'open',
      poolPercentage: DEFAULT_PERCENTAGE,
      grossProfit: 0,
      poolAmount: 0
    };
    db.poolRounds.push(round);
  }
  return round;
}

export function createReferral(userId: string, baseUrl = 'http://localhost:5173') {
  const db = loadDb();
  let link = db.referralLinks.find(l => l.inviterUserId === userId && l.status === 'active');
  if (!link) {
    link = { id: nanoid(), inviterUserId: userId, token: nanoid(12), status: 'active', createdAt: now() };
    db.referralLinks.push(link);
    appendAudit(db, 'REFERRAL_LINK_CREATED', link.id, link);
    saveDb(db);
  }
  return { token: link.token, url: `${baseUrl}/?ref=${link.token}` };
}

export function confirmPurchase(token: string, amount: number, invitedUserId?: string) {
  const db = loadDb();
  const link = db.referralLinks.find(l => l.token === token && l.status === 'active');
  if (!link) throw new Error('Token de referido inválido');

  const purchase = {
    id: nanoid(),
    inviterUserId: link.inviterUserId,
    invitedUserId,
    token,
    amount,
    counted: true,
    createdAt: now()
  };

  db.referralPurchases.push(purchase);

  let score = db.poolScores.find(s => s.userId === link.inviterUserId);
  if (!score) {
    score = { userId: link.inviterUserId, scoreCount: 0 };
    db.poolScores.push(score);
  }
  score.scoreCount += 1;
  score.firstReachedAt = score.firstReachedAt || now();

  const round = getOpenRound(db);
  round.grossProfit += amount * 0.1;
  round.poolAmount = round.grossProfit * (round.poolPercentage / 100);

  appendAudit(db, 'REFERRAL_PURCHASE_CONFIRMED', purchase.id, { purchase, score, round });
  saveDb(db);
  return { purchase, score, round };
}

export function currentPool(userId?: string) {
  const db = loadDb();
  const round = getOpenRound(db);
  const leaderboard = [...db.poolScores]
    .sort((a, b) => b.scoreCount - a.scoreCount || String(a.firstReachedAt || '').localeCompare(String(b.firstReachedAt || '')))
    .slice(0, 10);
  const wallet = userId ? getWallet(db, userId) : null;
  saveDb(db);
  return { round, leaderboard, wallet };
}

export function closeRound() {
  const db = loadDb();
  const round = getOpenRound(db);
  const leaderboard = [...db.poolScores]
    .filter(s => s.scoreCount > 0)
    .sort((a, b) => b.scoreCount - a.scoreCount || String(a.firstReachedAt || '').localeCompare(String(b.firstReachedAt || '')));

  if (leaderboard.length === 0 || round.poolAmount <= 0) {
    round.closedAt = now();
    round.status = 'closed';
    appendAudit(db, 'INVITATION_POOL_CLOSED_EMPTY', round.id, round);
    saveDb(db);
    return { round, winner: null };
  }

  const winner = leaderboard[0];
  const wallet = getWallet(db, winner.userId);
  const prize = Number(round.poolAmount.toFixed(2));

  wallet.giftLocked += prize;
  wallet.giftWagerRequired += prize * 2;

  round.closedAt = now();
  round.status = 'closed';
  round.winnerUserId = winner.userId;
  round.winnerScore = winner.scoreCount;

  winner.scoreCount = 0;
  winner.firstReachedAt = undefined;

  const newRound = {
    id: nanoid(),
    code: `POOL-${Date.now()}`,
    startedAt: now(),
    status: 'open' as const,
    poolPercentage: DEFAULT_PERCENTAGE,
    grossProfit: 0,
    poolAmount: 0
  };
  db.poolRounds.push(newRound);

  appendAudit(db, 'INVITATION_POOL_CLOSED', round.id, { round, winner, prize, wallet });
  saveDb(db);
  return { round, winner, prize, newRound };
}
