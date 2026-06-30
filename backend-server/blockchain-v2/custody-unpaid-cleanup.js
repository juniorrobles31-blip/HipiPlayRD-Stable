"use strict";

const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const BCV2 = __dirname;
const DATA = path.join(ROOT, "data", "blockchain-v2");

const CONFIG_FILE = path.join(BCV2, "custody-unpaid-cleanup.config.json");
const DB_FILE = path.join(DATA, "blockchain-v2.sqlite");
const WALLET_FILE = path.join(DATA, "custody-wallets-bsc.json");
const METADATA_FILE = path.join(DATA, "payment-intent-metadata.json");
const DETECTED_FILE = path.join(DATA, "custody-real-deposits-detected.json");
const AUDIT_FILE = path.join(DATA, "custody-unpaid-cleanup-audit.json");
const BALANCE_SYNC = path.join(BCV2, "custody-balance-sync.js");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;

    let raw = fs.readFileSync(file, "utf8");

    raw = String(raw || "")
      .replace(/^\uFEFF/, "")
      .replace(/\u0000/g, "")
      .trim();

    if (!raw) return fallback;

    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function nowMs() {
  return Date.now();
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function parseTimeMs(value) {
  if (value === null || value === undefined || value === "") return 0;

  if (typeof value === "number") {
    if (value > 1000000000000) return value;
    if (value > 1000000000) return value * 1000;
    return 0;
  }

  const raw = String(value).trim();

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n > 1000000000000) return n;
    if (n > 1000000000) return n * 1000;
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function pickColumn(columns, names) {
  const lowerMap = new Map(columns.map(c => [String(c.name).toLowerCase(), c.name]));

  for (const name of names) {
    const found = lowerMap.get(String(name).toLowerCase());
    if (found) return found;
  }

  return null;
}

function getAny(row, columns) {
  for (const col of columns) {
    if (row[col] !== undefined && row[col] !== null && row[col] !== "") {
      return row[col];
    }
  }

  return "";
}

function findIntentId(row, intentCols) {
  for (const col of intentCols) {
    const value = row[col];

    if (value && /^PAY-/i.test(String(value))) {
      return String(value).trim();
    }
  }

  for (const value of Object.values(row)) {
    if (value && /^PAY-/i.test(String(value))) {
      return String(value).trim();
    }
  }

  return "";
}

function amountValue(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function walletHasFunds(wallet) {
  const fields = [
    "usdtBalance",
    "usdt_balance",
    "balanceUSDT",
    "balanceUsdt",
    "bnbBalance",
    "bnb_balance",
    "nativeBalance",
    "native_balance"
  ];

  for (const field of fields) {
    if (amountValue(wallet[field]) > 0) return true;
  }

  return false;
}

function detectedHasIntent(detected, intentId) {
  const raw = JSON.stringify(detected || {});
  return intentId && raw.includes(intentId);
}

function detectedHasAddress(detected, address) {
  if (!address) return false;
  const raw = JSON.stringify(detected || {}).toLowerCase();
  return raw.includes(String(address).toLowerCase());
}

function runBalanceSync() {
  if (!fs.existsSync(BALANCE_SYNC)) return { ok: false, reason: "balance sync no existe" };

  try {
    cp.execFileSync(process.execPath, [BALANCE_SYNC], {
      cwd: BCV2,
      stdio: "ignore",
      timeout: 45000
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function loadSqlite() {
  try {
    const sqlite = require("node:sqlite");
    const db = new sqlite.DatabaseSync(DB_FILE);

    return {
      all(sql, params = []) {
        return db.prepare(sql).all(...params);
      },
      run(sql, params = []) {
        return db.prepare(sql).run(...params);
      },
      close() {
        db.close();
      }
    };
  } catch (err) {
    throw new Error("No se pudo abrir SQLite con node:sqlite. Node actual debe soportarlo. Detalle: " + err.message);
  }
}

function findIntentTables(db) {
  const tables = db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");

  const candidates = [];

  for (const table of tables) {
    const tableName = table.name;
    const columns = db.all(`PRAGMA table_info(${quoteIdent(tableName)})`);

    const colNames = columns.map(c => c.name);

    const statusCol = pickColumn(columns, [
      "status",
      "paymentStatus",
      "payment_status",
      "state"
    ]);

    const createdCol = pickColumn(columns, [
      "createdAt",
      "created_at",
      "created",
      "createdMs",
      "created_ms",
      "timestamp",
      "ts",
      "time",
      "requestedAt",
      "requested_at",
      "insertedAt",
      "inserted_at"
    ]);

    const intentCols = colNames.filter(name =>
      /intent|payment/i.test(name) || String(name).toLowerCase() === "id"
    );

    const addressCols = colNames.filter(name =>
      /address|wallet|vault|deposit/i.test(name)
    );

    let score = 0;

    if (/intent|payment/i.test(tableName)) score += 4;
    if (statusCol) score += 4;
    if (createdCol) score += 2;
    if (intentCols.length) score += 3;
    if (addressCols.length) score += 2;

    if (score >= 7 && statusCol && intentCols.length) {
      candidates.push({
        tableName,
        columns,
        colNames,
        statusCol,
        createdCol,
        intentCols,
        addressCols,
        score
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  return candidates;
}

function cleanupMetadata(intentIds) {
  if (!fs.existsSync(METADATA_FILE)) return { changed: false, removed: 0 };

  const metadata = readJson(METADATA_FILE, {});
  const before = JSON.stringify(metadata);
  let removed = 0;

  for (const intentId of intentIds) {
    if (metadata && typeof metadata === "object") {
      if (metadata[intentId]) {
        delete metadata[intentId];
        removed++;
      }

      for (const key of Object.keys(metadata)) {
        const value = metadata[key];

        if (JSON.stringify(value || {}).includes(intentId)) {
          delete metadata[key];
          removed++;
        }
      }
    }
  }

  const after = JSON.stringify(metadata);

  if (before !== after) {
    writeJson(METADATA_FILE, metadata);
    return { changed: true, removed };
  }

  return { changed: false, removed };
}

function cleanupWallets(cleanedItems, config, detected) {
  const walletDoc = readJson(WALLET_FILE, null);

  if (!walletDoc) {
    return {
      changed: false,
      released: 0,
      quarantined: 0,
      skippedWithFunds: 0
    };
  }

  const wallets =
    Array.isArray(walletDoc) ? walletDoc :
    Array.isArray(walletDoc.wallets) ? walletDoc.wallets :
    Array.isArray(walletDoc.items) ? walletDoc.items :
    [];

  let released = 0;
  let quarantined = 0;
  let skippedWithFunds = 0;
  let changed = false;

  for (const item of cleanedItems) {
    const intentId = item.intentId;
    const address = String(item.address || "").toLowerCase();

    const wallet = wallets.find(w => {
      const role = String(w.role || "").toUpperCase();

      if (role.includes("PAYOUT")) return false;

      const assigned =
        w.assignedIntent ||
        w.assignedIntentId ||
        w.intentId ||
        w.paymentIntentId ||
        w.payment_intent_id ||
        w.assigned_intent_id;

      const walletAddress = String(w.address || "").toLowerCase();

      return (
        (intentId && assigned && String(assigned) === String(intentId)) ||
        (address && walletAddress === address)
      );
    });

    if (!wallet) continue;

    const hasFunds =
      walletHasFunds(wallet) ||
      detectedHasIntent(detected, intentId) ||
      detectedHasAddress(detected, wallet.address);

    if (hasFunds && config.quarantineWalletsWithFunds) {
      wallet.status = "NEEDS_REVIEW_FUNDS_DETECTED";
      wallet.cleanupStatus = "FUNDS_DETECTED_AFTER_UNPAID";
      wallet.cleanupAt = new Date().toISOString();
      wallet.cleanupIntentId = intentId;
      skippedWithFunds++;
      changed = true;
      continue;
    }

    if (config.requireZeroBalanceToReleaseWallet && hasFunds) {
      skippedWithFunds++;
      continue;
    }

    if (config.releaseWalletsWithoutFunds) {
      wallet.status = "AVAILABLE";
      wallet.assignedIntent = null;
      wallet.assignedIntentId = null;
      wallet.intentId = null;
      wallet.paymentIntentId = null;
      wallet.payment_intent_id = null;
      wallet.assigned_intent_id = null;
      wallet.assignedPlayerId = null;
      wallet.playerId = null;
      wallet.userId = null;
      wallet.reservedAt = null;
      wallet.assignedAt = null;
      wallet.lastUnpaidCleanupAt = new Date().toISOString();
      wallet.lastUnpaidCleanupIntentId = intentId;
      wallet.cleanupCount = Number(wallet.cleanupCount || 0) + 1;
      released++;
      changed = true;
    }
  }

  if (changed) {
    writeJson(WALLET_FILE, walletDoc);
  }

  return {
    changed,
    released,
    quarantined,
    skippedWithFunds
  };
}

function main() {
  const config = readJson(CONFIG_FILE, { enabled: false });

  if (!config.enabled) {
    console.log(JSON.stringify({ ok: true, enabled: false }, null, 2));
    return;
  }

  const paidStatuses = new Set((config.paidStatuses || []).map(normalizeStatus));
  const cleanStatuses = new Set((config.statusesToClean || []).map(normalizeStatus));
  const maxAgeMs = Number(config.maxPendingSeconds || 60) * 1000;

  const balanceSync = runBalanceSync();

  const detected = readJson(DETECTED_FILE, {});
  const db = loadSqlite();

  const candidates = findIntentTables(db);

  let cleanedItems = [];
  let tableUsed = null;

  for (const table of candidates) {
    const rows = db.all(`SELECT rowid AS __rowid, * FROM ${quoteIdent(table.tableName)}`);

    const expired = [];

    for (const row of rows) {
      const status = normalizeStatus(row[table.statusCol]);

      if (paidStatuses.has(status)) continue;
      if (!cleanStatuses.has(status)) continue;

      const intentId = findIntentId(row, table.intentCols);

      if (!intentId) continue;

      const createdRaw = table.createdCol ? row[table.createdCol] : "";
      const createdMs = parseTimeMs(createdRaw);

      if (!createdMs) continue;

      const ageMs = nowMs() - createdMs;

      if (ageMs < maxAgeMs) continue;

      const address = String(getAny(row, table.addressCols) || "").trim();

      if (detectedHasIntent(detected, intentId) || detectedHasAddress(detected, address)) {
        continue;
      }

      expired.push({
        tableName: table.tableName,
        rowid: row.__rowid,
        intentId,
        status,
        createdAt: createdRaw,
        ageSeconds: Math.floor(ageMs / 1000),
        address
      });
    }

    if (expired.length > 0) {
      tableUsed = table.tableName;

      if (config.deleteUnpaidIntentsFromPanel) {
        for (const item of expired) {
          db.run(`DELETE FROM ${quoteIdent(table.tableName)} WHERE rowid = ?`, [item.rowid]);
        }
      }
      else {
        for (const item of expired) {
          db.run(`UPDATE ${quoteIdent(table.tableName)} SET ${quoteIdent(table.statusCol)} = ? WHERE rowid = ?`, ["CLEANED_UNPAID", item.rowid]);
        }
      }

      cleanedItems = expired;
      break;
    }
  }

  db.close();

  const metadata = cleanupMetadata(cleanedItems.map(x => x.intentId));
  const walletCleanup = cleanupWallets(cleanedItems, config, detected);

  const audit = readJson(AUDIT_FILE, []);
  audit.push({
    at: new Date().toISOString(),
    tableUsed,
    balanceSync,
    cleanedCount: cleanedItems.length,
    cleanedItems,
    metadata,
    walletCleanup
  });

  while (audit.length > 500) audit.shift();

  writeJson(AUDIT_FILE, audit);

  console.log(JSON.stringify({
    ok: true,
    maxPendingSeconds: config.maxPendingSeconds,
    tableUsed,
    cleanedCount: cleanedItems.length,
    walletCleanup,
    metadata,
    balanceSync
  }, null, 2));
}

main();
