import { dbGet, dbPut, LocalLedgerMovement, LocalWalletState, SyncQueueItem, WalletMode } from './localDb';
import { newId, sha256Hex, signLocalPayload, stableStringify } from './signing';

export async function initLocalWallet(userId: string, initial?: { demoBalance?: number; realBalance?: number; giftLocked?: number }) {
  const existing = await dbGet<LocalWalletState>('wallet_state', userId);
  if (existing) return existing;
  const createdAt = new Date().toISOString();
  const stateSeed = await sha256Hex(`${userId}:${createdAt}:${Math.random()}`);
  const wallet: LocalWalletState = {
    userId,
    walletStateId: `WAL-${stateSeed.slice(0, 24).toUpperCase()}`,
    demoBalance: initial?.demoBalance ?? 10000,
    realBalance: initial?.realBalance ?? 5000,
    giftBalance: initial?.giftLocked ?? 0,
    nonce: 0,
    updatedAt: createdAt
  };
  await dbPut('wallet_state', wallet);
  return wallet;
}

export async function getLocalWallet(userId: string) {
  return initLocalWallet(userId);
}

function balanceOf(wallet: LocalWalletState, mode: WalletMode) {
  return mode === 'demo' ? wallet.demoBalance : wallet.realBalance;
}

function setBalance(wallet: LocalWalletState, mode: WalletMode, value: number) {
  if (mode === 'demo') wallet.demoBalance = value;
  else wallet.realBalance = value;
}

export async function applyLocalMovement(params: {
  userId: string;
  type: LocalLedgerMovement['type'];
  mode: WalletMode;
  amountSpent?: number;
  amountAdded?: number;
  raceId?: string;
  raceCode?: string;
  extra?: Record<string, unknown>;
}) {
  const wallet = await getLocalWallet(params.userId);
  const amountSpent = Number(params.amountSpent || 0);
  const amountAdded = Number(params.amountAdded || 0);
  const balanceBefore = balanceOf(wallet, params.mode);
  const balanceAfter = balanceBefore - amountSpent + amountAdded;
  if (balanceAfter < 0) throw new Error('Saldo local insuficiente en la wallet del teléfono.');

  const previousWalletStateId = wallet.walletStateId;
  const movementId = newId('MOV');
  const nonce = wallet.nonce + 1;
  const createdAt = new Date().toISOString();

  const unsignedPayload = {
    movementId,
    userId: params.userId,
    type: params.type,
    raceId: params.raceId,
    raceCode: params.raceCode,
    mode: params.mode,
    amountSpent,
    amountAdded,
    balanceBefore,
    balanceAfter,
    previousWalletStateId,
    nonce,
    createdAt,
    ...(params.extra || {})
  };

  const payloadHash = await sha256Hex(stableStringify(unsignedPayload));
  const signed = await signLocalPayload(unsignedPayload);
  const newWalletStateId = `WAL-${(await sha256Hex(`${previousWalletStateId}:${movementId}:${payloadHash}:${signed.signature}`)).slice(0, 24).toUpperCase()}`;

  const movement: LocalLedgerMovement = {
    ...unsignedPayload,
    newWalletStateId,
    payloadHash,
    signature: signed.signature,
    signatureScheme: signed.signatureScheme,
    deviceKeyHash: signed.deviceKeyHash,
    syncStatus: 'pending'
  };

  setBalance(wallet, params.mode, balanceAfter);
  wallet.walletStateId = newWalletStateId;
  wallet.nonce = nonce;
  wallet.lastMovementId = movementId;
  wallet.lastSignature = signed.signature;
  wallet.updatedAt = createdAt;

  const queueItem: SyncQueueItem = {
    id: `SYNC-${movementId}`,
    movementId,
    payload: movement,
    status: 'pending',
    createdAt
  };

  await dbPut('wallet_state', wallet);
  await dbPut('ledger_movements', movement);
  await dbPut('sync_queue', queueItem);
  return { wallet, movement, queueItem };
}
