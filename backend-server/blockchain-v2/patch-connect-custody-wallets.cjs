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

const depositRegex =
  /const\s+depositAddress\s*=\s*simulatedVaultAddress\s*\(\s*vaultId\s*\)\s*;/;

if (!depositRegex.test(text)) {
  const around = text
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(item => item.line.includes("simulatedVaultAddress") || item.line.includes("depositAddress"))
    .slice(0, 40);

  throw new Error(
    "No pude reemplazar const depositAddress = simulatedVaultAddress(vaultId). Contexto: " +
    JSON.stringify(around)
  );
}

text = text.replace(
  depositRegex,
  `let depositAddress = simulatedVaultAddress(vaultId);
    let custodyWallet = null;

    const custodyReservation =
        hipiReserveCustodyWalletForIntent(
            intentId,
            playerId
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
    }`
);

const result = {
  ok: true,
  hasCustodyHelper: text.includes("HIPIPLAY CUSTODY REAL WALLETS - START"),
  usesManager: text.includes("custody-wallet-manager.js"),
  reservesWallet: text.includes("hipiReserveCustodyWalletForIntent"),
  replacesSimulatedAddress: text.includes("let depositAddress = simulatedVaultAddress(vaultId);"),
  requiresCustodyWallet: text.includes("No se pudo reservar wallet custody real para el intent")
};

fs.writeFileSync(file, text, "utf8");

console.log(JSON.stringify(result, null, 2));

for (const [key, value] of Object.entries(result)) {
  if (!value) {
    throw new Error("Validacion fallida: " + key);
  }
}