"use strict";

const fs = require("node:fs");

const queueFile = process.argv[2];
const auditFile = process.argv[3];

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

const queue = readJson(queueFile, []);
const audit = readJson(auditFile, []);

if (!Array.isArray(queue)) {
  throw new Error("El archivo de solicitudes no contiene un arreglo JSON.");
}

const before = queue.length;
const removed = [];
const kept = [];

for (const item of queue) {
  const playerId = String(item.playerId || "");
  const visibleId = String(item.visibleId || "");
  const status = String(item.status || "");
  const notes = Array.isArray(item.notes) ? item.notes.join(" ") : "";

  const isDryRunTest =
    status === "DRY_RUN_EXECUTED" &&
    (
      playerId.startsWith("usr_test_withdraw_") ||
      visibleId.startsWith("TEST") ||
      notes.includes("DRY_RUN_ONLY")
    );

  if (isDryRunTest) {
    removed.push({
      requestId: item.requestId,
      playerId: item.playerId,
      visibleId: item.visibleId,
      networkCode: item.networkCode,
      status: item.status,
      amount: item.grossAmountUsdt
    });
  } else {
    kept.push(item);
  }
}

writeJson(queueFile, kept);

audit.push({
  at: new Date().toISOString(),
  action: "CLEANUP_DRY_RUN_WITHDRAWAL_TESTS",
  before,
  after: kept.length,
  removedCount: removed.length,
  removed
});

while (audit.length > 1000) {
  audit.shift();
}

writeJson(auditFile, audit);

console.log(JSON.stringify({
  ok: true,
  before,
  after: kept.length,
  removedCount: removed.length,
  removed
}, null, 2));