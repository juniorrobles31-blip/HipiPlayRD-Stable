'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const backend = path.resolve(__dirname, '..');
const dataDir = path.join(backend, 'data');

const legacyFile = path.join(
  dataDir,
  'player-balances.json'
);

const accountsFile = path.join(
  dataDir,
  'player-balance-accounts.json'
);

const ledgerFile = path.join(
  dataDir,
  'player-balance-ledger-v2.json'
);

const migrationsDir = path.join(
  dataDir,
  'migrations'
);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(
      fs.readFileSync(filePath, 'utf8')
    );
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallback;
    }

    throw new Error(
      `Invalid JSON in ${filePath}: ${error.message}`
    );
  }
}

function atomicWriteJson(filePath, value) {
  const tempFile =
    `${filePath}.${process.pid}.${Date.now()}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(value, null, 2) + '\n',
    'utf8'
  );

  fs.renameSync(tempFile, filePath);
}

function sha256(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
    .toUpperCase();
}

function normalizeBalance(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(
      `Invalid legacy balance: ${value}`
    );
  }

  return Math.floor(amount);
}

if (!fs.existsSync(legacyFile)) {
  throw new Error(
    `Legacy balances file not found: ${legacyFile}`
  );
}

const existingAccounts =
  readJson(accountsFile, {});

const existingLedger =
  readJson(ledgerFile, []);

if (
  existingAccounts &&
  typeof existingAccounts === 'object' &&
  !Array.isArray(existingAccounts) &&
  Object.keys(existingAccounts).length > 0
) {
  throw new Error(
    'Dual accounts already contain data. Migration aborted.'
  );
}

if (
  Array.isArray(existingLedger) &&
  existingLedger.length > 0
) {
  throw new Error(
    'Dual ledger already contains data. Migration aborted.'
  );
}

const legacy = readJson(legacyFile, {});

if (
  !legacy ||
  typeof legacy !== 'object' ||
  Array.isArray(legacy)
) {
  throw new Error(
    'Legacy balances file must contain an object.'
  );
}

const now = new Date().toISOString();
const accounts = {};
const ledger = [];

let totalLegacy = 0;

for (const [playerId, rawRecord] of Object.entries(legacy)) {
  const balance = normalizeBalance(
    rawRecord && typeof rawRecord === 'object'
      ? rawRecord.balance
      : rawRecord
  );

  totalLegacy += balance;

  accounts[playerId] = {
    playerId,
    promoBalance: balance,
    purchasedBalance: 0,
    welcomePromoGranted: true,
    welcomePromoGrantedAt: now,
    migratedFromLegacyAt: now,
    createdAt:
      rawRecord &&
      typeof rawRecord === 'object' &&
      rawRecord.createdAt
        ? rawRecord.createdAt
        : now,
    updatedAt: now
  };

  ledger.push({
    id:
      `BAL2-MIG-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
    playerId,
    account: 'PROMO',
    type: 'LEGACY_BALANCE_MIGRATION',
    direction: 'CREDIT',
    amount: balance,
    referenceId:
      `LEGACY_BALANCE:${playerId}`,
    createdAt: now,
    balanceBefore: {
      playerId,
      promoBalance: 0,
      purchasedBalance: 0,
      totalBalance: 0,
      balance: 0,
      withdrawableCoins: 0
    },
    balanceAfter: {
      playerId,
      promoBalance: balance,
      purchasedBalance: 0,
      totalBalance: balance,
      balance,
      withdrawableCoins: 0
    }
  });
}

const totalPromo = Object.values(accounts).reduce(
  (sum, account) =>
    sum + account.promoBalance,
  0
);

const totalPurchased = Object.values(accounts).reduce(
  (sum, account) =>
    sum + account.purchasedBalance,
  0
);

if (totalLegacy !== totalPromo) {
  throw new Error(
    `Migration total mismatch. Legacy=${totalLegacy}, promo=${totalPromo}`
  );
}

atomicWriteJson(accountsFile, accounts);
atomicWriteJson(ledgerFile, ledger);

const reloadedAccounts =
  readJson(accountsFile, {});

const reloadedLedger =
  readJson(ledgerFile, []);

const reloadedTotalPromo =
  Object.values(reloadedAccounts).reduce(
    (sum, account) =>
      sum + normalizeBalance(account.promoBalance),
    0
  );

const reloadedTotalPurchased =
  Object.values(reloadedAccounts).reduce(
    (sum, account) =>
      sum + normalizeBalance(account.purchasedBalance),
    0
  );

if (
  Object.keys(reloadedAccounts).length !==
  Object.keys(accounts).length
) {
  throw new Error(
    'Reloaded account count does not match.'
  );
}

if (reloadedLedger.length !== ledger.length) {
  throw new Error(
    'Reloaded ledger count does not match.'
  );
}

if (reloadedTotalPromo !== totalLegacy) {
  throw new Error(
    'Reloaded promo total does not match.'
  );
}

fs.mkdirSync(
  migrationsDir,
  {
    recursive: true
  }
);

const stamp =
  new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

const reportFile = path.join(
  migrationsDir,
  `dual-balance-applied-${stamp}.json`
);

const report = {
  appliedAt: now,
  mode: 'APPLIED',
  legacyFile,
  accountsFile,
  ledgerFile,
  legacySha256: sha256(legacyFile),
  accountsSha256: sha256(accountsFile),
  ledgerSha256: sha256(ledgerFile),
  usersMigrated: Object.keys(accounts).length,
  ledgerEntriesCreated: ledger.length,
  legacyTotalCoins: totalLegacy,
  promoTotalCoins: reloadedTotalPromo,
  purchasedTotalCoins: reloadedTotalPurchased,
  totalsMatch:
    totalLegacy === reloadedTotalPromo,
  legacyFileModified: false,
  serverJsModified: false,
  backendRestarted: false
};

atomicWriteJson(reportFile, report);

console.log('');
console.log('DUAL BALANCE MIGRATION APPLIED');
console.log('');
console.log(`Users migrated: ${report.usersMigrated}`);
console.log(`Ledger entries created: ${report.ledgerEntriesCreated}`);
console.log(`Legacy total coins: ${report.legacyTotalCoins}`);
console.log(`Promo total coins: ${report.promoTotalCoins}`);
console.log(`Purchased total coins: ${report.purchasedTotalCoins}`);
console.log(`Totals match: ${report.totalsMatch}`);
console.log(`Legacy file modified: ${report.legacyFileModified}`);
console.log(`Server.js modified: ${report.serverJsModified}`);
console.log(`Backend restarted: ${report.backendRestarted}`);
console.log(`Report: ${reportFile}`);