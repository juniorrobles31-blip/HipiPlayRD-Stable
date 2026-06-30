"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

let ethersPkg;
try {
  ethersPkg = require("ethers");
} catch (err) {
  throw new Error("No se pudo cargar ethers. Detalle: " + err.message);
}

const ethersRoot = ethersPkg.ethers || ethersPkg;
const Wallet = ethersPkg.Wallet || ethersPkg.ethers?.Wallet;

if (!Wallet) {
  throw new Error("No se pudo resolver ethers.Wallet.");
}

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data", "blockchain-v2");
const WALLET_FILE = path.join(DATA, "custody-wallets-bsc.json");
const MASTER_KEY_FILE = path.join(__dirname, "custody-master-key.hex");
const NETWORK_CATALOG_FILE = path.join(__dirname, "custody-network-catalog.json");

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

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

function getWallets(doc) {
  if (Array.isArray(doc)) return doc;
  if (Array.isArray(doc.wallets)) return doc.wallets;
  if (Array.isArray(doc.items)) return doc.items;
  if (Array.isArray(doc.custodyWallets)) return doc.custodyWallets;
  if (Array.isArray(doc.bscWallets)) return doc.bscWallets;
  throw new Error("No pude detectar arreglo de wallets.");
}

function norm(value) {
  return String(value || "").trim().toUpperCase();
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest();
}

function base58Encode(buffer) {
  let x = BigInt("0x" + buffer.toString("hex"));
  let out = "";

  while (x > 0n) {
    const mod = x % 58n;
    out = BASE58_ALPHABET[Number(mod)] + out;
    x = x / 58n;
  }

  for (const byte of buffer) {
    if (byte === 0) out = "1" + out;
    else break;
  }

  return out || "1";
}

function base58Decode(str) {
  let x = 0n;

  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
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

function base58CheckEncode(payload) {
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return base58Encode(Buffer.concat([payload, checksum]));
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

function readMasterKey() {
  const raw = fs.readFileSync(MASTER_KEY_FILE, "utf8").trim().replace(/^0x/i, "");
  const key = Buffer.from(raw, "hex");

  if (key.length !== 32) {
    throw new Error("Master key invalida. Debe ser 32 bytes / 64 hex.");
  }

  return key;
}

function encryptPrivateKey(privateKey, masterKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);

  const encrypted = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return {
    algorithm: "aes-256-gcm",
    version: 1,
    encoding: "hex",
    iv: iv.toString("hex"),
    ciphertext: encrypted.toString("hex"),
    authTag: tag.toString("hex")
  };
}

function decryptPrivateKey(payload, masterKey) {
  const iv = Buffer.from(payload.iv, "hex");
  const ciphertext = Buffer.from(payload.ciphertext || payload.encrypted || payload.data, "hex");
  const tag = Buffer.from(payload.authTag || payload.tag, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

function getKeccak256() {
  const fn = ethersRoot.keccak256 || ethersPkg.keccak256 || ethersPkg.utils?.keccak256;
  if (!fn) throw new Error("No se encontro keccak256 en ethers.");
  return fn;
}

function getBytes(value) {
  const fn = ethersRoot.getBytes || ethersPkg.getBytes || ethersPkg.utils?.arrayify;
  if (!fn) throw new Error("No se encontro getBytes/arrayify en ethers.");
  return fn(value);
}

function computePublicKeyUncompressed(privateKey) {
  const SigningKey = ethersRoot.SigningKey || ethersPkg.SigningKey;

  if (SigningKey && typeof SigningKey.computePublicKey === "function") {
    return SigningKey.computePublicKey(privateKey, false);
  }

  if (ethersPkg.utils && typeof ethersPkg.utils.computePublicKey === "function") {
    return ethersPkg.utils.computePublicKey(privateKey, false);
  }

  const w = new Wallet(privateKey);
  const pub = w.publicKey || w.signingKey?.publicKey;

  if (pub && /^0x04[0-9a-fA-F]{128}$/.test(pub)) {
    return pub;
  }

  throw new Error("No se pudo calcular public key uncompressed.");
}

function privateKeyToTronAddress(privateKey) {
  const keccak256 = getKeccak256();
  const publicKey = computePublicKeyUncompressed(privateKey);
  const pubNoPrefix = "0x" + publicKey.replace(/^0x04/i, "");
  const hash = String(keccak256(getBytes(pubNoPrefix))).replace(/^0x/i, "");
  const address20 = Buffer.from(hash.slice(-40), "hex");
  const payload = Buffer.concat([Buffer.from([0x41]), address20]);
  return base58CheckEncode(payload);
}

function isValidTronAddress(address) {
  try {
    const payload = base58CheckDecode(String(address || ""));
    return payload.length === 21 && payload[0] === 0x41;
  } catch {
    return false;
  }
}

function detectNetworkFromAddress(address) {
  const value = String(address || "").trim();

  if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
    return {
      ok: true,
      networkCode: "BSC_BEP20",
      label: "BSC / BEP20",
      family: "EVM",
      token: "USDT",
      tokenStandard: "BEP20",
      gasToken: "BNB"
    };
  }

  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value) && isValidTronAddress(value)) {
    return {
      ok: true,
      networkCode: "TRON_TRC20",
      label: "TRON / TRC20",
      family: "TRON",
      token: "USDT",
      tokenStandard: "TRC20",
      gasToken: "TRX"
    };
  }

  return {
    ok: false,
    error: "UNSUPPORTED_WALLET_FORMAT",
    message: "Solo se aceptan wallets BSC 0x... o TRON T..."
  };
}

