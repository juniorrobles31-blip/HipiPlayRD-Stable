"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const walletsFile = process.argv[2];
const dbFile = process.argv[3];
const backupRoot = process.argv[4];

if (!walletsFile || !dbFile || !backupRoot) {
  throw new Error("Faltan argumentos.");
}

const archiveFile =
  path.join(backupRoot, "removed-demo-final-archive.json");

function readJson(file, fallback) {
  const raw =
    fs.existsSync(file)
      ? fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim()
      : "";

  return raw ? JSON.parse(raw) : fallback;
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function q(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function isZero(value) {
  const text = String(value || "0").trim();

  if (!text) return true;

  try {
    return BigInt(text) === 0n;
  }
  catch {
    return Number(text) === 0;
  }
}

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function placeholders(items) {
  return items.map(() => "?").join(",");
}

const archive = {
  createdAt: new Date().toISOString(),
  walletsRemoved: [],
  dbDeleted: {},
  tables: []
};

/*
  1. Wallets:
  Eliminar wallets demo/vacias:
  - AVAILABLE vacias
  - ASSIGNED a usr_demo_ vacias
  Conservar:
  - PAYOUT_HOT
  - cualquier wallet con USDT o BNB
  - cualquier wallet asignada a player no demo
*/
const walletsRaw = readJson(walletsFile, []);
const wallets = Array.isArray(walletsRaw) ? walletsRaw : [walletsRaw];

const kept = [];
const removed = [];

for (const wallet of wallets) {
  const role = String(wallet.role || "");
  const status = String(wallet.status || "");
  const assignedPlayerId = String(wallet.assignedPlayerId || "");

  const hasUSDT =
    !isZero(wallet.balanceUSDTAtomic) ||
    Number(wallet.balanceUSDT || 0) > 0;

  const hasBNB =
    !isZero(wallet.balanceBNBAtomic) ||
    Number(wallet.balanceBNB || 0) > 0;

  const isDemoAssigned =
    assignedPlayerId.startsWith("usr_demo_");

  const shouldRemove =
    role !== "PAYOUT_HOT" &&
    !hasUSDT &&
    !hasBNB &&
    (
      status === "AVAILABLE" ||
      isDemoAssigned
    );

  if (shouldRemove) {
    removed.push({
      walletId: wallet.walletId,
      role,
      status,
      address: wallet.address,
      assignedIntentId: wallet.assignedIntentId || null,
      assignedPlayerId: wallet.assignedPlayerId || null,
      balanceUSDT: wallet.balanceUSDT,
      balanceBNB: wallet.balanceBNB
    });
  }
  else {
    kept.push(wallet);
  }
}

writeJson(walletsFile, kept);
archive.walletsRemoved = removed;

const keptAddresses =
  new Set(
    kept
      .map(item => normalizeAddress(item.address))
      .filter(Boolean)
  );

/*
  2. DB:
  Eliminar datos demo/simulados:
  - player_id usr_demo_%
  - chain_id 97
  - token fake
  - vault/deposit addresses que ya no existen en custody
*/
const db = new DatabaseSync(dbFile);

try {
  const tables =
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map(row => row.name);

  archive.tables = tables;

  db.exec("BEGIN TRANSACTION");

  for (const table of tables) {
    const cols =
      db.prepare("PRAGMA table_info(" + q(table) + ")")
        .all()
        .map(item => item.name);

    archive.dbDeleted[table] = 0;

    for (const col of ["player_id", "playerId", "user_id", "userId"]) {
      if (cols.includes(col)) {
        const result =
          db.prepare(
            "DELETE FROM " + q(table) +
            " WHERE " + q(col) + " LIKE 'usr_demo_%'"
          ).run();

        archive.dbDeleted[table] += result.changes;
      }
    }

    for (const col of ["chain_id", "chainId"]) {
      if (cols.includes(col)) {
        const result =
          db.prepare(
            "DELETE FROM " + q(table) +
            " WHERE " + q(col) + " = 97"
          ).run();

        archive.dbDeleted[table] += result.changes;
      }
    }

    for (const col of ["token_address", "tokenAddress", "contract_address", "contractAddress"]) {
      if (cols.includes(col)) {
        const result =
          db.prepare(
            "DELETE FROM " + q(table) +
            " WHERE lower(" + q(col) + ") = lower(?)"
          ).run("0x0000000000000000000000000000000000001000");

        archive.dbDeleted[table] += result.changes;
      }
    }

    for (const col of ["reference_id", "referenceId"]) {
      if (cols.includes(col)) {
        const result =
          db.prepare(
            "DELETE FROM " + q(table) +
            " WHERE " + q(col) + " LIKE '97:%'"
          ).run();

        archive.dbDeleted[table] += result.changes;
      }
    }
  }

  /*
    Limpieza adicional payment_intents por wallet no conservada.
  */
  if (tables.includes("payment_intents")) {
    const cols =
      db.prepare("PRAGMA table_info(payment_intents)")
        .all()
        .map(item => item.name);

    const vaultCol =
      cols.includes("vault_address")
        ? "vault_address"
        : cols.includes("vaultAddress")
          ? "vaultAddress"
          : cols.includes("deposit_address")
            ? "deposit_address"
            : null;

    if (vaultCol) {
      const rows =
        db.prepare("SELECT rowid, * FROM payment_intents").all();

      const removeRowIds =
        rows
          .filter(row => {
            const addr = normalizeAddress(row[vaultCol]);
            return addr && !keptAddresses.has(addr);
          })
          .map(row => row.rowid);

      if (removeRowIds.length > 0) {
        const result =
          db.prepare(
            "DELETE FROM payment_intents WHERE rowid IN (" +
            placeholders(removeRowIds) +
            ")"
          ).run(...removeRowIds);

        archive.dbDeleted.payment_intents =
          (archive.dbDeleted.payment_intents || 0) + result.changes;
      }
    }
  }

  db.exec("COMMIT");
}
catch (error) {
  try {
    db.exec("ROLLBACK");
  }
  catch {}

  throw error;
}
finally {
  db.close();
}

writeJson(archiveFile, archive);

console.log(JSON.stringify({
  ok: true,
  walletsBefore: wallets.length,
  walletsKept: kept.length,
  walletsRemoved: removed.length,
  keptWallets: kept.map(item => ({
    walletId: item.walletId,
    role: item.role,
    status: item.status,
    address: item.address,
    assignedIntentId: item.assignedIntentId || null,
    assignedPlayerId: item.assignedPlayerId || null
  })),
  removedWallets: removed,
  dbDeleted: archive.dbDeleted,
  archiveFile
}, null, 2));