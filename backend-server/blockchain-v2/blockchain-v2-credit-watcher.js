"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SERVER_ROOT = path.resolve(__dirname, "..");
const MODULE_ROOT = __dirname;

const CONFIG_FILE = path.join(MODULE_ROOT, "payment-console.config.json");
const ADMIN_TOKEN_FILE = path.join(MODULE_ROOT, "main-admin-token.txt");
const CREDITED_FILE = path.join(SERVER_ROOT, "data", "blockchain-v2", "credited-paid-intents.json");

const MAIN_BASE = process.env.HIPI_MAIN_BASE || "http://127.0.0.1:4000";
const V2_BASE = process.env.HIPI_V2_BASE || "http://127.0.0.1:4105";
const INTERVAL_MS = Number(process.env.HIPI_CREDIT_WATCHER_INTERVAL_MS || 7000);

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value || {}, null, 2), "utf8");
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
  } catch {
    return "";
  }
}

function getConsoleToken() {
  const config = readJson(CONFIG_FILE, {});
  return String(config.consoleToken || config.token || "").trim();
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { method: "GET", headers });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(json?.error || `HTTP ${response.status}`);
  }

  return json;
}

async function postJson(url, payload, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload || {})
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(json?.error || `HTTP ${response.status}`);
  }

  return json;
}

function amountOf(intent) {
  const value = Number(intent.expectedAmount || intent.receivedAmount || intent.amount || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function intentIdOf(intent) {
  return String(intent.intentId || intent.id || intent.orderId || "").trim();
}

function playerIdOf(intent) {
  return String(intent.playerId || intent.userId || "").trim();
}

async function creditIntent(intent, credited) {
  const intentId = intentIdOf(intent);
  const playerId = playerIdOf(intent);
  const amount = amountOf(intent);

  if (!intentId || !playerId || amount <= 0) return;
  if (credited[intentId]) return;

  const adminToken = readText(ADMIN_TOKEN_FILE);

  if (!adminToken) {
    throw new Error("main-admin-token.txt esta vacio.");
  }

  const current = await getJson(`${MAIN_BASE}/api/player/balance/${encodeURIComponent(playerId)}`);
  const currentBalance = Math.floor(Number(current.balance || 0));
  const targetBalance = currentBalance + amount;

  const result = await postJson(
    `${MAIN_BASE}/api/admin/player/balance`,
    {
      playerId,
      balance: targetBalance,
      reason: "BLOCKCHAIN_V2_PAID",
      intentId,
      amount,
      source: "BLOCKCHAIN_V2_CREDIT_WATCHER"
    },
    { "x-admin-token": adminToken }
  );

  credited[intentId] = {
    intentId,
    playerId,
    amount,
    balanceBefore: currentBalance,
    balanceAfter: targetBalance,
    status: intent.status,
    network: intent.network || null,
    networkLabel: intent.networkLabel || intent.requestedNetwork || null,
    token: intent.tokenSymbol || intent.token || "USDT",
    depositAddress: intent.depositAddress || intent.address || null,
    sourceWallet: intent.sourceWallet || intent.customerWallet || intent.fromAddress || null,
    creditedAt: new Date().toISOString(),
    purchasedBalance: result.purchasedBalance || null,
    promoBalance: result.promoBalance || null
  };

  writeJson(CREDITED_FILE, credited);

  console.log(`[OK] ${intentId} acreditado: ${playerId} +${amount}`);
}

async function tick() {
  const consoleToken = getConsoleToken();

  if (!consoleToken) {
    throw new Error("consoleToken no encontrado.");
  }

  const dashboard = await getJson(
    `${V2_BASE}/api/dashboard?ts=${Date.now()}`,
    { "x-console-token": consoleToken }
  );

  const intents = Array.isArray(dashboard.intents) ? dashboard.intents : [];
  const paid = intents.filter(x => String(x.status || "").toUpperCase() === "PAID");
  const credited = readJson(CREDITED_FILE, {});

  if (!fs.existsSync(CREDITED_FILE)) {
    for (const intent of paid) {
      const intentId = intentIdOf(intent);
      if (intentId) {
        credited[intentId] = {
          intentId,
          playerId: playerIdOf(intent),
          amount: amountOf(intent),
          status: intent.status,
          baselineIgnored: true,
          notedAt: new Date().toISOString()
        };
      }
    }

    writeJson(CREDITED_FILE, credited);

    if (paid.length > 0) {
      console.log(`[BASELINE] ${paid.length} intent(s) PAID existentes marcados sin acreditar.`);
    }

    return;
  }

  for (const intent of paid) {
    try {
      await creditIntent(intent, credited);
    } catch (error) {
      console.error(`[ERROR] ${intentIdOf(intent) || "UNKNOWN"}: ${error.message}`);
    }
  }
}

async function main() {
  console.log("[HipiPlay] Blockchain V2 credit watcher iniciado.");
  console.log(`[HipiPlay] MAIN_BASE=${MAIN_BASE}`);
  console.log(`[HipiPlay] V2_BASE=${V2_BASE}`);
  console.log(`[HipiPlay] CREDITED_FILE=${CREDITED_FILE}`);

  await tick();

  setInterval(() => {
    tick().catch(error => console.error("[ERROR] tick:", error.message));
  }, INTERVAL_MS);
}

main().catch(error => {
  console.error("[FATAL]", error.message);
  process.exit(1);
});