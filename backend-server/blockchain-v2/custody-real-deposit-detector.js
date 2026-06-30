"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const SERVER_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(SERVER_ROOT, "data", "blockchain-v2");

const WALLETS_FILE = path.join(DATA_DIR, "custody-wallets-bsc.json");
const CHAIN_CONFIG_FILE = path.join(__dirname, "custody-chain.config.json");
const PANEL_CONFIG_FILE = path.join(__dirname, "payment-console.config.json");
const DETECTOR_CONFIG_FILE = path.join(__dirname, "custody-real-deposit-detector.config.json");
const DETECTED_FILE = path.join(DATA_DIR, "custody-real-deposits-detected.json");

const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
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

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function toAtomicAmount(value, decimals) {
  const text = String(value || "0").trim();

  if (!text || text === "null" || text === "undefined") {
    return 0n;
  }

  return ethers.parseUnits(text, decimals);
}

function getIntentExpectedAtomic(intent, decimals) {
  /*
    IMPORTANTE:
    El panel V2 historicamente guardaba expectedAmountAtomic en modo simulado
    con 6 decimales. En BSC/BEP20 real USDT usa 18 decimales.

    Por seguridad, para deteccion real on-chain se prefiere el monto humano:
    expectedAmount, expected_amount, amount, receivedAmount.

    expectedAmountAtomic queda como ultimo recurso.
  */

  const humanCandidates = [
    intent.expectedAmount,
    intent.expected_amount,
    intent.amount,
    intent.receivedAmount,
    intent.received_amount
  ];

  for (const candidate of humanCandidates) {
    const text = String(candidate || "").trim();

    if (
      text &&
      text !== "0" &&
      text !== "0.0" &&
      text !== "null" &&
      text !== "undefined"
    ) {
      return toAtomicAmount(text, decimals);
    }
  }

  if (intent.expectedAmountAtomic) {
    return BigInt(String(intent.expectedAmountAtomic));
  }

  if (intent.expected_amount_atomic) {
    return BigInt(String(intent.expected_amount_atomic));
  }

  return 0n;
}

function getIntentId(intent) {
  return String(
    intent.intentId ||
    intent.intent_id ||
    intent.id ||
    ""
  ).trim();
}

function getIntentPlayerId(intent) {
  return String(
    intent.playerId ||
    intent.player_id ||
    intent.userId ||
    intent.user_id ||
    ""
  ).trim();
}

function getIntentStatus(intent) {
  return String(intent.status || "").trim().toUpperCase();
}

function getIntentDepositAddress(intent) {
  return String(
    intent.depositAddress ||
    intent.deposit_address ||
    intent.vaultAddress ||
    intent.vault_address ||
    ""
  ).trim();
}

function loadConfig() {
  const chain = readJson(CHAIN_CONFIG_FILE, null);
  const panel = readJson(PANEL_CONFIG_FILE, null);
  const detector = readJson(DETECTOR_CONFIG_FILE, {});

  if (!chain) {
    throw new Error("No existe custody-chain.config.json");
  }

  if (!panel) {
    throw new Error("No existe payment-console.config.json");
  }

  if (
    !chain.rpcUrl ||
    String(chain.rpcUrl).includes("PON_AQUI")
  ) {
    throw new Error("rpcUrl no configurado.");
  }

  return {
    chain,
    panel,
    detector: {
      enabled: detector.enabled !== false,
      autoMarkPaid: detector.autoMarkPaid === true,
      panelBaseUrl: detector.panelBaseUrl || "http://127.0.0.1:4105",
      minConfirmations: Number(detector.minConfirmations || 3),
      lookbackBlocks: Number(detector.lookbackBlocks || 300000),
      chunkBlocks: Number(detector.chunkBlocks || 5000),
      scanOnlyAssignedWallets: detector.scanOnlyAssignedWallets !== false,
      requireExactOrGreaterAmount: detector.requireExactOrGreaterAmount !== false,
      useEventLogs: detector.useEventLogs === true
    }
  };
}

async function httpJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  }
  catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      "HTTP " +
      response.status +
      " " +
      url +
      " " +
      JSON.stringify(payload)
    );
  }

  return payload;
}

async function getDashboard(panelBaseUrl, consoleToken) {
  return await httpJson(
    panelBaseUrl.replace(/\/+$/, "") + "/api/dashboard?ts=" + Date.now(),
    {
      method: "GET",
      headers: {
        "x-console-token": String(consoleToken || "")
      }
    }
  );
}

