'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function createDualBalanceService(options = {}) {
  const dataDir = options.dataDir;
  const welcomePromoAmount = normalizeAmount(
    options.welcomePromoAmount === undefined
      ? 1000
      : options.welcomePromoAmount
  );

  if (!dataDir) {
    throw new Error('Dual balance: dataDir is required.');
  }

  const accountsFile = path.join(
    dataDir,
    'player-balance-accounts.json'
  );

  const ledgerFile = path.join(
    dataDir,
    'player-balance-ledger-v2.json'
  );

  ensureDataFiles();

  let accounts = readJson(accountsFile, {});
  let ledger = readJson(ledgerFile, []);

  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) {
    throw new Error('Dual balance: accounts file must contain an object.');
  }

  if (!Array.isArray(ledger)) {
    throw new Error('Dual balance: ledger file must contain an array.');
  }

  function ensureDataFiles() {
    fs.mkdirSync(dataDir, { recursive: true });

    if (!fs.existsSync(accountsFile)) {
      atomicWriteJson(accountsFile, {});
    }

    if (!fs.existsSync(ledgerFile)) {
      atomicWriteJson(ledgerFile, []);
    }
  }

  function readJson(filePath, fallback) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return fallback;
      }

      throw new Error(
        `Dual balance: invalid JSON in ${filePath}: ${error.message}`
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

  function persistAccounts() {
    atomicWriteJson(accountsFile, accounts);
  }

  function persistLedger() {
    atomicWriteJson(ledgerFile, ledger);
  }

  function normalizePlayerId(value) {
    const playerId = String(value || '').trim();

    if (!playerId) {
      throw new Error('Dual balance: playerId is required.');
    }

    return playerId;
  }

  function normalizeAmount(value) {
    const amount = Number(value);

    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Dual balance: invalid amount.');
    }

    return Math.floor(amount);
  }

  function accountPayload(account) {
    const promoBalance = normalizeAmount(
      account.promoBalance || 0
    );

    const purchasedBalance = normalizeAmount(
      account.purchasedBalance || 0
    );

    const totalBalance =
      promoBalance + purchasedBalance;

    return {
      playerId: account.playerId,
      promoBalance,
      purchasedBalance,
      totalBalance,
      balance: totalBalance,
      withdrawableCoins: purchasedBalance,
      welcomePromoGranted:
        account.welcomePromoGranted === true,
      welcomePromoGrantedAt:
        account.welcomePromoGrantedAt || null,
      migratedFromLegacyAt:
        account.migratedFromLegacyAt || null,
      createdAt:
        account.createdAt || null,
      updatedAt:
        account.updatedAt || null
    };
  }

  function ensureAccount(playerId, options = {}) {
    const id = normalizePlayerId(playerId);

    if (!accounts[id]) {
      const now = new Date().toISOString();

      accounts[id] = {
        playerId: id,
        promoBalance: normalizeAmount(
          options.promoBalance || 0
        ),
        purchasedBalance: normalizeAmount(
          options.purchasedBalance || 0
        ),
        welcomePromoGranted:
          options.welcomePromoGranted === true,
        welcomePromoGrantedAt:
          options.welcomePromoGrantedAt || null,
        migratedFromLegacyAt:
          options.migratedFromLegacyAt || null,
        createdAt: options.createdAt || now,
        updatedAt: now
      };

      persistAccounts();
    }

    return accountPayload(accounts[id]);
  }

  function getAccount(playerId) {
    const id = normalizePlayerId(playerId);

    if (!accounts[id]) {
      return ensureAccount(id);
    }

    return accountPayload(accounts[id]);
  }

  function getVisibleBalance(playerId) {
    return getAccount(playerId).totalBalance;
  }

  function appendLedgerEntry(entry) {
    const record = {
      id:
        `BAL2-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
      createdAt: new Date().toISOString(),
      ...entry
    };

    ledger.unshift(record);
    persistLedger();

    return record;
  }

  function grantWelcomePromo(playerId, options = {}) {
    const id = normalizePlayerId(playerId);
    ensureAccount(id);

    const account = accounts[id];

    if (account.welcomePromoGranted === true) {
      return {
        granted: false,
        reason: 'ALREADY_GRANTED',
        account: accountPayload(account)
      };
    }

    const amount = normalizeAmount(
      options.amount === undefined
        ? welcomePromoAmount
        : options.amount
    );

    if (amount <= 0) {
      throw new Error(
        'Dual balance: welcome promo amount must be greater than zero.'
      );
    }

    const before = accountPayload(account);
    const now = new Date().toISOString();

    account.promoBalance =
      before.promoBalance + amount;

    account.welcomePromoGranted = true;
    account.welcomePromoGrantedAt = now;
    account.updatedAt = now;

    persistAccounts();

    const after = accountPayload(account);

    const ledgerEntry = appendLedgerEntry({
      playerId: id,
      account: 'PROMO',
      type: 'WELCOME_PROMO',
      direction: 'CREDIT',
      amount,
      referenceId:
        options.referenceId || `WELCOME_PROMO:${id}`,
      balanceBefore: before,
      balanceAfter: after
    });

    return {
      granted: true,
      amount,
      ledgerEntry,
      account: after
    };
  }

  function creditPurchased(playerId, amount, options = {}) {
    const id = normalizePlayerId(playerId);
    const cleanAmount = normalizeAmount(amount);

    if (cleanAmount <= 0) {
      throw new Error(
        'Dual balance: purchased credit must be greater than zero.'
      );
    }

    ensureAccount(id);

    const account = accounts[id];
    const before = accountPayload(account);

    account.purchasedBalance =
      before.purchasedBalance + cleanAmount;

    account.updatedAt = new Date().toISOString();

    persistAccounts();

    const after = accountPayload(account);

    const ledgerEntry = appendLedgerEntry({
      playerId: id,
      account: 'PURCHASED',
      type: options.type || 'USDT_PURCHASE',
      direction: 'CREDIT',
      amount: cleanAmount,
      referenceId: options.referenceId || null,
      metadata: options.metadata || null,
      balanceBefore: before,
      balanceAfter: after
    });

    return {
      amount: cleanAmount,
      ledgerEntry,
      account: after
    };
  }

  function debitForSpend(playerId, amount, options = {}) {
    const id = normalizePlayerId(playerId);
    const cleanAmount = normalizeAmount(amount);

    if (cleanAmount <= 0) {
      throw new Error(
        'Dual balance: debit must be greater than zero.'
      );
    }

    ensureAccount(id);

    const account = accounts[id];
    const before = accountPayload(account);

    if (before.totalBalance < cleanAmount) {
      throw new Error(
        `Insufficient balance. Available: ${before.totalBalance}, required: ${cleanAmount}.`
      );
    }

    const promoFirst = options.promoFirst !== false;

    let remaining = cleanAmount;
    let promoAmount = 0;
    let purchasedAmount = 0;

    if (promoFirst) {
      promoAmount = Math.min(
        before.promoBalance,
        remaining
      );

      remaining -= promoAmount;

      purchasedAmount = Math.min(
        before.purchasedBalance,
        remaining
      );
    } else {
      purchasedAmount = Math.min(
        before.purchasedBalance,
        remaining
      );

      remaining -= purchasedAmount;

      promoAmount = Math.min(
        before.promoBalance,
        remaining
      );
    }

    if (
      promoAmount + purchasedAmount !== cleanAmount
    ) {
      throw new Error(
        'Dual balance: debit composition mismatch.'
      );
    }

    account.promoBalance =
      before.promoBalance - promoAmount;

    account.purchasedBalance =
      before.purchasedBalance - purchasedAmount;

    account.updatedAt = new Date().toISOString();

    persistAccounts();

    const after = accountPayload(account);

    const composition = {
      promoAmount,
      purchasedAmount
    };

    const ledgerEntry = appendLedgerEntry({
      playerId: id,
      account: 'MIXED',
      type: options.type || 'SPEND',
      direction: 'DEBIT',
      amount: cleanAmount,
      composition,
      referenceId: options.referenceId || null,
      metadata: options.metadata || null,
      balanceBefore: before,
      balanceAfter: after
    });

    return {
      amount: cleanAmount,
      composition,
      ledgerEntry,
      account: after
    };
  }

  function creditComposition(playerId, composition, options = {}) {
    const id = normalizePlayerId(playerId);

    const promoAmount = normalizeAmount(
      composition && composition.promoAmount
        ? composition.promoAmount
        : 0
    );

    const purchasedAmount = normalizeAmount(
      composition && composition.purchasedAmount
        ? composition.purchasedAmount
        : 0
    );

    const totalAmount =
      promoAmount + purchasedAmount;

    if (totalAmount <= 0) {
      throw new Error(
        'Dual balance: composition credit must be greater than zero.'
      );
    }

    ensureAccount(id);

    const account = accounts[id];
    const before = accountPayload(account);

    account.promoBalance =
      before.promoBalance + promoAmount;

    account.purchasedBalance =
      before.purchasedBalance + purchasedAmount;

    account.updatedAt = new Date().toISOString();

    persistAccounts();

    const after = accountPayload(account);

    const normalizedComposition = {
      promoAmount,
      purchasedAmount
    };

    const ledgerEntry = appendLedgerEntry({
      playerId: id,
      account: 'MIXED',
      type: options.type || 'COMPOSITION_CREDIT',
      direction: 'CREDIT',
      amount: totalAmount,
      composition: normalizedComposition,
      referenceId: options.referenceId || null,
      metadata: options.metadata || null,
      balanceBefore: before,
      balanceAfter: after
    });

    return {
      amount: totalAmount,
      composition: normalizedComposition,
      ledgerEntry,
      account: after
    };
  }

  function transfer(playerIdFrom, playerIdTo, amount, options = {}) {
    const transferId =
      options.transferId ||
      `TRANSFER-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const debit = debitForSpend(
      playerIdFrom,
      amount,
      {
        type: options.type || 'PLAYER_TRANSFER_OUT',
        promoFirst: options.promoFirst !== false,
        referenceId: transferId,
        metadata: options.metadata || null
      }
    );

    try {
      const credit = creditComposition(
        playerIdTo,
        debit.composition,
        {
          type: options.creditType || 'PLAYER_TRANSFER_IN',
          referenceId: transferId,
          metadata: options.metadata || null
        }
      );

      return {
        transferId,
        amount: debit.amount,
        composition: debit.composition,
        fromAccount: debit.account,
        toAccount: credit.account
      };
    } catch (error) {
      creditComposition(
        playerIdFrom,
        debit.composition,
        {
          type: 'PLAYER_TRANSFER_ROLLBACK',
          referenceId: transferId,
          metadata: {
            reason: error.message
          }
        }
      );

      throw error;
    }
  }

  function listAccounts() {
    return Object.values(accounts).map(accountPayload);
  }

  function getLedger(playerId = null) {
    if (!playerId) {
      return ledger.slice();
    }

    const id = normalizePlayerId(playerId);

    return ledger.filter(
      entry => entry.playerId === id
    );
  }

  return {
    files: {
      accountsFile,
      ledgerFile
    },
    welcomePromoAmount,
    ensureAccount,
    getAccount,
    getVisibleBalance,
    grantWelcomePromo,
    creditPurchased,
    debitForSpend,
    creditComposition,
    transfer,
    listAccounts,
    getLedger
  };
};