"use strict";

const fs = require("node:fs");

const file = process.argv[2];

if (!file) {
    throw new Error("Falta archivo del panel.");
}

let text = fs.readFileSync(file, "utf8");

const exactReplacements = [
    ["HipiPlay Blockchain V2 ,, Payment Bridge", "HipiPlay Blockchain V2 - Payment Bridge"],
    ["HipiPlay Blockchain V2 , Payment Bridge", "HipiPlay Blockchain V2 - Payment Bridge"],
    ["HipiPlay Blockchain V2 Â· Payment Bridge", "HipiPlay Blockchain V2 - Payment Bridge"],
    ["HipiPlay Blockchain V2 Ã‚Â· Payment Bridge", "HipiPlay Blockchain V2 - Payment Bridge"],

    ["Panel intermedio para probar compras, generacif³n de wallet/vault y estatus de pagos.", "Panel intermedio para probar compras, generar wallet/vault y ver estatus de pagos."],
    ["Panel intermedio para probar compras, generación de wallet/vault y estatus de pagos.", "Panel intermedio para probar compras, generar wallet/vault y ver estatus de pagos."],
    ["Panel intermedio para probar compras, generaciÃ³n de wallet/vault y estatus de pagos.", "Panel intermedio para probar compras, generar wallet/vault y ver estatus de pagos."],

    ["Modo actual:</strong> simulador hasta completar despliegue BSC Testnet. Aquƒ puedes probar generacif³n de wallet, estado del pago y ledger V2 sin tocar produccif³n.", "Modo actual:</strong> simulador hasta completar despliegue BSC Testnet. Aqui puedes probar la generacion de wallet, el estado del pago y el ledger V2 sin tocar produccion."],
    ["Modo actual:</strong> simulador hasta completar despliegue BSC Testnet. Aquí puedes probar generación de wallet, estado del pago y ledger V2 sin tocar producción.", "Modo actual:</strong> simulador hasta completar despliegue BSC Testnet. Aqui puedes probar la generacion de wallet, el estado del pago y el ledger V2 sin tocar produccion."],
    ["Modo actual:</strong> simulador hasta completar despliegue BSC Testnet. AquÃ­ puedes probar generaciÃ³n de wallet, estado del pago y ledger V2 sin tocar producciÃ³n.", "Modo actual:</strong> simulador hasta completar despliegue BSC Testnet. Aqui puedes probar la generacion de wallet, el estado del pago y el ledger V2 sin tocar produccion."],

    ["Resultado aparecerƒ aquƒ...", "Resultado aparecera aqui..."],
    ["Resultado aparecerá aquí...", "Resultado aparecera aqui..."],
    ["Resultado aparecerÃ¡ aquÃ­...", "Resultado aparecera aqui..."],

    ["Presiona “Generar wallet de pago”.", "Presiona Generar wallet de pago."],
    ["Presiona Ã¢Â€ÂœGenerar wallet de pagoÃ¢Â€Â.", "Presiona Generar wallet de pago."]
];

for (const [bad, good] of exactReplacements) {
    text = text.split(bad).join(good);
}

const wordReplacements = [
    [/generacif³n/g, "generacion"],
    [/generaciÃ³n/g, "generacion"],
    [/generación/g, "generacion"],

    [/Generacif³n/g, "Generacion"],
    [/GeneraciÃ³n/g, "Generacion"],
    [/Generación/g, "Generacion"],

    [/Aquƒ/g, "Aqui"],
    [/aquƒ/g, "aqui"],
    [/AquÃ­/g, "Aqui"],
    [/aquÃ­/g, "aqui"],
    [/Aquí/g, "Aqui"],
    [/aquí/g, "aqui"],

    [/produccif³n/g, "produccion"],
    [/producciÃ³n/g, "produccion"],
    [/producción/g, "produccion"],

    [/aparecerƒ/g, "aparecera"],
    [/aparecerÃ¡/g, "aparecera"],
    [/aparecerá/g, "aparecera"],

    [/Â·/g, "-"],
    [/Ã‚Â·/g, "-"],
    [/,,/g, "-"],

    [/Ã¡/g, "a"],
    [/Ã©/g, "e"],
    [/Ã­/g, "i"],
    [/Ã³/g, "o"],
    [/Ãº/g, "u"],
    [/Ã±/g, "n"],

    [/á/g, "a"],
    [/é/g, "e"],
    [/í/g, "i"],
    [/ó/g, "o"],
    [/ú/g, "u"],
    [/ñ/g, "n"],
    [/Á/g, "A"],
    [/É/g, "E"],
    [/Í/g, "I"],
    [/Ó/g, "O"],
    [/Ú/g, "U"],
    [/Ñ/g, "N"],

    [/ƒ/g, "i"],
    [/³/g, "o"],
    [/Â/g, ""],
    [/Ã/g, ""],
    [/�/g, ""]
];

for (const [pattern, replacement] of wordReplacements) {
    text = text.replace(pattern, replacement);
}

text = text
    .replace(/HipiPlay Blockchain V2\s*[-,]+\s*Payment Bridge/g, "HipiPlay Blockchain V2 - Payment Bridge")
    .replace(/Panel intermedio para probar compras, generar wallet\/vault y estatus de pagos\./g, "Panel intermedio para probar compras, generar wallet/vault y ver estatus de pagos.")
    .replace(/Panel intermedio para probar compras, generacion de wallet\/vault y estatus de pagos\./g, "Panel intermedio para probar compras, generar wallet/vault y ver estatus de pagos.")
    .replace(/Aqui puedes probar generacion de wallet, estado del pago y ledger V2 sin tocar produccion\./g, "Aqui puedes probar la generacion de wallet, el estado del pago y el ledger V2 sin tocar produccion.")
    .replace(/Resultado aparecera aqui\.\.\./g, "Resultado aparecera aqui...");

// Eliminar cualquier caracter raro restante, pero conservar codigo ASCII normal.
text = text.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");

fs.writeFileSync(file, text, "utf8");

const remainingBad = [];
const badPatterns = [
    "Ã",
    "Â",
    "ƒ",
    "³",
    "�",
    "generacif",
    "produccif",
    "aparecerf",
    "Aquf",
    ",, Payment"
];

for (const bad of badPatterns) {
    if (text.includes(bad)) {
        remainingBad.push(bad);
    }
}

console.log(JSON.stringify({
    ok: remainingBad.length === 0,
    remainingBad
}, null, 2));