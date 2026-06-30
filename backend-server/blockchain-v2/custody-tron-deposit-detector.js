"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data", "blockchain-v2");

const CONFIG_FILE = path.join(__dirname, "custody-tron-deposit-detector.config.json");
const PANEL_CONFIG_FILE = path.join(__dirname, "payment-console.config.json");
const AUDIT_FILE = path.join(DATA, "custody-tron-deposit-detector-audit.json");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest();
}

function base58Decode(str) {
  let x = 0n;

  for (const char of str) {
    const idx = B58.indexOf(char);
    if (idx < 0) throw new Error("Caracter base58 invalido.");
    x = x * 58n + BigInt(idx);
  }

  let hex = x.toString(16);
  if (hex.length % 2) hex = "0" + hex;

  let buffer = Buffer.from(hex, "hex");

  let leading = 0;
  for (const char of str) {
    if (char === "1") leading++;
    else break;
  }

  if (leading > 0) {
    buffer = Buffer.concat([Buffer.alloc(leading), buffer]);
  }

  return buffer;
}

function base58CheckDecode(str) {
  const raw = base58Decode(str);
  if (raw.length < 5) throw new Error("Base58Check demasiado corto.");

  const payload = raw.subarray(0, -4);
  const checksum = raw.subarray(-4);
  const expected = sha256(sha256(payload)).subarray(0, 4);

  if (!checksum.equals(expected)) {
    throw new Error("Checksum TRON invalido.");
  }

  return payload;
}

function tronAddressToHex20(address) {
  const payload = base58CheckDecode(String(address || ""));
  if (payload.length !== 21 || payload[0] !== 0x41) {
    throw new Error("Direccion TRON invalida.");
  }

  return payload.subarray(1).toString("hex");
}

function isTronAddress(address) {
  try {
    tronAddressToHex20(address);
    return true;
  } catch {
    return false;
  }
}

function pow10(decimals) {
  return 10n ** BigInt(decimals);
}

function decimalToAtomic(value, decimals) {
  const raw = String(value ?? "0").trim().replace(/,/g, "");

  if (!raw || raw === "null" || raw === "undefined") return 0n;

  const sign = raw.startsWith("-") ? -1n : 1n;
  const clean = raw.replace(/^-/, "");
  const parts = clean.split(".");

  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);

  const wholeAtomic = BigInt(whole || "0") * pow10(decimals);
  const fracAtomic = BigInt(frac || "0");

  return sign * (wholeAtomic + fracAtomic);
}

function atomicToDecimal(value, decimals) {
  const n = BigInt(value || 0);
  const base = pow10(decimals);
  const whole = n / base;
  const frac = n % base;

  if (frac === 0n) return whole.toString();

  let fracText = frac.toString().padStart(decimals, "0");
  fracText = fracText.replace(/0+$/, "");

  return `${whole}.${fracText}`;
}

function getIntentId(item) {
  return String(
    item.intentId ||
    item.intent_id ||
    item.id ||
    item.orderId ||
    ""
  );
}

function getDepositAddress(item) {
  return String(
    item.depositAddress ||
    item.vaultAddress ||
    item.vault_address ||
    item.address ||
    item.walletAddress ||
    item.toAddress ||
    ""
  ).trim();
}

function getStatus(item) {
  return String(item.status || "").trim().toUpperCase();
}

function isPending(item) {
  const status = getStatus(item);

  return [
    "PAYMENT_PENDING",
    "PENDING",
    "ASSIGNED",
    "CREATED",
    "NEW",
    "WAITING"
  ].includes(status);
}

function isTronIntent(item) {
  const networkCode = String(item.networkCode || item.network_code || "").toUpperCase();
  const tokenStandard = String(item.tokenStandard || item.token_standard || "").toUpperCase();
  const network = String(item.network || item.requestedNetwork || "").toUpperCase();
  const depositAddress = getDepositAddress(item);

  return (
    networkCode === "TRON_TRC20" ||
    tokenStandard === "TRC20" ||
    network === "TRON" ||
    isTronAddress(depositAddress)
  );
}

