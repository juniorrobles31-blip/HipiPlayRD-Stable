"use strict";

const fs = require("node:fs");

const file = process.argv[2];

if (!file) {
    throw new Error("Falta ruta del panel.");
}

let text = fs.readFileSync(file, "utf8");

const replacements = new Map([
    ["HipiPlay Blockchain V2 \u00c3\u0082\u00c2\u00b7 Payment Bridge", "HipiPlay Blockchain V2 - Payment Bridge"],
    ["HipiPlay Blockchain V2 \u00c2\u00b7 Payment Bridge", "HipiPlay Blockchain V2 - Payment Bridge"],
    ["\u00c3\u0082\u00c2\u00b7", "-"],
    ["\u00c2\u00b7", "-"],

    ["generaci\u00c3\u0083\u00c2\u00b3n", "generacion"],
    ["generaci\u00c3\u00b3n", "generacion"],
    ["Generaci\u00c3\u00b3n", "Generacion"],

    ["Aqu\u00c3\u0083\u00c2\u00ad", "Aqui"],
    ["Aqu\u00c3\u00ad", "Aqui"],
    ["aqu\u00c3\u0083\u00c2\u00ad", "aqui"],
    ["aqu\u00c3\u00ad", "aqui"],

    ["producci\u00c3\u0083\u00c2\u00b3n", "produccion"],
    ["producci\u00c3\u00b3n", "produccion"],
    ["Producci\u00c3\u00b3n", "Produccion"],

    ["aparecer\u00c3\u0083\u00c2\u00a1", "aparecera"],
    ["aparecer\u00c3\u00a1", "aparecera"],

    ["Presiona \u00e2\u0080\u009cGenerar wallet de pago\u00e2\u0080\u009d.", "Presiona Generar wallet de pago."],
    ["Presiona \u201cGenerar wallet de pago\u201d.", "Presiona Generar wallet de pago."],

    ["Usuario", "Usuario"],
    ["Monto", "Monto"],
    ["Pagados", "Pagados"],
    ["Pendientes", "Pendientes"],
    ["Acciones", "Acciones"]
]);

for (const [bad, good] of replacements) {
    text = text.split(bad).join(good);
}

text = text
    .replace(/\u00c3\u00a1/g, "a")
    .replace(/\u00c3\u00a9/g, "e")
    .replace(/\u00c3\u00ad/g, "i")
    .replace(/\u00c3\u00b3/g, "o")
    .replace(/\u00c3\u00ba/g, "u")
    .replace(/\u00c3\u00b1/g, "n")
    .replace(/\u00c3\u0081/g, "A")
    .replace(/\u00c3\u0089/g, "E")
    .replace(/\u00c3\u008d/g, "I")
    .replace(/\u00c3\u0093/g, "O")
    .replace(/\u00c3\u009a/g, "U")
    .replace(/\u00c3\u0091/g, "N")
    .replace(/\u00c2\u00a1/g, "")
    .replace(/\u00c2\u00bf/g, "")
    .replace(/\u00c2/g, "")
    .replace(/\u00c3/g, "")
    .replace(/\u00ef\u00bf\u00bd/g, "")
    .replace(/Ã¡/g, "a")
    .replace(/Ã©/g, "e")
    .replace(/Ã­/g, "i")
    .replace(/Ã³/g, "o")
    .replace(/Ãº/g, "u")
    .replace(/Ã±/g, "n")
    .replace(/Ã/g, "")
    .replace(/Â/g, "")
    .replace(/�/g, "");

text = text
    .replace(/HipiPlay Blockchain V2\s*-\s*Payment Bridge/g, "HipiPlay Blockchain V2 - Payment Bridge")
    .replace(/Panel intermedio para probar compras, generacion de wallet\/vault y estatus de pagos\./g, "Panel intermedio para probar compras, generar wallet/vault y ver estatus de pagos.")
    .replace(/Modo actual:<\/strong> simulador hasta completar despliegue BSC Testnet\.\s*Aqui puedes probar generacion de wallet, estado del pago y ledger V2 sin tocar produccion\./g, "Modo actual:</strong> simulador hasta completar despliegue BSC Testnet. Aqui puedes probar la generacion de wallet, el estado del pago y el ledger V2 sin tocar produccion.")
    .replace(/Resultado aparecera aqui\.\.\./g, "Resultado aparecera aqui...")
    .replace(/Crear compra de monedas/g, "Crear compra de monedas")
    .replace(/Wallets \/ intents generados/g, "Wallets / intents generados")
    .replace(/Link para cualquier PWA/g, "Link para cualquier PWA")
    .replace(/Simular pago/g, "Simular pago")
    .replace(/Generar wallet/g, "Generar wallet");

fs.writeFileSync(file, text, "utf8");

const stillBad = /Ã|Â|�/.test(text);

console.log(JSON.stringify({
    ok: true,
    stillBad
}, null, 2));