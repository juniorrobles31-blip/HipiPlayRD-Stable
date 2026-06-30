const fs = require("fs");

const file = "server.js";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

let s = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
fs.writeFileSync(`server.js.backup_pause_until_first_bet_${stamp}`, s, "utf8");

const oldBlock = `setInterval(() => {
  secondsRemaining -= 1;
  if (phase === "BETTING" && secondsRemaining <= 0) return closeBettingAndStartRace();
  if (phase === "RACE" && secondsRemaining <= 0) return showResults();
  if (phase === "RESULTS" && secondsRemaining <= 0) return startNewRound();
  broadcastState();
}, 1000);`;

const newBlock = `setInterval(() => {
  // Si no hay apuestas, el servidor se queda detenido en BETTING.
  // No inicia carrera, no cancela carrera y no consume el reloj.
  if (phase === "BETTING" && bets.length <= 0) {
    secondsRemaining = BETTING_SECONDS;
    roundStatus = "BETTING";
    roundCancelReason = null;
    raceStartedAt = null;
    resultsStartedAt = null;
    orderedResults = [];
    winners = [];
    hiddenWinners = [];
    settlements = [];
    broadcastState();
    return;
  }

  secondsRemaining -= 1;

  if (phase === "BETTING" && secondsRemaining <= 0) return closeBettingAndStartRace();
  if (phase === "RACE" && secondsRemaining <= 0) return showResults();
  if (phase === "RESULTS" && secondsRemaining <= 0) return startNewRound();

  broadcastState();
}, 1000);`;

if (!s.includes(oldBlock)) {
  console.error("No encontré el bloque setInterval esperado. No se aplicó el cambio.");
  process.exit(1);
}

s = s.replace(oldBlock, newBlock);

fs.writeFileSync(file, s, "utf8");

console.log("LISTO:");
console.log("- Sin apuestas, el servidor queda detenido en BETTING.");
console.log("- El reloj no corre si totalBetsReceived = 0.");
console.log("- Cuando entra la primera apuesta, empieza el conteo.");
