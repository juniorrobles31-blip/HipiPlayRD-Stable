"use strict";

const fs = require("node:fs");
const path = require("node:path");

const appFile = process.argv[2];
const srcRoot = process.argv[3];

let text = fs.readFileSync(appFile, "utf8");
const before = text;

function insertAfterImports(code) {
  const importBlockMatch = text.match(/^(import[\s\S]*?;\s*)+/);

  if (importBlockMatch) {
    const insertAt = importBlockMatch[0].length;
    text = text.slice(0, insertAt) + "\n" + code + "\n" + text.slice(insertAt);
  }
  else {
    text = code + "\n" + text;
  }
}

function replaceFunctionRange(startName, endName, replacement) {
  const start = text.indexOf("function " + startName + "(");

  if (start < 0) {
    insertAfterImports(replacement);
    return false;
  }

  let end = -1;

  if (endName) {
    end = text.indexOf("function " + endName + "(", start + 1);
  }

  if (end < 0) {
    const nextFunction = text.indexOf("\nfunction ", start + 1);
    end = nextFunction > -1 ? nextFunction : start;
  }

  if (end <= start) {
    throw new Error("No pude ubicar el final de " + startName);
  }

  text = text.slice(0, start) + replacement.trim() + "\n\n" + text.slice(end);

  return true;
}

/*
  1. Reemplazar la función que mostraba la información técnica.
  Desde ahora siempre devuelve un mensaje corto.
*/
const cleanTextFn = `
function hipiCleanDepositText(_value: unknown): string {
  return "Recarga recibida. Estamos validando el pago.";
}
`;

replaceFunctionRange(
  "hipiCleanDepositText",
  "hipiCopyPaymentAddress",
  cleanTextFn
);

/*
  2. Desactivar cualquier handler de copiar dirección.
*/
const copyFn = `
function hipiCopyPaymentAddress(_address: unknown): void {
  return;
}
`;

replaceFunctionRange(
  "hipiCopyPaymentAddress",
  "hipiInstallCopyAddressHandler",
  copyFn
);

const handlerFn = `
function hipiInstallCopyAddressHandler(): void {
  return;
}
`;

if (text.includes("function hipiInstallCopyAddressHandler(")) {
  const start = text.indexOf("function hipiInstallCopyAddressHandler(");
  const call = text.indexOf("hipiInstallCopyAddressHandler();", start);

  if (call > start) {
    const end = call + "hipiInstallCopyAddressHandler();".length;
    text = text.slice(0, start) + handlerFn.trim() + "\n" + text.slice(end);
  }
}

/*
  3. Textos cortos para el cliente.
*/
const exactReplacements = [
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

for (const [from, to] of exactReplacements) {
  text = text.split(from).join(to);
}

/*
  4. Cualquier status message renderizado debe usar el mensaje simple.
*/
text = text.replace(
  /\{\s*depositStatusMessage\s*\}/g,
  "{hipiCleanDepositText(depositStatusMessage)}"
);

text = text.replace(
  /\{\s*statusMessage\s*\}/g,
  "{hipiCleanDepositText(statusMessage)}"
);

/*
  5. Nunca renderizar campos técnicos.
*/
text = text.replace(/\{\s*depositIntent\.intentId\s*\}/g, "''");
text = text.replace(/\{\s*depositIntent\.status\s*\}/g, "'Pendiente'");
text = text.replace(/\{\s*depositIntent\.paymentStatus\s*\}/g, "'Pendiente'");
text = text.replace(/\{\s*depositIntent\.(depositAddress|vaultAddress|vault_address|deposit_address|address)\s*\}/g, "''");

/*
  6. Ocultar visualmente bloques técnicos si quedaron.
*/
const css = `
/* HipiPlay recarga simple producción */
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

.hipi-copy-address-btn {
  display: none !important;
}

code {
  display: none !important;
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
  simpleMessageInstalled: text.includes('return "Recarga recibida. Estamos validando el pago."'),
  copyDisabled: text.includes("function hipiCopyPaymentAddress(_address: unknown): void"),
  handlerDisabled: !text.includes("Copiar dirección de pago"),
  rawAddress: /0x[a-fA-F0-9]{40}/.test(text),
  hasPaymentPending: text.includes("PAYMENT_PENDING")
};

console.log(JSON.stringify(result, null, 2));

if (!result.simpleMessageInstalled || result.rawAddress || result.hasPaymentPending) {
  throw new Error("La limpieza simple no quedo completa.");
}