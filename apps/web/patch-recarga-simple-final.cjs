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

const helpers = `
function hipiMaskWallet(value: unknown, visible = 6): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length <= visible) return raw;
  return "••••" + raw.slice(-visible);
}

function hipiRoadName(value: unknown): string {
  const raw = String(value || "").trim();
  return raw || "BSC / BEP20";
}

function hipiCleanDepositText(_value: unknown): string {
  return "Recarga recibida. Estamos validando el pago.";
}

function hipiHideTechnicalDepositInfo(): boolean {
  return true;
}
`;

if (!text.includes("function hipiHideTechnicalDepositInfo(")) {
  insertAfterImports(helpers);
}

/*
  1. Mensajes cortos para cliente.
*/
const replacements = [
  [/Ingresa tu wallet y el monto\. Generaremos una dirección segura para completar tu recarga\./g, "Ingresa tu wallet y el monto."],
  [/Ingresa tu wallet y el monto\. Generaremos una direccion segura para completar tu recarga\./g, "Ingresa tu wallet y el monto."],
  [/Escribe tu wallet, detectamos la carretera y generamos la wallet de pago\./g, "Ingresa tu wallet y el monto."],
  [/Generaremos una dirección segura para completar tu recarga\./g, ""],
  [/Generaremos una direccion segura para completar tu recarga\./g, ""],
  [/Red validada correctamente\./g, "BSC / BEP20"],
  [/Carretera detectada correctamente\./g, "BSC / BEP20"],
  [/Wallet de pago generada\./g, "Recarga recibida."],
  [/Wallet destino generada/g, "Recarga recibida"],
  [/Recarga creada/g, "Confirmación"],
  [/Generar wallet real/g, "Confirmar recarga"],
  [/Generar wallet/g, "Confirmar recarga"],
  [/Continuar/g, "Siguiente"],
  [/Cantidad USDT a recargar/g, "Monto"],
  [/Monto a recargar/g, "Monto"],
  [/Tu wallet/g, "Wallet"],
  [/Wallet origen/g, "Wallet"],
  [/PAYMENT_PENDING/g, "Pendiente"],
  [/Pendiente de pago/g, "Pendiente"],
  [/Dirección de pago:/g, ""],
  [/Direccion de pago:/g, ""],
  [/Copiar dirección de pago[^<\n]*/g, ""],
  [/Copiar direccion de pago[^<\n]*/g, ""],
  [/Enviar USDT a esta wallet destino:/g, ""],
  [/Al confirmarse el pago, tus fichas compradas se acreditarán automáticamente\./g, ""],
  [/Al confirmarse el pago, tus fichas compradas se acreditaran automáticamente\./g, ""],
  [/Al confirmarse el pago, tus fichas compradas se acreditaran automaticamente\./g, ""],
  [/Cuando el pago sea detectado,[\s\S]*?fichas compradas\./g, ""],
  [/Intent:/g, ""],
  [/Referencia:/g, ""]
];

for (const [pattern, replacement] of replacements) {
  text = text.replace(pattern, replacement);
}

/*
  2. Forzar cualquier mensaje técnico generado por la recarga a un único mensaje simple.
*/
text = text.replace(
  /setDepositStatusMessage\(\s*`[\s\S]*?(Wallet|Intent|Enviar|PAYMENT_PENDING|deposit|vault|address|0x)[\s\S]*?`\s*\);/gi,
  "setDepositStatusMessage('Recarga recibida. Estamos validando el pago.');"
);

text = text.replace(
  /setDepositStatusMessage\(\s*['"][\s\S]*?(Wallet|Intent|Enviar|PAYMENT_PENDING|deposit|vault|address|0x)[\s\S]*?['"]\s*\);/gi,
  "setDepositStatusMessage('Recarga recibida. Estamos validando el pago.');"
);

/*
  3. Nunca renderizar intent, estado técnico ni dirección.
*/
text = text.replace(/\{\s*depositIntent\.intentId\s*\}/g, "''");
text = text.replace(/\{\s*depositIntent\.status\s*\}/g, "'Pendiente'");
text = text.replace(/\{\s*depositIntent\.paymentStatus\s*\}/g, "'Pendiente'");
text = text.replace(/\{\s*depositIntent\.(depositAddress|vaultAddress|vault_address|deposit_address|address)\s*\}/g, "''");

/*
  4. Reemplazar cualquier status message por resumen simple.
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
  5. Ocultar bloques visuales técnicos.
*/
text = text.replace(
  /<p[^>]*>\s*(?:Referencia|Intent|Estado|Dirección de pago|Direccion de pago|Wallet destino|Wallet origen)[\s\S]*?<\/p>/gi,
  ""
);

text = text.replace(
  /<div[^>]*>\s*(?:Referencia|Intent|Estado|Dirección de pago|Direccion de pago|Wallet destino|Wallet origen)[\s\S]*?<\/div>/gi,
  ""
);

text = text.replace(/<code[\s\S]*?<\/code>/gi, "");

text = text.replace(
  /<pre[^>]*>[\s\S]*?<\/pre>/gi,
  `<div className="hipi-simple-confirmation">
    Recarga recibida. Estamos validando el pago.
  </div>`
);

/*
  6. Quitar direcciones completas escritas como texto.
*/
text = text.replace(/0x[a-fA-F0-9]{40}/g, "");

/*
  7. CSS para que nada técnico de recarga se vea.
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

pre,
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

const forbidden = [
  "Generaremos una dirección segura",
  "Generaremos una direccion segura",
  "Red validada correctamente",
  "Carretera detectada correctamente",
  "Wallet de pago generada",
  "Wallet destino generada",
  "PAYMENT_PENDING",
  "Dirección de pago:",
  "Direccion de pago:",
  "Copiar dirección de pago",
  "Copiar direccion de pago",
  "Enviar USDT a esta wallet destino:"
].filter(item => text.includes(item));

const rawAddress = /0x[a-fA-F0-9]{40}/.test(text);

const result = {
  ok: true,
  changed: before !== text,
  simpleConfirmation: text.includes("hipi-simple-confirmation"),
  rawAddress,
  forbidden
};

console.log(JSON.stringify(result, null, 2));

if (forbidden.length > 0 || rawAddress) {
  throw new Error("Quedan datos técnicos visibles o direcciones completas.");
}