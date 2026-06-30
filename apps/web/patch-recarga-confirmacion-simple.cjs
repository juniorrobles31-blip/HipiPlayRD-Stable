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
  1. Textos cortos de producción.
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
  [/Cuando el pago sea detectado,[\s\S]*?fichas compradas\./g, ""]
];

for (const [pattern, replacement] of replacements) {
  text = text.replace(pattern, replacement);
}

/*
  2. Si se muestra depositStatusMessage, convertirlo a un mensaje único.
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
  3. Nunca renderizar intent completo, status técnico ni direcciones.
*/
text = text.replace(
  /\{\s*depositIntent\.intentId\s*\}/g,
  "''"
);

text = text.replace(
  /\{\s*depositIntent\.status\s*\}/g,
  "'Pendiente'"
);

text = text.replace(
  /\{\s*depositIntent\.paymentStatus\s*\}/g,
  "'Pendiente'"
);

text = text.replace(
  /\{\s*depositIntent\.(depositAddress|vaultAddress|vault_address|deposit_address|address)\s*\}/g,
  "''"
);

/*
  4. Ocultar bloques JSX que contengan datos técnicos de la recarga.
  Esto cubre bloques visuales con intent/status/address/reference.
*/
text = text.replace(
  /<p[^>]*>\s*(?:Referencia|Intent|Estado|Dirección de pago|Direccion de pago|Wallet destino|Wallet origen)[\s\S]*?<\/p>/gi,
  ""
);

text = text.replace(
  /<div[^>]*>\s*(?:Referencia|Intent|Estado|Dirección de pago|Direccion de pago|Wallet destino|Wallet origen)[\s\S]*?<\/div>/gi,
  ""
);

text = text.replace(
  /<code[\s\S]*?<\/code>/gi,
  ""
);

/*
  5. Reemplazar cualquier <pre> técnico por resumen simple.
*/
text = text.replace(
  /<pre[^>]*>\s*\{\s*hipiCleanDepositText\(depositStatusMessage\)\s*\}\s*<\/pre>/g,
  `<div className="hipi-simple-confirmation">
    Recarga recibida. Estamos validando el pago.
  </div>`
);

text = text.replace(
  /<pre[^>]*>[\s\S]*?<\/pre>/gi,
  `<div className="hipi-simple-confirmation">
    Recarga recibida. Estamos validando el pago.
  </div>`
);

/*
  6. Si existe bloque de resultado/recarga, dejarlo corto.
*/
text = text.replace(
  /<h3>\s*Confirmación\s*<\/h3>[\s\S]{0,1200}?Recarga recibida\. Estamos validando el pago\.[\s\S]{0,800}?<\/div>/g,
  `<h3>Confirmación</h3>
  <div className="hipi-simple-confirmation">
    Recarga recibida. Estamos validando el pago.
  </div>`
);

/*
  7. Quitar cualquier wallet EVM completa que haya quedado escrita como texto.
*/
text = text.replace(/0x[a-fA-F0-9]{40}/g, "");

/*
  8. CSS simple.
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
  "Intent:",
  "Dirección de pago:",
  "Direccion de pago:",
  "Copiar dirección de pago",
  "Copiar direccion de pago"
].filter(item => text.includes(item));

const result = {
  ok: true,
  changed: before !== text,
  simpleConfirmation: text.includes("hipi-simple-confirmation"),
  hidesPreCode: text.includes("pre,") && text.includes("code"),
  forbidden
};

console.log(JSON.stringify(result, null, 2));

if (forbidden.length > 0) {
  throw new Error("Quedan textos técnicos visibles: " + forbidden.join(", "));
}