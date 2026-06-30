const fs = require("fs");

const file = "server.js";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

let s = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
fs.writeFileSync(`server.js.backup_fix_no_empty_races_${stamp}`, s, "utf8");

function replaceFunction(functionName, replacement) {
  const start = s.indexOf(`function ${functionName}(`);
  if (start < 0) {
    console.error("NO ENCONTRADO:", functionName);
    process.exit(1);
  }

  const braceStart = s.indexOf("{", start);
  let depth = 0;
  let end = -1;

  for (let i = braceStart; i < s.length; i++) {
    if (s[i] === "{") depth++;
    if (s[i] === "}") depth--;

    if (depth === 0) {
      end = i + 1;
      break;
    }
  }

  if (end < 0) {
    console.error("NO SE ENCONTRO CIERRE:", functionName);
    process.exit(1);
  }

  s = s.slice(0, start) + replacement + s.slice(end);
  console.log("OK:", functionName);
}

// Forzar mínimo a 1 en esta copia real del servidor
s = s.replace(
  /const\s+MIN_ACTIVE_HORSES_FOR_VALID_RACE\s*=\s*.*?;/,
  "const MIN_ACTIVE_HORSES_FOR_VALID_RACE = 1;"
);

// Regla correcta: ganan los 3 caballos menos apostados.
// Si hay empate, se ordenan random.
// Si solo un caballo tiene apuesta, los ganadores salen random entre los de 0.
replaceFunction(
  "calculateOrderedResults",
`function calculateOrderedResults() {
  const totals = getHorseTotals()
    .map((item) => ({ ...item, tieBreaker: Math.random() }))
    .sort((a, b) => {
      if (a.totalAmount === b.totalAmount) {
        return a.tieBreaker - b.tieBreaker;
      }

      return a.totalAmount - b.totalAmount;
    });

  return totals.map((item, index) => ({
    position: index + 1,
    horseId: item.horseId,
    name: item.name,
    color: item.color,
    totalAmount: item.totalAmount,
    totalBets: item.totalBets,
    active: item.totalBets > 0 && item.totalAmount > 0
  }));
}`
);

replaceFunction(
  "calculateWinnersFromOrderedResults",
`function calculateWinnersFromOrderedResults(results) {
  return results.slice(0, 3);
}`
);

// No iniciar ni cancelar carreras si no hay apuestas.
// Si hay al menos 1 apuesta, la carrera corre.
replaceFunction(
  "closeBettingAndStartRace",
`function closeBettingAndStartRace() {
  if (bets.length <= 0) {
    phase = "BETTING";
    secondsRemaining = BETTING_SECONDS;
    raceStartedAt = null;
    resultsStartedAt = null;
    orderedResults = [];
    winners = [];
    hiddenWinners = [];
    settlements = [];
    roundStatus = "BETTING";
    roundCancelReason = null;
    broadcastState();
    return;
  }

  phase = "RACE";
  secondsRemaining = RACE_SECONDS;
  raceStartedAt = Date.now();
  resultsStartedAt = null;
  orderedResults = calculateOrderedResults();

  roundStatus = "VALID";
  roundCancelReason = null;
  hiddenWinners = calculateWinnersFromOrderedResults(orderedResults);

  winners = [];
  settlements = [];
  broadcastState();
}`
);

fs.writeFileSync(file, s, "utf8");

console.log("");
console.log("LISTO:");
console.log("- MIN_ACTIVE_HORSES_FOR_VALID_RACE = 1");
console.log("- Sin apuestas: no inicia ni cancela carrera.");
console.log("- Con 1 apuesta o más: la carrera corre.");
console.log("- Ganadores: 3 caballos menos apostados.");
