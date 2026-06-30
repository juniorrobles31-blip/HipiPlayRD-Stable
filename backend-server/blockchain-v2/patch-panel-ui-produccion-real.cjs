"use strict";

const fs = require("node:fs");

const panelFile = process.argv[2];
const configFile = process.argv[3];

if (!panelFile || !configFile) {
  throw new Error("Faltan argumentos.");
}

const USDT_BSC =
  "0x55d398326f99059fF775485246999027B3197955";

function readJson(file, fallback) {
  const raw =
    fs.existsSync(file)
      ? fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim()
      : "";

  return raw ? JSON.parse(raw) : fallback;
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

/*
  1. Config real.
*/
const config = readJson(configFile, {});

config.mode = "BSC_MAINNET_CUSTODY_PRODUCTION";
config.network = "BSC";
config.networkLabel = "BSC / BEP20";
config.chainId = 56;
config.tokenSymbol = "USDT";
config.tokenAddress = USDT_BSC;
config.productionMode = true;

writeJson(configFile, config);

/*
  2. Panel UI real.
*/
let text = fs.readFileSync(panelFile, "utf8");
const before = text;

/*
  Modos / red / token.
*/
text = text.replace(/SIMULATED_UNTIL_BSC_TESTNET_DEPLOY/g, "BSC_MAINNET_CUSTODY_PRODUCTION");
text = text.replace(/bsc-testnet-demo/g, "bsc-mainnet");
text = text.replace(/BSC Testnet/g, "BSC Mainnet");
text = text.replace(/Testnet/g, "Mainnet");
text = text.replace(/testnet/g, "mainnet");
text = text.replace(/simulador hasta completar despliegue BSC Mainnet/gi, "producción BSC/BEP20 activa");
text = text.replace(/simulador hasta completar despliegue BSC Testnet/gi, "producción BSC/BEP20 activa");
text = text.replace(/simulador hasta despliegue BSC Mainnet/gi, "producción BSC/BEP20 activa");
text = text.replace(/simulador hasta despliegue BSC Testnet/gi, "producción BSC/BEP20 activa");
text = text.replace(/SIMULADOR hasta despliegue BSC Mainnet\./g, "PRODUCCION BSC/BEP20 custody.");
text = text.replace(/SIMULADOR hasta despliegue BSC Testnet\./g, "PRODUCCION BSC/BEP20 custody.");
text = text.replace(/Modo:\s*SIMULADOR hasta despliegue BSC Mainnet\./g, "Modo: PRODUCCION BSC/BEP20 custody.");
text = text.replace(/Modo:\s*SIMULADOR hasta despliegue BSC Testnet\./g, "Modo: PRODUCCION BSC/BEP20 custody.");

text = text.replace(/0x0000000000000000000000000000000000001000/g, USDT_BSC);
text = text.replace(/chainId:\s*97/g, "chainId: 56");
text = text.replace(/chain_id:\s*97/g, "chain_id: 56");
text = text.replace(/"chainId"\s*:\s*97/g, "\"chainId\": 56");
text = text.replace(/chainId<\/strong>\s*97/g, "chainId</strong> 56");

/*
  Banner visible.
*/
text = text.replace(
  /Modo actual:\s*simulador[^<"]+/gi,
  "Modo actual: producción BSC/BEP20 activa. Las wallets generadas son reales, custody y pueden recibir USDT real."
);

text = text.replace(
  /Aquí puedes probar la generación de wallet, el estado del pago y el ledger V2 sin tocar producción\./gi,
  "Las recargas se validan contra BSC Mainnet y se acreditan automáticamente cuando el pago real es detectado."
);

text = text.replace(
  /Aqui puedes probar la generacion de wallet, el estado del pago y el ledger V2 sin tocar produccion\./gi,
  "Las recargas se validan contra BSC Mainnet y se acreditan automáticamente cuando el pago real es detectado."
);

/*
  Encabezados / labels.
*/
text = text.replace(/Crear compra de monedas/g, "Crear recarga real USDT");
text = text.replace(/Player ID \/ Usuario/g, "Player ID / Usuario real");
text = text.replace(/Generar wallet/g, "Generar wallet real");
text = text.replace(/Wallets \/ intents generados/g, "Wallets reales / recargas generadas");
text = text.replace(/Intentos/g, "Recargas");
text = text.replace(/Link para cualquier PWA/g, "Endpoint público de recarga para PWA");
text = text.replace(/Resultado aparecera aqui\.\.\./g, "Resultado de wallet real aparecerá aquí...");
text = text.replace(/Resultado aparecerá aquí\.\.\./g, "Resultado de wallet real aparecerá aquí...");
text = text.replace(/Panel intermedio para probar compras, generar wallet\/vault y ver estatus de pagos\./g, "Panel de custodia BSC/BEP20 para recargas reales, wallets custody y estados de pago.");

/*
  Defaults demo.
*/
text = text.replace(/usr_demo_console/g, "");
text = text.replace(/usr_demo_/g, "usr_");
text = text.replace(/MiPWA/g, "HipiPlay");
text = text.replace(/\/checkout\?playerId=&amount=10&pwa=HipiPlay/g, "/checkout?playerId=ID_USUARIO_REAL&amount=MONTO_USDT&pwa=HipiPlay");
text = text.replace(/\/checkout\?playerId=usr_demo_console&amount=10&pwa=MiPWA/g, "/checkout?playerId=ID_USUARIO_REAL&amount=MONTO_USDT&pwa=HipiPlay");
text = text.replace(/\/checkout\?playerId=usr_demo_console&amount=10&pwa=HipiPlay/g, "/checkout?playerId=ID_USUARIO_REAL&amount=MONTO_USDT&pwa=HipiPlay");

/*
  Placeholders si existen inputs.
*/
text = text.replace(/id="player-id"\s+value=""/g, 'id="player-id" placeholder="ID del usuario real" value=""');
text = text.replace(/id="amount"\s+value="10"/g, 'id="amount" placeholder="Monto USDT" value=""');

/*
  Botones y rutas internas antiguas.
*/
text = text.replace(/Simular pago/g, "Pago real automático");
text = text.replace(/simulate-deposit/g, "mark-paid-real");
text = text.replace(/function simulateDeposit\s*\(/g, "function markRealDeposit(");
text = text.replace(/simulateDeposit\s*\(/g, "markRealDeposit(");
text = text.replace(/function simulatedVaultAddress\s*\(/g, "function legacyFallbackVaultAddress(");
text = text.replace(/simulatedVaultAddress\s*\(/g, "legacyFallbackVaultAddress(");

/*
  No autogenerar 20.
*/
text = text.replace(/"generate"\s*,\s*"20"/g, "\"generate\", \"1\"");
text = text.replace(/"generate",\s*"20"/g, "\"generate\", \"1\"");

/*
  Quitar botones manuales de pago si quedaron en HTML.
*/
text = text.replace(
  /<button class="warn"[^>]*>[^<]*(Pago real automático|Pago real automatico|Simular pago)[^<]*<\/button>/gi,
  ""
);

fs.writeFileSync(panelFile, text, "utf8");

const badPatterns = [
  "simulador hasta completar",
  "simulador hasta despliegue",
  "BSC Testnet",
  "bsc-testnet-demo",
  "SIMULATED_UNTIL_BSC_TESTNET_DEPLOY",
  "usr_demo_console",
  "Simular pago",
  "simulate-deposit",
  "simulatedVaultAddress"
];

const foundBad =
  badPatterns.filter(pattern =>
    text.toLowerCase().includes(pattern.toLowerCase())
  );

console.log(JSON.stringify({
  ok: true,
  changed: before !== text,
  mode: config.mode,
  chainId: config.chainId,
  tokenAddress: config.tokenAddress,
  foundBad,
  productionText: text.includes("producción BSC/BEP20 activa") || text.includes("produccion BSC/BEP20 activa"),
  realRechargeText: text.includes("Crear recarga real USDT"),
  realWalletButton: text.includes("Generar wallet real")
}, null, 2));

if (foundBad.length > 0) {
  throw new Error("Quedan textos demo/simulacion: " + foundBad.join(", "));
}