"use strict";

const fs = require("node:fs");

const file = process.argv[2];

if (!file) {
  throw new Error("Falta custody-real-deposit-detector.js");
}

let text = fs.readFileSync(file, "utf8");

if (!text.includes("function loadConfig")) {
  throw new Error("No encontre function loadConfig.");
}

if (!text.includes("scanIncomingTransfers")) {
  throw new Error("No encontre scanIncomingTransfers.");
}

if (!text.includes("useEventLogs")) {
  text = text.replace(
    /requireExactOrGreaterAmount:\s*detector\.requireExactOrGreaterAmount\s*!==\s*false/,
    `requireExactOrGreaterAmount: detector.requireExactOrGreaterAmount !== false,
      useEventLogs: detector.useEventLogs === true`
  );
}

const oldBlock = `    const events = await scanIncomingTransfers({
      provider,
      token,
      toAddress: depositAddress,
      fromBlock: walletScanFrom,
      toBlock: currentBlock,
      chunkBlocks: detector.chunkBlocks
    });`;

const newBlock = `    let events = [];
    let logScanError = null;

    if (detector.useEventLogs === true) {
      try {
        events = await scanIncomingTransfers({
          provider,
          token,
          toAddress: depositAddress,
          fromBlock: walletScanFrom,
          toBlock: currentBlock,
          chunkBlocks: detector.chunkBlocks
        });
      }
      catch (error) {
        logScanError =
          error && error.message
            ? error.message
            : String(error || "eth_getLogs failed");

        events = [];
      }
    }`;

if (text.includes(oldBlock)) {
  text = text.replace(oldBlock, newBlock);
}
else if (!text.includes("let logScanError = null;")) {
  throw new Error("No encontre bloque exacto de scanIncomingTransfers para reemplazar.");
}

if (!text.includes("logScanError,")) {
  text = text.replace(
    /confirmations,\s*\n\s*amountIsEnough,/,
    `confirmations,
      logScanError,
      amountIsEnough,`
  );
}

if (!text.includes("useEventLogs: detector.autoMarkPaid")) {
  text = text.replace(
    /autoMarkPaid:\s*detector\.autoMarkPaid,\s*\n\s*minConfirmations:/,
    `autoMarkPaid: detector.autoMarkPaid,
    useEventLogs: detector.useEventLogs,
    minConfirmations:`
  );
}

const result = {
  ok: true,
  hasUseEventLogs: text.includes("useEventLogs"),
  hasBalanceFallback: text.includes("let logScanError = null;"),
  stillUsesBalanceOf: text.includes("token.balanceOf(depositAddress)"),
  noForcedLogs: text.includes("if (detector.useEventLogs === true)")
};

fs.writeFileSync(file, text, "utf8");

console.log(JSON.stringify(result, null, 2));

for (const [key, value] of Object.entries(result)) {
  if (!value) {
    throw new Error("Validacion fallida: " + key);
  }
}