function normalizeNetworkCode(value) {
  const v = norm(value);

  if (!v) return "BSC_BEP20";
  if (v === "BSC" || v === "BEP20" || v === "BNB" || v === "BNB_CHAIN") return "BSC_BEP20";
  if (v === "TRON" || v === "TRC20" || v === "TRX") return "TRON_TRC20";

  if (v === "BSC_BEP20" || v === "TRON_TRC20") return v;

  throw new Error("Network no soportada: " + value);
}

function networkInfo(networkCode) {
  const catalog = readJson(NETWORK_CATALOG_FILE, null);
  const code = normalizeNetworkCode(networkCode);

  const item = catalog?.networks?.[code];

  if (!item || item.enabled !== true) {
    throw new Error("Network deshabilitada/no configurada: " + code);
  }

  return item;
}

function assertSafeWalletFile() {
  const raw = fs.existsSync(WALLET_FILE) ? fs.readFileSync(WALLET_FILE, "utf8") : "[]";

  if (/"privateKey"\s*:/.test(raw)) {
    throw new Error("PELIGRO: privateKey plana detectada.");
  }
}

function loadDoc() {
  const doc = readJson(WALLET_FILE, []);
  const wallets = getWallets(doc);
  return { doc, wallets };
}

function saveDoc(doc) {
  writeJson(WALLET_FILE, doc);
  assertSafeWalletFile();
}

function walletNetwork(wallet) {
  if (wallet.networkCode) return normalizeNetworkCode(wallet.networkCode);

  const address = String(wallet.address || "");

  if (address.startsWith("T")) return "TRON_TRC20";
  return "BSC_BEP20";
}

function createWalletForNetwork(networkCode, role, status, extra) {
  const net = networkInfo(networkCode);
  const masterKey = readMasterKey();
  const evmWallet = Wallet.createRandom();
  const privateKey = evmWallet.privateKey;

  let address = "";
  let publicKey = "";

  if (net.family === "EVM") {
    address = evmWallet.address;
    publicKey = computePublicKeyUncompressed(privateKey);
  }
  else if (net.family === "TRON") {
    address = privateKeyToTronAddress(privateKey);
    publicKey = computePublicKeyUncompressed(privateKey);
  }
  else {
    throw new Error("Familia de red no soportada: " + net.family);
  }

  const encrypted = encryptPrivateKey(privateKey, masterKey);

  const item = Object.assign({
    walletId: "cw_" + String(net.networkCode).toLowerCase() + "_" + role.toLowerCase() + "_" + Date.now() + "_" + crypto.randomBytes(6).toString("hex"),
    address,
    publicKey,
    role,
    status,
    networkCode: net.networkCode,
    network: net.label,
    chainId: net.chainId,
    token: net.token,
    tokenStandard: net.tokenStandard,
    tokenContract: net.tokenContract,
    tokenDecimals: net.tokenDecimals,
    gasToken: net.gasToken,
    privateKeyEncrypted: encrypted,
    createdAt: new Date().toISOString(),
    generationMode: role === "DEPOSIT_HOLDING" ? "ON_DEMAND" : "INFRASTRUCTURE"
  }, extra || {});

  return item;
}

