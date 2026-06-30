const { ethers } = require("ethers");

const orderId = process.argv[2];
const shouldConfirm = process.argv.includes("--confirm");
const txArg = process.argv.find((arg) => arg.startsWith("--tx="));
const txHash = txArg ? txArg.slice(5) : "";

const baseUrl = "http://localhost:4000";
const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/";
const usdtContractAddress = "0x55d398326f99059fF775485246999027B3197955";

const abi = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

if (!orderId) {
  console.error("Uso:");
  console.error("node tools/check-usdt-bsc-payment.cjs DEP-ORDER-ID");
  console.error("node tools/check-usdt-bsc-payment.cjs DEP-ORDER-ID --confirm --tx=0xHASH");
  process.exit(1);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

async function main() {
  const orderData = await fetchJson(`${baseUrl}/api/player/deposit/${orderId}`);
  const order = orderData.order;

  if (!order) {
    throw new Error("Orden no encontrada.");
  }

  if (String(order.network).toUpperCase() !== "BSC") {
    throw new Error(`Este script solo verifica BSC. La orden es ${order.network}.`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const usdt = new ethers.Contract(usdtContractAddress, abi, provider);

  const decimals = Number(await usdt.decimals());
  const symbol = await usdt.symbol();
  const balanceRaw = await usdt.balanceOf(order.address);
  const expectedRaw = ethers.parseUnits(String(order.expectedAmount), decimals);

  const balance = Number(ethers.formatUnits(balanceRaw, decimals));
  const expected = Number(order.expectedAmount);
  const paid = balanceRaw >= expectedRaw;

  const result = {
    orderId: order.orderId,
    status: order.status,
    network: order.network,
    token: symbol,
    address: order.address,
    expectedAmount: expected,
    receivedOnAddress: balance,
    paid
  };

  console.log(JSON.stringify(result, null, 2));

  if (!paid) {
    console.log("");
    console.log("Pago aún NO detectado. Espera confirmación en la red y vuelve a ejecutar.");
    return;
  }

  console.log("");
  console.log("Pago detectado por balance en la wallet asignada.");

  if (shouldConfirm) {
    const confirm = await fetchJson(`${baseUrl}/api/admin/deposits/${orderId}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        txHash,
        creditedAmount: balance,
        adminNote: "Confirmado por verificación de balance BSC USDT"
      })
    });

    console.log("");
    console.log("Orden confirmada y monedas acreditadas:");
    console.log(JSON.stringify(confirm, null, 2));
  } else {
    console.log("");
    console.log("Para acreditar monedas al jugador ejecuta:");
    console.log(`node tools/check-usdt-bsc-payment.cjs ${orderId} --confirm --tx=TXHASH_REAL`);
  }
}

main().catch((error) => {
  console.error("ERROR:", error.message);
  process.exit(1);
});