"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

let ethersPkg;
try {
  ethersPkg = require("ethers");
} catch (err) {
  throw new Error("No se pudo cargar ethers. Ejecuta npm install en blockchain-v2 si falta. Detalle: " + err.message);
}

const Wallet = ethersPkg.Wallet || ethersPkg.ethers?.Wallet;

if (!Wallet) {
  throw new Error("No se pudo resolver ethers.Wallet.");
}

const walletFile = process.argv[2];
const masterKeyFile = process.argv[3];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function getWalletArray(doc) {
  if (Array.isArray(doc)) return doc;
  if (Array.isArray(doc.wallets)) return doc.wallets;
  if (Array.isArray(doc.items)) return doc.items;
  if (Array.isArray(doc.custodyWallets)) return doc.custodyWallets;
  if (Array.isArray(doc.bscWallets)) return doc.bscWallets;
  throw new Error("No pude detectar arreglo de wallets en custody-wallets-bsc.json");
}

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

function hasPlainPrivateKey(wallet) {
  return Boolean(wallet.privateKey || wallet.privkey || wallet.pk);
}

function encryptedTemplate(wallets) {
  for (const wallet of wallets) {
    if (wallet.privateKeyEncrypted) {
      return wallet.privateKeyEncrypted;
    }
  }

  return null;
}

function encryptPrivateKey(privateKey, template, masterKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  if (template && typeof template === "object" && !Array.isArray(template)) {
    const result = {};

    if ("algorithm" in template) result.algorithm = template.algorithm || "aes-256-gcm";
    else result.algorithm = "aes-256-gcm";

    if ("iv" in template) result.iv = iv.toString("hex");
    else result.iv = iv.toString("hex");

    if ("ciphertext" in template) result.ciphertext = encrypted.toString("hex");
    else if ("encrypted" in template) result.encrypted = encrypted.toString("hex");
    else if ("data" in template) result.data = encrypted.toString("hex");
    else result.ciphertext = encrypted.toString("hex");

    if ("authTag" in template) result.authTag = tag.toString("hex");
    else if ("tag" in template) result.tag = tag.toString("hex");
    else result.authTag = tag.toString("hex");

    return result;
  }

  throw new Error("Formato privateKeyEncrypted no soportado para crear payout de forma segura.");
}

const doc = readJson(walletFile);
const wallets = getWalletArray(doc);

for (const wallet of wallets) {
  if (hasPlainPrivateKey(wallet)) {
    throw new Error("PELIGRO: existe privateKey plana en custody-wallets-bsc.json.");
  }
}

let activePayout = wallets.find(w =>
  normalize(w.role) === "PAYOUT_HOT" &&
  normalize(w.status) === "ACTIVE"
);

let action = "already_active";

if (!activePayout) {
  const inactivePayout = wallets.find(w => normalize(w.role) === "PAYOUT_HOT");

  if (inactivePayout) {
    inactivePayout.status = "ACTIVE";
    inactivePayout.activatedAt = new Date().toISOString();
    activePayout = inactivePayout;
    action = "reactivated_existing";
  }
}

if (!activePayout) {
  const template = encryptedTemplate(wallets);

  if (!template) {
    throw new Error("No existe privateKeyEncrypted de ejemplo para copiar formato de cifrado.");
  }

  const masterHex = fs.readFileSync(masterKeyFile, "utf8").trim().replace(/^0x/i, "");
  const masterKey = Buffer.from(masterHex, "hex");

  if (masterKey.length !== 32) {
    throw new Error("Master key invalida. Debe tener 32 bytes / 64 hex.");
  }

  const newWallet = Wallet.createRandom();
  const privateKey = newWallet.privateKey;
  const encrypted = encryptPrivateKey(privateKey, template, masterKey);

  let publicKey = "";

  try {
    publicKey = newWallet.publicKey || newWallet.signingKey?.publicKey || "";
  } catch {}

  activePayout = {
    walletId: "cw_bsc_payout_hot_" + Date.now() + "_" + crypto.randomBytes(6).toString("hex"),
    address: newWallet.address,
    publicKey,
    role: "PAYOUT_HOT",
    status: "ACTIVE",
    network: "BSC",
    chainId: 56,
    token: "USDT",
    tokenStandard: "BEP20",
    privateKeyEncrypted: encrypted,
    createdAt: new Date().toISOString(),
    note: "PAYOUT_HOT creado automaticamente. Private key cifrada; no exponer."
  };

  wallets.push(activePayout);
  action = "created_new";
}

writeJson(walletFile, doc);

console.log(JSON.stringify({
  ok: true,
  action,
  payoutHot: {
    walletId: activePayout.walletId,
    address: activePayout.address,
    role: activePayout.role,
    status: activePayout.status
  },
  totalWallets: wallets.length,
  plainPrivateKeysVisible: false
}, null, 2));