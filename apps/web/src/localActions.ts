import {
  addCoinMovement,
  addLocalBet,
  addSyncItem,
  getPrimaryMobileUser,
  saveMobileWallet,
  setAppMeta,
  createLocalId,
  getAllRecords
} from './hipiplayDb';

type BetActionInput = {
  raceId: string;
  horseNumber: number;
  amount: number;
  walletCoinsAfter: number;
};

type PurchaseActionInput = {
  packageId: string;
  coins: number;
  walletCoinsAfter: number;
};

type PrizeActionInput = {
  raceId: string;
  amount: number;
  walletCoinsAfter: number;
};

function now() {
  return new Date().toISOString();
}

async function requireLocalUser() {
  const user = await getPrimaryMobileUser();

  if (!user) {
    throw new Error('No hay usuario local en IndexedDB.');
  }

  return user;
}

export async function recordBetPlacedAction(input: BetActionInput) {
  const user = await requireLocalUser();
  const userId = user.serverUserId || user.localUserId;

  const bet = await addLocalBet({
    userId,
    raceId: input.raceId,
    horseNumber: input.horseNumber,
    amount: input.amount,
    status: 'pending',
    syncStatus: 'pending'
  });

  const movement = await addCoinMovement({
    userId,
    type: 'BET_PLACED',
    amount: -Math.abs(input.amount),
    reason: `Apuesta caballo #${input.horseNumber} carrera ${input.raceId}`,
    syncStatus: 'pending'
  });

  await saveMobileWallet({
    userId,
    localUserId: user.localUserId,
    coins: input.walletCoinsAfter,
    lastSyncedCoins: input.walletCoinsAfter,
    updatedAt: now()
  });

  const syncItem = await addSyncItem({
    type: 'PLACE_BET',
    userId,
    deviceId: user.deviceId,
    payload: {
      localBetId: bet.id,
      localMovementId: movement.id,
      raceId: input.raceId,
      horseNumber: input.horseNumber,
      amount: input.amount
    }
  });

  await setAppMeta('last_local_action', {
    type: 'PLACE_BET',
    at: now(),
    syncItemId: syncItem.id
  });

  return { bet, movement, syncItem };
}

export async function recordBuyCoinsAction(input: PurchaseActionInput) {
  const user = await requireLocalUser();
  const userId = user.serverUserId || user.localUserId;

  const movement = await addCoinMovement({
    userId,
    type: 'BUY_COINS',
    amount: Math.abs(input.coins),
    reason: `Compra paquete ${input.packageId}`,
    syncStatus: 'pending'
  });

  await saveMobileWallet({
    userId,
    localUserId: user.localUserId,
    coins: input.walletCoinsAfter,
    lastSyncedCoins: input.walletCoinsAfter,
    updatedAt: now()
  });

  const syncItem = await addSyncItem({
    type: 'BUY_COINS',
    userId,
    deviceId: user.deviceId,
    payload: {
      packageId: input.packageId,
      coins: input.coins,
      localMovementId: movement.id
    }
  });

  await setAppMeta('last_local_action', {
    type: 'BUY_COINS',
    at: now(),
    syncItemId: syncItem.id
  });

  return { movement, syncItem };
}

export async function recordPrizeWonAction(input: PrizeActionInput) {
  const user = await requireLocalUser();
  const userId = user.serverUserId || user.localUserId;

  const movement = await addCoinMovement({
    userId,
    type: 'BET_WON',
    amount: Math.abs(input.amount),
    reason: `Premio ganado carrera ${input.raceId}`,
    syncStatus: 'pending'
  });

  await saveMobileWallet({
    userId,
    localUserId: user.localUserId,
    coins: input.walletCoinsAfter,
    lastSyncedCoins: input.walletCoinsAfter,
    updatedAt: now()
  });

  const syncItem = await addSyncItem({
    type: 'CLAIM_PRIZE',
    userId,
    deviceId: user.deviceId,
    payload: {
      raceId: input.raceId,
      prizeAmount: input.amount,
      localMovementId: movement.id
    }
  });

  await setAppMeta('last_local_action', {
    type: 'CLAIM_PRIZE',
    at: now(),
    syncItemId: syncItem.id
  });

  return { movement, syncItem };
}

export async function recordWalletSnapshotAction(coins: number) {
  const user = await requireLocalUser();
  const userId = user.serverUserId || user.localUserId;

  await saveMobileWallet({
    userId,
    localUserId: user.localUserId,
    coins,
    lastSyncedCoins: coins,
    updatedAt: now()
  });

  const syncItem = await addSyncItem({
    type: 'UPDATE_BALANCE',
    userId,
    deviceId: user.deviceId,
    payload: {
      coins,
      snapshotId: createLocalId('wallet-snapshot')
    }
  });

  await setAppMeta('last_wallet_snapshot', {
    coins,
    at: now(),
    syncItemId: syncItem.id
  });

  return syncItem;
}

export async function getLocalCoinMovements() {
  return getAllRecords('coin_movements');
}

export async function getLocalBets() {
  return getAllRecords('bets');
}

export async function getLocalSyncQueue() {
  return getAllRecords('sync_queue');
}
