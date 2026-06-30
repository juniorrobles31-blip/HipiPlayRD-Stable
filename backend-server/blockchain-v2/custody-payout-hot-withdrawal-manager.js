"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data", "blockchain-v2");

const CONFIG_FILE = path.join(__dirname, "custody-payout-hot-withdrawal.config.json");
const WALLET_FILE = path.join(DATA, "custody-wallets-bsc.json");
const QUEUE_FILE = path.join(DATA, "custody-withdrawal-requests.json");
const AUDIT_FILE = path.join(DATA, "custody-withdrawal-requests-audit.json");

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

function audit(entry) {
  const list = readJson(AUDIT_FILE, []);
  list.push({
    at: new Date().toISOString(),
    ...entry
  });

  while (list.length > 1000) {
    list.shift();
  }

  writeJson(AUDIT_FILE, list);
}

function getWallets(doc) {
  if (Array.isArray(doc)) return doc;
  if (Array.isArray(doc.wallets)) return doc.wallets;
  if (Array.isArray(doc.items)) return doc.items;
  if (Array.isArray(doc.custodyWallets)) return doc.custodyWallets;
  if (Array.isArray(doc.bscWallets)) return doc.bscWallets;
  return [];
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

function isValidTron(address) {
  try {
    const payload = base58CheckDecode(String(address || ""));
    return payload.length === 21 && payload[0] === 0x41;
  } catch {
    return false;
  }
}

function detectNetwork(address) {
  const clean = String(address || "").trim();

  if (/^0x[a-fA-F0-9]{40}$/.test(clean)) {
    return {
      networkCode: "BSC_BEP20",
      network: "BSC / BEP20",
      tokenStandard: "BEP20",
      tokenDecimals: 18,
      gasToken: "BNB"
    };
  }

  if (isValidTron(clean)) {
    return {
      networkCode: "TRON_TRC20",
      network: "TRON / TRC20",
      tokenStandard: "TRC20",
      tokenDecimals: 6,
      gasToken: "TRX"
    };
  }

  throw new Error("Wallet destino invalida o carretera no soportada.");
}

function decimalNumber(value) {
  const n = Number(String(value ?? "").replace(/,/g, "."));
  if (!Number.isFinite(n)) throw new Error("Monto invalido.");
  return n;
}

function newId(prefix) {
  return prefix + "-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(6).toString("hex").toUpperCase();
}

function loadConfig() {
  const config = readJson(CONFIG_FILE, {});
  if (config.enabled !== true) throw new Error("Modulo de retiros deshabilitado.");
  return config;
}

function loadQueue() {
  const queue = readJson(QUEUE_FILE, []);
  return Array.isArray(queue) ? queue : [];
}

function saveQueue(queue) {
  writeJson(QUEUE_FILE, queue);
}

function loadPayoutHot(networkCode) {
  const raw = fs.readFileSync(WALLET_FILE, "utf8");

  if (/"privateKey"\s*:/.test(raw)) {
    throw new Error("PELIGRO: privateKey plana detectada. Operacion bloqueada.");
  }

  const doc = JSON.parse(raw.replace(/^\uFEFF/, ""));
  const wallets = getWallets(doc);

  const hot = wallets.find(w =>
    String(w.role || "") === "PAYOUT_HOT" &&
    String(w.status || "") === "ACTIVE" &&
    String(w.networkCode || "") === String(networkCode)
  );

  if (!hot || !hot.address) {
    throw new Error("No existe PAYOUT_HOT activo para " + networkCode);
  }

  return {
    walletId: hot.walletId || hot.id,
    address: hot.address,
    networkCode: hot.networkCode,
    network: hot.network,
    tokenStandard: hot.tokenStandard
  };
}

function validateConfigNetwork(config, networkCode) {
  const allowed = Array.isArray(config.supportedNetworks)
    ? config.supportedNetworks
    : [];

  if (!allowed.includes(networkCode)) {
    throw new Error("Carretera no habilitada para retiro: " + networkCode);
  }
}

function calculateAmounts(config, networkCode, amountUsdt) {
  const fee =
    Number(
      config?.fees?.[networkCode]?.customerFeeUsdt ??
      0
    );

  if (!Number.isFinite(fee) || fee < 0) {
    throw new Error("Fee invalido para " + networkCode);
  }

  const net = amountUsdt - fee;

  if (net <= 0) {
    throw new Error("El monto debe ser mayor que la comision.");
  }

  return {
    grossAmountUsdt: Number(amountUsdt.toFixed(6)),
    feeUsdt: Number(fee.toFixed(6)),
    netAmountUsdt: Number(net.toFixed(6))
  };
}

function status() {
  const config = loadConfig();
  const queue = loadQueue();

  const bsc = loadPayoutHot("BSC_BEP20");
  const tron = loadPayoutHot("TRON_TRC20");

  return {
    ok: true,
    mode: config.mode,
    broadcastEnabled: config.broadcastEnabled === true,
    requireManualApproval: config.requireManualApproval === true,
    supportedNetworks: config.supportedNetworks || [],
    payoutHot: {
      BSC_BEP20: bsc,
      TRON_TRC20: tron
    },
    totalRequests: queue.length,
    byStatus: queue.reduce((acc, item) => {
      const s = item.status || "UNKNOWN";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {})
  };
}

function validateAddress(address) {
  const network = detectNetwork(address);
  const config = loadConfig();
  validateConfigNetwork(config, network.networkCode);
  const hot = loadPayoutHot(network.networkCode);

  return {
    ok: true,
    destinationAddress: address,
    ...network,
    payoutHotWalletId: hot.walletId,
    payoutHotAddress: hot.address
  };
}

function createRequest(playerId, amount, destinationAddress, visibleId) {
  const config = loadConfig();
  const amountUsdt = decimalNumber(amount);

  const min = Number(config.minWithdrawUsdt || 0);
  const max = Number(config.maxWithdrawUsdt || 0);

  if (amountUsdt <= 0) throw new Error("Monto debe ser mayor que cero.");
  if (min > 0 && amountUsdt < min) throw new Error("Monto menor al minimo configurado.");
  if (max > 0 && amountUsdt > max) throw new Error("Monto mayor al maximo configurado.");

  if (!playerId) throw new Error("playerId requerido.");

  const network = detectNetwork(destinationAddress);
  validateConfigNetwork(config, network.networkCode);

  const hot = loadPayoutHot(network.networkCode);
  const amounts = calculateAmounts(config, network.networkCode, amountUsdt);

  const queue = loadQueue();

  const request = {
    requestId: newId("WD"),
    playerId: String(playerId),
    visibleId: visibleId ? String(visibleId) : null,
    status: config.requireManualApproval === true ? "PENDING_REVIEW" : "APPROVED",
    token: "USDT",
    ...network,
    payoutHotWalletId: hot.walletId,
    payoutHotAddress: hot.address,
    destinationAddress: String(destinationAddress).trim(),
    ...amounts,
    broadcastEnabled: config.broadcastEnabled === true,
    createdAt: new Date().toISOString(),
    approvedAt: null,
    rejectedAt: null,
    executedAt: null,
    txHash: null,
    notes: [
      "DRY_RUN_ONLY: no firma ni envia fondos reales"
    ]
  };

  queue.push(request);
  saveQueue(queue);

  audit({
    action: "CREATE_WITHDRAWAL_REQUEST",
    requestId: request.requestId,
    playerId: request.playerId,
    networkCode: request.networkCode,
    amountUsdt: request.grossAmountUsdt
  });

  return {
    ok: true,
    request
  };
}

function findRequest(queue, id) {
  const request = queue.find(x => String(x.requestId) === String(id));
  if (!request) throw new Error("Solicitud no encontrada: " + id);
  return request;
}

function approve(id) {
  const queue = loadQueue();
  const request = findRequest(queue, id);

  if (request.status !== "PENDING_REVIEW") {
    throw new Error("Solo se puede aprobar una solicitud PENDING_REVIEW.");
  }

  request.status = "APPROVED";
  request.approvedAt = new Date().toISOString();

  saveQueue(queue);

  audit({
    action: "APPROVE_WITHDRAWAL_REQUEST",
    requestId: request.requestId
  });

  return {
    ok: true,
    request
  };
}

function reject(id, reason) {
  const queue = loadQueue();
  const request = findRequest(queue, id);

  if (["EXECUTED", "DRY_RUN_EXECUTED"].includes(request.status)) {
    throw new Error("No se puede rechazar una solicitud ya ejecutada.");
  }

  request.status = "REJECTED";
  request.rejectedAt = new Date().toISOString();
  request.rejectReason = reason || "Rechazada manualmente";

  saveQueue(queue);

  audit({
    action: "REJECT_WITHDRAWAL_REQUEST",
    requestId: request.requestId,
    reason: request.rejectReason
  });

  return {
    ok: true,
    request
  };
}

function plan(id) {
  const queue = loadQueue();
  const request = findRequest(queue, id);

  const hot = loadPayoutHot(request.networkCode);

  return {
    ok: true,
    dryRun: true,
    requestId: request.requestId,
    status: request.status,
    token: request.token,
    networkCode: request.networkCode,
    network: request.network,
    tokenStandard: request.tokenStandard,
    fromPayoutHotWalletId: hot.walletId,
    fromPayoutHotAddress: hot.address,
    toCustomerAddress: request.destinationAddress,
    grossAmountUsdt: request.grossAmountUsdt,
    feeUsdt: request.feeUsdt,
    netAmountUsdt: request.netAmountUsdt,
    gasToken: request.gasToken,
    broadcastEnabled: false,
    message: "Plan generado en DRY-RUN. No se firmo ni envio transaccion."
  };
}

function executeDryRun(id) {
  const config = loadConfig();
  const queue = loadQueue();
  const request = findRequest(queue, id);

  if (request.status !== "APPROVED") {
    throw new Error("La solicitud debe estar APPROVED antes de ejecutar.");
  }

  if (config.broadcastEnabled === true) {
    throw new Error("Broadcast real no permitido por este comando. Modo actual bloqueado por seguridad.");
  }

  const executionPlan = plan(id);

  request.status = "DRY_RUN_EXECUTED";
  request.executedAt = new Date().toISOString();
  request.txHash = null;
  request.executionPlan = executionPlan;

  saveQueue(queue);

  audit({
    action: "DRY_RUN_EXECUTE_WITHDRAWAL",
    requestId: request.requestId,
    networkCode: request.networkCode,
    amountUsdt: request.netAmountUsdt
  });

  return {
    ok: true,
    dryRun: true,
    executed: false,
    request,
    message: "DRY-RUN completado. No se movieron fondos reales."
  };
}

function list() {
  return {
    ok: true,
    requests: loadQueue()
  };
}

function selfTest() {
  const s = status();
  const bsc = validateAddress(s.payoutHot.BSC_BEP20.address);
  const tron = validateAddress(s.payoutHot.TRON_TRC20.address);

  return {
    ok: true,
    status: s,
    addressValidation: {
      BSC_BEP20: bsc,
      TRON_TRC20: tron
    }
  };
}

async function main() {
  const cmd = String(process.argv[2] || "help").toLowerCase();

  let result;

  if (cmd === "status") {
    result = status();
  }
  else if (cmd === "list") {
    result = list();
  }
  else if (cmd === "validate-address") {
    result = validateAddress(process.argv[3]);
  }
  else if (cmd === "create") {
    result = createRequest(
      process.argv[3],
      process.argv[4],
      process.argv[5],
      process.argv[6]
    );
  }
  else if (cmd === "approve") {
    result = approve(process.argv[3]);
  }
  else if (cmd === "reject") {
    result = reject(process.argv[3], process.argv.slice(4).join(" "));
  }
  else if (cmd === "plan") {
    result = plan(process.argv[3]);
  }
  else if (cmd === "dry-run") {
    result = executeDryRun(process.argv[3]);
  }
  else if (cmd === "self-test") {
    result = selfTest();
  }
  else {
    result = {
      ok: true,
      commands: [
        "status",
        "list",
        "validate-address <wallet>",
        "create <playerId> <amountUsdt> <destinationWallet> [visibleId]",
        "approve <requestId>",
        "reject <requestId> [reason]",
        "plan <requestId>",
        "dry-run <requestId>",
        "self-test"
      ],
      safety: "broadcastEnabled=false. No envia fondos reales."
    };
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  const result = {
    ok: false,
    error: error.message,
    stack: error.stack
  };

  audit({
    action: "ERROR",
    error: error.message
  });

  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});