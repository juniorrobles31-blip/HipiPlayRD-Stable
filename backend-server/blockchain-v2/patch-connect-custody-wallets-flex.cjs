"use strict";

const fs = require("node:fs");

const file = process.argv[2];

if (!file) {
  throw new Error("Falta payment-console-server.js");
}

let text = fs.readFileSync(file, "utf8");

if (text.includes("HIPIPLAY CUSTODY REAL WALLETS - START")) {
  console.log(JSON.stringify({
    ok: true,
    alreadyPatched: true
  }, null, 2));
  process.exit(0);
}

if (!text.includes("function createIntent")) {
  throw new Error("No encontre function createIntent.");
}

if (!text.includes("simulatedVaultAddress")) {
  throw new Error("No encontre simulatedVaultAddress.");
}

const helper = `

// HIPIPLAY CUSTODY REAL WALLETS - START
const HIPI_CUSTODY_CP =
  require("node:child_process");

const HIPI_CUSTODY_PATH =
  require("node:path");

const HIPI_CUSTODY_MANAGER_FILE =
  HIPI_CUSTODY_PATH.join(__dirname, "custody-wallet-manager.js");

function hipiRunCustodyManager(args) {
  const output =
    HIPI_CUSTODY_CP.execFileSync(
      process.execPath,
      [
        HIPI_CUSTODY_MANAGER_FILE,
        ...args
      ],
      {
        cwd: __dirname,
        encoding: "utf8",
        stdio: [
          "ignore",
          "pipe",
          "pipe"
        ],
        timeout: 30000
      }
    );

  return JSON.parse(output);
}

function hipiReserveCustodyWalletForIntent(intentId, playerId) {
  try {
    return hipiRunCustodyManager([
      "reserve",
      String(intentId || ""),
      String(playerId || "")
    ]);
  }
  catch (error) {
    const message =
      String(error.stderr || error.message || "");

    if (
      message.includes("No hay wallets custody disponibles") ||
      message.includes("Genera mas wallets")
    ) {
      hipiRunCustodyManager([
        "generate",
        "20"
      ]);

      return hipiRunCustodyManager([
        "reserve",
        String(intentId || ""),
        String(playerId || "")
      ]);
    }

    throw error;
  }
}
// HIPIPLAY CUSTODY REAL WALLETS - END
`;

text = text.replace(
  /function\s+createIntent\s*\(/,
  helper + "\nfunction createIntent("
);

const depositPattern =
  /const\s+depositAddress\s*=\s*[\r\n\s]*simulatedVaultAddress\s*\(\s*vaultId\s*\)\s*;/m;

if (!depositPattern.test(text)) {
  const around = text
    .split(/\r?\n/)
    .map((line, index) => ({ number: index + 1, line }))
    .filter(item =>
      item.line.includes("simulatedVaultAddress") ||
      item.line.includes("depositAddress") ||
      item.line.includes("vaultAddress")
    )
    .slice(0, 80);

  throw new Error(
    "No pude ubicar el bloque multilinea depositAddress/simulatedVaultAddress. Contexto: " +
    JSON.stringify(around)
  );
}

text = text.replace(
  depositPattern,
  `let depositAddress =
        simulatedVaultAddress(vaultId);

    let custodyWallet = null;`
);

const reserveBlock = `
    // HIPIPLAY_CUSTODY_RESERVE_BEFORE_DB_WRITE
    const hipiIntentIdForCustody =
        typeof intentId !== "undefined"
            ? intentId
            : (
                typeof payload !== "undefined" &&
                payload &&
                (
                    payload.intentId ||
                    payload.intent_id
                )
            );

    const hipiPlayerIdForCustody =
        typeof playerId !== "undefined"
            ? playerId
            : (
                typeof payload !== "undefined" &&
                payload &&
                (
                    payload.playerId ||
                    payload.player_id ||
                    payload.userId
                )
            );

    const custodyReservation =
        hipiReserveCustodyWalletForIntent(
            hipiIntentIdForCustody,
            hipiPlayerIdForCustody
        );

    if (
        custodyReservation &&
        custodyReservation.wallet &&
        custodyReservation.wallet.address
    ) {
        custodyWallet =
            custodyReservation.wallet;

        depositAddress =
            custodyReservation.wallet.address;
    }

    if (!custodyWallet || !custodyWallet.address) {
        throw new Error("No se pudo reservar wallet custody real para el intent.");
    }

    if (
        typeof payload !== "undefined" &&
        payload &&
        typeof payload === "object"
    ) {
        payload.vaultAddress =
            depositAddress;

        payload.vault_address =
            depositAddress;

        payload.depositAddress =
            depositAddress;

        payload.custodyWalletId =
            custodyWallet.walletId || null;
    }

`;

let inserted = false;

const databaseCreatePattern =
  /(\s*)if\s*\(\s*typeof\s+database\.createPaymentIntent\s*===\s*["']function["']\s*\)\s*\{/m;

if (databaseCreatePattern.test(text)) {
  text = text.replace(
    databaseCreatePattern,
    reserveBlock + "$1if (typeof database.createPaymentIntent === \"function\") {"
  );

  inserted = true;
}

if (!inserted) {
  const insertFilteredPattern =
    /(\s*)insertFiltered\s*\(\s*["']payment_intents["']\s*,\s*\{/m;

  if (insertFilteredPattern.test(text)) {
    text = text.replace(
      insertFilteredPattern,
      reserveBlock + "$1insertFiltered(\"payment_intents\", {"
    );

    inserted = true;
  }
}

if (!inserted) {
  const around = text
    .split(/\r?\n/)
    .map((line, index) => ({ number: index + 1, line }))
    .filter(item =>
      item.line.includes("createPaymentIntent") ||
      item.line.includes("insertFiltered") ||
      item.line.includes("payment_intents")
    )
    .slice(0, 80);

  throw new Error(
    "No encontre punto seguro antes de guardar payment_intents. Contexto: " +
    JSON.stringify(around)
  );
}

const result = {
  ok: true,
  hasCustodyHelper: text.includes("HIPIPLAY CUSTODY REAL WALLETS - START"),
  usesManager: text.includes("custody-wallet-manager.js"),
  hasLetDepositAddress: text.includes("let depositAddress"),
  hasReserveBeforeDbWrite: text.includes("HIPIPLAY_CUSTODY_RESERVE_BEFORE_DB_WRITE"),
  updatesPayloadVaultAddress: text.includes("payload.vaultAddress"),
  requiresCustodyWallet: text.includes("No se pudo reservar wallet custody real para el intent")
};

fs.writeFileSync(file, text, "utf8");

console.log(JSON.stringify(result, null, 2));

for (const [key, value] of Object.entries(result)) {
  if (!value) {
    throw new Error("Validacion fallida: " + key);
  }
}