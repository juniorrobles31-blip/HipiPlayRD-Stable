"use strict";

const fs = require("node:fs");

const walletFile = process.argv[2];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function getWallets(doc) {
  if (Array.isArray(doc)) return { wallets: doc, key: null };
  if (Array.isArray(doc.wallets)) return { wallets: doc.wallets, key: "wallets" };
  if (Array.isArray(doc.items)) return { wallets: doc.items, key: "items" };
  if (Array.isArray(doc.custodyWallets)) return { wallets: doc.custodyWallets, key: "custodyWallets" };
  if (Array.isArray(doc.bscWallets)) return { wallets: doc.bscWallets, key: "bscWallets" };
  throw new Error("No pude detectar arreglo de wallets.");
}

const raw = fs.readFileSync(walletFile, "utf8");

if (/"privateKey"\s*:/.test(raw)) {
  throw new Error("PELIGRO: privateKey plana detectada.");
}

const doc = readJson(walletFile);
const holder = getWallets(doc);
const wallets = holder.wallets;

const before = wallets.length;
const removed = [];

for (let i = wallets.length - 1; i >= 0; i--) {
  const w = wallets[i] || {};
  const intent = String(w.assignedIntent || w.assignedIntentId || "");
  const player = String(w.assignedPlayerId || w.playerId || "");
  const role = String(w.role || "");
  const status = String(w.status || "");

  const isBadTest =
    role === "DEPOSIT_HOLDING" &&
    status === "ASSIGNED" &&
    (
      player.startsWith("usr_test_tron") ||
      intent.startsWith("TEST-TRON") ||
      intent.startsWith("PAY-MQZU")
    );

  if (isBadTest) {
    removed.push({
      walletId: w.walletId,
      address: w.address,
      networkCode: w.networkCode,
      assignedIntent: intent,
      assignedPlayerId: player
    });

    wallets.splice(i, 1);
  }
}

if (removed.length > 0) {
  writeJson(walletFile, doc);
}

console.log(JSON.stringify({
  ok: true,
  before,
  after: wallets.length,
  removedCount: removed.length,
  removed
}, null, 2));