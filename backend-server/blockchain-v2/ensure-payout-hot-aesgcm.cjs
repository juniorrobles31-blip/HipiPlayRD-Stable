"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");

let ethersPkg;
try {
  ethersPkg = require("ethers");
} catch (err) {
  throw new Error("No se pudo cargar ethers. Detalle: " + err.message);
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

  throw new Error("No pude detectar arreglo de wallets.");
}

function norm(value) {
  return String(value || "").trim().toUpperCase();
}

function hasPlainPrivateKey(wallet) {
  return Boolean(wallet.privateKey || wallet.privkey || wallet.pk);
}

function readMasterKey() {
  const raw = fs.readFileSync(masterKeyFile, "utf8").trim().replace(/^0x/i, "");
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
  const ciphertext = Buffer.from(payload.ciphertext, "hex");
  const tag = Buffer.from(payload.authTag, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

const doc = readJson(walletFile);
const wallets = getWalletArray(doc);

for (const wallet of wallets) {
  if (hasPlainPrivateKey(wallet)) {
    throw new Error("PELIGRO: existe privateKey plana en custody-wallets-bsc.json.");
  }
}

let activePayouts = wallets.filter(w =>
  norm(w.role) === "PAYOUT_HOT" &&
  norm(w.status) === "ACTIVE"
);

if (activePayouts.length > 1) {
  throw new Error("Hay mas de una PAYOUT_HOT ACTIVE. Resolver antes de continuar.");
}

let payout = activePayouts[0] || null;
let action = "already_active";

if (!payout) {
  const inactive = wallets.find(w => norm(w.role) === "PAYOUT_HOT");

  if (inactive) {
    inactive.status = "ACTIVE";
    inactive.activatedAt = new Date().toISOString();
    payout = inactive;
    action = "reactivated_existing";
  }
}

if (!payout) {
  const masterKey = readMasterKey();
  const newWallet = Wallet.createRandom();

  const encrypted = encryptPrivateKey(newWallet.privateKey, masterKey);
  const decrypted = decryptPrivateKey(encrypted, masterKey);
  const checkWallet = new Wallet(decrypted);

  if (String(checkWallet.address).toLowerCase() !== String(newWallet.address).toLowerCase()) {
    throw new Error("Validacion de cifrado fallo. La private key no corresponde a la wallet.");
  }

  let publicKey = "";

  try {
    publicKey = newWallet.publicKey || newWallet.signingKey?.publicKey || "";
  } catch {}

  payout = {
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
    note: "PAYOUT_HOT creado con AES-256-GCM. No exponer private key."
  };

  wallets.push(payout);
  action = "created_new_aes_256_gcm";
}

writeJson(walletFile, doc);

const raw = fs.readFileSync(walletFile, "utf8");

if (/"privateKey"\s*:/.test(raw)) {
  throw new Error("PELIGRO: el archivo contiene privateKey plana.");
}

console.log(JSON.stringify({
  ok: true,
  action,
  payoutHot: {
    walletId: payout.walletId,
    address: payout.address,
    role: payout.role,
    status: payout.status
  },
  totalWallets: wallets.length,
  plainPrivateKeysVisible: false,
  encryption: payout.privateKeyEncrypted ? payout.privateKeyEncrypted.algorithm : null
}, null, 2));