function expectedAtomic(item, decimals) {
  const human =
    item.expectedAmount ??
    item.amount ??
    item.requestedAmount ??
    item.expected_amount ??
    item.amountUsdt ??
    item.usdtAmount;

  if (human !== undefined && human !== null && String(human).trim() !== "") {
    return decimalToAtomic(human, decimals);
  }

  const atomic =
    item.expectedAmountAtomic ??
    item.expected_amount_atomic ??
    item.amountAtomic ??
    item.amount_atomic;

  if (atomic !== undefined && atomic !== null && String(atomic).trim() !== "") {
    return BigInt(String(atomic));
  }

  return 0n;
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 20000);

  try {
    const response = await fetch(url, {
      ...(options || {}),
      signal: controller.signal
    });

    const text = await response.text();
    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.response = data;
      throw error;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function panelGet(pathname, config, panelConfig) {
  return fetchJson(
    `${config.panelBaseUrl}${pathname}`,
    {
      method: "GET",
      headers: {
        "x-console-token": panelConfig.consoleToken || ""
      }
    },
    Number(config.timeoutSeconds || 20) * 1000
  );
}

async function panelPost(pathname, body, config, panelConfig) {
  return fetchJson(
    `${config.panelBaseUrl}${pathname}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-console-token": panelConfig.consoleToken || ""
      },
      body: JSON.stringify(body || {})
    },
    Number(config.timeoutSeconds || 20) * 1000
  );
}

function parseTrc20BalanceResponse(data, tokenContract) {
  const list = Array.isArray(data?.data) ? data.data : [];

  for (const item of list) {
    const contract =
      item.tokenId ||
      item.token_id ||
      item.contract_address ||
      item.tokenAddress ||
      item.token_address ||
      "";

    const balance =
      item.balance ??
      item.amount ??
      item.value ??
      item.quantity;

    if (
      balance !== undefined &&
      (
        !contract ||
        String(contract).toLowerCase() === String(tokenContract).toLowerCase()
      )
    ) {
      return BigInt(String(balance));
    }
  }

  return null;
}

async function getBalanceByTronGridList(address, config) {
  const url =
    `${config.tronGridBaseUrl}/v1/accounts/${encodeURIComponent(address)}/trc20/balance`;

  const data =
    await fetchJson(
      url,
      { method: "GET" },
      Number(config.timeoutSeconds || 20) * 1000
    );

  return parseTrc20BalanceResponse(data, config.tokenContract);
}

async function getBalanceByTriggerConstant(address, config) {
  const hex20 = tronAddressToHex20(address);

  const parameter =
    "000000000000000000000000" + hex20;

  const data =
    await fetchJson(
      `${config.tronGridBaseUrl}/wallet/triggerconstantcontract`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          owner_address: address,
          contract_address: config.tokenContract,
          function_selector: "balanceOf(address)",
          parameter,
          visible: true
        })
      },
      Number(config.timeoutSeconds || 20) * 1000
    );

  const hex =
    data?.constant_result &&
    data.constant_result[0];

  if (!hex) return 0n;

  return BigInt("0x" + String(hex).replace(/^0x/i, ""));
}

async function getTrc20Balance(address, config) {
  try {
    const fromList = await getBalanceByTronGridList(address, config);

    if (fromList !== null) {
      return {
        balanceAtomic: fromList,
        source: "trongrid-trc20-balance"
      };
    }
  } catch {}

  const fromContract =
    await getBalanceByTriggerConstant(address, config);

  return {
    balanceAtomic: fromContract,
    source: "triggerconstantcontract"
  };
}

function writeAudit(entry) {
  const audit = readJson(AUDIT_FILE, []);

  audit.push(entry);

  while (audit.length > 1000) {
    audit.shift();
  }

  writeJson(AUDIT_FILE, audit);
}

async function main() {
  const config = readJson(CONFIG_FILE, {});
  const panelConfig = readJson(PANEL_CONFIG_FILE, {});

  const startedAt = new Date().toISOString();

  if (config.enabled !== true) {
    const result = {
      ok: true,
      enabled: false,
      reason: "Detector TRON deshabilitado",
      at: startedAt
    };

    writeAudit(result);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!panelConfig.consoleToken) {
    throw new Error("Falta consoleToken en payment-console.config.json");
  }

  const dashboard =
    await panelGet("/api/dashboard?ts=" + Date.now(), config, panelConfig);

  const intents =
    dashboard.intents ||
    dashboard.dashboard?.intents ||
    [];

  const candidates =
    intents.filter(item =>
      isPending(item) &&
      isTronIntent(item)
    );

  const results = [];

  for (const item of candidates) {
    const intentId = getIntentId(item);
    const depositAddress = getDepositAddress(item);

    if (!intentId || !depositAddress || !isTronAddress(depositAddress)) {
      results.push({
        intentId,
        depositAddress,
        skipped: true,
        reason: "intent o wallet TRON invalida"
      });
      continue;
    }

    const expected = expectedAtomic(item, Number(config.tokenDecimals || 6));
    const balance = await getTrc20Balance(depositAddress, config);

    const paid =
      expected > 0n &&
      balance.balanceAtomic >= expected;

    const result = {
      intentId,
      depositAddress,
      networkCode: "TRON_TRC20",
      expectedAmount: atomicToDecimal(expected, Number(config.tokenDecimals || 6)),
      receivedAmount: atomicToDecimal(balance.balanceAtomic, Number(config.tokenDecimals || 6)),
      expectedAtomic: expected.toString(),
      receivedAtomic: balance.balanceAtomic.toString(),
      balanceSource: balance.source,
      paid,
      markedPaid: false
    };

    if (paid && config.autoMarkPaid === true) {
      const markBody = {
        source: "TRON_DEPOSIT_DETECTOR",
        network: "TRON",
        networkCode: "TRON_TRC20",
        networkLabel: "TRON / TRC20",
        tokenSymbol: "USDT",
        tokenStandard: "TRC20",
        tokenContract: config.tokenContract,
        tokenDecimals: Number(config.tokenDecimals || 6),
        depositAddress,
        receivedAmount: result.receivedAmount,
        receivedAmountAtomic: result.receivedAtomic,
        expectedAmount: result.expectedAmount,
        expectedAmountAtomic: result.expectedAtomic,
        txHash: "TRON_BALANCE_DETECTED_" + depositAddress + "_" + Date.now()
      };

      const markResult =
        await panelPost(
          "/api/intents/" + encodeURIComponent(intentId) + "/mark-paid-real",
          markBody,
          config,
          panelConfig
        );

      result.markedPaid = true;
      result.markResult = markResult;
    }

    results.push(result);
  }

  const summary = {
    ok: true,
    at: startedAt,
    networkCode: "TRON_TRC20",
    totalIntents: intents.length,
    pendingTronChecked: candidates.length,
    paidDetected: results.filter(x => x.paid).length,
    markedPaid: results.filter(x => x.markedPaid).length,
    autoMarkPaid: config.autoMarkPaid === true,
    results
  };

  writeAudit(summary);

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  const result = {
    ok: false,
    at: new Date().toISOString(),
    error: error.message,
    stack: error.stack
  };

  writeAudit(result);

  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});