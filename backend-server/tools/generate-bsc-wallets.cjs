const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const count = Number(process.argv[2] || 10);

if (!Number.isFinite(count) || count <= 0) {
  console.error("Uso: node tools/generate-bsc-wallets.cjs 20");
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const secretDir = path.join(root, "wallet-secrets");
const publicDir = path.join(root, "wallet-public");

fs.mkdirSync(secretDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const secretWallets = [];
const publicWallets = [];

for (let i = 1; i <= count; i++) {
  const wallet = ethers.Wallet.createRandom();

  secretWallets.push({
    index: i,
    network: "BSC",
    token: "USDT",
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic ? wallet.mnemonic.phrase : null,
    createdAt: new Date().toISOString()
  });

  publicWallets.push({
    network: "BSC",
    token: "USDT",
    address: wallet.address,
    note: `Wallet BSC USDT pool deposito ${String(i).padStart(4, "0")}`
  });
}

const secretFile = path.join(secretDir, `wallets-secret-bsc-${stamp}.json`);
const publicFile = path.join(publicDir, `wallet-pool-public-bsc-${stamp}.json`);

fs.writeFileSync(secretFile, JSON.stringify(secretWallets, null, 2), "utf8");
fs.writeFileSync(publicFile, JSON.stringify(publicWallets, null, 2), "utf8");

console.log("Wallets BSC reales generadas:");
console.log("PUBLIC FILE:", publicFile);
console.log("SECRET FILE:", secretFile);
console.log("");
console.log("IMPORTANTE:");
console.log("- Importa al servidor solo el PUBLIC FILE.");
console.log("- Guarda el SECRET FILE fuera del servidor y protégelo.");
console.log("- Si pierdes las private keys, pierdes acceso a los fondos.");
console.log("- Para mover USDT desde esas wallets necesitarás BNB para gas en cada wallet.");