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

function replaceFunction(functionName, newCode) {
  const needle = "function " + functionName + "(";
  const start = text.indexOf(needle);

  if (start < 0) {
    insertAfterImports(newCode);
    return false;
  }

  const open = text.indexOf("{", start);

  if (open < 0) {
    throw new Error("No encontre apertura de " + functionName);
  }

  let depth = 0;
  let end = -1;

  for (let i = open; i < text.length; i++) {
    const ch = text[i];

    if (ch === "{") depth++;
    if (ch === "}") depth--;

    if (depth === 0) {
      end = i + 1;
      break;
    }
  }

  if (end < 0) {
    throw new Error("No encontre cierre de " + functionName);
  }

  text = text.slice(0, start) + newCode + text.slice(end);
  return true;
}

const maskWalletFn = `
function hipiMaskWallet(value: unknown, visible = 8): string {
  const raw = String(value || "").trim();

  if (!raw) return "pendiente";
  if (raw.length <= visible) return raw;

  return "••••" + raw.slice(-visible);
}
`;

const shortRefFn = `
function hipiShortRef(value: unknown): string {
  const raw = String(value || "").trim();

  if (!raw) return "pendiente";

  return "REF-" + raw.slice(-8);
}
`;

const paymentStatusFn = `
function hipiPaymentStatus(value: unknown): string {
  const raw = String(value || "").trim().toUpperCase();

  if (raw === "PAID" || raw === "CONFIRMED") return "Pago confirmado";
  if (raw === "PAYMENT_PENDING" || raw === "PENDING") return "Pendiente de pago";
  if (raw === "EXPIRED") return "Expirada";
  if (raw === "CANCELLED" || raw === "CANCELED") return "Cancelada";

  return raw || "Pendiente de pago";
}
`;

const depositGetterFn = `
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
`;

const cleanTextFn = `
function hipiCleanDepositText(value: unknown): string {
  let msg = String(value || "").trim();

  if (!msg) return "";

  const foundAddresses: string[] = [];

  msg = msg.replace(/0x[a-fA-F0-9]{40}/g, function (addr) {
    foundAddresses.push(addr);
    return hipiMaskWallet(addr, 8);
  });

  if (foundAddresses.length > 0) {
    try {
      (globalThis as any).__hipiLastPaymentAddress =
        foundAddresses[foundAddresses.length - 1];
    } catch {}
  }

  msg = msg.replace(/PAYMENT_PENDING/g, "Pendiente de pago");
  msg = msg.replace(/PAID/g, "Pago confirmado");

  msg = msg.replace(/Intent:\\s*(PAY-[A-Z0-9-]+)/gi, function (_m, id) {
    return "Referencia: " + hipiShortRef(id);
  });

  msg = msg.replace(/Wallet\\s+origen:\\s*/gi, "");
  msg = msg.replace(/Tu\\s+wallet:\\s*/gi, "");
  msg = msg.replace(/Enviar\\s+USDT\\s+a\\s+esta\\s+wallet\\s+destino:\\s*/gi, "Dirección de pago: ");
  msg = msg.replace(/Cuando el pago sea detectado,[\\s\\S]*?fichas compradas\\./gi, "Al confirmarse el pago, tus fichas compradas se acreditarán automáticamente.");

  const fullAddress = String((globalThis as any).__hipiLastPaymentAddress || "").trim();

  if (fullAddress && !msg.includes("Copiar dirección de pago")) {
    msg =
      msg.trim() +
      "\\n\\nCopiar dirección de pago • " +
      hipiMaskWallet(fullAddress, 8);
  }

  return msg;
}
`;

const copyFn = `
function hipiCopyPaymentAddress(address: unknown): void {
  const raw =
    String(address || "").trim() ||
    String((globalThis as any).__hipiLastPaymentAddress || "").trim();

  if (!raw) return;

  try {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(raw);
    }
  } catch {}
}
`;

const installCopyHandlerFn = `
function hipiInstallCopyAddressHandler(): void {
  try {
    if (typeof document === "undefined") return;

    const g = globalThis as any;

    if (g.__hipiCopyAddressHandlerInstalled) return;

    g.__hipiCopyAddressHandlerInstalled = true;

    document.addEventListener(
      "click",
      function (event) {
        const target = event.target as HTMLElement | null;

        if (!target) return;

        const box = target.closest(".hipi-payment-summary, pre, div") as HTMLElement | null;

        if (!box) return;

        const content = String(box.textContent || "");

        if (
          content.includes("Copiar dirección de pago") ||
          content.includes("Dirección de pago")
        ) {
          hipiCopyPaymentAddress("");
        }
      },
      true
    );
  } catch {}
}

hipiInstallCopyAddressHandler();
`;

replaceFunction("hipiMaskWallet", maskWalletFn);
replaceFunction("hipiShortRef", shortRefFn);
replaceFunction("hipiPaymentStatus", paymentStatusFn);
replaceFunction("hipiDepositAddressFromIntent", depositGetterFn);
replaceFunction("hipiCleanDepositText", cleanTextFn);
replaceFunction("hipiCopyPaymentAddress", copyFn);

if (!text.includes("function hipiInstallCopyAddressHandler(")) {
  insertAfterImports(installCopyHandlerFn);
}

/*
  Limpieza de textos visibles.
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
  Reemplazos de render si existen.
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

text = text.replace(
  /\{\s*depositStatusMessage\s*\}/g,
  "{hipiCleanDepositText(depositStatusMessage)}"
);

text = text.replace(
  /\{\s*statusMessage\s*\}/g,
  "{hipiCleanDepositText(statusMessage)}"
);

/*
  Si todavía existe render crudo de address, enmascararlo.
*/
text = text.replace(
  /\{\s*depositIntent\.(depositAddress|vaultAddress|vault_address|deposit_address|address)\s*\}/g,
  "{hipiMaskWallet(hipiDepositAddressFromIntent(depositIntent), 8)}"
);

/*
  CSS.
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

.hipi-payment-summary,
pre {
  cursor: pointer;
  white-space: pre-wrap;
  word-break: break-word;
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

const result = {
  ok: true,
  changed: before !== text,
  copyVisualLine: text.includes("Copiar dirección de pago"),
  hasClickHandler: text.includes("hipiInstallCopyAddressHandler"),
  hasLastAddressStore: text.includes("__hipiLastPaymentAddress"),
  hasMaskWallet: text.includes("hipiMaskWallet"),
  hasTechnicalPending: text.includes("PAYMENT_PENDING"),
  hasRawDepositAddressRender:
    /\{\s*depositIntent\.(depositAddress|vaultAddress|vault_address|deposit_address|address)\s*\}/.test(text)
};

console.log(JSON.stringify(result, null, 2));

if (!result.copyVisualLine || !result.hasClickHandler || !result.hasLastAddressStore) {
  throw new Error("No quedo lista la copia visual de direccion.");
}