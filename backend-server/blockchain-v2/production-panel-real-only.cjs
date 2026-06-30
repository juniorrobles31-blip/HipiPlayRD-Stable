"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const panelFile = process.argv[2];
const panelConfigFile = process.argv[3];
const detectorFile = process.argv[4];
const walletsFile = process.argv[5];
const dbFile = process.argv[6];
const backupRoot = process.argv[7];

const USDT_BSC =
  "0x55d398326f99059fF775485246999027B3197955";

const archiveFile =
  path.join(backupRoot, "production-real-only-archive.json");

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

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

const archive = {
  createdAt: new Date().toISOString(),
  db: {},
  panel: {},
  detector: {},
  config: {},
  wallets: {}
};

/*
  1. Config del panel a modo produccion.
*/
const config = readJson(panelConfigFile, {});

config.mode = "BSC_MAINNET_CUSTODY_PRODUCTION";
config.network = "BSC";
config.networkLabel = "BSC / BEP20";
config.chainId = 56;
config.tokenSymbol = "USDT";
config.tokenAddress = USDT_BSC;

writeJson(panelConfigFile, config);

archive.config.updated = true;

/*
  2. Limpiar DB de datos simulados.
*/
const walletsRaw = readJson(walletsFile, []);
const wallets = Array.isArray(walletsRaw) ? walletsRaw : [walletsRaw];

const realAddresses =
  new Set(
    wallets
      .map(item => normalizeAddress(item.address))
      .filter(Boolean)
  );

archive.wallets.total = wallets.length;
archive.wallets.addresses = [...realAddresses];

const db = new DatabaseSync(dbFile);

