export type WalletMode = 'demo' | 'real';

export type User = {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
};

export type Wallet = {
  userId: string;
  demoBalance: number;
  realBalance: number;
  giftLocked: number;
  giftWagerRequired: number;
  giftWagerProgress: number;

  /**
   * Identificador rotativo del estado de wallet.
   * Cada movimiento de saldo destruye el ID anterior y genera uno nuevo.
   */
  stateId: string;
  movementNonce: number;
  signatureScheme: 'J123-SHA256-MVP' | 'WEBAUTHN_READY' | 'WALLET_READY';
  lastMovementId?: string;
  lastSignature?: string;
  lastRotatedAt?: string;
};

export type WalletIntent = {
  payload: {
    movementType: string;
    userId: string;
    previousStateId: string;
    movementNonce: number;
    raceId?: string;
    raceCode?: string;
    mode?: WalletMode;
    amount?: number;
    horse?: number;
    timestamp: string;
  };
  signature: string;
  signatureScheme: 'J123-SHA256-MVP';
};

export type WalletMovement = {
  id: string;
  userId: string;
  movementType: string;
  previousStateId: string;
  newStateId: string;
  movementNonce: number;
  amount: number;
  mode?: WalletMode;
  signature: string;
  signatureScheme: string;
  payloadHash: string;
  balanceSnapshot: {
    demoBalance: number;
    realBalance: number;
    giftLocked: number;
    giftWagerRequired: number;
    giftWagerProgress: number;
  };
  auditHash?: string;
  createdAt: string;
};

export type GameEvent = {
  id: string;
  game: string;
  seedCommit: string;
  result: unknown;
  status: 'created' | 'closed' | 'revealed';
  createdAt: string;
  revealedAt?: string;
};

export type Bet = {
  id: string;
  userId: string;
  game: string;
  mode: WalletMode;
  amount: number;
  selection: unknown;
  result: unknown;
  payout: number;
  profitLoss: number;
  createdAt: string;
};

export type DerbyRace = {
  id: string;
  code: string;
  status: 'betting' | 'locked' | 'revealed';
  startsAt: string;
  betClosesAt: string;
  revealsAt: string;
  seedCommit: string;
  serverSeed?: string;
  resultOrder?: number[];
  top3?: number[];
  totalVolume: number;
  totalRealVolume: number;
  totalWinnersPaid: number;
  totalBurned: number;
  ownerMinuteAmount: number;
  ownerUserId?: string;
  auditHash?: string;
  createdAt: string;
  revealedAt?: string;
};

export type DerbyBet = {
  id: string;
  raceId: string;
  raceCode: string;
  userId: string;
  mode: WalletMode;
  selectedHorse: number;
  amount: number;
  status: 'pending' | 'won' | 'lost';
  resultOrder?: number[];
  payout: number;
  profitLoss: number;
  createdAt: string;
  resolvedAt?: string;
};

export type TokenBurn = {
  id: string;
  raceId: string;
  userId: string;
  betId: string;
  mode: WalletMode;
  amountBurned: number;
  reason: string;
  createdAt: string;
};

export type MinuteOwnerPayout = {
  id: string;
  raceId: string;
  ownerUserId: string;
  sourceType: 'pool_score' | 'manual' | 'none';
  baseAmount: number;
  percentage: number;
  payoutAmount: number;
  status: 'gift_locked' | 'skipped';
  auditHash?: string;
  createdAt: string;
};

export type AuditLog = {
  id: string;
  eventType: string;
  eventId: string;
  payloadHash: string;
  previousHash: string | null;
  chainHash: string;
  blockchainStatus: 'pending' | 'sent' | 'failed';
  txHash?: string;
  createdAt: string;
};

export type ReferralLink = {
  id: string;
  inviterUserId: string;
  token: string;
  status: 'active' | 'revoked';
  createdAt: string;
};

export type ReferralPurchase = {
  id: string;
  inviterUserId: string;
  invitedUserId?: string;
  token: string;
  amount: number;
  counted: boolean;
  createdAt: string;
};

export type PoolRound = {
  id: string;
  code: string;
  startedAt: string;
  closedAt?: string;
  status: 'open' | 'closed';
  poolPercentage: number;
  grossProfit: number;
  poolAmount: number;
  winnerUserId?: string;
  winnerScore?: number;
};

export type PoolScore = {
  userId: string;
  scoreCount: number;
  firstReachedAt?: string;
};

export type Database = {
  users: User[];
  wallets: Wallet[];
  events: GameEvent[];
  bets: Bet[];
  derbyRaces: DerbyRace[];
  derbyBets: DerbyBet[];
  tokenBurns: TokenBurn[];
  minuteOwnerPayouts: MinuteOwnerPayout[];
  audits: AuditLog[];
  referralLinks: ReferralLink[];
  referralPurchases: ReferralPurchase[];
  poolRounds: PoolRound[];
  poolScores: PoolScore[];
  walletMovements: WalletMovement[];
};
