import { dbGetAll, dbPut, LocalDerbyBet, WalletMode } from './localDb';
import { applyLocalMovement } from './localWallet';
import { newId } from './signing';

export async function placeLocalDerbyBet(params: {
  userId: string;
  raceId: string;
  raceCode: string;
  mode: WalletMode;
  horse: number;
  amount: number;
}) {
  if (!Number.isFinite(params.amount) || params.amount <= 0) throw new Error('Monto inválido.');
  const existing = (await dbGetAll<LocalDerbyBet>('derby_bets')).find(b => b.userId === params.userId && b.raceId === params.raceId && b.status === 'pending');
  if (existing) throw new Error('Ya tienes un boleto pendiente en esta carrera. Espera el resultado o la próxima carrera.');

  const movementResult = await applyLocalMovement({
    userId: params.userId,
    type: 'BET_PLACED',
    mode: params.mode,
    amountSpent: params.amount,
    amountAdded: 0,
    raceId: params.raceId,
    raceCode: params.raceCode,
    extra: { selectedHorse: params.horse }
  });

  const bet: LocalDerbyBet = {
    id: newId('BET'),
    userId: params.userId,
    raceId: params.raceId,
    raceCode: params.raceCode,
    selectedHorse: params.horse,
    amount: params.amount,
    mode: params.mode,
    status: 'pending',
    payout: 0,
    profitLoss: -params.amount,
    createdAt: new Date().toISOString(),
    betMovementId: movementResult.movement.movementId
  };
  await dbPut('derby_bets', bet);
  return { bet, ...movementResult };
}

export async function resolvePendingLocalBets(userId: string, raceId: string, raceCode: string, resultOrder: number[]) {
  const bets = await dbGetAll<LocalDerbyBet>('derby_bets');
  const pending = bets.filter(b => b.userId === userId && b.raceId === raceId && b.status === 'pending');
  const top3 = resultOrder.slice(0, 3);
  const resolved: LocalDerbyBet[] = [];
  for (const bet of pending) {
    const won = top3.includes(bet.selectedHorse);
    const payout = won ? bet.amount * 2 : 0;
    const movement = await applyLocalMovement({
      userId,
      type: won ? 'BET_WON' : 'BET_LOST_BURN',
      mode: bet.mode,
      amountSpent: 0,
      amountAdded: payout,
      raceId,
      raceCode,
      extra: { selectedHorse: bet.selectedHorse, resultOrder, top3, payout, burned: won ? 0 : bet.amount }
    });
    bet.status = won ? 'won' : 'lost';
    bet.payout = payout;
    bet.profitLoss = payout - bet.amount;
    bet.resultOrder = resultOrder;
    bet.resolvedAt = new Date().toISOString();
    bet.resultMovementId = movement.movement.movementId;
    await dbPut('derby_bets', bet);
    resolved.push(bet);
  }
  return resolved;
}

export async function localDerbyHistory(userId: string) {
  const bets = await dbGetAll<LocalDerbyBet>('derby_bets');
  return bets.filter(b => b.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
