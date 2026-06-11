import { nanoid } from 'nanoid';
import { appendAudit, sha256 } from './audit.js';
import { getWallet } from './db.js';
import { Database, WalletIntent, WalletMode, WalletMovement } from './types.js';

const nowIso = () => new Date().toISOString();

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function walletSnapshot(db: Database, userId: string) {
  const wallet = getWallet(db, userId);
  return {
    userId: wallet.userId,
    demoBalance: wallet.demoBalance,
    realBalance: wallet.realBalance,
    giftLocked: wallet.giftLocked,
    giftWagerRequired: wallet.giftWagerRequired,
    giftWagerProgress: wallet.giftWagerProgress,
    stateId: wallet.stateId,
    movementNonce: wallet.movementNonce,
    signatureScheme: wallet.signatureScheme,
    lastMovementId: wallet.lastMovementId,
    lastSignature: wallet.lastSignature,
    lastRotatedAt: wallet.lastRotatedAt
  };
}

export function expectedIntentSignature(intent: WalletIntent) {
  return sha256(stableStringify(intent.payload));
}

export function validateWalletIntent(db: Database, userId: string, intent: WalletIntent | undefined, expected: {
  movementType: string;
  raceId?: string;
  raceCode?: string;
  mode?: WalletMode;
  amount?: number;
  horse?: number;
}) {
  if (!intent || !intent.payload || !intent.signature) {
    throw new Error('Movimiento rechazado: falta firma digital de wallet.');
  }

  const wallet = getWallet(db, userId);
  const payload = intent.payload;

  if (intent.signatureScheme !== 'J123-SHA256-MVP') throw new Error('Esquema de firma no soportado.');
  if (payload.userId !== userId) throw new Error('Firma inválida: usuario no coincide.');
  if (payload.previousStateId !== wallet.stateId) throw new Error('Firma inválida: el ID de wallet ya fue rotado. Actualiza la pantalla.');
  if (payload.movementNonce !== wallet.movementNonce + 1) throw new Error('Firma inválida: nonce de movimiento incorrecto.');
  if (payload.movementType !== expected.movementType) throw new Error('Firma inválida: tipo de movimiento incorrecto.');
  if (expected.raceId && payload.raceId !== expected.raceId) throw new Error('Firma inválida: carrera incorrecta.');
  if (expected.raceCode && payload.raceCode !== expected.raceCode) throw new Error('Firma inválida: código de carrera incorrecto.');
  if (expected.mode && payload.mode !== expected.mode) throw new Error('Firma inválida: modo incorrecto.');
  if (typeof expected.amount === 'number' && Number(payload.amount) !== Number(expected.amount)) throw new Error('Firma inválida: monto incorrecto.');
  if (typeof expected.horse === 'number' && Number(payload.horse) !== Number(expected.horse)) throw new Error('Firma inválida: caballo incorrecto.');

  const expectedSignature = expectedIntentSignature(intent);
  if (intent.signature !== expectedSignature) {
    throw new Error('Firma digital inválida. Si no hay firma válida, no hay ejecución.');
  }

  return intent;
}

export function rotateWalletState(db: Database, userId: string, movementType: string, details: {
  amount: number;
  mode?: WalletMode;
  signature?: string;
  payload?: unknown;
}) {
  const wallet = getWallet(db, userId);
  const previousStateId = wallet.stateId;
  const nextNonce = wallet.movementNonce + 1;
  const createdAt = nowIso();
  const movementId = `MOV-${nanoid(12).toUpperCase()}`;
  const payloadHash = sha256(stableStringify(details.payload ?? {}));

  const balanceSnapshot = {
    demoBalance: wallet.demoBalance,
    realBalance: wallet.realBalance,
    giftLocked: wallet.giftLocked,
    giftWagerRequired: wallet.giftWagerRequired,
    giftWagerProgress: wallet.giftWagerProgress
  };

  const newStateId = `WAL-${sha256(stableStringify({
    previousStateId,
    movementId,
    movementType,
    nextNonce,
    payloadHash,
    balanceSnapshot,
    createdAt
  })).slice(0, 24).toUpperCase()}`;

  wallet.stateId = newStateId;
  wallet.movementNonce = nextNonce;
  wallet.lastMovementId = movementId;
  wallet.lastSignature = details.signature || sha256(`${movementType}:${payloadHash}:${createdAt}`);
  wallet.lastRotatedAt = createdAt;
  wallet.signatureScheme = 'J123-SHA256-MVP';

  const movement: WalletMovement = {
    id: movementId,
    userId,
    movementType,
    previousStateId,
    newStateId,
    movementNonce: nextNonce,
    amount: details.amount,
    mode: details.mode,
    signature: wallet.lastSignature,
    signatureScheme: wallet.signatureScheme,
    payloadHash,
    balanceSnapshot,
    createdAt
  };

  const audit = appendAudit(db, 'WALLET_STATE_ROTATED', movement.id, movement);
  movement.auditHash = audit.chainHash;
  db.walletMovements.push(movement);

  return { wallet, movement, audit };
}
