"use strict";

const fs = require("node:fs");
const path = require("node:path");

const appFile = process.argv[2];
const srcRoot = process.argv[3];

let text = fs.readFileSync(appFile, "utf8");
const before = text;

function ensureHelper(name, code) {
  if (!text.includes("function " + name + "(")) {
    const importBlockMatch = text.match(/^(import[\s\S]*?;\s*)+/);

    if (importBlockMatch) {
      const insertAt = importBlockMatch[0].length;
      text = text.slice(0, insertAt) + "\n" + code + "\n" + text.slice(insertAt);
    }
    else {
      text = code + "\n" + text;
    }
  }
}

ensureHelper("hipiMaskWallet", `
function hipiMaskWallet(value: unknown, visible = 8): string {
  const raw = String(value || "").trim();
  if (!raw) return "pendiente";
  if (raw.length <= visible) return raw;
  return "••••" + raw.slice(-visible);
}
`);

ensureHelper("hipiShortRef", `
function hipiShortRef(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "pendiente";
  return "REF-" + raw.slice(-8);
}
`);

ensureHelper("hipiPaymentStatus", `
function hipiPaymentStatus(value: unknown): string {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "PAID" || raw === "CONFIRMED") return "Pago confirmado";
  if (raw === "PAYMENT_PENDING" || raw === "PENDING") return "Pendiente de pago";
  if (raw === "EXPIRED") return "Expirada";
  if (raw === "CANCELLED" || raw === "CANCELED") return "Cancelada";
  return raw || "Pendiente de pago";
}
`);

ensureHelper("hipiDepositAddressFromIntent", `
function hipiDepositAddressFromIntent(intent: any): string {
  return String(
    intent?.depositAddress ||
    intent?.vaultAddress ||
    intent?.vault_address ||
    intent?.deposit_address ||
    intent?.address ||
    ""
  ).trim();
}
`);

ensureHelper("hipiCleanDepositText", `
function hipiCleanDepositText(value: unknown): string {
  let msg = String(value || "").trim();

  if (!msg) return "";

  msg = msg.replace(/0x[a-fA-F0-9]{40}/g, function (addr) {
    return hipiMaskWallet(addr, 8);
  });

  msg = msg.replace(/PAYMENT_PENDING/g, "Pendiente de pago");
  msg = msg.replace(/PAID/g, "Pago confirmado");

  msg = msg.replace(/Intent:\\s*(PAY-[A-Z0-9-]+)/gi, function (_m, id) {
    return "Referencia: " + hipiShortRef(id);
  });

  msg = msg.replace(/Wallet\\s+origen:\\s*/gi, "");
  msg = msg.replace(/Tu\\s+wallet:\\s*/gi, "");
  msg = msg.replace(/Enviar\\s+USDT\\s+a\\s+esta\\s+wallet\\s+destino:\\s*/gi, "Dirección de pago: ");
  msg = msg.replace(/Cuando el pago sea detectado,[\\s\\S]*?fichas compradas\\./gi, "Al confirmarse el pago, tus fichas compradas se acreditarán automáticamente.");

  return msg;
}
`);

ensureHelper("hipiCopyPaymentAddress", `
function hipiCopyPaymentAddress(address: unknown): void {
  const raw = String(address || "").trim();

  if (!raw) return;

  try {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(raw);
    }
  } catch {}
}
`);

/*
  Limpieza de textos técnicos.
*/
const replacements = [
  [/Escribe tu wallet, detectamos la carretera y generamos la wallet de pago\./g, "Ingresa tu wallet y el monto. Generaremos una dirección segura para completar tu recarga."],
  [/Tu wallet/g, "Wallet origen"],
  [/Cantidad USDT a recargar/g, "Monto a recargar"],
  [/Wallet destino generada/g, "Recarga creada"],
  [/Wallet de pago generada\./g, "Recarga creada."],
  [/Carretera detectada correctamente\./g, "Red validada correctamente."],
  [/Carretera detectada:/g, "Red:"],
  [/PAYMENT_PENDING/g, "Pendiente de pago"],
  [/Enviar USDT a esta wallet destino:/g, "Dirección de pago:"],
  [/Cuando el pago sea detectado, la recarga pasara a PAID y se acreditaran las fichas compradas\./g, "Al confirmarse el pago, tus fichas compradas se acreditarán automáticamente."],
  [/Cuando el pago sea detectado, la recarga pasará a PAID y se acreditarán las fichas compradas\./g, "Al confirmarse el pago, tus fichas compradas se acreditarán automáticamente."]
];

for (const [pattern, replacement] of replacements) {
  text = text.replace(pattern, replacement);
}