function verifyWallet(wallet) {
  const masterKey = readMasterKey();
  const privateKey = decryptPrivateKey(wallet.privateKeyEncrypted, masterKey);
  const code = walletNetwork(wallet);
  const net = networkInfo(code);

  let derived = "";

  if (net.family === "TRON") {
    derived = privateKeyToTronAddress(privateKey);
  }
  else {
    derived = new Wallet(privateKey).address;
  }

  return String(derived).toLowerCase() === String(wallet.address).toLowerCase();
}

function ensurePayoutWallets() {
  const { doc, wallets } = loadDoc();
  const created = [];
  let changed = false;

  for (const wallet of wallets) {
    if (norm(wallet.role) === "PAYOUT_HOT" && !wallet.networkCode) {
      wallet.networkCode = wallet.address && String(wallet.address).startsWith("T") ? "TRON_TRC20" : "BSC_BEP20";
      wallet.network = wallet.networkCode === "TRON_TRC20" ? "TRON / TRC20" : "BSC / BEP20";
      wallet.generationMode = wallet.generationMode || "INFRASTRUCTURE";
      changed = true;
    }
  }

  for (const code of ["BSC_BEP20", "TRON_TRC20"]) {
    const active = wallets.filter(w =>
      norm(w.role) === "PAYOUT_HOT" &&
      norm(w.status) === "ACTIVE" &&
      normalizeNetworkCode(walletNetwork(w)) === code
    );

    if (active.length > 1) {
      throw new Error("Hay mas de una PAYOUT_HOT ACTIVE para " + code);
    }

    if (active.length === 0) {
      const payout = createWalletForNetwork(code, "PAYOUT_HOT", "ACTIVE", {
        note: "PAYOUT_HOT por carretera. No exponer private key."
      });

      wallets.push(payout);
      created.push({
        walletId: payout.walletId,
        address: payout.address,
        role: payout.role,
        status: payout.status,
        networkCode: payout.networkCode
      });
      changed = true;
    }
  }

  if (changed) saveDoc(doc);

  return {
    ok: true,
    changed,
    created,
    totalWallets: wallets.length
  };
}

function reserve(intentId, playerId, networkCode) {
  const code = normalizeNetworkCode(networkCode || "BSC_BEP20");
  const net = networkInfo(code);

  const { doc, wallets } = loadDoc();

  const payoutActive = wallets.filter(w =>
    norm(w.role) === "PAYOUT_HOT" &&
    norm(w.status) === "ACTIVE" &&
    normalizeNetworkCode(walletNetwork(w)) === code
  );

  if (payoutActive.length !== 1) {
    throw new Error("Debe existir exactamente una PAYOUT_HOT ACTIVE para " + code);
  }

  const existing = wallets.find(w =>
    norm(w.role) === "DEPOSIT_HOLDING" &&
    String(w.assignedIntent || w.assignedIntentId || "") === String(intentId)
  );

  if (existing) {
    return {
      ok: true,
      action: "existing_for_intent",
      walletId: existing.walletId,
      id: existing.walletId,
      address: existing.address,
      role: existing.role,
      status: existing.status,
      networkCode: existing.networkCode || walletNetwork(existing),
      network: existing.network,
      tokenStandard: existing.tokenStandard,
      assignedIntent: existing.assignedIntent || existing.assignedIntentId || intentId
    };
  }

  const item = createWalletForNetwork(code, "DEPOSIT_HOLDING", "ASSIGNED", {
    assignedIntent: String(intentId || ""),
    assignedIntentId: String(intentId || ""),
    assignedPlayerId: String(playerId || ""),
    playerId: String(playerId || ""),
    reservedAt: new Date().toISOString(),
    assignedAt: new Date().toISOString(),
    note: "Wallet generada bajo demanda para una solicitud de recarga."
  });

  wallets.push(item);
  saveDoc(doc);

  return {
    ok: true,
    action: "created_on_demand",
    walletId: item.walletId,
    id: item.walletId,
    address: item.address,
    role: item.role,
    status: item.status,
    networkCode: item.networkCode,
    network: item.network,
    token: item.token,
    tokenStandard: item.tokenStandard,
    tokenContract: item.tokenContract,
    tokenDecimals: item.tokenDecimals,
    gasToken: item.gasToken,
    assignedIntent: item.assignedIntent,
    assignedPlayerId: item.assignedPlayerId
  };
}

