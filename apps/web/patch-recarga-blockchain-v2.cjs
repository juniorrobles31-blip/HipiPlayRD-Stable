"use strict";

const fs = require("node:fs");

const appFile = process.argv[2];

if (!appFile) {
    throw new Error("Falta ruta de App.tsx.");
}

let text = fs.readFileSync(appFile, "utf8");

const checks = [
    "function WalletActionsPanel",
    "function WalletActionModal",
    "action === 'deposit'",
    "'/api/player/deposit/request'",
    "const order = data.order || data.deposit || data;"
];

for (const check of checks) {
    if (!text.includes(check)) {
        throw new Error("No encontre marcador requerido: " + check);
    }
}

// 1. Mantener transferencia interna intacta.
// 2. Cambiar solamente la recarga USDT para usar Blockchain V2.
text = text.replace(
    "data = await postJson('/api/player/deposit/request', {",
    "data = await postJson('/blockchain-pay/api/public/intents', {"
);

// La API V2 devuelve data.intent. El flujo viejo esperaba data.order/data.deposit.
text = text.replace(
    "const order = data.order || data.deposit || data;",
    "const order = data.intent || data.order || data.deposit || data;"
);

// Mejorar textos del modal sin acentos raros.
text = text.replace(
    "deposit: 'Genera una orden de recarga USDT.'",
    "deposit: 'Genera una wallet unica de pago USDT sin salir de la PWA.'"
);

text = text.replace(
    "withdraw: 'Solicita retiro USDT por red BSC/BEP20.'",
    "withdraw: 'Solicita retiro USDT hacia tu wallet personal.'"
);

text = text.replace(
    "{ action: 'withdraw', label: 'Retiro USDT', caption: 'BSC / BEP20', icon: <Landmark size={34} /> }",
    "{ action: 'withdraw', label: 'Retiro USDT', caption: 'Wallet personal', icon: <Landmark size={34} /> }"
);

text = text.replace(
    "Dirección BSC / BEP20",
    "Direccion USDT destino"
);

// Evitar que las lineas de la wallet se vean pegadas.
text = text.replace(
    "{status && <div className=\"wallet-action-modal-status\">{status}</div>}",
    "{status && <pre className=\"wallet-action-modal-status\" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{status}</pre>}"
);

// Limpiar caracteres mojibake visibles en la pantalla principal.
text = text
    .replace(/Cerrar sesiÃ³n/g, "Cerrar sesion")
    .replace(/Ãšsalo/g, "Usalo")
    .replace(/EnvÃ­a/g, "Envia")
    .replace(/nÃºmeros/g, "numeros")
    .replace(/operaciÃ³n/g, "operacion");

fs.writeFileSync(appFile, text, "utf8");

const after = fs.readFileSync(appFile, "utf8");

const result = {
    ok: true,
    usesBlockchainPay: after.includes("postJson('/blockchain-pay/api/public/intents'"),
    readsIntent: after.includes("const order = data.intent || data.order || data.deposit || data;"),
    oldDepositEndpointStillUsed: after.includes("postJson('/api/player/deposit/request'"),
    transferStillPresent: after.includes("action: 'transfer'"),
    withdrawStillPresent: after.includes("action: 'withdraw'")
};

console.log(JSON.stringify(result, null, 2));

if (!result.usesBlockchainPay || !result.readsIntent || result.oldDepositEndpointStillUsed) {
    throw new Error("La recarga no quedo correctamente conectada a Blockchain V2.");
}