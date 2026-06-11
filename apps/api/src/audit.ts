import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { Database } from './types.js';

export function sha256(payload: unknown) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function hmac(seed: string, payload: string) {
  return crypto.createHmac('sha256', seed).update(payload).digest('hex');
}

export function appendAudit(db: Database, eventType: string, eventId: string, payload: unknown) {
  const previous = db.audits.at(-1)?.chainHash ?? null;
  const payloadHash = sha256(payload);
  const chainHash = sha256({ previous, eventType, eventId, payloadHash });

  const audit = {
    id: nanoid(),
    eventType,
    eventId,
    payloadHash,
    previousHash: previous,
    chainHash,
    blockchainStatus: 'pending' as const,
    createdAt: new Date().toISOString()
  };

  db.audits.push(audit);
  return audit;
}
