"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  DatabaseSync
} = require("node:sqlite");

const panelFile = process.argv[2];
const walletsFile = process.argv[3];
const dbFile = process.argv[4];
const backupRoot = process.argv[5];

if (!panelFile || !walletsFile || !dbFile || !backupRoot) {
  throw new Error("Faltan argumentos.");
}

const archiveFile =
  path.join(
    backupRoot,
    "archived-production-cleanup.json"
  );

function readJson(file, fallback) {
  const raw =
    fs.existsSync(file)
      ? fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim()
      : "";

  return raw ? JSON.parse(raw) : fallback;
}

function writeJson(file, value) {
  fs.writeFileSync(
    file,
    JSON.stringify(value, null, 2),
    "utf8"
  );
}

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function amountIsZero(value) {
  const text = String(value || "0").trim();

  if (!text) return true;

  try {
    return BigInt(text) === 0n;
  }
  catch {
    return Number(text) === 0;
  }
}

function q(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function placeholders(items) {
  return items.map(() => "?").join(",");
}

const archive = {
  createdAt: new Date().toISOString(),
  walletsRemoved: [],
  paymentIntentsRemoved: [],
  relatedRowsRemoved: {},
  panelPatches: {}
};

/*
  1. Limpiar wallets:
  Se conservan:
  - PAYOUT_HOT
  - ASSIGNED
  - cualquier wallet con USDT o BNB
  - cualquier wallet no AVAILABLE
*/
const walletsRaw = readJson(walletsFile, []);
const wallets = Array.isArray(walletsRaw) ? walletsRaw : [walletsRaw];

const keptWallets = [];
const removedWallets = [];

for (const wallet of wallets) {
  const role = String(wallet.role || "");
  const status = String(wallet.status || "");

  const hasUSDT =
    !amountIsZero(wallet.balanceUSDTAtomic) ||
    Number(wallet.balanceUSDT || 0) > 0;

  const hasBNB =
    !amountIsZero(wallet.balanceBNBAtomic) ||
    Number(wallet.balanceBNB || 0) > 0;

  const keep =
    role === "PAYOUT_HOT" ||
    status === "ASSIGNED" ||
    status === "ACTIVE" ||
    hasUSDT ||
    hasBNB;

  if (keep) {
    keptWallets.push(wallet);
  }
  else {
    removedWallets.push({
      walletId: wallet.walletId,
      address: wallet.address,
      role,
      status,
      balanceUSDT: wallet.balanceUSDT,
      balanceBNB: wallet.balanceBNB
    });
  }
}

writeJson(walletsFile, keptWallets);
archive.walletsRemoved = removedWallets;

const realAddresses =
  new Set(
    keptWallets
      .map(item => normalizeAddress(item.address))
      .filter(Boolean)
  );

/*
  2. Limpiar intents viejos/simulados:
  Se eliminan de la DB los payment_intents cuya vault_address
  no pertenezca a una wallet custody real conservada.
*/
const db = new DatabaseSync(dbFile);

const tables =
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map(row => row.name);

if (tables.includes("payment_intents")) {
  const paymentColumns =
    db.prepare("PRAGMA table_info(payment_intents)").all();

  const columnNames =
    paymentColumns.map(item => item.name);

  const idCol =
    columnNames.includes("intent_id")
      ? "intent_id"
      : columnNames.includes("intentId")
        ? "intentId"
        : columnNames.includes("id")
          ? "id"
          : null;

  const vaultCol =
    columnNames.includes("vault_address")
      ? "vault_address"
      : columnNames.includes("vaultAddress")
        ? "vaultAddress"
        : columnNames.includes("deposit_address")
          ? "deposit_address"
          : null;

  if (idCol && vaultCol) {
    const rows =
      db.prepare("SELECT * FROM payment_intents").all();

    const removeRows =
      rows.filter(row => {
        const addr = normalizeAddress(row[vaultCol]);
        return addr && !realAddresses.has(addr);
      });

    const ids =
      removeRows
        .map(row => String(row[idCol] || "").trim())
        .filter(Boolean);

    archive.paymentIntentsRemoved = removeRows;

    if (ids.length > 0) {
      const tx = db.transaction(() => {
        for (const table of tables) {
          const columns =
            db.prepare("PRAGMA table_info(" + q(table) + ")").all();

          const names =
            columns.map(item => item.name);

          const relatedIntentCol =
            names.includes("intent_id")
              ? "intent_id"
              : names.includes("intentId")
                ? "intentId"
                : null;

          if (
            relatedIntentCol &&
            table !== "payment_intents"
          ) {
            const sqlSelect =
              "SELECT * FROM " +
              q(table) +
              " WHERE " +
              q(relatedIntentCol) +
              " IN (" +
              placeholders(ids) +
              ")";

            const relatedRows =
              db.prepare(sqlSelect).all(...ids);

            if (relatedRows.length > 0) {
              archive.relatedRowsRemoved[table] = relatedRows;

              const sqlDelete =
                "DELETE FROM " +
                q(table) +
                " WHERE " +
                q(relatedIntentCol) +
                " IN (" +
                placeholders(ids) +
                ")";

              db.prepare(sqlDelete).run(...ids);
            }
          }
        }

        const sqlDeletePayment =
          "DELETE FROM payment_intents WHERE " +
          q(idCol) +
          " IN (" +
          placeholders(ids) +
          ")";

        db.prepare(sqlDeletePayment).run(...ids);
      });

      tx();
    }
  }
}

db.close();

writeJson(archiveFile, archive);

/*
  3. Panel production cleanup:
  - Oculta boton Simular pago
  - cambia textos de modo simulado
  - cambia generacion automatica de 20 wallets a 1 por intent
  - cambia labels testnet/demo a mainnet custody
*/
let panel =
  fs.readFileSync(panelFile, "utf8");

const before = panel;

panel =
  panel.replace(
    /SIMULATED_UNTIL_BSC_TESTNET_DEPLOY/g,
    "BSC_MAINNET_CUSTODY_PRODUCTION"
  );

panel =
  panel.replace(
    /bsc-testnet-demo/g,
    "bsc-mainnet"
  );

panel =
  panel.replace(
    /0x0000000000000000000000000000000000001000/g,
    "0x55d398326f99059fF775485246999027B3197955"
  );

panel =
  panel.replace(
    /chainId:\s*97/g,
    "chainId: 56"
  );

panel =
  panel.replace(
    /chain_id:\s*97/g,
    "chain_id: 56"
  );

panel =
  panel.replace(
    /"chainId"\s*:\s*97/g,
    "\"chainId\": 56"
  );

panel =
  panel.replace(
    /Panel intermedio para probar compras, generar wallet\/vault y ver estatus de pagos\./g,
    "Panel de custodia BSC/BEP20 para recargas reales, wallets custody y estados de pago."
  );

panel =
  panel.replace(
    /<button class="warn"\s+onclick="simulate\('\\\$\{item\.intentId\}'\)">Simular pago<\/button>/g,
    ""
  );

panel =
  panel.replace(
    /<button class="warn"\s+onclick="simulate\('\$\{item\.intentId\}'\)">Simular pago<\/button>/g,
    ""
  );

panel =
  panel.replace(
    /Simular pago/g,
    "Pago real automatico"
  );

panel =
  panel.replace(
    /"generate"\s*,\s*"20"/g,
    "\"generate\", \"1\""
  );

archive.panelPatches = {
  changed: before !== panel,
  hasSimulatedText: /SIMULATED_UNTIL_BSC_TESTNET_DEPLOY|bsc-testnet-demo|Simular pago/.test(panel),
  futureGenerateOneWallet: panel.includes("\"generate\", \"1\""),
  productionModeText: panel.includes("BSC_MAINNET_CUSTODY_PRODUCTION")
};

fs.writeFileSync(panelFile, panel, "utf8");

writeJson(archiveFile, archive);

console.log(JSON.stringify({
  ok: true,
  walletsBefore: wallets.length,
  walletsKept: keptWallets.length,
  walletsRemoved: removedWallets.length,
  realAddresses: [...realAddresses],
  removedWallets,
  removedPaymentIntents: archive.paymentIntentsRemoved.length,
  relatedTablesTouched: Object.keys(archive.relatedRowsRemoved),
  archiveFile,
  panelPatches: archive.panelPatches
}, null, 2));