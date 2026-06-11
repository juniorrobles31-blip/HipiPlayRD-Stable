import { nanoid } from 'nanoid';
import { z } from 'zod';
import { appendAudit, hmac, sha256 } from './audit.js';
import { getWallet, loadDb, saveDb } from './db.js';
import { WalletMode } from './types.js';

const betSchema = z.object({
  game: z.enum(['horse', 'dice_direct', 'super_dice', 'triple_dice', 'roulette', 'puntazo']),
  mode: z.enum(['demo', 'real']),
  amount: z.number().positive(),
  selection: z.any()
});

const now = () => new Date().toISOString();

function takeBalance(wallet: ReturnType<typeof getWallet>, mode: WalletMode, amount: number) {
  if (mode === 'demo') {
    if (wallet.demoBalance < amount) throw new Error('Balance demo insuficiente');
    wallet.demoBalance -= amount;
    return;
  }
  if (wallet.realBalance < amount) throw new Error('Balance real insuficiente');
  wallet.realBalance -= amount;
}

function addBalance(wallet: ReturnType<typeof getWallet>, mode: WalletMode, amount: number) {
  if (mode === 'demo') wallet.demoBalance += amount;
  else wallet.realBalance += amount;
}

function registerGiftWager(wallet: ReturnType<typeof getWallet>, amount: number) {
  if (wallet.giftLocked <= 0 || wallet.giftWagerRequired <= 0) return;
  wallet.giftWagerProgress += amount;
  if (wallet.giftWagerProgress >= wallet.giftWagerRequired) {
    wallet.realBalance += wallet.giftLocked;
    wallet.giftLocked = 0;
    wallet.giftWagerRequired = 0;
    wallet.giftWagerProgress = 0;
  }
}

function rngFrom(seed: string, max: number) {
  const n = parseInt(seed.slice(0, 12), 16);
  return (n % max) + 1;
}

function calculate(game: string, selection: any, seed: string, amount: number) {
  if (game === 'horse') {
    const winningHorse = rngFrom(hmac(seed, 'horse'), 6);
    const selected = Number(selection?.horse ?? selection);
    const win = selected === winningHorse;
    const multiplier = 5;
    return { result: { winningHorse }, payout: win ? amount * multiplier : 0 };
  }

  if (game === 'dice_direct') {
    const dice = rngFrom(hmac(seed, 'dice_direct'), 6);
    const selected = Number(selection?.number ?? selection);
    const win = selected === dice;
    return { result: { dice }, payout: win ? amount * 5 : 0 };
  }

  if (game === 'super_dice') {
    const d1 = rngFrom(hmac(seed, 'super_dice_1'), 6);
    const d2 = rngFrom(hmac(seed, 'super_dice_2'), 6);
    const total = d1 + d2;
    const pick = String(selection?.choice ?? selection);
    const win = (pick === 'high' && total >= 8) || (pick === 'low' && total <= 6) || (pick === 'seven' && total === 7);
    const multiplier = pick === 'seven' ? 4 : 2;
    return { result: { dice: [d1, d2], total }, payout: win ? amount * multiplier : 0 };
  }

  if (game === 'triple_dice') {
    const dice = [rngFrom(hmac(seed, 'triple_1'), 6), rngFrom(hmac(seed, 'triple_2'), 6), rngFrom(hmac(seed, 'triple_3'), 6)];
    const selected = Number(selection?.number ?? selection);
    const matches = dice.filter(d => d === selected).length;
    const payout = matches === 0 ? 0 : amount * (matches * 2);
    return { result: { dice }, payout };
  }

  if (game === 'roulette') {
    const number = rngFrom(hmac(seed, 'roulette'), 37) - 1;
    const pick = selection?.number !== undefined ? Number(selection.number) : null;
    const color = number === 0 ? 'green' : number % 2 === 0 ? 'black' : 'red';
    if (pick !== null) return { result: { number, color }, payout: pick === number ? amount * 35 : 0 };
    const colorPick = String(selection?.color ?? selection);
    return { result: { number, color }, payout: colorPick === color ? amount * 2 : 0 };
  }

  if (game === 'puntazo') {
    const number = rngFrom(hmac(seed, 'puntazo'), 100);
    const selected = Number(selection?.number ?? selection);
    const diff = Math.abs(number - selected);
    const payout = diff === 0 ? amount * 50 : diff <= 3 ? amount * 5 : 0;
    return { result: { number }, payout };
  }

  return { result: {}, payout: 0 };
}

export function placeBet(userId: string, body: unknown) {
  const input = betSchema.parse(body);
  const db = loadDb();
  const wallet = getWallet(db, userId);

  takeBalance(wallet, input.mode, input.amount);

  const eventId = nanoid();
  const serverSeed = sha256(`${eventId}:${Date.now()}:${Math.random()}`);
  const seedCommit = sha256(serverSeed);
  const { result, payout } = calculate(input.game, input.selection, serverSeed, input.amount);

  if (payout > 0) addBalance(wallet, input.mode, payout);
  if (input.mode === 'real') registerGiftWager(wallet, input.amount);

  const event = {
    id: eventId,
    game: input.game,
    seedCommit,
    result,
    status: 'revealed' as const,
    createdAt: now(),
    revealedAt: now()
  };

  const bet = {
    id: nanoid(),
    userId,
    game: input.game,
    mode: input.mode,
    amount: input.amount,
    selection: input.selection,
    result,
    payout,
    profitLoss: payout - input.amount,
    createdAt: now()
  };

  db.events.push(event);
  db.bets.push(bet);

  const audit = appendAudit(db, 'GAME_BET', bet.id, { event, bet, walletAfter: wallet });
  saveDb(db);

  return { event, bet, wallet, audit };
}

export function gameHistory(userId: string) {
  const db = loadDb();
  const wallet = getWallet(db, userId);
  const bets = db.bets.filter(b => b.userId === userId).slice(-25).reverse();
  return { wallet, bets };
}
