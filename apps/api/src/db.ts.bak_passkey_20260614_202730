import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { Database, User, Wallet } from './types.js';
import { sha256 } from './audit.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const now = () => new Date().toISOString();

function buildWalletStateId(userId: string, seed: string) {
  return `WAL-${sha256(`${userId}:${seed}`).slice(0, 20).toUpperCase()}`;
}

export function normalizeWallet(wallet: Wallet): Wallet {
  const seed = `${wallet.userId}:${wallet.demoBalance}:${wallet.realBalance}`;
  wallet.stateId = wallet.stateId || buildWalletStateId(wallet.userId, seed);
  wallet.movementNonce = Number.isFinite(wallet.movementNonce) ? wallet.movementNonce : 0;
  wallet.signatureScheme = wallet.signatureScheme || 'J123-SHA256-MVP';
  return wallet;
}

function defaultDb(): Database {
  const admin: User = {
    id: 'usr_admin',
    username: 'admin',
    passwordHash: bcrypt.hashSync('admin123', 10),
    createdAt: now()
  };

  const wallet: Wallet = {
    userId: admin.id,
    demoBalance: 10000,
    realBalance: 5000,
    giftLocked: 0,
    giftWagerRequired: 0,
    giftWagerProgress: 0,
    stateId: buildWalletStateId(admin.id, 'initial-admin-wallet'),
    movementNonce: 0,
    signatureScheme: 'J123-SHA256-MVP',
    lastRotatedAt: now()
  };

  return {
    users: [admin],
    wallets: [wallet],
    events: [],
    bets: [],
    derbyRaces: [],
    derbyBets: [],
    tokenBurns: [],
    minuteOwnerPayouts: [],
    audits: [],
    referralLinks: [],
    referralPurchases: [],
    poolRounds: [],
    poolScores: [],
    walletMovements: []
  };
}

function normalizeDb(raw: Partial<Database>): Database {
  const base = defaultDb();
  const wallets = (raw.wallets ?? base.wallets).map(w => normalizeWallet(w));
  return {
    users: raw.users ?? base.users,
    wallets,
    events: raw.events ?? [],
    bets: raw.bets ?? [],
    derbyRaces: raw.derbyRaces ?? [],
    derbyBets: raw.derbyBets ?? [],
    tokenBurns: raw.tokenBurns ?? [],
    minuteOwnerPayouts: raw.minuteOwnerPayouts ?? [],
    audits: raw.audits ?? [],
    referralLinks: raw.referralLinks ?? [],
    referralPurchases: raw.referralPurchases ?? [],
    poolRounds: raw.poolRounds ?? [],
    poolScores: raw.poolScores ?? [],
    walletMovements: raw.walletMovements ?? []
  };
}

export function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) saveDb(defaultDb());
  else saveDb(normalizeDb(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as Partial<Database>));
}

export function loadDb(): Database {
  ensureDb();
  return normalizeDb(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as Partial<Database>);
}

export function saveDb(db: Database) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(normalizeDb(db), null, 2), 'utf8');
}

export function getWallet(db: Database, userId: string): Wallet {
  let wallet = db.wallets.find(w => w.userId === userId);
  if (!wallet) {
    wallet = {
      userId,
      demoBalance: 10000,
      realBalance: 0,
      giftLocked: 0,
      giftWagerRequired: 0,
      giftWagerProgress: 0,
      stateId: buildWalletStateId(userId, `new-wallet-${Date.now()}`),
      movementNonce: 0,
      signatureScheme: 'J123-SHA256-MVP',
      lastRotatedAt: now()
    };
    db.wallets.push(wallet);
  }
  return normalizeWallet(wallet);
}
