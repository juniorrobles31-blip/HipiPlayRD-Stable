import { z } from 'zod';
import { appendAudit, sha256 } from './audit.js';
import { loadDb, saveDb } from './db.js';

const ROUND_MS = 60_000;
const BET_CLOSE_MS = 55_000;
function pad(n: number) { return String(n).padStart(2, '0'); }

export function currentSeedPayload(now = Date.now()) {
  const roundStart = Math.floor(now / ROUND_MS) * ROUND_MS;
  const d = new Date(roundStart);
  const code = `DERBY-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  const seed = sha256(`${code}:JUEGA123_DERBY_MINUTE_PUBLIC_SEED_V1`);
  const seedCommit = sha256(seed);
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

const MovementSchema = z.object({
  movementId: z.string().min(4),
  userId: z.string().min(1),
  type: z.string().min(1),
  mode: z.enum(['demo', 'real']),
  amountSpent: z.number().nonnegative(),
  amountAdded: z.number().nonnegative(),
  balanceBefore: z.number(),
  balanceAfter: z.number(),
  previousWalletStateId: z.string().min(4),
  newWalletStateId: z.string().min(4),
  nonce: z.number().int().positive(),
  payloadHash: z.string().min(32),
  signature: z.string().min(32),
  signatureScheme: z.string().min(1),
  deviceKeyHash: z.string().min(32),
  createdAt: z.string().min(8),
  raceId: z.string().optional(),
  raceCode: z.string().optional()
}).passthrough();

export function registerLocalMovement(userId: string, rawMovement: unknown) {
  const parsed = MovementSchema.parse(rawMovement);
  if (parsed.userId !== userId) throw new Error('El movimiento no pertenece al usuario autenticado.');
  if (!parsed.signature || !parsed.payloadHash) throw new Error('Movimiento rechazado: falta firma o hash.');

  const db = loadDb();
  const eventId = parsed.movementId;
  const audit = appendAudit(db, 'LOCAL_FIRST_WALLET_MOVEMENT', eventId, {
    userHash: sha256(parsed.userId),
    movementId: parsed.movementId,
    type: parsed.type,
    mode: parsed.mode,
    amountSpent: parsed.amountSpent,
    amountAdded: parsed.amountAdded,
    previousWalletStateId: parsed.previousWalletStateId,
    newWalletStateId: parsed.newWalletStateId,
    nonce: parsed.nonce,
    payloadHash: parsed.payloadHash,
    signature: parsed.signature,
    signatureScheme: parsed.signatureScheme,
    deviceKeyHash: parsed.deviceKeyHash,
    raceId: parsed.raceId,
    raceCode: parsed.raceCode,
    createdAt: parsed.createdAt
  });
  saveDb(db);
  return { audit, txHash: audit.chainHash, blockchainStatus: audit.blockchainStatus };
}

export function registerLocalBatch(userId: string, movements: unknown[]) {
  return movements.map(m => registerLocalMovement(userId, m));
}
