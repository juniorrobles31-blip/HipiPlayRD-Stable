"use strict";

const fs = require("node:fs");

const file = process.argv[2];

if (!file) {
  throw new Error("Falta custody-real-deposit-detector.js");
}

let text = fs.readFileSync(file, "utf8");

const start = text.indexOf("function getIntentExpectedAtomic(intent, decimals) {");

if (start < 0) {
  throw new Error("No encontre function getIntentExpectedAtomic.");
}

const nextFunction = text.indexOf("\nfunction ", start + 1);

if (nextFunction < 0) {
  throw new Error("No encontre fin de getIntentExpectedAtomic.");
}

const replacement = `function getIntentExpectedAtomic(intent, decimals) {
  /*
    IMPORTANTE:
    El panel V2 historicamente guardaba expectedAmountAtomic en modo simulado
    con 6 decimales. En BSC/BEP20 real USDT usa 18 decimales.

    Por seguridad, para deteccion real on-chain se prefiere el monto humano:
    expectedAmount, expected_amount, amount, receivedAmount.

    expectedAmountAtomic queda como ultimo recurso.
  */

  const humanCandidates = [
    intent.expectedAmount,
    intent.expected_amount,
    intent.amount,
    intent.receivedAmount,
    intent.received_amount
  ];

  for (const candidate of humanCandidates) {
    const text = String(candidate || "").trim();

    if (
      text &&
      text !== "0" &&
      text !== "0.0" &&
      text !== "null" &&
      text !== "undefined"
    ) {
      return toAtomicAmount(text, decimals);
    }
  }

  if (intent.expectedAmountAtomic) {
    return BigInt(String(intent.expectedAmountAtomic));
  }

  if (intent.expected_amount_atomic) {
    return BigInt(String(intent.expected_amount_atomic));
  }

  return 0n;
}
`;

text =
  text.slice(0, start) +
  replacement +
  text.slice(nextFunction);

const result = {
  ok: true,
  prefersHumanAmount: text.includes("se prefiere el monto humano"),
  usesExpectedAmount: text.includes("intent.expectedAmount"),
  atomicLastResort: text.indexOf("intent.expectedAmountAtomic") > text.indexOf("humanCandidates")
};

fs.writeFileSync(file, text, "utf8");

console.log(JSON.stringify(result, null, 2));

for (const [key, value] of Object.entries(result)) {
  if (!value) {
    throw new Error("Validacion fallida: " + key);
  }
}