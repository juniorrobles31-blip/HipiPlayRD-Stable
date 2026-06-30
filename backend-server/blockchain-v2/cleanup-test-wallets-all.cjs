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
  if (Array.isArray(doc)) return doc;
  if (Array.isArray(doc.wallets)) return doc.wallets;
  if (Array.isArray(doc.items)) return doc.items;
  if (Array.isArray(doc.custodyWallets)) return doc.custodyWallets;
  if (Array.isArray(doc.bscWallets)) return doc.bscWallets;
  throw new Error("No pude detectar arreglo de wallets.");
}

const raw = fs.readFileSync(walletFile, "utf8");

if (/"privateKey"\s*:/.test(raw)) {
  throw new Error("PELIGRO: privateKey plana detectada.");
}

const doc = readJson(walletFile);
const wallets = getWallets(doc);

const before = wallets.length;
const removed = [];

for (let i = wallets.length - 1; i >= 0; i--) {
  const w = wallets[i] || {};
  const role = String(w.role || "");
  const status = String(w.status || "");
  const intent = String(w.assignedIntent || w.assignedIntentId || "");
  const player = String(w.assignedPlayerId || w.playerId || "");

  const isTest =
    role === "DEPOSIT_HOLDING" &&
    status === "ASSIGNED" &&
    (
      intent.startsWith("DIRECT-") ||
      intent.startsWith("TEST-") ||
      intent.startsWith("PAY-MQZU") ||
      player.startsWith("usr_test_") ||
      player.startsWith("usr_direct_")
    );

  if (isTest) {
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