/*
  Intent y estado limpios.
*/
text = text.replace(
  /\{\s*depositIntent\.intentId\s*\}/g,
  "{hipiShortRef(depositIntent.intentId)}"
);

text = text.replace(
  /\{\s*depositIntent\.status\s*\}/g,
  "{hipiPaymentStatus(depositIntent.status)}"
);

text = text.replace(
  /\{\s*depositIntent\.paymentStatus\s*\}/g,
  "{hipiPaymentStatus(depositIntent.paymentStatus)}"
);

/*
  Convertir cualquier dirección de depositIntent en botón copiar.
*/
const copyButton = `<button
  type="button"
  className="hipi-copy-address-btn"
  onClick={() => hipiCopyPaymentAddress(hipiDepositAddressFromIntent(depositIntent))}
>
  Copiar dirección de pago • {hipiMaskWallet(hipiDepositAddressFromIntent(depositIntent), 8)}
</button>`;

const addressPatterns = [
  /\{\s*depositIntent\.depositAddress\s*\}/g,
  /\{\s*depositIntent\.vaultAddress\s*\}/g,
  /\{\s*depositIntent\.vault_address\s*\}/g,
  /\{\s*depositIntent\.deposit_address\s*\}/g,
  /\{\s*depositIntent\.address\s*\}/g,
  /\{\s*hipiMaskWallet\(\s*hipiDepositAddressFromIntent\(depositIntent\)\s*,\s*8\s*\)\s*\}/g
];

let replacedAddress = false;

if (!text.includes("Copiar dirección de pago •")) {
  for (const pattern of addressPatterns) {
    if (pattern.test(text)) {
      text = text.replace(pattern, copyButton);
      replacedAddress = true;
      break;
    }
  }
}

/*
  Sanitizar mensaje técnico.
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
  Fallback fuerte:
  Si no había dirección renderizada, insertar botón antes del mensaje de estado.
*/
if (!text.includes("Copiar dirección de pago •")) {
  const fallbackMarkers = [
    "{hipiCleanDepositText(depositStatusMessage)}",
    "{hipiCleanDepositText(statusMessage)}",
    "hipiCleanDepositText(depositStatusMessage)",
    "hipiCleanDepositText(statusMessage)"
  ];

  for (const marker of fallbackMarkers) {
    const idx = text.indexOf(marker);

    if (idx >= 0) {
      text =
        text.slice(0, idx) +
        copyButton +
        "\n" +
        text.slice(idx);

      replacedAddress = true;
      break;
    }
  }
}

/*
  CSS profesional.
*/
const css = `
/* HipiPlay recarga producción */
.hipi-copy-address-btn {
  width: 100%;
  margin: 10px 0 12px;
  padding: 14px 16px;
  border: 1px solid rgba(34, 197, 94, 0.45);
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(34, 197, 94, 0.24), rgba(34, 197, 94, 0.12));
  color: #eafff1;
  font-weight: 800;
  font-size: 15px;
  letter-spacing: 0.01em;
  text-align: center;
  box-shadow: 0 0 22px rgba(34, 197, 94, 0.14);
}

.hipi-copy-address-btn:active {
  transform: scale(0.99);
}

.hipi-payment-summary {
  margin-top: 12px;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(2, 6, 23, 0.58);
  color: rgba(255,255,255,0.88);
  font-size: 14px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

pre {
  white-space: pre-wrap;
  word-break: break-word;
}
`;

const cssTargets = [
  path.join(srcRoot, "index.css"),
  path.join(srcRoot, "App.css")
].filter(file => fs.existsSync(file));

for (const file of cssTargets) {
  const current = fs.readFileSync(file, "utf8");

  if (!current.includes("HipiPlay recarga producción")) {
    fs.writeFileSync(file, current + "\n" + css, "utf8");
  }
}

fs.writeFileSync(appFile, text, "utf8");

const debug = {
  ok: true,
  changed: before !== text,
  replacedAddress,
  copyButton: text.includes("Copiar dirección de pago •"),
  hasMaskWallet: text.includes("hipiMaskWallet"),
  hasCopyFunction: text.includes("hipiCopyPaymentAddress"),
  hasDepositAddressGetter: text.includes("hipiDepositAddressFromIntent"),
  hasTechnicalPending: text.includes("PAYMENT_PENDING"),
  hasRawDepositAddressRender:
    /\{\s*depositIntent\.(depositAddress|vaultAddress|vault_address|deposit_address|address)\s*\}/.test(text)
};

console.log(JSON.stringify(debug, null, 2));

if (!debug.copyButton) {
  throw new Error("No se pudo insertar el boton copiar.");
}