async function markPaid(panelBaseUrl, consoleToken, intentId, amountText, txHash, blockNumber) {
  return await httpJson(
    panelBaseUrl.replace(/\/+$/, "") +
      "/api/intents/" +
      encodeURIComponent(intentId) +
      "/mark-paid-real",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-console-token": String(consoleToken || "")
      },
      body: JSON.stringify({
        amount: amountText,
        receivedAmount: amountText,
        txHash,
        blockNumber,
        source: "REAL_BSC_BALANCE_DETECTED",
        realOnChain: true
      })
    }
  );
}

async function scanIncomingTransfers({
  provider,
  token,
  toAddress,
  fromBlock,
  toBlock,
  chunkBlocks
}) {
  const filter = token.filters.Transfer(null, toAddress);
  const events = [];

  let start = fromBlock;

  while (start <= toBlock) {
    const end = Math.min(start + chunkBlocks - 1, toBlock);

    const batch = await token.queryFilter(filter, start, end);

    for (const event of batch) {
      events.push(event);
    }

    start = end + 1;
  }

  return events;
}

async function runOnce() {
  const { chain, panel, detector } = loadConfig();

  if (!detector.enabled) {
    return {
      ok: true,
      enabled: false,
      message: "Detector deshabilitado."
    };
  }

  const wallets = readJson(WALLETS_FILE, []);
  const detected = readJson(DETECTED_FILE, {});

  const provider = new ethers.JsonRpcProvider(chain.rpcUrl, Number(chain.chainId));
  const token = new ethers.Contract(chain.usdtContract, ERC20_ABI, provider);

  const network = await provider.getNetwork();

  if (Number(network.chainId) !== Number(chain.chainId)) {
    throw new Error(
      "RPC incorrecto. Esperado " +
      chain.chainId +
      ", recibido " +
      String(network.chainId)
    );
  }

  let decimals = Number(chain.usdtDecimals || 18);

  try {
    decimals = Number(await token.decimals());
  }
  catch {
    decimals = Number(chain.usdtDecimals || 18);
  }

  const currentBlock = await provider.getBlockNumber();

  const dashboard = await getDashboard(
    detector.panelBaseUrl,
    panel.consoleToken
  );

  const intents = Array.isArray(dashboard.intents)
    ? dashboard.intents
    : [];

  const pendingIntents = intents.filter(intent =>
    getIntentStatus(intent) !== "PAID" &&
    getIntentStatus(intent) !== "CANCELLED" &&
    getIntentStatus(intent) !== "EXPIRED"
  );

  const walletByAddress = new Map();

  for (const wallet of wallets) {
    walletByAddress.set(normalizeAddress(wallet.address), wallet);
  }

  const results = [];

  for (const intent of pendingIntents) {
    const intentId = getIntentId(intent);
    const playerId = getIntentPlayerId(intent);
    const depositAddress = getIntentDepositAddress(intent);

    if (!intentId || !depositAddress) {
      continue;
    }

    const wallet = walletByAddress.get(normalizeAddress(depositAddress));

    if (detector.scanOnlyAssignedWallets && !wallet) {
      continue;
    }

    if (
      detector.scanOnlyAssignedWallets &&
      wallet &&
      wallet.assignedIntentId &&
      String(wallet.assignedIntentId) !== intentId
    ) {
      continue;
    }

    const expectedAtomic = getIntentExpectedAtomic(intent, decimals);

    if (expectedAtomic <= 0n) {
      results.push({
        intentId,
        depositAddress,
        status: "SKIPPED",
        reason: "expected amount empty"
      });

      continue;
    }

    const initialFromBlock =
      Math.max(1, currentBlock - detector.lookbackBlocks);

    const walletScanFrom =
      wallet && wallet.lastDepositScanBlock
        ? Math.max(
            initialFromBlock,
            Number(wallet.lastDepositScanBlock) - 20
          )
        : initialFromBlock;

    let events = [];
    let logScanError = null;

    if (detector.useEventLogs === true) {
      try {
        events = await scanIncomingTransfers({
          provider,
          token,
          toAddress: depositAddress,
          fromBlock: walletScanFrom,
          toBlock: currentBlock,
          chunkBlocks: detector.chunkBlocks
        });
      }
      catch (error) {
        logScanError =
          error && error.message
            ? error.message
            : String(error || "eth_getLogs failed");

        events = [];
      }
    }

    let totalReceived = 0n;
    let bestEvent = null;

    for (const event of events) {
      const value = BigInt(event.args.value.toString());
      totalReceived += value;

      if (!bestEvent || Number(event.blockNumber) > Number(bestEvent.blockNumber)) {
        bestEvent = event;
      }
    }

    const tokenBalance = await token.balanceOf(depositAddress);
    const balanceAtomic = BigInt(tokenBalance.toString());

    const amountIsEnough =
      detector.requireExactOrGreaterAmount
        ? totalReceived >= expectedAtomic || balanceAtomic >= expectedAtomic
        : totalReceived > 0n || balanceAtomic > 0n;

    const confirmations =
      bestEvent
        ? currentBlock - Number(bestEvent.blockNumber) + 1
        : 0;

    const confirmedEnough =
      confirmations >= detector.minConfirmations ||
      (amountIsEnough && !bestEvent);

    const amountText =
      ethers.formatUnits(
        totalReceived > 0n ? totalReceived : balanceAtomic,
        decimals
      );

    const detectedKey =
      intentId + ":" + normalizeAddress(depositAddress);

    const item = {
      intentId,
      playerId,
      depositAddress,
      expectedAmount: ethers.formatUnits(expectedAtomic, decimals),
      expectedAmountAtomic: expectedAtomic.toString(),
      receivedByEvents: ethers.formatUnits(totalReceived, decimals),
      receivedByEventsAtomic: totalReceived.toString(),
      currentBalance: ethers.formatUnits(balanceAtomic, decimals),
      currentBalanceAtomic: balanceAtomic.toString(),
      txHash: bestEvent ? bestEvent.transactionHash : null,
      blockNumber: bestEvent ? Number(bestEvent.blockNumber) : null,
      currentBlock,
      confirmations,
      logScanError,
      amountIsEnough,
      confirmedEnough,
      autoMarkPaid: detector.autoMarkPaid,
      detectedAt: nowIso()
    };

    if (wallet) {
      wallet.lastDepositScanBlock = currentBlock;
      wallet.lastDepositScanAt = nowIso();
      wallet.updatedAt = nowIso();
    }

    if (amountIsEnough && confirmedEnough) {
      detected[detectedKey] = {
        ...item,
        status: detector.autoMarkPaid ? "AUTO_MARK_ATTEMPTED" : "DETECTED_WAITING_APPROVAL"
      };

      if (detector.autoMarkPaid && !detected[detectedKey].paidMarkedAt) {
        const paidResult = await markPaid(
          detector.panelBaseUrl,
          panel.consoleToken,
          intentId,
          amountText,
          bestEvent ? bestEvent.transactionHash : "BALANCE_DETECTED_" + intentId,
          bestEvent ? Number(bestEvent.blockNumber) : currentBlock
        );

        detected[detectedKey].paidMarkedAt = nowIso();
        detected[detectedKey].paidResult = paidResult;
        detected[detectedKey].status = "PAID_MARKED";
      }

      results.push({
        ...item,
        status: detector.autoMarkPaid ? "PAID_MARKED" : "DETECTED_WAITING_APPROVAL"
      });
    }
    else {
      results.push({
        ...item,
        status: "NOT_ENOUGH_YET"
      });
    }
  }

  writeJson(WALLETS_FILE, wallets);
  writeJson(DETECTED_FILE, detected);

  return {
    ok: true,
    network: chain.network,
    chainId: Number(chain.chainId),
    rpcChainId: Number(network.chainId),
    currentBlock,
    tokenContract: chain.usdtContract,
    decimals,
    autoMarkPaid: detector.autoMarkPaid,
    useEventLogs: detector.useEventLogs,
    minConfirmations: detector.minConfirmations,
    pendingIntents: pendingIntents.length,
    scanned: results.length,
    detectedCount: results.filter(item =>
      item.status === "DETECTED_WAITING_APPROVAL" ||
      item.status === "PAID_MARKED"
    ).length,
    results,
    detectedFile: DETECTED_FILE
  };
}

async function main() {
  const cmd = String(process.argv[2] || "scan").toLowerCase();

  if (cmd === "scan") {
    const result = await runOnce();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    usage: [
      "node custody-real-deposit-detector.js scan"
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