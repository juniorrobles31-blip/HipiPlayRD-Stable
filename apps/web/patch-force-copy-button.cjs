"use strict";

const fs = require("node:fs");

const appFile = process.argv[2];

let text = fs.readFileSync(appFile, "utf8");
const before = text;

const buttonBlock = `
{depositIntent ? (
  <button
    type="button"
    className="hipi-copy-address-btn"
    onClick={() => hipiCopyPaymentAddress(hipiDepositAddressFromIntent(depositIntent))}
  >
    Copiar dirección de pago • {hipiMaskWallet(hipiDepositAddressFromIntent(depositIntent), 8)}
  </button>
) : null}
`;

if (!text.includes("Copiar dirección de pago •")) {
  if (text.includes("{hipiCleanDepositText(depositStatusMessage)}")) {
    text = text.replace(
      "{hipiCleanDepositText(depositStatusMessage)}",
      buttonBlock + "\n{hipiCleanDepositText(depositStatusMessage)}"
    );
  }
  else if (text.includes("hipiCleanDepositText(depositStatusMessage)")) {
    text = text.replace(
      /hipiCleanDepositText\(depositStatusMessage\)/,
      "hipiCleanDepositText(depositStatusMessage)"
    );

    const marker = "hipiCleanDepositText(depositStatusMessage)";
    const idx = text.indexOf(marker);

    if (idx >= 0) {
      const insertAt = text.indexOf("\n", idx);

      if (insertAt >= 0) {
        text = text.slice(0, insertAt + 1) + buttonBlock + text.slice(insertAt + 1);
      }
    }
  }
}

/*
  Si todavía no pudo insertarlo, colocarlo inmediatamente antes del cierre
  del bloque donde se renderiza depositIntent.
*/
if (!text.includes("Copiar dirección de pago •")) {
  const intentBlockPattern = /(\{depositIntent\s*\?\s*\([\s\S]*?)(\)\s*:\s*null\})/;

  if (intentBlockPattern.test(text)) {
    text = text.replace(intentBlockPattern, function (_m, a, b) {
      return a + "\n" + buttonBlock + "\n" + b;
    });
  }
}

fs.writeFileSync(appFile, text, "utf8");

console.log(JSON.stringify({
  ok: true,
  changed: before !== text,
  copyButton: text.includes("Copiar dirección de pago •"),
  hasMaskWallet: text.includes("hipiMaskWallet"),
  hasCopyFunction: text.includes("hipiCopyPaymentAddress"),
  hasDepositAddressGetter: text.includes("hipiDepositAddressFromIntent")
}, null, 2));

if (!text.includes("Copiar dirección de pago •")) {
  throw new Error("No se pudo insertar el boton copiar.");
}