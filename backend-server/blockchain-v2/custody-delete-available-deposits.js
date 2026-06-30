"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data", "blockchain-v2");
const WALLET_FILE = path.join(DATA, "custody-wallets-bsc.json");
const AUDIT_FILE = path.join(DATA, "custody-delete-available-deposits-audit.json");

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

function amount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function hasFunds(wallet) {
  return (
    amount(wallet.usdtBalance) > 0 ||
    amount(wallet.usdt_balance) > 0 ||
    amount(wallet.balanceUSDT) > 0 ||
    amount(wallet.balanceUsdt) > 0 ||
    amount(wallet.bnbBalance) > 0 ||
    amount(wallet.bnb_balance) > 0 ||
    amount(wallet.nativeBalance) > 0 ||
    amount(wallet.native_balance) > 0
  );
}

function hasAssigned(wallet) {
  return Boolean(
    wallet.assignedIntent ||
    wallet.assignedIntentId ||
    wallet.intentId ||
    wallet.paymentIntentId ||
    wallet.assignedPlayerId ||
    wallet.playerId
  );
}

function main() {
  if (!fs.existsSync(WALLET_FILE)) {
    console.log(JSON.stringify({ ok: true, deleted: 0, reason: "wallet file no existe" }, null, 2));
    return;
  }

  const doc = readJson(WALLET_FILE, []);
  const wallets = getWallets(doc);

  const before = wallets.length;
  const deleted = [];

  for (let i = wallets.length - 1; i >= 0; i--) {
    const wallet = wallets[i];

    const shouldDelete =
      norm(wallet.role) === "DEPOSIT_HOLDING" &&
      norm(wallet.status) === "AVAILABLE" &&
      !hasAssigned(wallet) &&
      !hasFunds(wallet);

    if (shouldDelete) {
      deleted.push({
        walletId: wallet.walletId,
        address: wallet.address,
        role: wallet.role,
        status: wallet.status
      });

      wallets.splice(i, 1);
    }
  }

  if (deleted.length > 0) {
    writeJson(WALLET_FILE, doc);
  }

  const audit = readJson(AUDIT_FILE, []);
  audit.push({
    at: new Date().toISOString(),
    before,
    after: wallets.length,
    deletedCount: deleted.length,
    deleted
  });

  while (audit.length > 500) audit.shift();

  writeJson(AUDIT_FILE, audit);

  console.log(JSON.stringify({
    ok: true,
    before,
    after: wallets.length,
    deletedCount: deleted.length
  }, null, 2));
}

main();