"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const SERVER_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(SERVER_ROOT, "data", "blockchain-v2");

const CONFIG_FILE = path.join(__dirname, "custody-chain.config.json");
const WALLETS_FILE = path.join(DATA_DIR, "custody-wallets-bsc.json");
const AUDIT_FILE = path.join(DATA_DIR, "custody-balance-audit.json");

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

function nowIso() {
  return new Date().toISOString();
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;

  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();

  return raw ? JSON.parse(raw) : fallback;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function appendAudit(entry) {
  const audit = readJson(AUDIT_FILE, []);

  audit.unshift({
    id: "bal_" + Date.now() + "_" + Math.random().toString(16).slice(2),
    ...entry,
    createdAt: nowIso()
  });

  writeJson(AUDIT_FILE, audit.slice(0, 20000));
}

function loadConfig() {
  const config = readJson(CONFIG_FILE, null);

  if (!config) {
    throw new Error("No existe custody-chain.config.json");
  }

  if (
    !config.rpcUrl ||
    String(config.rpcUrl).includes("PON_AQUI")
  ) {
    throw new Error("Debes configurar rpcUrl real en custody-chain.config.json");
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(String(config.usdtContract || ""))) {
    throw new Error("usdtContract invalido.");
  }

  return config;
}

function loadWallets() {
  const wallets = readJson(WALLETS_FILE, []);

  if (!Array.isArray(wallets)) {
    throw new Error("custody-wallets-bsc.json debe ser un arreglo.");
  }

  return wallets;
}

async function syncBalances() {
  const config = loadConfig();
  const wallets = loadWallets();

  const provider = new ethers.JsonRpcProvider(config.rpcUrl, Number(config.chainId));
  const token = new ethers.Contract(config.usdtContract, ERC20_ABI, provider);

  const network = await provider.getNetwork();

  if (Number(network.chainId) !== Number(config.chainId)) {
    throw new Error(
      "RPC conectado a chainId incorrecto. Esperado " +
      config.chainId +
      ", recibido " +
      String(network.chainId)
    );
  }

  let tokenDecimals = Number(config.usdtDecimals || 18);

  try {
    tokenDecimals = Number(await token.decimals());
  }
  catch {
    tokenDecimals = Number(config.usdtDecimals || 18);
  }

  let totalUSDTAtomic = 0n;
  let totalBNBAtomic = 0n;

  const updated = [];

  for (const wallet of wallets) {
    if (!wallet.address || !/^0x[a-fA-F0-9]{40}$/.test(wallet.address)) {
      continue;
    }

    const [nativeBalance, tokenBalance] = await Promise.all([
      provider.getBalance(wallet.address),
      token.balanceOf(wallet.address)
    ]);

    const usdtText = ethers.formatUnits(tokenBalance, tokenDecimals);
    const bnbText = ethers.formatEther(nativeBalance);

    wallet.balanceUSDT = usdtText;
    wallet.balanceBNB = bnbText;
    wallet.balanceUSDTAtomic = tokenBalance.toString();
    wallet.balanceBNBAtomic = nativeBalance.toString();
    wallet.balanceLastSyncedAt = nowIso();
    wallet.updatedAt = nowIso();

    totalUSDTAtomic += tokenBalance;
    totalBNBAtomic += nativeBalance;

    updated.push({
      walletId: wallet.walletId,
      address: wallet.address,
      status: wallet.status,
      assignedIntentId: wallet.assignedIntentId,
      assignedPlayerId: wallet.assignedPlayerId,
      balanceUSDT: usdtText,
      balanceBNB: bnbText
    });
  }

  writeJson(WALLETS_FILE, wallets);

  const summary = {
    ok: true,
    network: config.network,
    chainId: Number(config.chainId),
    rpcChainId: Number(network.chainId),
    tokenContract: config.usdtContract,
    tokenDecimals,
    totalWallets: wallets.length,
    syncedWallets: updated.length,
    totalUSDT: ethers.formatUnits(totalUSDTAtomic, tokenDecimals),
    totalBNB: ethers.formatEther(totalBNBAtomic),
    updated
  };

  appendAudit({
    type: "BALANCE_SYNC",
    network: config.network,
    chainId: Number(config.chainId),
    totalWallets: wallets.length,
    syncedWallets: updated.length,
    totalUSDT: summary.totalUSDT,
    totalBNB: summary.totalBNB
  });

  return summary;
}

async function main() {
  const cmd = String(process.argv[2] || "sync").toLowerCase();

  if (cmd === "sync") {
    const result = await syncBalances();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    usage: [
      "node custody-balance-sync.js sync"
    ]
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message
  }, null, 2));

  process.exit(1);
});