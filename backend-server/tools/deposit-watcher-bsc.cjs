const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const BASE_URL = process.env.HIPIPLAY_SERVER_URL || "http://localhost:4000";
const RPC_URL = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const USDT_BSC_CONTRACT = process.env.USDT_BSC_CONTRACT || "0x55d398326f99059fF775485246999027B3197955";
const POLL_SECONDS = Number(process.env.DEPOSIT_WATCHER_SECONDS || 15);
const REQUIRED_CONFIRMATIONS = Number(process.env.DEPOSIT_CONFIRMATIONS || 3);

const ROOT = path.resolve(__dirname, "..");
const LOG_FILE = path.join(ROOT, "logs", "deposit-watcher.log");

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

async function getPendingDeposits() {
  const data = await fetchJson(`${BASE_URL}/api/admin/deposits`);
  const deposits = Array.isArray(data.deposits) ? data.deposits : [];

  return deposits.filter((order) =>
    String(order.status || "").toUpperCase() === "PENDING" &&
    String(order.network || "").toUpperCase() === "BSC" &&
    String(order.token || "USDT").toUpperCase() === "USDT"
  );
}

async function checkBalancePayment(provider, usdt, decimals, order) {
  const latestBlock = await provider.getBlockNumber();
  const safeBlock = Math.max(0, latestBlock - REQUIRED_CONFIRMATIONS);

  const address = ethers.getAddress(order.address);
  const expectedAmount = Number(order.expectedAmount || order.amount || 0);
  const expectedRaw = ethers.parseUnits(String(expectedAmount), decimals);

  // Se revisa el balance en un bloque anterior para respetar confirmaciones.
  const balanceRaw = await usdt.balanceOf(address, { blockTag: safeBlock });
  const receivedAmount = Number(ethers.formatUnits(balanceRaw, decimals));

  return {
    paid: balanceRaw >= expectedRaw,
    expectedAmount,
    receivedAmount,
    latestBlock,
    safeBlock,
    confirmations: REQUIRED_CONFIRMATIONS,
    txHash: `AUTO_BALANCE_CHECK_BSC_BLOCK_${safeBlock}`
  };
}

async function confirmOrder(order, payment) {
  // Para evitar sobre-acreditar por dust o pagos extra, acredita el monto esperado.
  // Si quieres acreditar sobrepagos automáticamente, cambia expectedAmount por receivedAmount.
  const body = {
    txHash: payment.txHash,
    creditedAmount: payment.expectedAmount,
    adminNote: `Auto confirmado por watcher BSC USDT usando balanceOf. Bloque seguro: ${payment.safeBlock}`
  };

  return fetchJson(`${BASE_URL}/api/admin/deposits/${order.orderId}/confirm`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

async function runOnce(provider, usdt, decimals) {
  const pending = await getPendingDeposits();

  if (!pending.length) {
    log("Sin depósitos pendientes.");
    return;
  }

  log("Depósitos pendientes:", pending.length);

  for (const order of pending) {
    try {
      const payment = await checkBalancePayment(provider, usdt, decimals, order);

      log(
        "Orden",
        order.orderId,
        "address:",
        order.address,
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

      const result = await confirmOrder(order, payment);

      log(
        "CONFIRMADA",
        order.orderId,
        "player:",
        order.playerId,
        "credited:",
        payment.expectedAmount,
        "balance:",
        result.balance ? result.balance.balance : "-"
      );
    } catch (error) {
      log("ERROR orden", order.orderId || "-", error.message);
    }
  }
}

async function main() {
  log("Deposit watcher iniciado - modo balanceOf.");
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