function verify() {
  const { wallets } = loadDoc();

  const result = [];

  for (const wallet of wallets) {
    if (!wallet.privateKeyEncrypted) {
      result.push({
        walletId: wallet.walletId,
        address: wallet.address,
        role: wallet.role,
        status: wallet.status,
        networkCode: wallet.networkCode || walletNetwork(wallet),
        verified: false,
        reason: "sin privateKeyEncrypted"
      });
      continue;
    }

    try {
      result.push({
        walletId: wallet.walletId,
        address: wallet.address,
        role: wallet.role,
        status: wallet.status,
        networkCode: wallet.networkCode || walletNetwork(wallet),
        verified: verifyWallet(wallet)
      });
    } catch (err) {
      result.push({
        walletId: wallet.walletId,
        address: wallet.address,
        role: wallet.role,
        status: wallet.status,
        networkCode: wallet.networkCode || walletNetwork(wallet),
        verified: false,
        reason: err.message
      });
    }
  }

  return {
    ok: result.every(x => x.verified),
    totalWallets: wallets.length,
    verified: result.filter(x => x.verified).length,
    wallets: result
  };
}

function list() {
  const { wallets } = loadDoc();

  return {
    ok: true,
    totalWallets: wallets.length,
    wallets: wallets.map(w => ({
      walletId: w.walletId,
      address: w.address,
      role: w.role,
      status: w.status,
      networkCode: w.networkCode || walletNetwork(w),
      network: w.network || null,
      tokenStandard: w.tokenStandard || null,
      assignedIntent: w.assignedIntent || w.assignedIntentId || null,
      assignedPlayerId: w.assignedPlayerId || w.playerId || null,
      generationMode: w.generationMode || null
    }))
  };
}

function main() {
  assertSafeWalletFile();

  const cmd = String(process.argv[2] || "list").toLowerCase();

  if (cmd === "ensure-payouts") {
    console.log(JSON.stringify(ensurePayoutWallets(), null, 2));
    return;
  }

  if (cmd === "reserve") {
    const intentId = process.argv[3] || "";
    const playerId = process.argv[4] || "";
    const networkCode = process.argv[5] || "BSC_BEP20";

    if (!intentId) {
      throw new Error("Uso: node custody-wallet-manager.js reserve INTENT_ID PLAYER_ID NETWORK_CODE");
    }

    console.log(JSON.stringify(reserve(intentId, playerId, networkCode), null, 2));
    return;
  }

  if (cmd === "detect") {
    console.log(JSON.stringify(detectNetworkFromAddress(process.argv[3] || ""), null, 2));
    return;
  }

  if (cmd === "verify") {
    console.log(JSON.stringify(verify(), null, 2));
    return;
  }

  if (cmd === "list") {
    console.log(JSON.stringify(list(), null, 2));
    return;
  }

  throw new Error("Comando no soportado: " + cmd);
}

main();