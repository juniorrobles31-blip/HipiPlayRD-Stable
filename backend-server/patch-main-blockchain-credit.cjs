"use strict";

const fs = require("node:fs");

const file = process.argv[2];

if (!file) {
    throw new Error("Falta ruta server.js.");
}

let text = fs.readFileSync(file, "utf8");

if (text.includes("HIPIPLAY BLOCKCHAIN V2 PURCHASE CREDIT - START")) {
    console.log(JSON.stringify({
        ok: true,
        alreadyPatched: true
    }, null, 2));
    process.exit(0);
}

const marker = "// HIPIPLAY DUAL BALANCE SHADOW - END";

if (!text.includes(marker)) {
    throw new Error("No encontre marcador DUAL BALANCE SHADOW END.");
}

const insert = `

// HIPIPLAY BLOCKCHAIN V2 PURCHASE CREDIT - START
const HIPI_BLOCKCHAIN_V2_CREDIT_SECRET_FILE =
  path.join(__dirname, "blockchain-v2", "blockchain-credit-secret.txt");

const HIPI_BLOCKCHAIN_V2_CREDITED_FILE =
  path.join(dataDir, "blockchain-v2-credited-intents.json");

function hipiReadBlockchainCreditSecret() {
  try {
    return fs.readFileSync(HIPI_BLOCKCHAIN_V2_CREDIT_SECRET_FILE, "utf8").trim();
  }
  catch {
    return "";
  }
}

function hipiLoadCreditedBlockchainIntents() {
  try {
    if (!fs.existsSync(HIPI_BLOCKCHAIN_V2_CREDITED_FILE)) {
      return {};
    }

    const parsed =
      JSON.parse(fs.readFileSync(HIPI_BLOCKCHAIN_V2_CREDITED_FILE, "utf8"));

    return parsed && typeof parsed === "object" ? parsed : {};
  }
  catch {
    return {};
  }
}

function hipiPersistCreditedBlockchainIntents(value) {
  fs.writeFileSync(
    HIPI_BLOCKCHAIN_V2_CREDITED_FILE,
    JSON.stringify(value || {}, null, 2),
    "utf8"
  );
}

function hipiNormalizeCreditAmount(value) {
  const amount =
    Number(value || 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Monto de credito invalido.");
  }

  return Math.floor(amount);
}

app.post("/api/blockchain-v2/credit-purchased", express.json({ limit: "1mb" }), (req, res) => {
  try {
    const expectedSecret =
      hipiReadBlockchainCreditSecret();

    const providedSecret =
      String(
        req.get("x-blockchain-credit-secret") ||
        req.body?.secret ||
        ""
      ).trim();

    if (!expectedSecret || providedSecret !== expectedSecret) {
      return res.status(401).json({
        ok: false,
        error: "UNAUTHORIZED_BLOCKCHAIN_CREDIT"
      });
    }

    const body =
      req.body || {};

    const intentId =
      String(
        body.intentId ||
        body.paymentIntentId ||
        ""
      ).trim();

    const playerId =
      String(
        body.playerId ||
        body.userId ||
        ""
      ).trim();

    const amount =
      hipiNormalizeCreditAmount(
        body.amount ||
        body.expectedAmount ||
        body.receivedAmount
      );

    if (!intentId || !playerId) {
      return res.status(400).json({
        ok: false,
        error: "intentId y playerId son obligatorios."
      });
    }

    const credited =
      hipiLoadCreditedBlockchainIntents();

    if (credited[intentId]) {
      return res.json({
        ok: true,
        alreadyCredited: true,
        credit: credited[intentId],
        balance: getPlayerBalancePayload(playerId),
        dualAccount: dualBalanceService.getAccount(playerId)
      });
    }

    const beforeAccount =
      dualBalanceService.getAccount(playerId);

    const credit =
      dualBalanceService.creditPurchased(
        playerId,
        amount,
        {
          type: "BLOCKCHAIN_V2_USDT_DEPOSIT",
          referenceId: "BLOCKCHAIN_V2:" + intentId,
          metadata: {
            intentId,
            network: body.network || null,
            networkLabel: body.networkLabel || null,
            token: body.token || body.tokenSymbol || "USDT",
            depositAddress: body.depositAddress || null,
            sourceWallet: body.sourceWallet || body.customerWallet || body.fromAddress || null,
            pwa: body.pwa || "HipiPlay"
          }
        }
      );

    const legacyBalance =
      setPlayerBalance(
        playerId,
        Number(credit.account.totalBalance)
      );

    const record = {
      intentId,
      playerId,
      amount,
      token: body.token || body.tokenSymbol || "USDT",
      network: body.network || null,
      networkLabel: body.networkLabel || null,
      depositAddress: body.depositAddress || null,
      sourceWallet: body.sourceWallet || body.customerWallet || body.fromAddress || null,
      balanceBefore: beforeAccount.totalBalance,
      balanceAfter: credit.account.totalBalance,
      purchasedBalanceAfter: credit.account.purchasedBalance,
      promoBalanceAfter: credit.account.promoBalance,
      legacyBalance,
      ledgerEntryId: credit.ledgerEntry ? credit.ledgerEntry.id : null,
      creditedAt: new Date().toISOString()
    };

    credited[intentId] =
      record;

    hipiPersistCreditedBlockchainIntents(credited);

    addLedgerEntry({
      type: "BLOCKCHAIN_V2_PURCHASED_CREDIT",
      playerId,
      amount,
      intentId,
      token: record.token,
      network: record.network,
      networkLabel: record.networkLabel,
      depositAddress: record.depositAddress,
      sourceWallet: record.sourceWallet,
      balanceBefore: record.balanceBefore,
      balanceAfter: record.balanceAfter,
      purchasedBalanceAfter: record.purchasedBalanceAfter,
      promoBalanceAfter: record.promoBalanceAfter
    });

    if (typeof broadcastState === "function") {
      broadcastState();
    }

    return res.json({
      ok: true,
      credited: true,
      credit: record,
      balance: getPlayerBalancePayload(playerId),
      dualAccount: credit.account,
      ledgerEntry: credit.ledgerEntry || null
    });
  }
  catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "No se pudo acreditar la recarga blockchain."
    });
  }
});
// HIPIPLAY BLOCKCHAIN V2 PURCHASE CREDIT - END
`;

text = text.replace(marker, insert + "\n" + marker);

fs.writeFileSync(file, text, "utf8");

const after = fs.readFileSync(file, "utf8");

const result = {
    ok: true,
    hasEndpoint: after.includes('/api/blockchain-v2/credit-purchased'),
    hasCreditPurchased: after.includes('dualBalanceService.creditPurchased'),
    hasIdempotency: after.includes('blockchain-v2-credited-intents.json'),
    hasSecretValidation: after.includes('UNAUTHORIZED_BLOCKCHAIN_CREDIT')
};

console.log(JSON.stringify(result, null, 2));

for (const [key, value] of Object.entries(result)) {
    if (!value) {
        throw new Error("Validacion fallida: " + key);
    }
}