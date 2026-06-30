"use strict";

const fs = require("node:fs");

const file = process.argv[2];

if (!file) {
  throw new Error("Falta payment-console-server.js");
}

let text = fs.readFileSync(file, "utf8");

if (!text.includes("function createIntent")) {
  throw new Error("No encontre function createIntent.");
}

if (!text.includes("function simulatedVaultAddress")) {
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

if (!text.includes("HIPIPLAY CUSTODY REAL WALLETS - START")) {
  text = text.replace(
    /function\s+createIntent\s*\(/,
    helper + "\nfunction createIntent("
  );
}

const vaultPattern =
  /const\s+vaultAddress\s*=\s*[\r\n\s]*simulatedVaultAddress\s*\(\s*vaultId\s*\)\s*;/m;

if (!vaultPattern.test(text)) {
  const context = text
    .split(/\r?\n/)
    .map((line, index) => ({
      number: index + 1,
      line
    }))
    .filter(item =>
      item.line.includes("vaultAddress") ||
      item.line.includes("simulatedVaultAddress") ||
      item.line.includes("vault_address") ||
      item.line.includes("intentId") ||
      item.line.includes("playerId")
    )
    .slice(0, 120);

  throw new Error(
    "No encontre const vaultAddress = simulatedVaultAddress(vaultId). Contexto: " +
    JSON.stringify(context)
  );
}

const custodyReplacement = `
    let vaultAddress =
        simulatedVaultAddress(vaultId);

    let custodyWallet = null;

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
                    payload.userId ||
                    payload.user_id
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

        vaultAddress =
            custodyReservation.wallet.address;
    }

    if (!custodyWallet || !custodyWallet.address) {
        throw new Error("No se pudo reservar wallet custody real para el intent.");
    }
`;

text = text.replace(vaultPattern, custodyReplacement);

const result = {
  ok: true,
  hasCustodyHelper: text.includes("HIPIPLAY CUSTODY REAL WALLETS - START"),
  usesManager: text.includes("custody-wallet-manager.js"),
  hasLetVaultAddress: text.includes("let vaultAddress"),
  reservesCustody: text.includes("hipiReserveCustodyWalletForIntent"),
  blocksWithoutWallet: text.includes("No se pudo reservar wallet custody real para el intent."),
  stillPersistsVaultAddress: text.includes("vault_address: vaultAddress")
};

fs.writeFileSync(file, text, "utf8");

console.log(JSON.stringify(result, null, 2));

for (const [key, value] of Object.entries(result)) {
  if (!value) {
    throw new Error("Validacion fallida: " + key);
  }
}