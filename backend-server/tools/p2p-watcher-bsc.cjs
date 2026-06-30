const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const BASE_URL = process.env.HIPIPLAY_SERVER_URL || "http://localhost:4000";
const RPC_URL = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const USDT_BSC_CONTRACT = process.env.USDT_BSC_CONTRACT || "0x55d398326f99059fF775485246999027B3197955";
const POLL_SECONDS = Number(process.env.P2P_WATCHER_SECONDS || 15);
const REQUIRED_CONFIRMATIONS = Number(process.env.P2P_CONFIRMATIONS || 3);

const ROOT = path.resolve(__dirname, "..");
const LOG_FILE = path.join(ROOT, "logs", "p2p-watcher.log");

const ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `${url} respondió HTTP ${response.status}`);
  }

  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPendingP2PTrades() {
  const data = await fetchJson(`${BASE_URL}/api/admin/p2p/trades`);
  const trades = Array.isArray(data.trades) ? data.trades : [];

  return trades.filter((trade) =>
    String(trade.status || "").toUpperCase() === "PAYMENT_PENDING" &&
    String(trade.network || "").toUpperCase() === "BSC" &&
    String(trade.token || "USDT").toUpperCase() === "USDT" &&
    Boolean(trade.paymentAddress)
  );
}

async function checkP2PPayment(provider, usdt, decimals, trade) {
  const latestBlock = await provider.getBlockNumber();
  const safeBlock = Math.max(0, latestBlock - REQUIRED_CONFIRMATIONS);

  const address = ethers.getAddress(trade.paymentAddress);
  const expectedAmount = Number(trade.usdtAmount || 0);
  const expectedRaw = ethers.parseUnits(String(expectedAmount), decimals);

  const balanceRaw = await usdt.balanceOf(address, { blockTag: safeBlock });
  const receivedAmount = Number(ethers.formatUnits(balanceRaw, decimals));

  return {
    paid: balanceRaw >= expectedRaw,
    expectedAmount,
    receivedAmount,
    latestBlock,
    safeBlock,
    confirmations: REQUIRED_CONFIRMATIONS,
    txHash: `AUTO_P2P_BALANCE_CHECK_BSC_BLOCK_${safeBlock}`
  };
}

async function confirmP2PTrade(trade, payment) {
  const body = {
    txHash: payment.txHash,
    paidAmount: payment.expectedAmount,
    receivedAmount: payment.receivedAmount,
    adminNote: `Auto confirmado por P2P watcher BSC USDT usando balanceOf. Bloque seguro: ${payment.safeBlock}`
  };

  return fetchJson(`${BASE_URL}/api/admin/p2p/trades/${trade.tradeId}/confirm`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

async function runOnce(provider, usdt, decimals) {
  const pendingTrades = await getPendingP2PTrades();

  if (!pendingTrades.length) {
    log("Sin trades P2P pendientes.");
    return;
  }

  log("Trades P2P pendientes:", pendingTrades.length);

  for (const trade of pendingTrades) {
    try {
      const payment = await checkP2PPayment(provider, usdt, decimals, trade);

      log(
        "Trade",
        trade.tradeId,
        "buyer:",
        trade.buyerId,
        "seller:",
        trade.sellerId,
        "address:",
        trade.paymentAddress,
        "esperado:",
        payment.expectedAmount,
        "recibido:",
        payment.receivedAmount,
        "safeBlock:",
        payment.safeBlock,
        "paid:",
        payment.paid
      );

      if (!payment.paid) continue;

      const result = await confirmP2PTrade(trade, payment);

      log(
        "P2P CONFIRMADO",
        trade.tradeId,
        "buyer:",
        trade.buyerId,
        "seller:",
        trade.sellerId,
        "coins:",
        trade.coinAmount,
        "usdt:",
        trade.usdtAmount,
        "buyerBalance:",
        result.buyerBalance ? result.buyerBalance.balance : "-",
        "sellerUsdt:",
        result.sellerUsdtBalance ? result.sellerUsdtBalance.balance : "-"
      );
    } catch (error) {
      log("ERROR trade", trade.tradeId || "-", error.message);
    }
  }
}

async function main() {
  log("P2P watcher iniciado - modo balanceOf.");
  log("BASE_URL:", BASE_URL);
  log("RPC_URL:", RPC_URL);
  log("USDT_BSC_CONTRACT:", USDT_BSC_CONTRACT);
  log("POLL_SECONDS:", POLL_SECONDS);
  log("REQUIRED_CONFIRMATIONS:", REQUIRED_CONFIRMATIONS);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const usdt = new ethers.Contract(USDT_BSC_CONTRACT, ABI, provider);

  const symbol = await usdt.symbol();
  const decimals = Number(await usdt.decimals());

  log("Token:", symbol, "decimals:", decimals);

  while (true) {
    try {
      await runOnce(provider, usdt, decimals);
    } catch (error) {
      log("ERROR watcher:", error.message);
    }

    await sleep(POLL_SECONDS * 1000);
  }
}

main().catch((error) => {
  log("FATAL:", error.message);
  process.exit(1);
});