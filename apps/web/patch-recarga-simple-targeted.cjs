"use strict";

const fs = require("node:fs");
const path = require("node:path");

const appFile = process.argv[2];
const srcRoot = process.argv[3];

let text = fs.readFileSync(appFile, "utf8");
const before = text;

const SIMPLE_MESSAGE = "Recarga recibida. Estamos validando el pago.";

function findCallEnd(src, openParenIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = openParenIndex; i < src.length; i++) {
    const ch = src[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === quote) {
        quote = null;
      }

      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "(") {
      depth++;
      continue;
    }

    if (ch === ")") {
      depth--;

      if (depth === 0) {
        let end = i + 1;

        while (end < src.length && /\s/.test(src[end])) end++;

        if (src[end] === ";") end++;

        return end;
      }
    }
  }

  return -1;
}

function replaceTechnicalStatusCalls(src) {
  const functionNames = [
    "setDepositStatusMessage",
    "setStatusMessage"
  ];

  let out = src;
  let total = 0;

  for (const fn of functionNames) {
    let searchFrom = 0;

    while (true) {
      const start = out.indexOf(fn + "(", searchFrom);

      if (start < 0) break;

      const openParen = out.indexOf("(", start);
      const end = findCallEnd(out, openParen);

      if (end < 0) {
        searchFrom = start + fn.length;
        continue;
      }

      const call = out.slice(start, end);

      const isDepositTechnical =
        /Wallet|Intent|Enviar|PAYMENT_PENDING|depositAddress|vault|address|0x[a-fA-F0-9]{8,}|fichas compradas|wallet destino/i.test(call);

      if (isDepositTechnical) {
        const replacement = `${fn}('${SIMPLE_MESSAGE}');`;
        out = out.slice(0, start) + replacement + out.slice(end);
        searchFrom = start + replacement.length;
        total++;
      }
      else {
        searchFrom = end;
      }
    }
  }

  return { out, total };
}

/*
  1. Reemplazar únicamente llamadas técnicas de status.
*/
const statusResult = replaceTechnicalStatusCalls(text);
text = statusResult.out;

/*
  2. Textos visibles mínimos.
*/
const replacements = [
  ["Ingresa tu wallet y el monto. Generaremos una dirección segura para completar tu recarga.", "Ingresa tu wallet y el monto."],
  ["Ingresa tu wallet y el monto. Generaremos una direccion segura para completar tu recarga.", "Ingresa tu wallet y el monto."],
  ["Escribe tu wallet, detectamos la carretera y generamos la wallet de pago.", "Ingresa tu wallet y el monto."],
  ["Generaremos una dirección segura para completar tu recarga.", ""],
  ["Generaremos una direccion segura para completar tu recarga.", ""],
  ["Red validada correctamente.", "BSC / BEP20"],
  ["Carretera detectada correctamente.", "BSC / BEP20"],
  ["Wallet de pago generada.", "Recarga recibida."],
  ["Wallet destino generada", "Recarga recibida"],
  ["Recarga creada", "Confirmación"],
  ["Generar wallet real", "Confirmar recarga"],
  ["Generar wallet", "Confirmar recarga"],
  ["Continuar", "Siguiente"],
  ["Cantidad USDT a recargar", "Monto"],
  ["Monto a recargar", "Monto"],
  ["PAYMENT_PENDING", "Pendiente"]
];

for (const [from, to] of replacements) {
  text = text.split(from).join(to);
}

/*
  3. Si el render usa depositStatusMessage directo, mostrar mensaje simple.
*/
text = text.replace(
  /\{\s*depositStatusMessage\s*\}/g,
  "{'Recarga recibida. Estamos validando el pago.'}"
);

text = text.replace(
  /\{\s*statusMessage\s*\}/g,
  "{'Recarga recibida. Estamos validando el pago.'}"
);

/*
  4. Si todavía hay renders de datos técnicos, vaciarlos.
*/
text = text.replace(/\{\s*depositIntent\.intentId\s*\}/g, "''");
text = text.replace(/\{\s*depositIntent\.status\s*\}/g, "'Pendiente'");
text = text.replace(/\{\s*depositIntent\.paymentStatus\s*\}/g, "'Pendiente'");
text = text.replace(/\{\s*depositIntent\.(depositAddress|vaultAddress|vault_address|deposit_address|address)\s*\}/g, "''");

/*
  5. Ocultar visualmente componentes técnicos de recarga.
*/
const css = `
/* HipiPlay recarga simple producción */
.hipi-copy-address-btn {
  display: none !important;
}

.wallet-action-modal pre,
.wallet-action-modal code,
.wallet-action-modal .hipi-payment-summary {
  display: none !important;
}

.hipi-simple-confirmation {
  margin-top: 12px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(34,197,94,0.28);
  background: rgba(34,197,94,0.10);
  color: rgba(255,255,255,0.92);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
  text-align: center;
}
`;

const cssTargets = [
  path.join(srcRoot, "index.css"),
  path.join(srcRoot, "App.css")
].filter(file => fs.existsSync(file));

for (const file of cssTargets) {
  const current = fs.readFileSync(file, "utf8");

  if (!current.includes("HipiPlay recarga simple producción")) {
    fs.writeFileSync(file, current + "\n" + css, "utf8");
  }
}

fs.writeFileSync(appFile, text, "utf8");

const result = {
  ok: true,
  changed: before !== text,
  technicalStatusCallsReplaced: statusResult.total,
  hasSimpleMessage: text.includes(SIMPLE_MESSAGE),
  hasUnsafeFullAddressLiteral: /0x[a-fA-F0-9]{40}/.test(text),
  hasPaymentPendingLiteral: text.includes("PAYMENT_PENDING")
};

console.log(JSON.stringify(result, null, 2));

if (!result.hasSimpleMessage) {
  throw new Error("No quedo instalado el mensaje simple.");
}