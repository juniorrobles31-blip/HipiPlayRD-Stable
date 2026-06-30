"use strict";

const fs = require("node:fs");

const queueFile = process.argv[2];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

const queue = readJson(queueFile);

if (!Array.isArray(queue)) {
  throw new Error("Queue no es arreglo.");
}

const before = queue.length;
const removed = [];
const kept = [];

for (const item of queue) {
  const playerId = String(item.playerId || "");
  const visibleId = String(item.visibleId || "");

  const isTest =
    playerId.startsWith("usr_pwa_withdraw_test_") ||
    visibleId.startsWith("PWA_TEST_");

  if (isTest) {
    removed.push({
      requestId: item.requestId,
      playerId: item.playerId,
      visibleId: item.visibleId,
      networkCode: item.networkCode,
      status: item.status
    });
  } else {
    kept.push(item);
  }
}

writeJson(queueFile, kept);

console.log(JSON.stringify({
  ok: true,
  before,
  after: kept.length,
  removedCount: removed.length,
  removed
}, null, 2));