try {
  const tables =
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map(row => row.name);

  db.exec("BEGIN TRANSACTION");

  if (tables.includes("chain_events")) {
    const before =
      db.prepare("SELECT COUNT(*) AS c FROM chain_events").get().c;

    const cols =
      db.prepare("PRAGMA table_info(chain_events)").all().map(item => item.name);

    let deleted = 0;

    if (cols.includes("chain_id")) {
      deleted += db.prepare("DELETE FROM chain_events WHERE chain_id = 97").run().changes;
    }

    if (cols.includes("contract_address")) {
      deleted += db.prepare(
        "DELETE FROM chain_events WHERE lower(contract_address) = lower(?)"
      ).run("0x0000000000000000000000000000000000001000").changes;
    }

    const after =
      db.prepare("SELECT COUNT(*) AS c FROM chain_events").get().c;

    archive.db.chainEvents = {
      before,
      after,
      deleted
    };
  }

  if (tables.includes("ledger_entries")) {
    const before =
      db.prepare("SELECT COUNT(*) AS c FROM ledger_entries").get().c;

    const cols =
      db.prepare("PRAGMA table_info(ledger_entries)").all().map(item => item.name);

    let deleted = 0;

    if (cols.includes("reference_id")) {
      deleted += db.prepare(
        "DELETE FROM ledger_entries WHERE reference_id LIKE '97:%'"
      ).run().changes;
    }

    if (cols.includes("player_id")) {
      deleted += db.prepare(
        "DELETE FROM ledger_entries WHERE player_id LIKE 'usr_demo_%'"
      ).run().changes;
    }

    const after =
      db.prepare("SELECT COUNT(*) AS c FROM ledger_entries").get().c;

    archive.db.ledgerEntries = {
      before,
      after,
      deleted
    };
  }

  if (tables.includes("payment_intents")) {
    const cols =
      db.prepare("PRAGMA table_info(payment_intents)").all().map(item => item.name);

    const setParts = [];
    const args = [];

    if (cols.includes("network")) {
      setParts.push(q("network") + " = ?");
      args.push("bsc-mainnet");
    }

    if (cols.includes("chain_id")) {
      setParts.push(q("chain_id") + " = ?");
      args.push(56);
    }

    if (cols.includes("token_address")) {
      setParts.push(q("token_address") + " = ?");
      args.push(USDT_BSC);
    }

    if (cols.includes("mode")) {
      setParts.push(q("mode") + " = ?");
      args.push("BSC_MAINNET_CUSTODY_PRODUCTION");
    }

    if (setParts.length > 0) {
      const result =
        db.prepare(
          "UPDATE payment_intents SET " + setParts.join(", ")
        ).run(...args);

      archive.db.paymentIntentsUpdated = result.changes;
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

/*
  3. Panel: quitar nombres/rutas/textos de simulacion.
  OJO:
  El endpoint interno se renombra de simulate-deposit a mark-paid-real.
*/
let panel =
  fs.readFileSync(panelFile, "utf8");

const beforePanel = panel;

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
    USDT_BSC
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
    /Modo:\s*SIMULADOR hasta despliegue BSC Testnet\./g,
    "Modo: PRODUCCION BSC/BEP20 custody."
  );

panel =
  panel.replace(
    /SIMULADOR hasta despliegue BSC Testnet\./g,
    "PRODUCCION BSC/BEP20 custody."
  );

panel =
  panel.replace(
    /Panel intermedio para probar compras, generar wallet\/vault y ver estatus de pagos\./g,
    "Panel de custodia BSC/BEP20 para recargas reales, wallets custody y estados de pago."
  );

panel =
  panel.replace(
    /function simulatedVaultAddress\s*\(/g,
    "function legacyFallbackVaultAddress("
  );

panel =
  panel.replace(
    /simulatedVaultAddress\s*\(/g,
    "legacyFallbackVaultAddress("
  );

panel =
  panel.replace(
    /function simulateDeposit\s*\(/g,
    "function markRealDeposit("
  );

panel =
  panel.replace(
    /simulateDeposit\s*\(/g,
    "markRealDeposit("
  );

panel =
  panel.replace(
    /simulateMatch/g,
    "realPaidMatch"
  );

panel =
  panel.replace(
    /simulate-deposit/g,
    "mark-paid-real"
  );

panel =
  panel.replace(
    /async function simulate\s*\(/g,
    "async function markPaidRealClient("
  );

panel =
  panel.replace(
    /onclick="simulate\(/g,
    "onclick=\"markPaidRealClient("
  );

panel =
  panel.replace(
    /<button class="warn"[^>]*>[^<]*(Pago real automatico|Simular pago)[^<]*<\/button>/gi,
    ""
  );

panel =
  panel.replace(
    /Simular pago/g,
    "Pago real automático"
  );

panel =
  panel.replace(
    /"generate"\s*,\s*"20"/g,
    "\"generate\", \"1\""
  );

panel =
  panel.replace(
    /"generate",\s*"20"/g,
    "\"generate\", \"1\""
  );

fs.writeFileSync(panelFile, panel, "utf8");

archive.panel.changed = beforePanel !== panel;
archive.panel.hasBadText =
  /SIMULATED_UNTIL_BSC_TESTNET_DEPLOY|bsc-testnet-demo|Simular pago|simulate-deposit|simulateDeposit|simulatedVaultAddress/i.test(panel);

/*
  4. Detector: usar endpoint real.
*/
let detector =
  fs.readFileSync(detectorFile, "utf8");

const beforeDetector = detector;

detector =
  detector.replace(
    /simulate-deposit/g,
    "mark-paid-real"
  );

detector =
  detector.replace(
    /REAL_ONCHAIN_DEPOSIT_DETECTED/g,
    "REAL_BSC_BALANCE_DETECTED"
  );

fs.writeFileSync(detectorFile, detector, "utf8");

archive.detector.changed = beforeDetector !== detector;
archive.detector.usesRealEndpoint = detector.includes("mark-paid-real");

writeJson(archiveFile, archive);

console.log(JSON.stringify({
  ok: true,
  archiveFile,
  walletsKept: wallets.length,
  realAddresses: [...realAddresses],
  configMode: config.mode,
  db: archive.db,
  panelChanged: archive.panel.changed,
  panelHasBadText: archive.panel.hasBadText,
  detectorChanged: archive.detector.changed,
  detectorUsesRealEndpoint: archive.detector.usesRealEndpoint
}, null, 2));