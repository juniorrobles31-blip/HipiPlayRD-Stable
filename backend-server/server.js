
// HIPIPLAY AUTO RACES WITHOUT BETS - START
function hipiEnsureRaceHorses(horses) {
  if (Array.isArray(horses) && horses.length > 0) {
    return horses;
  }

  return [
    { id: 1, name: 'Caballo 1', color: 'Rojo' },
    { id: 2, name: 'Caballo 2', color: 'Azul' },
    { id: 3, name: 'Caballo 3', color: 'Verde' },
    { id: 4, name: 'Caballo 4', color: 'Amarillo' },
    { id: 5, name: 'Caballo 5', color: 'Negro' },
    { id: 6, name: 'Caballo 6', color: 'Blanco' }
  ];
}

function hipiRandomWinnersFromSix() {
  return [1, 2, 3, 4, 5, 6]
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);
}
// HIPIPLAY AUTO RACES WITHOUT BETS - END

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const {
  resolveDemoSessionReference
} = require("./demo-public-id");

const PORT = Number(process.env.PORT || 4000);
const BETTING_SECONDS = Number(process.env.BETTING_SECONDS || 40);
const RACE_SECONDS = Number(process.env.RACE_SECONDS || 10);
const RESULTS_SECONDS = Number(process.env.RESULTS_SECONDS || 10);
const PAYOUT_MULTIPLIERS = {
  first: Number(process.env.PAYOUT_MULTIPLIER_FIRST || 2),
  second: Number(process.env.PAYOUT_MULTIPLIER_SECOND || 1.5),
  third: Number(process.env.PAYOUT_MULTIPLIER_THIRD || 1.5)
};
const DEFAULT_PLAYER_BALANCE = Number(process.env.DEFAULT_PLAYER_BALANCE || 9000);
const MIN_ACTIVE_HORSES_FOR_VALID_RACE = 1;

const app = express();

/* HIPIPLAY FORCE 3 WINNERS SAFETY - START */
function hipiValidHorseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
}

function hipiNormalizeLowestBetTotals(lowestBetTotals) {
  const byHorse = new Map();

  for (let horseId = 1; horseId <= 6; horseId += 1) {
    byHorse.set(horseId, {
      horseId,
      totalAmount: 0,
      totalBets: 0
    });
  }

  if (Array.isArray(lowestBetTotals)) {
    for (const item of lowestBetTotals) {
      const horseId = hipiValidHorseId(item?.horseId ?? item?.selectedHorse ?? item?.horse);

      if (!horseId) continue;

      byHorse.set(horseId, {
        horseId,
        totalAmount: Number(item?.totalAmount ?? item?.amount ?? 0) || 0,
        totalBets: Number(item?.totalBets ?? item?.bets ?? 0) || 0
      });
    }
  }

  return Array.from(byHorse.values()).sort((a, b) => {
    if (a.totalAmount !== b.totalAmount) return a.totalAmount - b.totalAmount;
    if (a.totalBets !== b.totalBets) return a.totalBets - b.totalBets;
    return a.horseId - b.horseId;
  });
}

function hipiCompleteTop3Winners(winners, lowestBetTotals) {
  const selected = [];

  function addWinner(value) {
    const horseId = hipiValidHorseId(value);

    if (!horseId) return;
    if (selected.includes(horseId)) return;
    if (selected.length >= 3) return;

    selected.push(horseId);
  }

  if (Array.isArray(winners)) {
    for (const winner of winners) {
      addWinner(winner?.horseId ?? winner?.selectedHorse ?? winner?.horse ?? winner);
    }
  }

  const totals = hipiNormalizeLowestBetTotals(lowestBetTotals);

  for (const item of totals) {
    addWinner(item.horseId);
  }

  for (let horseId = 1; horseId <= 6; horseId += 1) {
    addWinner(horseId);
  }

  return selected.slice(0, 3);
}

function hipiNormalizeWinnersPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;

  if (Array.isArray(payload.winners)) {
    payload.lowestBetTotals = hipiNormalizeLowestBetTotals(payload.lowestBetTotals);
    payload.winners = hipiCompleteTop3Winners(payload.winners, payload.lowestBetTotals);
  }

  const nestedKeys = ['state', 'raceState', 'serverRaceState', 'race', 'result', 'data'];

  for (const key of nestedKeys) {
    if (payload[key] && typeof payload[key] === 'object' && Array.isArray(payload[key].winners)) {
      payload[key].lowestBetTotals = hipiNormalizeLowestBetTotals(payload[key].lowestBetTotals);
      payload[key].winners = hipiCompleteTop3Winners(payload[key].winners, payload[key].lowestBetTotals);
    }
  }

  return payload;
}

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (payload) => {
    return originalJson(hipiNormalizeWinnersPayload(payload));
  };

  next();
});
/* HIPIPLAY FORCE 3 WINNERS SAFETY - END */


// HIPIPLAY REAL AUTO CYCLE ENGINE - START
const HIPI_AUTO_FS = require('fs');
const HIPI_AUTO_PATH = require('path');

const HIPI_AUTO_DATA_DIR = HIPI_AUTO_PATH.join(__dirname, 'data');
const HIPI_AUTO_CLOCK_FILE = HIPI_AUTO_PATH.join(HIPI_AUTO_DATA_DIR, 'auto-race-clock.json');
const HIPI_AUTO_WINNERS_FILE = HIPI_AUTO_PATH.join(HIPI_AUTO_DATA_DIR, 'auto-race-winners.json');

const HIPI_AUTO_BETTING_SECONDS = 20;
const HIPI_AUTO_RACE_SECONDS = 8;
const HIPI_AUTO_RESULTS_SECONDS = 8;
const HIPI_AUTO_TOTAL_SECONDS = HIPI_AUTO_BETTING_SECONDS + HIPI_AUTO_RACE_SECONDS + HIPI_AUTO_RESULTS_SECONDS;

function hipiAutoEnsureDataDir() {
  if (!HIPI_AUTO_FS.existsSync(HIPI_AUTO_DATA_DIR)) {
    HIPI_AUTO_FS.mkdirSync(HIPI_AUTO_DATA_DIR, { recursive: true });
  }
}

function hipiAutoReadJson(file, fallback) {
  try {
    if (!HIPI_AUTO_FS.existsSync(file)) return fallback;
    return JSON.parse(HIPI_AUTO_FS.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function hipiAutoWriteJson(file, data) {
  try {
    hipiAutoEnsureDataDir();
    HIPI_AUTO_FS.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn('No se pudo escribir archivo auto-race:', error.message);
  }
}

function hipiAutoGetClock() {
  const clock = hipiAutoReadJson(HIPI_AUTO_CLOCK_FILE, null);

  if (clock && Number.isFinite(Number(clock.startedAt))) {
    return clock;
  }

  const freshClock = {
    startedAt: Date.now()
  };

  hipiAutoWriteJson(HIPI_AUTO_CLOCK_FILE, freshClock);
  return freshClock;
}

function hipiAutoShuffle(array) {
  return array
    .map((value) => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map((item) => item.value);
}

function hipiAutoGetWinners(roundId) {
  const key = String(roundId);
  const winnersMap = hipiAutoReadJson(HIPI_AUTO_WINNERS_FILE, {});

  if (!Array.isArray(winnersMap[key]) || winnersMap[key].length < 3) {
    winnersMap[key] = hipiAutoShuffle([1, 2, 3, 4, 5, 6]).slice(0, 3);
    hipiAutoWriteJson(HIPI_AUTO_WINNERS_FILE, winnersMap);
  }

  return winnersMap[key];
}

function hipiAutoGetJugadaId(roundId) {
  try {
    if (typeof hipiGetJugadaId === 'function') {
      return hipiGetJugadaId(roundId);
    }
  } catch {}

  return String(10000 + (Number(roundId) % 90000)).padStart(5, '0');
}

function hipiAutoGetState() {
  const clock = hipiAutoGetClock();
  const now = Date.now();
  const elapsedTotal = Math.max(0, Math.floor((now - Number(clock.startedAt)) / 1000));
  const cycleIndex = Math.floor(elapsedTotal / HIPI_AUTO_TOTAL_SECONDS);
  const elapsedInCycle = elapsedTotal % HIPI_AUTO_TOTAL_SECONDS;
  const roundId = cycleIndex + 1;

  let phase = 'BETTING';
  let secondsRemaining = HIPI_AUTO_BETTING_SECONDS - elapsedInCycle;
  let raceStartedAt = null;
  let resultsStartedAt = null;

  if (elapsedInCycle >= HIPI_AUTO_BETTING_SECONDS && elapsedInCycle < HIPI_AUTO_BETTING_SECONDS + HIPI_AUTO_RACE_SECONDS) {
    phase = 'RACE';
    secondsRemaining = HIPI_AUTO_BETTING_SECONDS + HIPI_AUTO_RACE_SECONDS - elapsedInCycle;
    raceStartedAt = Number(clock.startedAt) + (cycleIndex * HIPI_AUTO_TOTAL_SECONDS + HIPI_AUTO_BETTING_SECONDS) * 1000;
  }

  if (elapsedInCycle >= HIPI_AUTO_BETTING_SECONDS + HIPI_AUTO_RACE_SECONDS) {
    phase = 'RESULTS';
    secondsRemaining = HIPI_AUTO_TOTAL_SECONDS - elapsedInCycle;
    raceStartedAt = Number(clock.startedAt) + (cycleIndex * HIPI_AUTO_TOTAL_SECONDS + HIPI_AUTO_BETTING_SECONDS) * 1000;
    resultsStartedAt = Number(clock.startedAt) + (cycleIndex * HIPI_AUTO_TOTAL_SECONDS + HIPI_AUTO_BETTING_SECONDS + HIPI_AUTO_RACE_SECONDS) * 1000;
  }

  const jugadaId = hipiAutoGetJugadaId(roundId);

  return {
    ok: true,
    serverTime: now,
    roundId,
    raceNumber: roundId,
    phase,
    secondsRemaining: Math.max(0, secondsRemaining),
    bettingSeconds: HIPI_AUTO_BETTING_SECONDS,
    raceSeconds: HIPI_AUTO_RACE_SECONDS,
    resultsSeconds: HIPI_AUTO_RESULTS_SECONDS,
    payoutMultipliers: {
      first: 2,
      second: 1.5,
      third: 1.5
    },
    roundStatus: phase,
    roundCancelReason: null,
    minActiveHorsesRequired: 0,
    activeHorseCount: 0,
    raceStartedAt,
    resultsStartedAt,
    horses: [
      { id: 1, name: 'Caballo 1', color: 'Rojo' },
      { id: 2, name: 'Caballo 2', color: 'Azul' },
      { id: 3, name: 'Caballo 3', color: 'Verde' },
      { id: 4, name: 'Caballo 4', color: 'Amarillo' },
      { id: 5, name: 'Caballo 5', color: 'Negro' },
      { id: 6, name: 'Caballo 6', color: 'Blanco' }
    ],
    totalBetsReceived: 0,
    winners: phase === 'RESULTS' ? hipiAutoGetWinners(roundId) : [],
    jugadaId,
    playId: jugadaId,
    roundCode: jugadaId
  };
}

app.get('/api/state', (req, res) => {
  let state = hipiAutoApplyLowestBetWinnersToState(hipiAutoGetState());

  if (typeof hipiAutoSettleAllBetsForState === 'function') {
    hipiAutoSettleAllBetsForState(state);
  }

  res.json(state);
});
// HIPIPLAY REAL AUTO CYCLE ENGINE - END


// HIPIPLAY AUTO RACES RESPONSE PATCH - START
app.use((req, res, next) => {
  const originalJsonAutoRace = res.json.bind(res);

  res.json = (body) => {
    try {
      if (body && typeof body === 'object') {
        body.minActiveHorsesRequired = 0;

        if (!Array.isArray(body.horses) || body.horses.length === 0) {
          body.horses = hipiEnsureRaceHorses(body.horses);
        }

        if (
          String(body.phase || '').toUpperCase().startsWith('RESULT') &&
          (!Array.isArray(body.winners) || body.winners.length === 0)
        ) {
          body.winners = hipiRandomWinnersFromSix();
        }

        if (body.state && typeof body.state === 'object') {
          body.state.minActiveHorsesRequired = 0;

          if (!Array.isArray(body.state.horses) || body.state.horses.length === 0) {
            body.state.horses = hipiEnsureRaceHorses(body.state.horses);
          }

          if (
            String(body.state.phase || '').toUpperCase().startsWith('RESULT') &&
            (!Array.isArray(body.state.winners) || body.state.winners.length === 0)
          ) {
            body.state.winners = hipiRandomWinnersFromSix();
          }
        }
      }
    } catch (error) {
      console.warn('No se pudo aplicar auto-race patch:', error.message);
    }

    return originalJsonAutoRace(body);
  };

  next();
});
// HIPIPLAY AUTO RACES RESPONSE PATCH - END


// HIPIPLAY JUGADA ID RANDOM 5 DIGITOS - START
const HIPI_JUGADA_FS = require('fs');
const HIPI_JUGADA_PATH = require('path');

const HIPI_JUGADA_FILE = HIPI_JUGADA_PATH.join(__dirname, 'data', 'jugada-ids.json');

function hipiLoadJugadaIds() {
  try {
    if (!HIPI_JUGADA_FS.existsSync(HIPI_JUGADA_FILE)) return {};
    return JSON.parse(HIPI_JUGADA_FS.readFileSync(HIPI_JUGADA_FILE, 'utf8'));
  } catch (error) {
    console.warn('No se pudieron cargar los IDs de jugada:', error.message);
    return {};
  }
}

function hipiSaveJugadaIds(ids) {
  try {
    const dir = HIPI_JUGADA_PATH.dirname(HIPI_JUGADA_FILE);
    if (!HIPI_JUGADA_FS.existsSync(dir)) {
      HIPI_JUGADA_FS.mkdirSync(dir, { recursive: true });
    }
    HIPI_JUGADA_FS.writeFileSync(HIPI_JUGADA_FILE, JSON.stringify(ids, null, 2));
  } catch (error) {
    console.warn('No se pudieron guardar los IDs de jugada:', error.message);
  }
}

const HIPI_JUGADA_IDS = hipiLoadJugadaIds();

function hipiGenerateFiveDigitJugadaId() {
  const used = new Set(Object.values(HIPI_JUGADA_IDS).map(String));
  let id = '';

  do {
    id = String(Math.floor(10000 + Math.random() * 90000));
  } while (used.has(id));

  return id;
}

function hipiGetJugadaId(roundValue) {
  const key = String(roundValue || 'active');

  if (!HIPI_JUGADA_IDS[key]) {
    HIPI_JUGADA_IDS[key] = hipiGenerateFiveDigitJugadaId();
    hipiSaveJugadaIds(HIPI_JUGADA_IDS);
  }

  return HIPI_JUGADA_IDS[key];
}

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    try {
      if (body && typeof body === 'object') {
        const rootRound = body.roundId || body.raceNumber || body.round || body.ronda;

        if (rootRound && (body.phase || body.secondsRemaining !== undefined || req.path === '/api/state')) {
          const jugadaId = hipiGetJugadaId(rootRound);
          body.jugadaId = jugadaId;
          body.playId = jugadaId;
          body.roundCode = jugadaId;
        }

        if (body.state && typeof body.state === 'object') {
          const stateRound = body.state.roundId || body.state.raceNumber || rootRound;
          if (stateRound) {
            const jugadaId = hipiGetJugadaId(stateRound);
            body.state.jugadaId = jugadaId;
            body.state.playId = jugadaId;
            body.state.roundCode = jugadaId;
          }
        }

        if (body.bet && typeof body.bet === 'object') {
          const betRound = body.bet.roundId || body.bet.raceNumber || rootRound;
          if (betRound) {
            const jugadaId = hipiGetJugadaId(betRound);
            body.bet.jugadaId = jugadaId;
            body.bet.playId = jugadaId;
            body.bet.roundCode = jugadaId;
          }
        }
      }
    } catch (error) {
      console.warn('No se pudo anexar jugadaId:', error.message);
    }

    return originalJson(body);
  };

  next();
});
// HIPIPLAY JUGADA ID RANDOM 5 DIGITOS - END

const PWA_DIST_PATH = "C:\\hipiplay-pwa";

app.use(cors({ origin: "*" }));
app.use(express.json());

// HIPIPLAY AUTO BETS ENGINE - START
const HIPI_AUTO_BETS_FILE = HIPI_AUTO_PATH.join(HIPI_AUTO_DATA_DIR, 'auto-race-bets.json');

function hipiAutoNormalizePlayerId(value) {
  return String(value || '').trim();
}

function hipiAutoGetPlayerIdFromRequest(req) {
  const queryPlayer =
    req.query?.playerId ||
    req.query?.userId ||
    req.query?.id ||
    req.body?.playerId ||
    req.body?.userId ||
    req.body?.clientId ||
    req.body?.id;

  if (queryPlayer) return hipiAutoNormalizePlayerId(queryPlayer);

  const parts = String(req.path || '')
    .split('/')
    .filter(Boolean);

  const playerIndex = parts.findIndex((part) =>
    ['player', 'players', 'user', 'users'].includes(String(part).toLowerCase())
  );

  if (playerIndex >= 0 && parts[playerIndex + 1] && String(parts[playerIndex + 1]).toLowerCase() !== 'result') {
    return hipiAutoNormalizePlayerId(parts[playerIndex + 1]);
  }

  return '';
}

function hipiAutoGetAllBets() {
  return hipiAutoReadJson(HIPI_AUTO_BETS_FILE, {});
}

function hipiAutoSaveAllBets(bets) {
  hipiAutoWriteJson(HIPI_AUTO_BETS_FILE, bets);
}

function hipiAutoCreateBetId(jugadaId) {
  return `BET-${jugadaId}-${String(Math.floor(10000 + Math.random() * 90000))}`;
}

function hipiAutoGetBetKey(roundId, playerId) {
  return `${roundId}:${playerId}`;
}

function hipiAutoGetMultiplier(position) {
  if (position === 0) return 2;
  if (position === 1) return 1.5;
  if (position === 2) return 1.5;
  return 0;
}
// HIPIPLAY LOWEST BET WINNERS PATCH - START
const HIPI_AUTO_LOWEST_WINNERS_FILE = HIPI_AUTO_PATH.join(HIPI_AUTO_DATA_DIR, 'auto-race-lowest-winners.json');

function hipiAutoApplyLowestBetWinnersToState(state) {
  try {
    if (!state || String(state.phase || '').toUpperCase() !== 'RESULTS') {
      return state;
    }

    const roundId = Number(state.roundId);

    if (!Number.isFinite(roundId)) {
      return state;
    }

    const saved = hipiAutoReadJson(HIPI_AUTO_LOWEST_WINNERS_FILE, {});
    const key = String(roundId);

    if (
      saved[key] &&
      Array.isArray(saved[key].winners) &&
      saved[key].winners.length >= 3
    ) {
      return {
        ...state,
        winners: saved[key].winners.slice(0, 3),
        winnerMode: 'LOWEST_BET',
        lowestBetTotals: saved[key].totals || []
      };
    }

    const bets = hipiAutoGetAllBets();

    const totals = [1, 2, 3, 4, 5, 6].map((horseId) => ({
      horseId,
      totalAmount: 0,
      totalBets: 0,
      tieBreaker: Math.random()
    }));

    Object.keys(bets).forEach((betKey) => {
      const bet = bets[betKey];

      if (!bet || Number(bet.roundId) !== roundId) return;

      const horseId = Number(bet.selectedHorse ?? bet.horseId);
      const amount = Number(bet.amount || 0);

      const row = totals.find((item) => item.horseId === horseId);

      if (!row) return;

      row.totalAmount += Number.isFinite(amount) ? amount : 0;
      row.totalBets += 1;
    });

    const totalBetsReceived = totals.reduce((sum, item) => sum + item.totalBets, 0);

    let winners;

    if (totalBetsReceived > 0) {
      winners = totals
        .slice()
        .sort((a, b) => {
          if (a.totalAmount !== b.totalAmount) {
            return a.totalAmount - b.totalAmount;
          }

          if (a.totalBets !== b.totalBets) {
            return a.totalBets - b.totalBets;
          }

          return a.tieBreaker - b.tieBreaker;
        })
        .slice(0, 3)
        .map((item) => item.horseId);
    } else {
      winners = Array.isArray(state.winners) && state.winners.length >= 3
        ? state.winners.slice(0, 3).map((winner) => Number(winner))
        : totals
            .slice()
            .sort((a, b) => a.tieBreaker - b.tieBreaker)
            .slice(0, 3)
            .map((item) => item.horseId);
    }

    const payload = {
      roundId,
      winners,
      mode: 'LOWEST_BET',
      totals: totals.map((item) => ({
        horseId: item.horseId,
        totalAmount: item.totalAmount,
        totalBets: item.totalBets
      })),
      createdAt: new Date().toISOString()
    };

    saved[key] = payload;
    hipiAutoWriteJson(HIPI_AUTO_LOWEST_WINNERS_FILE, saved);

    return {
      ...state,
      winners,
      winnerMode: 'LOWEST_BET',
      lowestBetTotals: payload.totals
    };
  } catch (error) {
    console.error('Error aplicando ganadores menos apostados:', error);
    return state;
  }
}
// HIPIPLAY LOWEST BET WINNERS PATCH - END


// HIPIPLAY REAL MONEY FLOW - liquidacion automatica
function hipiAutoSettleBalancesForCurrentResults(state) {
  try {
    if (!state || String(state.phase || '').toUpperCase() !== 'RESULTS') return;

    const winners = Array.isArray(state.winners)
      ? state.winners.map((winner) => Number(winner)).filter((winner) => Number.isFinite(winner))
      : [];

    if (!winners.length) return;

    const bets = hipiAutoGetAllBets();
    let changed = false;

    Object.keys(bets).forEach((key) => {
      const bet = bets[key];

      if (!bet) return;
      if (Number(bet.roundId) !== Number(state.roundId)) return;

      if (bet.status === 'resolved' && bet.finalBalance !== undefined && bet.finalBalance !== null) {
        return;
      }

      const selectedHorse = Number(bet.selectedHorse ?? bet.horseId);
      const position = winners.indexOf(selectedHorse);
      const multiplier = hipiAutoGetMultiplier(position);
      const won = multiplier > 0;
      const payout = won ? Math.floor(Number(bet.amount || 0) * multiplier) : 0;

      const reservedBalance = Number.isFinite(Number(bet.balanceAfterBet))
        ? Number(bet.balanceAfterBet)
        : 0;

      const finalBalance = Math.max(0, Math.floor(reservedBalance + payout));

      bet.status = 'resolved';
      bet.winners = winners;
      bet.won = won;
      bet.payout = payout;
      bet.finalBalance = finalBalance;
      bet.balance = finalBalance;
      bet.walletBalance = finalBalance;
      bet.serverBalance = finalBalance;
      bet.resolvedAt = Date.now();
      const dualSettlement =
        hipiDualSettleAutoBet({
          bet,
          payout,
          won,
          state
        });

      bet.finalBalance =
        dualSettlement.finalBalance;

      bet.balance =
        dualSettlement.finalBalance;

      bet.walletBalance =
        dualSettlement.finalBalance;

      bet.serverBalance =
        dualSettlement.finalBalance;

      bets[key] = bet;
      changed = true;
    });

    if (changed) {
      hipiAutoSaveAllBets(bets);
    }
  } catch (error) {
    console.error('Error liquidando balances automaticos:', error);
  }
}

// HIPIPLAY AUTO BALANCE SETTLEMENT PATCH - START
function hipiAutoSettleAllBetsForState(state) {
  try {
    if (!state || String(state.phase || '').toUpperCase() !== 'RESULTS') return;

    const winners = Array.isArray(state.winners)
      ? state.winners.map((winner) => Number(winner)).filter((winner) => Number.isFinite(winner))
      : [];

    if (!winners.length) return;

    const bets = hipiAutoGetAllBets();
    let changed = false;

    Object.keys(bets).forEach((key) => {
      const bet = bets[key];

      if (!bet || Number(bet.roundId) !== Number(state.roundId)) return;

      if (bet.status === 'resolved' && bet.finalBalance !== undefined && bet.finalBalance !== null) {
        return;
      }

      const selectedHorse = Number(bet.selectedHorse ?? bet.horseId);
      const position = winners.indexOf(selectedHorse);
      const multiplier = hipiAutoGetMultiplier(position);
      const won = multiplier > 0;
      const payout = won ? Math.floor(Number(bet.amount || 0) * multiplier) : 0;

      const baseBalance = Number.isFinite(Number(bet.balanceAfterBet))
        ? Number(bet.balanceAfterBet)
        : 0;

      const finalBalance = Math.max(0, Math.floor(baseBalance + payout));

      bet.status = 'resolved';
      bet.winners = winners;
      bet.won = won;
      bet.payout = payout;
      bet.finalBalance = finalBalance;
      bet.walletBalance = finalBalance;
      bet.serverBalance = finalBalance;
      bet.resolvedAt = Date.now();
      const dualSettlement =
        hipiDualSettleAutoBet({
          bet,
          payout,
          won,
          state
        });

      bet.finalBalance =
        dualSettlement.finalBalance;

      bet.balance =
        dualSettlement.finalBalance;

      bet.walletBalance =
        dualSettlement.finalBalance;

      bet.serverBalance =
        dualSettlement.finalBalance;

      bets[key] = bet;
      changed = true;
    });

    if (changed) {
      hipiAutoSaveAllBets(bets);
    }
  } catch (error) {
    console.error('Error liquidando apuestas automaticas:', error);
  }
}
// HIPIPLAY AUTO BALANCE SETTLEMENT PATCH - END


app.use((req, res, next) => {
  const path = String(req.path || req.url || '').toLowerCase();

  if (!path.startsWith('/api')) {
    return next();
  }

  const isBetEndpoint =
    req.method === 'POST' &&
    !path.includes('p2p') &&
    (
      path.includes('bet') ||
      path.includes('bets') ||
      path.includes('apuesta') ||
      path.includes('apostar')
    );

  if (isBetEndpoint) {
    try {
      let state = hipiAutoApplyLowestBetWinnersToState(hipiAutoGetState());

      if (String(state.phase).toUpperCase() !== 'BETTING') {
        return res.status(400).json({
          ok: false,
          message: 'Las apuestas estan cerradas. Espera la proxima jugada.',
          state
        });
      }

      const body = req.body || {};
      const playerId = hipiAutoNormalizePlayerId(
        body.playerId || body.userId || body.clientId || body.id
      );

      if (!playerId) {
        return res.status(400).json({
          ok: false,
          message: 'No se recibio playerId para registrar la apuesta.',
          state
        });
      }

      const selectedHorse = Number(
        body.selectedHorse ||
        body.horseId ||
        body.horse ||
        body.caballo ||
        body.caballoId
      );

      if (!Number.isFinite(selectedHorse) || selectedHorse < 1 || selectedHorse > 6) {
        return res.status(400).json({
          ok: false,
          message: 'Caballo invalido.',
          state
        });
      }

      const amount = Math.floor(Number(
        body.amount ||
        body.betAmount ||
        body.balanceApostado ||
        body.monto ||
        0
      ));

      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({
          ok: false,
          message: 'Monto invalido.',
          state
        });
      }

      const bets = hipiAutoGetAllBets();
      const key = hipiAutoGetBetKey(state.roundId, playerId);

      if (bets[key]) {
        return res.json({
          ok: true,
          message: 'Ya tienes una apuesta registrada en esta jugada.',
          bet: bets[key],
          state,
          balanceAfterBet: bets[key].balanceAfterBet,
          walletBalance: bets[key].balanceAfterBet,
          serverBalance: bets[key].balanceAfterBet
        });
      }
      // HIPIPLAY AUTO BALANCE RESERVE PATCH - START
      const betId =
        hipiAutoCreateBetId(
          state.jugadaId
        );

      const dualReservation =
        hipiDualReserveAutoBet({
          playerId,
          amount,
          roundId:
            state.roundId,
          jugadaId:
            state.jugadaId
        });

      const balanceBefore =
        Number(
          dualReservation.balanceBefore
        );

      const balanceAfterBet =
        Number(
          dualReservation.account
            .totalBalance
        );
      // HIPIPLAY AUTO BALANCE RESERVE PATCH - END

      const bet = {
        id: betId,
        betId,
        roundId: state.roundId,
        raceNumber: state.roundId,
        raceId: `server-round-${state.roundId}`,
        raceCode: `Jugada ${state.jugadaId}`,
        jugadaId: state.jugadaId,
        playId: state.jugadaId,
        roundCode: state.jugadaId,
        playerId,
        clientName: body.clientName || body.username || body.name || playerId,
        selectedHorse,
        horseId: selectedHorse,
        amount,
        dualAccountingVersion: 2,
        dualStakeReferenceId:
          dualReservation.referenceId,
        dualStakeLedgerEntryId:
          dualReservation.ledgerEntry.id,
        dualStakeComposition:
          dualReservation.composition,
        balanceBefore,
        balanceBeforeBet: balanceBefore,
        balanceTotal: balanceBefore,
        balanceAfterBet,
        walletBalance: balanceAfterBet,
        serverBalance: balanceAfterBet,
        status: 'pending',
        createdAt: Date.now()
      };

      bets[key] = bet;
      hipiAutoSaveAllBets(bets);

      return res.json({
        ok: true,
        message: 'Apuesta registrada correctamente.',
        bet,
        state,
        balance: balanceAfterBet,
        balanceAfterBet,
        walletBalance: balanceAfterBet,
        serverBalance: balanceAfterBet,
        finalBalance: balanceAfterBet
      });
    } catch (error) {
      console.error('Error en auto bet:', error);
      return res.status(500).json({
        ok: false,
        message: 'Error registrando apuesta automatica.',
        error: error.message
      });
    }
  }

  const isPlayerResultEndpoint =
    req.method === 'GET' &&
    path.includes('result') &&
    (
      path.includes('player') ||
      path.includes('user') ||
      path.includes('jugador')
    );

  if (isPlayerResultEndpoint) {
    try {
      let state = hipiAutoApplyLowestBetWinnersToState(hipiAutoGetState());
      const playerId = hipiAutoGetPlayerIdFromRequest(req);

      if (String(state.phase).toUpperCase() !== 'RESULTS') {
        return res.json({
          ok: true,
          pending: true,
          message: 'La jugada aun no esta en resultados.',
          state
        });
      }

      const bets = hipiAutoGetAllBets();
      const key = hipiAutoGetBetKey(state.roundId, playerId);
      const bet = bets[key] || null;
      const winners = Array.isArray(state.winners) ? state.winners : [];

      if (!bet) {
        return res.json({
          ok: true,
          noTicket: true,
          won: false,
          amount: 0,
          selectedHorse: null,
          winners,
          roundId: state.roundId,
          raceNumber: state.roundId,
          jugadaId: state.jugadaId,
          finalBalance: null,
          state
        });
      }

      const position = winners.indexOf(Number(bet.selectedHorse));
      const multiplier = hipiAutoGetMultiplier(position);
      const won = multiplier > 0;
      const payout = won ? Math.floor(Number(bet.amount) * multiplier) : 0;
      let finalBalance = Number.isFinite(Number(bet.balanceAfterBet))
        ? Math.max(0, Math.floor(Number(bet.balanceAfterBet) + payout))
        : null;
      // HIPIPLAY AUTO BALANCE SET FINAL BALANCE PATCH - START
      if (finalBalance !== null) {
        const dualSettlement =
          hipiDualSettleAutoBet({
            bet,
            payout,
            won,
            state
          });

        finalBalance =
          dualSettlement.finalBalance;
      }
      // HIPIPLAY AUTO BALANCE SET FINAL BALANCE PATCH - END

      bet.status = 'resolved';
      bet.winners = winners;
      bet.won = won;
      bet.payout = payout;
      bet.finalBalance = finalBalance;
      bet.resolvedAt = Date.now();

      bets[key] = bet;
      hipiAutoSaveAllBets(bets);

      return res.json({
        ok: true,
        won,
        payout,
        amount: bet.amount,
        selectedHorse: bet.selectedHorse,
        winners,
        roundId: state.roundId,
        raceNumber: state.roundId,
        jugadaId: state.jugadaId,
        balance: finalBalance,
        finalBalance,
        walletBalance: finalBalance,
        serverBalance: finalBalance,
        balanceAfterBet: bet.balanceAfterBet,
        bet,
        state
      });
    } catch (error) {
      console.error('Error en auto player result:', error);
      return res.status(500).json({
        ok: false,
        message: 'Error consultando resultado automatico.',
        error: error.message
      });
    }
  }

  return next();
});
// HIPIPLAY AUTO BETS ENGINE - END

app.use(express.static(path.join(__dirname, "public")));

function proxyToPwaBackend(req, res) {
  const targetPath = req.originalUrl;

  const body = req.body && Object.keys(req.body).length > 0
    ? JSON.stringify(req.body)
    : null;

  const headers = {
    ...req.headers,
    host: "127.0.0.1:4001"
  };

  if (body) {
    headers["content-type"] = "application/json";
    headers["content-length"] = Buffer.byteLength(body);
  }

  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: 4001,
      path: targetPath,
      method: req.method,
      headers
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (error) => {
    res.status(502).json({
      ok: false,
      error: "No se pudo conectar con el backend principal de la PWA.",
      detail: error.message
    });
  });

  if (body) {
    proxyReq.write(body);
  }

  proxyReq.end();
}

app.use([
  "/api/auth",
  "/api/me",
  "/api/users",
  "/api/games",
  "/api/races",
  "/api/referral",
  "/api/pool",
  "/api/audits",
  "/api/local-first"
], proxyToPwaBackend);

app.use("/app-api", (req, res) => {
  const targetPath = req.originalUrl.replace(/^\/app-api/, "/api");

  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: 4001,
      path: targetPath,
      method: req.method,
      headers: {
        ...req.headers,
        host: "127.0.0.1:4001"
      }
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (error) => {
    res.status(502).json({
      ok: false,
      error: "No se pudo conectar con el backend principal de la PWA.",
      detail: error.message
    });
  });

  if (req.body && Object.keys(req.body).length > 0) {
    proxyReq.write(JSON.stringify(req.body));
  }

  proxyReq.end();
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const horses = [
  { id: 1, name: "Caballo 1", color: "Rojo" },
  { id: 2, name: "Caballo 2", color: "Azul" },
  { id: 3, name: "Caballo 3", color: "Verde" },
  { id: 4, name: "Caballo 4", color: "Amarillo" },
  { id: 5, name: "Caballo 5", color: "Negro" },
  { id: 6, name: "Caballo 6", color: "Blanco" }
];

const dataDir = path.join(__dirname, "data");
const logsDir = path.join(__dirname, "logs");
const historyFile = path.join(dataDir, "race-history.json");
const balancesFile = path.join(dataDir, "player-balances.json");
const ledgerFile = path.join(dataDir, "ledger.json");
const walletPoolFile = path.join(dataDir, "wallet-pool.json");
const depositOrdersFile = path.join(dataDir, "deposit-orders.json");
const p2pOffersFile = path.join(dataDir, "p2p-offers.json");
const p2pTradesFile = path.join(dataDir, "p2p-trades.json");
const coinTransfersFile = path.join(dataDir, "coin-transfers.json");
const userEscrowFile = path.join(dataDir, "user-escrow.json");
const userUsdtBalancesFile = path.join(dataDir, "user-usdt-balances.json");
const withdrawalsFile = path.join(dataDir, "withdrawals.json");
const casinoBalanceFile = path.join(dataDir, "casino-balance.json");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
if (!fs.existsSync(historyFile)) fs.writeFileSync(historyFile, "[]\n", "utf8");
if (!fs.existsSync(balancesFile)) fs.writeFileSync(balancesFile, "{}\n", "utf8");
if (!fs.existsSync(ledgerFile)) fs.writeFileSync(ledgerFile, "[]\n", "utf8");
if (!fs.existsSync(walletPoolFile)) fs.writeFileSync(walletPoolFile, "[]\n", "utf8");
if (!fs.existsSync(depositOrdersFile)) fs.writeFileSync(depositOrdersFile, "[]\n", "utf8");
if (!fs.existsSync(p2pOffersFile)) fs.writeFileSync(p2pOffersFile, "[]\n", "utf8");
if (!fs.existsSync(p2pTradesFile)) fs.writeFileSync(p2pTradesFile, "[]\n", "utf8");
if (!fs.existsSync(coinTransfersFile)) fs.writeFileSync(coinTransfersFile, "[]\n", "utf8");
if (!fs.existsSync(userEscrowFile)) fs.writeFileSync(userEscrowFile, "{}\n", "utf8");
if (!fs.existsSync(userUsdtBalancesFile)) fs.writeFileSync(userUsdtBalancesFile, "{}\n", "utf8");
if (!fs.existsSync(withdrawalsFile)) fs.writeFileSync(withdrawalsFile, "[]\n", "utf8");
if (!fs.existsSync(casinoBalanceFile)) fs.writeFileSync(casinoBalanceFile, JSON.stringify({ balance: 0, currency: "COIN", equivalent: "USDT", totalRevenue: 0, totalLoss: 0, processedRaceNumbers: [], updatedAt: null }, null, 2), "utf8");

let roundId = 1;
let phase = "BETTING";
let secondsRemaining = BETTING_SECONDS;
let bets = [];
let winners = [];
let hiddenWinners = [];
let orderedResults = [];
let settlements = [];
let raceStartedAt = null;
let resultsStartedAt = null;
let roundHistory = loadHistory();
let playerBalances = loadPlayerBalances();
let ledger = loadLedger();
let walletPool = loadWalletPool();
let depositOrders = loadDepositOrders();
let p2pOffers = loadP2POffers();
let p2pTrades = loadP2PTrades();
let coinTransfers = loadCoinTransfers();
let userEscrow = loadUserEscrow();
let userUsdtBalances = loadUserUsdtBalances();
let withdrawals = loadWithdrawals();
let casinoBalance = loadCasinoBalance();
let roundStatus = "BETTING";
let roundCancelReason = null;

function loadHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyFile, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("No se pudo cargar el historial:", error.message);
    return [];
  }
}
function persistHistory() { fs.writeFileSync(historyFile, JSON.stringify(roundHistory, null, 2), "utf8"); }

function loadPlayerBalances() {
  try {
    const parsed = JSON.parse(fs.readFileSync(balancesFile, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error("No se pudieron cargar los balances:", error.message);
    return {};
  }
}
function persistPlayerBalances() {
  fs.writeFileSync(balancesFile, JSON.stringify(playerBalances, null, 2), "utf8");
}

function loadLedger() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("No se pudo cargar el ledger:", error.message);
    return [];
  }
}

function persistLedger() {
  fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2), "utf8");
}

function addLedgerEntry(entry) {
  const item = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
    createdAt: new Date().toISOString(),
    ...entry
  };

  ledger.unshift(item);
  ledger = ledger.slice(0, 5000);
  persistLedger();
  return item;
}

function loadCasinoBalance() {
  try {
    const parsed = JSON.parse(fs.readFileSync(casinoBalanceFile, "utf8"));

    return {
      balance: Number(parsed.balance || 0),
      currency: parsed.currency || "COIN",
      equivalent: parsed.equivalent || "USDT",
      totalRevenue: Number(parsed.totalRevenue || 0),
      totalLoss: Number(parsed.totalLoss || 0),
      processedRaceNumbers: Array.isArray(parsed.processedRaceNumbers) ? parsed.processedRaceNumbers : [],
      updatedAt: parsed.updatedAt || null
    };
  } catch (error) {
    console.error("No se pudo cargar casino-balance:", error.message);

    return {
      balance: 0,
      currency: "COIN",
      equivalent: "USDT",
      totalRevenue: 0,
      totalLoss: 0,
      processedRaceNumbers: [],
      updatedAt: null
    };
  }
}

function persistCasinoBalance() {
  fs.writeFileSync(casinoBalanceFile, JSON.stringify(casinoBalance, null, 2), "utf8");
}

function applyCasinoRaceResult(raceNumber, houseRevenue) {
  const raceKey = String(raceNumber);

  if (casinoBalance.processedRaceNumbers.includes(raceKey)) {
    return casinoBalance;
  }

  const amount = Number(houseRevenue || 0);

  casinoBalance.balance = Number(casinoBalance.balance || 0) + amount;

  if (amount >= 0) {
    casinoBalance.totalRevenue = Number(casinoBalance.totalRevenue || 0) + amount;
  } else {
    casinoBalance.totalLoss = Number(casinoBalance.totalLoss || 0) + Math.abs(amount);
  }

  casinoBalance.processedRaceNumbers.unshift(raceKey);
  casinoBalance.processedRaceNumbers = casinoBalance.processedRaceNumbers.slice(0, 10000);
  casinoBalance.updatedAt = new Date().toISOString();

  persistCasinoBalance();

  return casinoBalance;
}


function loadWalletPool() {
  try {
    const parsed = JSON.parse(fs.readFileSync(walletPoolFile, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("No se pudo cargar wallet-pool:", error.message);
    return [];
  }
}

function persistWalletPool() {
  fs.writeFileSync(walletPoolFile, JSON.stringify(walletPool, null, 2), "utf8");
}

function loadDepositOrders() {
  try {
    const parsed = JSON.parse(fs.readFileSync(depositOrdersFile, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("No se pudo cargar deposit-orders:", error.message);
    return [];
  }
}

function persistDepositOrders() {
  fs.writeFileSync(depositOrdersFile, JSON.stringify(depositOrders, null, 2), "utf8");
}

function generateDepositOrderId() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  return `DEP-${timestamp}-${random}`;
}

function addWalletToPool(input) {
  const address = String(input.address || "").trim();
  const network = String(input.network || "").trim().toUpperCase();
  const token = String(input.token || "USDT").trim().toUpperCase();
  const note = String(input.note || "").trim();

  if (!address) throw new Error("La direcciÃƒÂ³n pÃƒÂºblica es obligatoria.");
  if (!network) throw new Error("La red es obligatoria.");

  const exists = walletPool.some((wallet) =>
    String(wallet.address).toLowerCase() === address.toLowerCase() &&
    String(wallet.network).toUpperCase() === network &&
    String(wallet.token || "USDT").toUpperCase() === token
  );

  if (exists) throw new Error("Esa direcciÃƒÂ³n ya existe en el pool.");

  const wallet = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
    network,
    token,
    address,
    note,
    status: "AVAILABLE",
    assignedOrderId: null,
    assignedPlayerId: null,
    createdAt: new Date().toISOString(),
    assignedAt: null,
    usedAt: null,
    retiredAt: null
  };

  walletPool.unshift(wallet);
  persistWalletPool();

  return wallet;
}

function getWalletPoolSummary() {
  return walletPool.reduce((acc, wallet) => {
    const status = String(wallet.status || "AVAILABLE").toUpperCase();

    acc.total += 1;
    acc[status] = Number(acc[status] || 0) + 1;

    return acc;
  }, {
    total: 0,
    AVAILABLE: 0,
    ASSIGNED: 0,
    USED: 0,
    RETIRED: 0,
    DISABLED: 0
  });
}

function findAvailableDepositWallet(network, token) {
  const desiredNetwork = String(network || "TRC20").trim().toUpperCase();
  const desiredToken = String(token || "USDT").trim().toUpperCase();

  return walletPool.find((wallet) =>
    String(wallet.status || "").toUpperCase() === "AVAILABLE" &&
    String(wallet.network || "").toUpperCase() === desiredNetwork &&
    String(wallet.token || "USDT").toUpperCase() === desiredToken
  );
}

function createDepositOrder(input) {
  const playerId = normalizePlayerId(input.playerId);
  const clientName = String(input.clientName || playerId || "Cliente").trim();
  const amount = Number(input.amount || 0);
  const network = String(input.network || "TRC20").trim().toUpperCase();
  const token = String(input.token || "USDT").trim().toUpperCase();

  if (!playerId) throw new Error("playerId es obligatorio.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("El monto debe ser mayor a 0.");

  const wallet = findAvailableDepositWallet(network, token);

  if (!wallet) {
    throw new Error(`No hay wallets disponibles para ${token} en ${network}.`);
  }

  const orderId = generateDepositOrderId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

  wallet.status = "ASSIGNED";
  wallet.assignedOrderId = orderId;
  wallet.assignedPlayerId = playerId;
  wallet.assignedAt = now.toISOString();

  const order = {
    orderId,
    playerId,
    clientName,
    amount,
    expectedAmount: amount,
    creditedAmount: 0,
    network,
    token,
    address: wallet.address,
    walletId: wallet.id,
    status: "PENDING",
    txHash: null,
    adminNote: "",
    createdAt: now.toISOString(),
    expiresAt,
    confirmedAt: null,
    rejectedAt: null
  };

  depositOrders.unshift(order);

  persistWalletPool();
  persistDepositOrders();

  addLedgerEntry({
    type: "DEPOSIT_REQUESTED",
    status: "PENDING",
    orderId,
    playerId,
    clientName,
    amount,
    network,
    token,
    address: wallet.address,
    walletId: wallet.id
  });

  return order;
}

function confirmDepositOrder(orderId, input) {
  const order = depositOrders.find((item) => String(item.orderId) === String(orderId));

  if (!order) throw new Error("Orden de depÃƒÂ³sito no encontrada.");
  if (order.status === "CONFIRMED") return order;
  if (order.status !== "PENDING") throw new Error(`La orden no estÃƒÂ¡ pendiente. Estado actual: ${order.status}`);

  const creditedAmount = Number(input.creditedAmount || order.expectedAmount || order.amount || 0);

  if (!Number.isFinite(creditedAmount) || creditedAmount <= 0) {
    throw new Error("El monto acreditado debe ser mayor a 0.");
  }

  const playerId = normalizePlayerId(order.playerId);
  const balanceBefore = getPlayerBalance(playerId);
  const balanceAfter = balanceBefore + creditedAmount;

  setPlayerBalance(playerId, balanceAfter);

  order.status = "CONFIRMED";
  order.creditedAmount = creditedAmount;
  order.txHash = String(input.txHash || "").trim();
  order.adminNote = String(input.adminNote || "").trim();
  order.confirmedAt = new Date().toISOString();

  const wallet = walletPool.find((item) => String(item.id) === String(order.walletId));
  if (wallet) {
    wallet.status = "USED";
    wallet.usedAt = new Date().toISOString();
  }

  persistDepositOrders();
  persistWalletPool();

  addLedgerEntry({
    type: "DEPOSIT_CONFIRMED",
    status: "CONFIRMED",
    orderId: order.orderId,
    playerId,
    clientName: order.clientName,
    amount: creditedAmount,
    expectedAmount: order.expectedAmount,
    network: order.network,
    token: order.token,
    address: order.address,
    walletId: order.walletId,
    txHash: order.txHash,
    balanceBefore,
    balanceAfter
  });

  return order;
}

function rejectDepositOrder(orderId, input) {
  const order = depositOrders.find((item) => String(item.orderId) === String(orderId));

  if (!order) throw new Error("Orden de depÃƒÂ³sito no encontrada.");
  if (order.status === "CONFIRMED") throw new Error("No se puede rechazar una orden ya confirmada.");
  if (order.status === "REJECTED") return order;

  order.status = "REJECTED";
  order.adminNote = String(input.adminNote || "").trim();
  order.rejectedAt = new Date().toISOString();

  const wallet = walletPool.find((item) => String(item.id) === String(order.walletId));
  if (wallet) {
    wallet.status = "RETIRED";
    wallet.retiredAt = new Date().toISOString();
  }

  persistDepositOrders();
  persistWalletPool();

  addLedgerEntry({
    type: "DEPOSIT_REJECTED",
    status: "REJECTED",
    orderId: order.orderId,
    playerId: order.playerId,
    clientName: order.clientName,
    amount: order.expectedAmount,
    network: order.network,
    token: order.token,
    address: order.address,
    walletId: order.walletId,
    note: order.adminNote
  });

  return order;
}

function publicDepositOrder(order) {
  if (!order) return null;

  return {
    orderId: order.orderId,
    playerId: order.playerId,
    clientName: order.clientName,
    amount: order.amount,
    expectedAmount: order.expectedAmount,
    creditedAmount: order.creditedAmount,
    network: order.network,
    token: order.token,
    address: order.address,
    status: order.status,
    txHash: order.txHash,
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    confirmedAt: order.confirmedAt,
    rejectedAt: order.rejectedAt
  };
}


function loadJsonArraySafe(file, label) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`No se pudo cargar ${label}:`, error.message);
    return [];
  }
}

function loadJsonObjectSafe(file, label) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error(`No se pudo cargar ${label}:`, error.message);
    return {};
  }
}

function persistJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function loadP2POffers() {
  return loadJsonArraySafe(p2pOffersFile, "p2p-offers");
}

function persistP2POffers() {
  persistJson(p2pOffersFile, p2pOffers);
}

function loadP2PTrades() {
  return loadJsonArraySafe(p2pTradesFile, "p2p-trades");
}

function persistP2PTrades() {
  persistJson(p2pTradesFile, p2pTrades);
}

function loadUserEscrow() {
  return loadJsonObjectSafe(userEscrowFile, "user-escrow");
}

function persistUserEscrow() {
  persistJson(userEscrowFile, userEscrow);
}

function loadUserUsdtBalances() {
  return loadJsonObjectSafe(userUsdtBalancesFile, "user-usdt-balances");
}

function persistUserUsdtBalances() {
  persistJson(userUsdtBalancesFile, userUsdtBalances);
}

function generateP2PId(prefix) {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  return `${prefix}-${timestamp}-${random}`;
}

function getEscrowBalance(playerId) {
  const id = normalizePlayerId(playerId);
  const record = userEscrow[id] || {};
  return Number(record.p2pLocked || 0);
}

function adjustEscrowBalance(playerId, amount) {
  const id = normalizePlayerId(playerId);
  const current = getEscrowBalance(id);
  const next = current + Number(amount || 0);

  if (next < -0.000001) {
    throw new Error("Escrow insuficiente.");
  }

  userEscrow[id] = {
    playerId: id,
    p2pLocked: Math.max(0, next),
    updatedAt: new Date().toISOString()
  };

  persistUserEscrow();

  return userEscrow[id];
}

function getUserUsdtBalance(playerId) {
  const id = normalizePlayerId(playerId);
  const record = userUsdtBalances[id] || {};
  return Number(record.balance || 0);
}

function adjustUserUsdtBalance(playerId, amount) {
  const id = normalizePlayerId(playerId);
  const current = getUserUsdtBalance(id);
  const next = current + Number(amount || 0);

  if (next < -0.000001) {
    throw new Error("Balance USDT insuficiente.");
  }

  userUsdtBalances[id] = {
    playerId: id,
    balance: Math.max(0, next),
    token: "USDT",
    updatedAt: new Date().toISOString()
  };

  persistUserUsdtBalances();

  return userUsdtBalances[id];
}

function publicP2POffer(offer) {
  if (!offer) return null;

  return {
    offerId: offer.offerId,
    sellerId: offer.sellerId,
    sellerName: offer.sellerName,
    coinAmount: offer.coinAmount,
    remainingCoins: offer.remainingCoins,
    pricePerCoin: offer.pricePerCoin,
    totalUsdt: offer.totalUsdt,
    remainingUsdt: Number((Number(offer.remainingCoins || 0) * Number(offer.pricePerCoin || 1)).toFixed(8)),
    network: offer.network,
    token: offer.token,
    status: offer.status,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt
  };
}

function publicP2PTrade(trade) {
  if (!trade) return null;

  return {
    tradeId: trade.tradeId,
    offerId: trade.offerId,
    sellerId: trade.sellerId,
    sellerName: trade.sellerName,
    buyerId: trade.buyerId,
    buyerName: trade.buyerName,
    coinAmount: trade.coinAmount,
    usdtAmount: trade.usdtAmount,
    network: trade.network,
    token: trade.token,
    paymentAddress: trade.paymentAddress,
    walletId: trade.walletId,
    status: trade.status,
    txHash: trade.txHash,
    createdAt: trade.createdAt,
    expiresAt: trade.expiresAt,
    confirmedAt: trade.confirmedAt,
    cancelledAt: trade.cancelledAt
  };
}

function getOpenP2POffers() {
  return p2pOffers
    .filter((offer) =>
      ["OPEN", "PARTIAL"].includes(String(offer.status || "").toUpperCase()) &&
      Number(offer.remainingCoins || 0) > 0
    )
    .map(publicP2POffer);
}

function createP2POffer(input) {
  const sellerId = normalizePlayerId(input.sellerId || input.playerId);
  const sellerName = String(input.sellerName || input.clientName || sellerId).trim();
  const coinAmount = Number(input.coinAmount || input.amount || 0);
  const pricePerCoin = Number(input.pricePerCoin || 1);
  const network = String(input.network || "BSC").trim().toUpperCase();
  const token = String(input.token || "USDT").trim().toUpperCase();

  if (!sellerId) throw new Error("sellerId es obligatorio.");
  if (!Number.isFinite(coinAmount) || coinAmount <= 0) throw new Error("La cantidad de monedas debe ser mayor a 0.");
  if (!Number.isFinite(pricePerCoin) || pricePerCoin <= 0) throw new Error("El precio por moneda debe ser mayor a 0.");

  const available = getPlayerBalance(sellerId);

  if (available < coinAmount) {
    throw new Error(`Balance insuficiente. Disponible: ${available}, requerido: ${coinAmount}.`);
  }

  const balanceBefore = available;
  const balanceAfter = available - coinAmount;

  setPlayerBalance(sellerId, balanceAfter);
  adjustEscrowBalance(sellerId, coinAmount);

  const offerId = generateP2PId("OFF");
  const totalUsdt = Number((coinAmount * pricePerCoin).toFixed(8));
  const now = new Date().toISOString();

  const offer = {
    offerId,
    sellerId,
    sellerName,
    coinAmount,
    remainingCoins: coinAmount,
    pricePerCoin,
    totalUsdt,
    network,
    token,
    status: "OPEN",
    createdAt: now,
    updatedAt: now,
    cancelledAt: null,
    completedAt: null
  };

  p2pOffers.unshift(offer);
  persistP2POffers();

  addLedgerEntry({
    type: "P2P_OFFER_CREATED",
    status: "OPEN",
    offerId,
    sellerId,
    sellerName,
    coinAmount,
    pricePerCoin,
    totalUsdt,
    network,
    token,
    balanceBefore,
    balanceAfter,
    escrowAfter: getEscrowBalance(sellerId)
  });

  return offer;
}

function cancelP2POffer(offerId, input = {}) {
  const offer = p2pOffers.find((item) => String(item.offerId) === String(offerId));

  if (!offer) throw new Error("Oferta no encontrada.");

  const status = String(offer.status || "").toUpperCase();

  if (["COMPLETED", "CANCELLED"].includes(status)) {
    return offer;
  }

  const activeTrade = p2pTrades.find((trade) =>
    String(trade.offerId) === String(offer.offerId) &&
    String(trade.status || "").toUpperCase() === "PAYMENT_PENDING"
  );

  if (activeTrade) {
    throw new Error("No puedes cancelar la oferta porque tiene una operaciÃƒÂ³n pendiente de pago.");
  }

  const remainingCoins = Number(offer.remainingCoins || 0);

  if (remainingCoins > 0) {
    const sellerBalanceBefore = getPlayerBalance(offer.sellerId);
    setPlayerBalance(offer.sellerId, sellerBalanceBefore + remainingCoins);
    adjustEscrowBalance(offer.sellerId, -remainingCoins);
  }

  offer.remainingCoins = 0;
  offer.status = "CANCELLED";
  offer.cancelledAt = new Date().toISOString();
  offer.updatedAt = new Date().toISOString();
  offer.cancelReason = String(input.reason || input.adminNote || "Cancelada").trim();

  persistP2POffers();

  addLedgerEntry({
    type: "P2P_OFFER_CANCELLED",
    status: "CANCELLED",
    offerId: offer.offerId,
    sellerId: offer.sellerId,
    returnedCoins: remainingCoins,
    escrowAfter: getEscrowBalance(offer.sellerId)
  });

  return offer;
}

function takeP2POffer(offerId, input) {
  const offer = p2pOffers.find((item) => String(item.offerId) === String(offerId));

  if (!offer) throw new Error("Oferta no encontrada.");

  const buyerId = normalizePlayerId(input.buyerId || input.playerId);
  const buyerName = String(input.buyerName || input.clientName || buyerId).trim();
  const requestedCoins = input.coinAmount !== undefined
    ? Number(input.coinAmount)
    : Number(offer.remainingCoins || 0);

  if (!buyerId) throw new Error("buyerId es obligatorio.");
  if (buyerId === offer.sellerId) throw new Error("No puedes comprar tu propia oferta.");
  if (!["OPEN", "PARTIAL"].includes(String(offer.status || "").toUpperCase())) {
    throw new Error("La oferta no estÃƒÂ¡ disponible.");
  }
  if (!Number.isFinite(requestedCoins) || requestedCoins <= 0) {
    throw new Error("La cantidad a comprar debe ser mayor a 0.");
  }
  if (requestedCoins > Number(offer.remainingCoins || 0)) {
    throw new Error("La cantidad solicitada excede lo disponible en la oferta.");
  }

  const wallet = findAvailableDepositWallet(offer.network, offer.token);

  if (!wallet) {
    throw new Error(`No hay wallet disponible para cobrar esta operaciÃƒÂ³n P2P en ${offer.network}/${offer.token}.`);
  }

  const tradeId = generateP2PId("TRD");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const usdtAmount = Number((requestedCoins * Number(offer.pricePerCoin || 1)).toFixed(8));

  wallet.status = "ASSIGNED";
  wallet.assignedOrderId = tradeId;
  wallet.assignedPlayerId = buyerId;
  wallet.assignedAt = now.toISOString();

  offer.remainingCoins = Number((Number(offer.remainingCoins || 0) - requestedCoins).toFixed(8));
  offer.status = offer.remainingCoins > 0 ? "PARTIAL" : "TAKEN";
  offer.updatedAt = now.toISOString();

  const trade = {
    tradeId,
    offerId: offer.offerId,
    sellerId: offer.sellerId,
    sellerName: offer.sellerName,
    buyerId,
    buyerName,
    coinAmount: requestedCoins,
    pricePerCoin: offer.pricePerCoin,
    usdtAmount,
    network: offer.network,
    token: offer.token,
    paymentAddress: wallet.address,
    walletId: wallet.id,
    status: "PAYMENT_PENDING",
    txHash: null,
    adminNote: "",
    createdAt: now.toISOString(),
    expiresAt,
    confirmedAt: null,
    cancelledAt: null
  };

  p2pTrades.unshift(trade);

  persistWalletPool();
  persistP2POffers();
  persistP2PTrades();

  addLedgerEntry({
    type: "P2P_TRADE_CREATED",
    status: "PAYMENT_PENDING",
    tradeId,
    offerId: offer.offerId,
    sellerId: offer.sellerId,
    buyerId,
    coinAmount: requestedCoins,
    usdtAmount,
    network: offer.network,
    token: offer.token,
    paymentAddress: wallet.address,
    walletId: wallet.id
  });

  return trade;
}

function confirmP2PTradePayment(tradeId, input = {}) {
  const trade = p2pTrades.find((item) => String(item.tradeId) === String(tradeId));

  if (!trade) throw new Error("Trade no encontrado.");

  if (String(trade.status || "").toUpperCase() === "CONFIRMED") {
    return trade;
  }

  if (String(trade.status || "").toUpperCase() !== "PAYMENT_PENDING") {
    throw new Error(`El trade no estÃƒÂ¡ pendiente. Estado actual: ${trade.status}`);
  }

  const paidAmount = Number(input.paidAmount || input.receivedAmount || trade.usdtAmount || 0);

  if (!Number.isFinite(paidAmount) || paidAmount < Number(trade.usdtAmount || 0)) {
    throw new Error("Pago insuficiente para confirmar la operaciÃƒÂ³n.");
  }

  const buyerBalanceBefore = getPlayerBalance(trade.buyerId);
  const buyerBalanceAfter = buyerBalanceBefore + Number(trade.coinAmount || 0);

  setPlayerBalance(trade.buyerId, buyerBalanceAfter);
  adjustEscrowBalance(trade.sellerId, -Number(trade.coinAmount || 0));
  const sellerUsdt = adjustUserUsdtBalance(trade.sellerId, Number(trade.usdtAmount || 0));

  trade.status = "CONFIRMED";
  trade.txHash = String(input.txHash || `AUTO_P2P_CONFIRM_${Date.now()}`).trim();
  trade.adminNote = String(input.adminNote || "").trim();
  trade.confirmedAt = new Date().toISOString();

  const wallet = walletPool.find((item) => String(item.id) === String(trade.walletId));

  if (wallet) {
    wallet.status = "USED";
    wallet.usedAt = new Date().toISOString();
  }

  const offer = p2pOffers.find((item) => String(item.offerId) === String(trade.offerId));

  if (offer && Number(offer.remainingCoins || 0) <= 0) {
    const pendingTrades = p2pTrades.some((item) =>
      String(item.offerId) === String(offer.offerId) &&
      String(item.status || "").toUpperCase() === "PAYMENT_PENDING"
    );

    if (!pendingTrades) {
      offer.status = "COMPLETED";
      offer.completedAt = new Date().toISOString();
      offer.updatedAt = new Date().toISOString();
    }
  }

  persistP2PTrades();
  persistP2POffers();
  persistWalletPool();

  addLedgerEntry({
    type: "P2P_TRADE_CONFIRMED",
    status: "CONFIRMED",
    tradeId: trade.tradeId,
    offerId: trade.offerId,
    sellerId: trade.sellerId,
    buyerId: trade.buyerId,
    coinAmount: trade.coinAmount,
    usdtAmount: trade.usdtAmount,
    txHash: trade.txHash,
    buyerBalanceBefore,
    buyerBalanceAfter,
    sellerUsdtBalanceAfter: sellerUsdt.balance,
    sellerEscrowAfter: getEscrowBalance(trade.sellerId)
  });

  return trade;
}

function cancelP2PTrade(tradeId, input = {}) {
  const trade = p2pTrades.find((item) => String(item.tradeId) === String(tradeId));

  if (!trade) throw new Error("Trade no encontrado.");

  const status = String(trade.status || "").toUpperCase();

  if (status === "CONFIRMED") {
    throw new Error("No se puede cancelar un trade confirmado.");
  }

  if (status === "CANCELLED") {
    return trade;
  }

  const offer = p2pOffers.find((item) => String(item.offerId) === String(trade.offerId));

  if (offer) {
    offer.remainingCoins = Number((Number(offer.remainingCoins || 0) + Number(trade.coinAmount || 0)).toFixed(8));
    offer.status = "OPEN";
    offer.updatedAt = new Date().toISOString();
  }

  const wallet = walletPool.find((item) => String(item.id) === String(trade.walletId));

  if (wallet) {
    wallet.status = "RETIRED";
    wallet.retiredAt = new Date().toISOString();
  }

  trade.status = "CANCELLED";
  trade.cancelledAt = new Date().toISOString();
  trade.adminNote = String(input.adminNote || input.reason || "Cancelado").trim();

  persistP2PTrades();
  persistP2POffers();
  persistWalletPool();

  addLedgerEntry({
    type: "P2P_TRADE_CANCELLED",
    status: "CANCELLED",
    tradeId: trade.tradeId,
    offerId: trade.offerId,
    sellerId: trade.sellerId,
    buyerId: trade.buyerId,
    coinAmount: trade.coinAmount,
    usdtAmount: trade.usdtAmount,
    note: trade.adminNote
  });

  return trade;
}


function loadCoinTransfers() {
  return loadJsonArraySafe(coinTransfersFile, "coin-transfers");
}

function persistCoinTransfers() {
  persistJson(coinTransfersFile, coinTransfers);
}

function publicCoinTransfer(transfer) {
  if (!transfer) return null;

  return {
    transferId: transfer.transferId,
    fromPlayerId: transfer.fromPlayerId,
    fromName: transfer.fromName,
    toPlayerId: transfer.toPlayerId,
    toName: transfer.toName,
    amount: transfer.amount,
    status: transfer.status,
    note: transfer.note,
    createdAt: transfer.createdAt,
    confirmedAt: transfer.confirmedAt,
    cancelledAt: transfer.cancelledAt
  };
}

function findCoinTransfer(transferId) {
  return coinTransfers.find((item) => String(item.transferId) === String(transferId));
}

function createCoinTransfer(input = {}) {
  const fromPlayerId = normalizePlayerId(input.fromPlayerId || input.senderId || input.playerId);
  const toPlayerId = normalizePlayerId(input.toPlayerId || input.receiverId || input.targetPlayerId);
  const fromName = String(input.fromName || input.senderName || fromPlayerId || "").trim();
  const toName = String(input.toName || input.receiverName || toPlayerId || "").trim();
  const amount = Math.floor(Number(input.amount || input.coinAmount || 0));
  const note = String(input.note || "").trim();

  if (!fromPlayerId) throw new Error("fromPlayerId es obligatorio.");
  if (!toPlayerId) throw new Error("toPlayerId es obligatorio.");
  if (fromPlayerId === toPlayerId) throw new Error("No puedes transferirte monedas a ti mismo.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("La cantidad de monedas debe ser mayor a 0.");

  const senderBalanceBefore = getPlayerBalance(fromPlayerId);

  if (senderBalanceBefore < amount) {
    throw new Error(`Balance insuficiente. Disponible: ${senderBalanceBefore}, requerido: ${amount}.`);
  }

  const senderBalanceAfter = setPlayerBalance(fromPlayerId, senderBalanceBefore - amount);
  adjustEscrowBalance(fromPlayerId, amount);

  const transferId = generateP2PId("TRF");
  const now = new Date().toISOString();

  const transfer = {
    transferId,
    fromPlayerId,
    fromName,
    toPlayerId,
    toName,
    amount,
    status: "PENDING_CONFIRMATION",
    note,
    createdAt: now,
    confirmedAt: null,
    cancelledAt: null,
    cancelReason: null
  };

  coinTransfers.unshift(transfer);
  persistCoinTransfers();

  addLedgerEntry({
    type: "COIN_TRANSFER_CREATED",
    status: "PENDING_CONFIRMATION",
    transferId,
    fromPlayerId,
    toPlayerId,
    amount,
    senderBalanceBefore,
    senderBalanceAfter,
    senderEscrowAfter: getEscrowBalance(fromPlayerId),
    note
  });

  return transfer;
}

function confirmCoinTransfer(transferId, input = {}) {
  const transfer = findCoinTransfer(transferId);

  if (!transfer) throw new Error("Transferencia no encontrada.");

  const status = String(transfer.status || "").toUpperCase();

  if (status === "CONFIRMED") {
    return transfer;
  }

  if (status !== "PENDING_CONFIRMATION") {
    throw new Error(`La transferencia no estÃ¡ pendiente. Estado actual: ${transfer.status}`);
  }

  const confirmingPlayerId = normalizePlayerId(input.confirmingPlayerId || input.fromPlayerId || input.playerId);

  if (confirmingPlayerId && confirmingPlayerId !== transfer.fromPlayerId) {
    throw new Error("Solo el emisor puede confirmar esta transferencia.");
  }

  const receiverBalanceBefore = getPlayerBalance(transfer.toPlayerId);
  const receiverBalanceAfter = setPlayerBalance(transfer.toPlayerId, receiverBalanceBefore + Number(transfer.amount || 0));

  adjustEscrowBalance(transfer.fromPlayerId, -Number(transfer.amount || 0));

  transfer.status = "CONFIRMED";
  transfer.confirmedAt = new Date().toISOString();

  persistCoinTransfers();

  addLedgerEntry({
    type: "COIN_TRANSFER_CONFIRMED",
    status: "CONFIRMED",
    transferId: transfer.transferId,
    fromPlayerId: transfer.fromPlayerId,
    toPlayerId: transfer.toPlayerId,
    amount: transfer.amount,
    receiverBalanceBefore,
    receiverBalanceAfter,
    senderEscrowAfter: getEscrowBalance(transfer.fromPlayerId)
  });

  return transfer;
}

function cancelCoinTransfer(transferId, input = {}) {
  const transfer = findCoinTransfer(transferId);

  if (!transfer) throw new Error("Transferencia no encontrada.");

  const status = String(transfer.status || "").toUpperCase();

  if (status === "CONFIRMED") {
    throw new Error("No se puede cancelar una transferencia confirmada.");
  }

  if (status === "CANCELLED") {
    return transfer;
  }

  if (status !== "PENDING_CONFIRMATION") {
    throw new Error(`La transferencia no estÃ¡ pendiente. Estado actual: ${transfer.status}`);
  }

  const cancellingPlayerId = normalizePlayerId(input.cancellingPlayerId || input.fromPlayerId || input.playerId);

  if (cancellingPlayerId && cancellingPlayerId !== transfer.fromPlayerId) {
    throw new Error("Solo el emisor puede cancelar esta transferencia.");
  }

  const senderBalanceBefore = getPlayerBalance(transfer.fromPlayerId);
  const senderBalanceAfter = setPlayerBalance(transfer.fromPlayerId, senderBalanceBefore + Number(transfer.amount || 0));

  adjustEscrowBalance(transfer.fromPlayerId, -Number(transfer.amount || 0));

  transfer.status = "CANCELLED";
  transfer.cancelledAt = new Date().toISOString();
  transfer.cancelReason = String(input.reason || input.note || "Cancelada").trim();

  persistCoinTransfers();

  addLedgerEntry({
    type: "COIN_TRANSFER_CANCELLED",
    status: "CANCELLED",
    transferId: transfer.transferId,
    fromPlayerId: transfer.fromPlayerId,
    toPlayerId: transfer.toPlayerId,
    amount: transfer.amount,
    senderBalanceBefore,
    senderBalanceAfter,
    senderEscrowAfter: getEscrowBalance(transfer.fromPlayerId),
    reason: transfer.cancelReason
  });

  return transfer;
}

function getCoinTransfersByPlayer(playerId) {
  const id = normalizePlayerId(playerId);

  return coinTransfers
    .filter((transfer) => transfer.fromPlayerId === id || transfer.toPlayerId === id)
    .map(publicCoinTransfer);
}

function getP2PAdminSummary() {
  const openOffers = p2pOffers.filter((offer) => ["OPEN", "PARTIAL"].includes(String(offer.status || "").toUpperCase())).length;
  const pendingTrades = p2pTrades.filter((trade) => String(trade.status || "").toUpperCase() === "PAYMENT_PENDING").length;
  const confirmedTrades = p2pTrades.filter((trade) => String(trade.status || "").toUpperCase() === "CONFIRMED").length;
  const escrowTotal = Object.values(userEscrow).reduce((sum, item) => sum + Number(item.p2pLocked || 0), 0);
  const usdtTotal = Object.values(userUsdtBalances).reduce((sum, item) => sum + Number(item.balance || 0), 0);

  return {
    openOffers,
    pendingTrades,
    confirmedTrades,
    escrowTotal,
    usdtTotal
  };
}


function loadWithdrawals() {
  try {
    const parsed = JSON.parse(fs.readFileSync(withdrawalsFile, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("No se pudo cargar withdrawals:", error.message);
    return [];
  }
}

function persistWithdrawals() {
  fs.writeFileSync(withdrawalsFile, JSON.stringify(withdrawals, null, 2), "utf8");
}

function generateWalletActionId(prefix) {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  return `${prefix}-${timestamp}-${random}`;
}

function getWalletSummary(playerId) {
  const id = normalizePlayerId(playerId);

  return {
    ok: true,
    playerId: id,
    coinBalance: getPlayerBalance(id),
    p2pEscrow: userEscrow[id] || { playerId: id, p2pLocked: 0 },
    usdtBalance: userUsdtBalances[id] || { playerId: id, balance: 0, token: "USDT" },
    activeOffers: p2pOffers.filter((offer) =>
      offer.sellerId === id &&
      ["OPEN", "PARTIAL", "TAKEN"].includes(String(offer.status || "").toUpperCase())
    ),
    activeTrades: p2pTrades.filter((trade) =>
      (trade.sellerId === id || trade.buyerId === id) &&
      ["PAYMENT_PENDING"].includes(String(trade.status || "").toUpperCase())
    ),
    deposits: depositOrders.filter((order) => order.playerId === id).slice(0, 20),
    withdrawals: withdrawals.filter((item) => item.playerId === id).slice(0, 20)
  };
}

function transferPlayerCoins(input) {
  const fromPlayerId = normalizePlayerId(input.fromPlayerId || input.senderId);
  const toPlayerId = normalizePlayerId(input.toPlayerId || input.receiverId);
  const amount = Number(input.amount || 0);
  const note = String(input.note || "").trim();

  if (!fromPlayerId) throw new Error("fromPlayerId es obligatorio.");
  if (!toPlayerId) throw new Error("toPlayerId es obligatorio.");
  if (fromPlayerId === toPlayerId) throw new Error("No puedes transferirte monedas a ti mismo.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("El monto debe ser mayor a 0.");

  const senderBalanceBefore = getPlayerBalance(fromPlayerId);

  if (senderBalanceBefore < amount) {
    throw new Error(`Balance insuficiente. Disponible: ${senderBalanceBefore}, requerido: ${amount}.`);
  }

  const receiverBalanceBefore = getPlayerBalance(toPlayerId);

  const transferId = generateWalletActionId("TRF");

  setPlayerBalance(fromPlayerId, senderBalanceBefore - amount);
  setPlayerBalance(toPlayerId, receiverBalanceBefore + amount);

  const transfer = {
    transferId,
    fromPlayerId,
    toPlayerId,
    amount,
    note,
    status: "CONFIRMED",
    createdAt: new Date().toISOString()
  };

  addLedgerEntry({
    type: "PLAYER_COIN_TRANSFER",
    status: "CONFIRMED",
    transferId,
    fromPlayerId,
    toPlayerId,
    amount,
    senderBalanceBefore,
    senderBalanceAfter: senderBalanceBefore - amount,
    receiverBalanceBefore,
    receiverBalanceAfter: receiverBalanceBefore + amount,
    note
  });

  return transfer;
}

function createWithdrawalRequest(input) {
  const playerId = normalizePlayerId(input.playerId);
  const amount = Number(input.amount || 0);
  const destinationAddress = String(input.destinationAddress || input.address || "").trim();
  const network = String(input.network || "BSC").trim().toUpperCase();
  const token = String(input.token || "USDT").trim().toUpperCase();
  const note = String(input.note || "").trim();

  if (!playerId) throw new Error("playerId es obligatorio.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("El monto debe ser mayor a 0.");
  if (!destinationAddress) throw new Error("La wallet destino es obligatoria.");
  if (token !== "USDT") throw new Error("Por ahora solo se permite retiro en USDT.");

  const balanceBefore = getUserUsdtBalance(playerId);

  if (balanceBefore < amount) {
    throw new Error(`Balance USDT insuficiente. Disponible: ${balanceBefore}, requerido: ${amount}.`);
  }

  const withdrawalId = generateWalletActionId("WDR");

  // Se descuenta al crear la solicitud para evitar doble retiro.
  const balanceAfter = adjustUserUsdtBalance(playerId, -amount).balance;

  const withdrawal = {
    withdrawalId,
    playerId,
    amount,
    network,
    token,
    destinationAddress,
    status: "PENDING",
    txHash: null,
    note,
    adminNote: "",
    createdAt: new Date().toISOString(),
    confirmedAt: null,
    rejectedAt: null
  };

  withdrawals.unshift(withdrawal);
  persistWithdrawals();

  addLedgerEntry({
    type: "USDT_WITHDRAWAL_REQUESTED",
    status: "PENDING",
    withdrawalId,
    playerId,
    amount,
    network,
    token,
    destinationAddress,
    balanceBefore,
    balanceAfter,
    note
  });

  return withdrawal;
}

function confirmWithdrawalRequest(withdrawalId, input = {}) {
  const withdrawal = withdrawals.find((item) => String(item.withdrawalId) === String(withdrawalId));

  if (!withdrawal) throw new Error("Solicitud de retiro no encontrada.");

  if (String(withdrawal.status || "").toUpperCase() === "CONFIRMED") {
    return withdrawal;
  }

  if (String(withdrawal.status || "").toUpperCase() !== "PENDING") {
    throw new Error(`La solicitud no estÃƒÂ¡ pendiente. Estado actual: ${withdrawal.status}`);
  }

  const txHash = String(input.txHash || "").trim();

  if (!txHash) {
    throw new Error("txHash es obligatorio para confirmar el retiro.");
  }

  withdrawal.status = "CONFIRMED";
  withdrawal.txHash = txHash;
  withdrawal.adminNote = String(input.adminNote || "").trim();
  withdrawal.confirmedAt = new Date().toISOString();

  persistWithdrawals();

  addLedgerEntry({
    type: "USDT_WITHDRAWAL_CONFIRMED",
    status: "CONFIRMED",
    withdrawalId: withdrawal.withdrawalId,
    playerId: withdrawal.playerId,
    amount: withdrawal.amount,
    network: withdrawal.network,
    token: withdrawal.token,
    destinationAddress: withdrawal.destinationAddress,
    txHash
  });

  return withdrawal;
}

function rejectWithdrawalRequest(withdrawalId, input = {}) {
  const withdrawal = withdrawals.find((item) => String(item.withdrawalId) === String(withdrawalId));

  if (!withdrawal) throw new Error("Solicitud de retiro no encontrada.");

  if (String(withdrawal.status || "").toUpperCase() === "CONFIRMED") {
    throw new Error("No se puede rechazar un retiro ya confirmado.");
  }

  if (String(withdrawal.status || "").toUpperCase() === "REJECTED") {
    return withdrawal;
  }

  // Devuelve el balance USDT al usuario.
  const balanceAfter = adjustUserUsdtBalance(withdrawal.playerId, Number(withdrawal.amount || 0)).balance;

  withdrawal.status = "REJECTED";
  withdrawal.adminNote = String(input.adminNote || "").trim();
  withdrawal.rejectedAt = new Date().toISOString();

  persistWithdrawals();

  addLedgerEntry({
    type: "USDT_WITHDRAWAL_REJECTED",
    status: "REJECTED",
    withdrawalId: withdrawal.withdrawalId,
    playerId: withdrawal.playerId,
    amount: withdrawal.amount,
    network: withdrawal.network,
    token: withdrawal.token,
    destinationAddress: withdrawal.destinationAddress,
    balanceAfter,
    adminNote: withdrawal.adminNote
  });

  return withdrawal;
}

function normalizePlayerId(playerId) {
  return String(playerId || "").trim();
}
function getPlayerBalance(playerId) {
  const id = normalizePlayerId(playerId);
  if (!id) return 0;

  const stored = Number(playerBalances[id]?.balance);
  if (Number.isFinite(stored)) return Math.max(0, Math.floor(stored));

  const initialBalance = Number.isFinite(DEFAULT_PLAYER_BALANCE) ? Math.max(0, Math.floor(DEFAULT_PLAYER_BALANCE)) : 0;
  playerBalances[id] = {
    playerId: id,
    balance: initialBalance,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  persistPlayerBalances();
  return initialBalance;
}
function setPlayerBalance(playerId, nextBalance) {
  const id = normalizePlayerId(playerId);
  if (!id) return 0;

  const balance = Math.max(0, Math.floor(Number(nextBalance || 0)));
  playerBalances[id] = {
    ...(playerBalances[id] || { playerId: id, createdAt: new Date().toISOString() }),
    playerId: id,
    balance,
    updatedAt: new Date().toISOString()
  };
  persistPlayerBalances();
  return balance;
}
function getPlayerBalancePayload(playerId) {
  const id = normalizePlayerId(playerId);
  return {
    ok: true,
    playerId: id,
    balance: getPlayerBalance(id),
    serverManaged: true
  };
}

function toNumber(value) { const n = Number(value); return Number.isFinite(n) ? n : NaN; }

function getHorseTotals() {
  return horses.map((horse) => {
    const horseBets = bets.filter((bet) => bet.horseId === horse.id);
    return {
      horseId: horse.id,
      name: horse.name,
      color: horse.color,
      totalAmount: horseBets.reduce((sum, bet) => sum + bet.amount, 0),
      totalBets: horseBets.length
    };
  });
}
function calculateOrderedResults() {
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
}

function getActiveHorseCount() {
  return getHorseTotals().filter((item) => item.totalBets > 0 && item.totalAmount > 0).length;
}

function calculateWinnersFromOrderedResults(results) {
  return results.slice(0, 3);
}

function getPayoutMultiplierByPosition(position) {
  if (Number(position) === 1) return PAYOUT_MULTIPLIERS.first;
  if (Number(position) === 2) return PAYOUT_MULTIPLIERS.second;
  if (Number(position) === 3) return PAYOUT_MULTIPLIERS.third;
  return 0;
}

function getPayoutMultiplierForHorse(horseId) {
  const winner = hiddenWinners.find((item) => Number(item.horseId) === Number(horseId));
  if (!winner) return 0;
  return getPayoutMultiplierByPosition(winner.position);
}

function calculateSettlements() {
  const cancelled = roundStatus === "CANCELLED";

  return bets.map((bet) => {
    const multiplier = cancelled ? 0 : getPayoutMultiplierForHorse(bet.horseId);
    const won = !cancelled && multiplier > 0;
    const payout = won ? Math.floor(bet.amount * multiplier) : 0;
    const refundAmount = cancelled ? bet.amount : 0;
    const balanceAfterBet = bet.balanceAfterBet;
    const finalBalance = balanceAfterBet + payout + refundAmount;

    return {
      raceNumber: roundId,
      roundId,
      betId: bet.id,
      playerId: bet.playerId,
      clientName: bet.clientName,
      horseId: bet.horseId,
      horseName: bet.horseName,
      amount: bet.amount,
      balanceBeforeBet: bet.balanceTotal,
      balanceApostado: bet.amount,
      balanceAfterBet,
      won,
      cancelled,
      refunded: cancelled,
      refundAmount,
      payout,
      finalBalance,
      multiplier,
      winners: hiddenWinners.map((winner) => ({
        position: winner.position,
        horseId: winner.horseId,
        multiplier: getPayoutMultiplierByPosition(winner.position)
      })),
      createdAt: new Date().toISOString()
    };
  });
}

function getPlayerSettlements(playerId) {
  return settlements.filter((settlement) => settlement.playerId === String(playerId));
}
function getPlayerResultPayload(playerId) {
  const playerSettlements = getPlayerSettlements(playerId);
  const totalPayout = playerSettlements.reduce((sum, item) => sum + item.payout, 0);
  const totalBetAmount = playerSettlements.reduce((sum, item) => sum + item.amount, 0);
  const won = playerSettlements.some((item) => item.won);
  let balanceBeforeBet = null;
  let balanceAfterBet = null;
  let finalBalance = null;
  if (playerSettlements.length > 0) {
    balanceBeforeBet = playerSettlements[0].balanceBeforeBet;
    balanceAfterBet = playerSettlements[playerSettlements.length - 1].balanceAfterBet;
    finalBalance = playerSettlements[playerSettlements.length - 1].finalBalance;
  }
  return {
    ok: true,
    raceNumber: roundId,
    roundId,
    playerId: String(playerId),
    won,
    totalBetAmount,
    totalPayout,
    payoutMultipliers: PAYOUT_MULTIPLIERS,
    roundStatus,
    roundCancelReason,
    minActiveHorsesRequired: 0,
    activeHorseCount: getActiveHorseCount(),
    balanceBeforeBet,
    balanceAfterBet,
    finalBalance,
    winners: hiddenWinners.map((winner) => ({ position: winner.position, horseId: winner.horseId, name: winner.name, color: winner.color })),
    settlements: playerSettlements.map((item) => ({
      betId: item.betId,
      horseId: item.horseId,
      horseName: item.horseName,
      amount: item.amount,
      balanceBeforeBet: item.balanceBeforeBet,
      balanceAfterBet: item.balanceAfterBet,
      won: item.won,
      payout: item.payout,
      finalBalance: item.finalBalance,
      multiplier: item.multiplier
    }))
  };
}
function getRoundFinancialSummary() {
  const totalAmountReceived = bets.reduce((sum, bet) => sum + bet.amount, 0);
  const totalPayout = settlements.reduce((sum, item) => sum + item.payout, 0);
  const totalRefunded = settlements.reduce((sum, item) => sum + (item.refundAmount || 0), 0);
  const houseRevenue = roundStatus === "CANCELLED" ? 0 : totalAmountReceived - totalPayout - totalRefunded;

  return {
    totalAmountReceived,
    totalPayout,
    totalRefunded,
    houseRevenue,
    houseResult: houseRevenue >= 0 ? "PROFIT" : "LOSS"
  };
}

function buildFullHistoryRecord() {
  const financial = getRoundFinancialSummary();

  if (roundStatus !== "CANCELLED") {
    applyCasinoRaceResult(roundId, financial.houseRevenue);
  }

  return {
    raceNumber: roundId,
    roundId,
    roundStatus,
    cancelReason: roundCancelReason,
    finishedAt: new Date().toISOString(),
    totalBetsReceived: bets.length,
    activeHorseCount: getActiveHorseCount(),
    minActiveHorsesRequired: 0,
    ...financial,
    payoutMultipliers: PAYOUT_MULTIPLIERS,
    roundStatus,
    roundCancelReason,
    minActiveHorsesRequired: 0,
    activeHorseCount: getActiveHorseCount(),
    orderedResults,
    winners: hiddenWinners.length ? hiddenWinners : winners,
    settlements,
    bets
  };
}

function saveRoundLogAndHistory() {
  const record = buildFullHistoryRecord();
  roundHistory.unshift(record);
  roundHistory = roundHistory.slice(0, 300);
  persistHistory();
  fs.writeFileSync(path.join(logsDir, `race-${roundId}.json`), JSON.stringify(record, null, 2), "utf8");
}
function getPublicHistory() {
  return roundHistory.map((race) => ({ raceNumber: race.raceNumber, winners: (race.winners || []).slice(0, 3).map((winner) => winner.horseId) }));
}
function getPublicState() {
  const publicWinners = phase === "RESULTS" ? winners.map((winner) => ({ position: winner.position, horseId: winner.horseId, name: winner.name, color: winner.color })) : [];
  return {
    ok: true,
    serverTime: Date.now(),
    roundId,
    raceNumber: roundId,
    phase,
    secondsRemaining,
    bettingSeconds: BETTING_SECONDS,
    raceSeconds: RACE_SECONDS,
    resultsSeconds: RESULTS_SECONDS,
    payoutpayoutMultipliers: PAYOUT_MULTIPLIERS,
    roundStatus,
    roundCancelReason,
    minActiveHorsesRequired: 0,
    activeHorseCount: getActiveHorseCount(),
    raceStartedAt,
    resultsStartedAt,
    horses,
    totalBetsReceived: bets.length,
    winners: publicWinners
  };
}
function getAdminState() {
  return {
    ...getPublicState(),
    admin: true,
    totals: getHorseTotals(),
    hiddenWinners,
    orderedResults,
    settlements,
    internalWinnersCalculated: hiddenWinners.length > 0,
    visibleWinnersInPwa: phase === "RESULTS" ? winners : [],
    currentBets: bets,
    history: roundHistory,
    playerBalances,
    casinoBalance,
    recentLedger: ledger.slice(0, 100)
  };
}
function broadcastState() { io.emit("game_state", getPublicState()); io.to("admin").emit("admin_state", getAdminState()); }
function closeBettingAndStartRace() {
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
}

function showResults() {
  phase = "RESULTS";
  secondsRemaining = RESULTS_SECONDS;
  resultsStartedAt = Date.now();
  winners = roundStatus === "CANCELLED" ? [] : hiddenWinners;
  settlements = calculateSettlements();

  settlements.forEach((settlement) => {
    setPlayerBalance(settlement.playerId, settlement.finalBalance);

    if (settlement.refunded) {
      addLedgerEntry({
        type: "BET_REFUNDED",
        status: "CONFIRMED",
        raceNumber: roundId,
        roundId,
        playerId: settlement.playerId,
        clientName: settlement.clientName,
        betId: settlement.betId,
        horseId: settlement.horseId,
        horseName: settlement.horseName,
        amount: settlement.refundAmount,
        balanceBefore: settlement.balanceAfterBet,
        balanceAfter: settlement.finalBalance,
        reason: roundCancelReason
      });
    } else if (settlement.won) {
      addLedgerEntry({
        type: "BET_WON",
        status: "CONFIRMED",
        raceNumber: roundId,
        roundId,
        playerId: settlement.playerId,
        clientName: settlement.clientName,
        betId: settlement.betId,
        horseId: settlement.horseId,
        horseName: settlement.horseName,
        amount: settlement.payout,
        multiplier: settlement.multiplier,
        balanceBefore: settlement.balanceAfterBet,
        balanceAfter: settlement.finalBalance
      });
    } else {
      addLedgerEntry({
        type: "BET_LOST",
        status: "CONFIRMED",
        raceNumber: roundId,
        roundId,
        playerId: settlement.playerId,
        clientName: settlement.clientName,
        betId: settlement.betId,
        horseId: settlement.horseId,
        horseName: settlement.horseName,
        amount: settlement.amount,
        balanceBefore: settlement.balanceAfterBet,
        balanceAfter: settlement.finalBalance
      });
    }
  });

  const financial = getRoundFinancialSummary();

  if (roundStatus !== "CANCELLED") {
    applyCasinoRaceResult(roundId, financial.houseRevenue);
  }

  addLedgerEntry({
    type: roundStatus === "CANCELLED" ? "RACE_CANCELLED" : "RACE_SETTLED",
    status: "CONFIRMED",
    raceNumber: roundId,
    roundId,
    amount: financial.totalAmountReceived,
    totalPayout: financial.totalPayout,
    totalRefunded: financial.totalRefunded,
    houseRevenue: financial.houseRevenue,
    houseResult: financial.houseResult,
    activeHorseCount: getActiveHorseCount(),
    winners: winners.map((winner) => ({
      position: winner.position,
      horseId: winner.horseId,
      multiplier: getPayoutMultiplierByPosition(winner.position)
    })),
    reason: roundCancelReason
  });

  if (roundStatus !== "CANCELLED") {
    addLedgerEntry({
      type: financial.houseRevenue >= 0 ? "HOUSE_REVENUE" : "HOUSE_LOSS",
      status: "CONFIRMED",
      raceNumber: roundId,
      roundId,
      amount: Math.abs(financial.houseRevenue),
      houseRevenue: financial.houseRevenue,
      totalAmountReceived: financial.totalAmountReceived,
      totalPayout: financial.totalPayout
    });
  }

  [...new Set(bets.map((bet) => bet.playerId))].forEach((playerId) => io.to(`player:${playerId}`).emit("player_result", getPlayerResultPayload(playerId)));
  broadcastState();
}

function startNewRound() {
  saveRoundLogAndHistory();
  roundId += 1;
  phase = "BETTING";
  secondsRemaining = BETTING_SECONDS;
  bets = [];
  winners = [];
  hiddenWinners = [];
  orderedResults = [];
  settlements = [];
  raceStartedAt = null;
  resultsStartedAt = null;
  roundStatus = "BETTING";
  roundCancelReason = null;
  broadcastState();
}
setInterval(() => {
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
}, 1000);

function registerBet({ playerId, horseId, amount, balanceTotal, balanceApostado, clientName }) {
  if (phase !== "BETTING") {
    const error = new Error("Las apuestas estÃƒÆ’Ã‚Â¡n cerradas. Hay una carrera en curso."); error.status = 403; throw error;
  }

  const id = normalizePlayerId(playerId);
  const betAmount = amount !== undefined ? toNumber(amount) : toNumber(balanceApostado);
  const clientReportedBalance = toNumber(balanceTotal);

  if (!id || !horseId || !Number.isFinite(betAmount)) {
    const error = new Error("Faltan datos: playerId, horseId o amount/balanceApostado."); error.status = 400; throw error;
  }
  if (betAmount <= 0) {
    const error = new Error("El balance apostado debe ser mayor que cero."); error.status = 400; throw error;
  }

  const horse = horses.find((h) => h.id === Number(horseId));
  if (!horse) { const error = new Error("Caballo no encontrado."); error.status = 404; throw error; }

  const alreadyBet = bets.some((bet) => bet.playerId === id);
  if (alreadyBet) { const error = new Error("Este jugador ya apostÃƒÆ’Ã‚Â³ en la carrera actual."); error.status = 409; throw error; }

  const balanceBeforeBet = getPlayerBalance(id);
  if (betAmount > balanceBeforeBet) {
    const error = new Error(`Saldo insuficiente. Disponible: ${balanceBeforeBet}. Apuesta: ${betAmount}.`); error.status = 403; throw error;
  }

  const balanceAfterBet = setPlayerBalance(id, balanceBeforeBet - betAmount);
  const bet = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
    roundId,
    raceNumber: roundId,
    playerId: id,
    clientName: clientName ? String(clientName) : "",
    horseId: horse.id,
    horseName: horse.name,
    amount: betAmount,
    balanceApostado: betAmount,
    balanceTotal: balanceBeforeBet,
    balanceBeforeBet,
    balanceAfterBet,
    clientReportedBalance: Number.isFinite(clientReportedBalance) ? clientReportedBalance : null,
    createdAt: new Date().toISOString()
  };
  bets.push(bet);

  addLedgerEntry({
    type: "BET_PLACED",
    status: "CONFIRMED",
    raceNumber: roundId,
    roundId,
    playerId: id,
    clientName: bet.clientName,
    betId: bet.id,
    horseId: bet.horseId,
    horseName: bet.horseName,
    amount: bet.amount,
    balanceBefore: balanceBeforeBet,
    balanceAfter: balanceAfterBet
  });

  broadcastState();
  return bet;
}

app.get("/", (req, res) => res.redirect("/admin.html"));
app.get("/api/state", (req, res) => res.json(getPublicState()));
app.get("/api/history", (req, res) => res.json({ ok: true, history: getPublicHistory() }));
app.get("/api/player/balance/:playerId", (req, res) => res.json(getPlayerBalancePayload(req.params.playerId)));
app.get("/api/player/result/:playerId", (req, res) => {
  if (phase !== "RESULTS") return res.json({ ok: true, raceNumber: roundId, playerId: String(req.params.playerId), available: false, message: "El resultado del jugador solo estÃƒÆ’Ã‚Â¡ disponible durante la fase RESULTS.", phase });
  res.json({ ...getPlayerResultPayload(req.params.playerId), available: true });
});

const ADMIN_TOKEN = String(process.env.HIPIPLAY_ADMIN_TOKEN || "").trim();
const TRANSFER_PASSKEY_SECRET_FILE = path.join(__dirname, ".secrets", "transfer-passkey-secret.txt");

function requireAdminToken(req, res, next) {
  const provided = String(req.get("x-admin-token") || "").trim();

  if (!ADMIN_TOKEN) {
    return res.status(503).json({
      ok: false,
      error: "ADMIN_TOKEN_NOT_CONFIGURED"
    });
  }

  if (!provided || provided !== ADMIN_TOKEN) {
    return res.status(401).json({
      ok: false,
      error: "UNAUTHORIZED_ADMIN_ENDPOINT"
    });
  }

  return next();
}


function readTransferPasskeySecret() {
  const envSecret = String(process.env.HIPIPLAY_TRANSFER_PASSKEY_SECRET || "").trim();

  if (envSecret) return envSecret;

  try {
    return fs.readFileSync(TRANSFER_PASSKEY_SECRET_FILE, "utf8").trim();
  } catch (error) {
    return "";
  }
}

const usedTransferPasskeyProofs = new Map();

function createTransferPasskeyProof(payload) {
  const secret = readTransferPasskeySecret();

  if (!secret) {
    throw new Error(
      "Validacion de huella no configurada."
    );
  }

  const encodedPayload = Buffer
    .from(
      JSON.stringify(payload),
      "utf8"
    )
    .toString("base64url");

  const signature = crypto
    .createHmac(
      "sha256",
      secret
    )
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

function getTransferPasskeyProofKey(proof) {
  return crypto
    .createHash("sha256")
    .update(String(proof || ""))
    .digest("hex");
}

function cleanupUsedTransferPasskeyProofs() {
  const now = Date.now();

  for (
    const [proofKey, expiresAt]
    of usedTransferPasskeyProofs.entries()
  ) {
    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= now
    ) {
      usedTransferPasskeyProofs.delete(
        proofKey
      );
    }
  }
}
function safeEqualString(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));

  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyTransferPasskeyProof(proof, expected) {
  const secret = readTransferPasskeySecret();

  if (!secret) {
    throw new Error("Validacion de huella no configurada.");
  }

  const rawProof = String(proof || "").trim();
  const parts = rawProof.split(".");

  if (parts.length !== 2) {
    throw new Error("Validacion de huella requerida.");
  }

  const encodedPayload = parts[0];
  const receivedSignature = parts[1];

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  if (!safeEqualString(receivedSignature, expectedSignature)) {
    throw new Error("La validacion de huella no es valida.");
  }

  let payload = null;

  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch (error) {
    throw new Error("La validacion de huella esta corrupta.");
  }

  if (!payload || payload.type !== "COIN_TRANSFER_PASSKEY") {
    throw new Error("La validacion de huella no corresponde a transferencias.");
  }

  if (expected.purpose && payload.purpose !== expected.purpose) {
    throw new Error("La validacion de huella no corresponde a esta accion.");
  }

  if (expected.playerId && String(payload.userId) !== String(expected.playerId)) {
    throw new Error("La huella no corresponde al usuario emisor.");
  }

  if (expected.transferId && String(payload.transferId) !== String(expected.transferId)) {
    throw new Error("La huella no corresponde a esta transferencia.");
  }

  if (expected.toPlayerId && String(payload.toPlayerId) !== String(expected.toPlayerId)) {
    throw new Error("La huella no corresponde al receptor.");
  }

  if (expected.amount && Number(payload.amount) !== Number(expected.amount)) {
    throw new Error("La huella no corresponde al monto.");
  }

  const expiresAt = new Date(payload.expiresAt || 0).getTime();

  if (!expiresAt || expiresAt < Date.now()) {
    throw new Error("La validacion de huella expiro.");
  }

  return payload;
}

app.use("/api/admin", requireAdminToken);

app.get("/api/admin/transfers/coins", (req, res) => {
  res.json({
    ok: true,
    transfers: coinTransfers.map(publicCoinTransfer)
  });
});

app.get("/api/admin/transfers/coins/player/:playerId", (req, res) => {
  const playerId = normalizePlayerId(req.params.playerId);

  res.json({
    ok: true,
    playerId,
    balance: getPlayerBalancePayload(playerId),
    escrow: userEscrow[playerId] || { playerId, p2pLocked: 0 },
    transfers: getCoinTransfersByPlayer(playerId)
  });
});

app.post("/api/admin/transfers/coins/create", (req, res) => {
  try {
    const transfer = createCoinTransfer(req.body || {});

    res.json({
      ok: true,
      transfer: publicCoinTransfer(transfer),
      fromBalance: getPlayerBalancePayload(transfer.fromPlayerId),
      toBalance: getPlayerBalancePayload(transfer.toPlayerId),
      fromEscrow: userEscrow[transfer.fromPlayerId] || null
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo crear la transferencia."
    });
  }
});

app.post("/api/admin/transfers/coins/:transferId/confirm", (req, res) => {
  try {
    const transfer = confirmCoinTransfer(req.params.transferId, req.body || {});

    res.json({
      ok: true,
      transfer: publicCoinTransfer(transfer),
      fromBalance: getPlayerBalancePayload(transfer.fromPlayerId),
      toBalance: getPlayerBalancePayload(transfer.toPlayerId),
      fromEscrow: userEscrow[transfer.fromPlayerId] || null
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo confirmar la transferencia."
    });
  }
});

app.post("/api/admin/transfers/coins/:transferId/cancel", (req, res) => {
  try {
    const transfer = cancelCoinTransfer(req.params.transferId, req.body || {});

    res.json({
      ok: true,
      transfer: publicCoinTransfer(transfer),
      fromBalance: getPlayerBalancePayload(transfer.fromPlayerId),
      toBalance: getPlayerBalancePayload(transfer.toPlayerId),
      fromEscrow: userEscrow[transfer.fromPlayerId] || null
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo cancelar la transferencia."
    });
  }
});

app.get("/api/admin/state", (req, res) => res.json(getAdminState()));
app.get("/api/admin/history", (req, res) => res.json({ ok: true, history: roundHistory }));
app.get("/api/admin/ledger", (req, res) => res.json({ ok: true, ledger }));

app.get("/api/admin/wallet-pool", (req, res) => {
  res.json({
    ok: true,
    summary: getWalletPoolSummary(),
    wallets: walletPool
  });
});

app.post("/api/admin/wallet-pool", requireAdminToken, (req, res) => {
  try {
    const wallet = addWalletToPool(req.body || {});

    addLedgerEntry({
      type: "WALLET_POOL_ADDED",
      status: "CONFIRMED",
      walletId: wallet.id,
      network: wallet.network,
      token: wallet.token,
      address: wallet.address
    });

    res.json({
      ok: true,
      wallet,
      summary: getWalletPoolSummary()
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo agregar la wallet al pool."
    });
  }
});

app.post("/api/player/deposit/request", (req, res) => {
  try {
    const order = createDepositOrder(req.body || {});
    res.json({ ok: true, order: publicDepositOrder(order) });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo crear la orden de depÃƒÂ³sito."
    });
  }
});

app.get("/api/player/deposit/:orderId", (req, res) => {
  const order = depositOrders.find((item) => String(item.orderId) === String(req.params.orderId));

  if (!order) {
    return res.status(404).json({ ok: false, error: "Orden no encontrada." });
  }

  res.json({ ok: true, order: publicDepositOrder(order) });
});

app.get("/api/admin/deposits", (req, res) => {
  res.json({
    ok: true,
    deposits: depositOrders,
    walletPoolSummary: getWalletPoolSummary()
  });
});

app.post("/api/admin/deposits/:orderId/confirm", requireAdminToken, (req, res) => {
  try {
    const order = confirmDepositOrder(req.params.orderId, req.body || {});

    res.json({
      ok: true,
      order,
      balance: getPlayerBalancePayload(order.playerId),
      walletPoolSummary: getWalletPoolSummary()
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo confirmar el depÃƒÂ³sito."
    });
  }
});

app.post("/api/admin/deposits/:orderId/reject", requireAdminToken, (req, res) => {
  try {
    const order = rejectDepositOrder(req.params.orderId, req.body || {});

    res.json({
      ok: true,
      order,
      walletPoolSummary: getWalletPoolSummary()
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo rechazar el depÃƒÂ³sito."
    });
  }
});

app.get("/api/admin/casino-balance", (req, res) => res.json({ ok: true, casinoBalance }));


const API_USERS_DB_FILE = process.env.HIPIPLAY_API_DB_FILE || "C:\\hipiplay-app\\apps\\api\\data\\db.json";

function loadRegisteredUsersForTransfers() {
  try {
    const raw = fs.readFileSync(API_USERS_DB_FILE, "utf8").replace(/^\uFEFF/, "").trim();

    if (!raw) return [];

    const db = JSON.parse(raw);
    return Array.isArray(db.users) ? db.users : [];
  } catch (error) {
    return [];
  }
}

function resolveRegisteredPlayerReference(value) {
  const reference = String(value || "").trim();

  if (!reference) return null;

  const demoUser =
    resolveDemoSessionReference(
      path.join(
        HIPI_AUTO_DATA_DIR,
        "demo-sessions.json"
      ),
      reference
    );

  if (demoUser) {
    return demoUser;
  }

  const users = loadRegisteredUsersForTransfers();
  const lowerReference = reference.toLowerCase();

  const user = users.find((item) => {
    const id = String(item.id || "").trim();
    const username = String(item.username || "").trim().toLowerCase();

    return id === reference || username === lowerReference;
  });

  if (!user || !user.id) return null;

  return {
    playerId: String(user.id).trim(),
    username: String(user.username || user.id).trim(),
    user
  };
}

app.get("/api/transfers/coins/player/:playerId", (req, res) => {
  try {
    const playerId = normalizePlayerId(req.params.playerId);

    if (!playerId) {
      return res.status(400).json({
        ok: false,
        error: "playerId es obligatorio."
      });
    }

    res.json({
      ok: true,
      playerId,
      balance: getPlayerBalancePayload(playerId),
      escrow: userEscrow[playerId] || { playerId, p2pLocked: 0 },
      transfers: getCoinTransfersByPlayer(playerId)
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudieron cargar las transferencias."
    });
  }
});


app.get("/api/transfers/coins/resolve-user", (req, res) => {
  try {
    const query = String(req.query.query || req.query.username || req.query.playerId || "").trim();
    const currentPlayerId = String(req.query.currentPlayerId || "").trim();

    if (!query) {
      return res.status(400).json({
        ok: false,
        exists: false,
        error: "Escribe el usuario destino."
      });
    }

    const resolved = resolveRegisteredPlayerReference(query);

    if (!resolved) {
      return res.status(404).json({
        ok: false,
        exists: false,
        error: "Usuario no encontrado."
      });
    }

    if (currentPlayerId && resolved.playerId === currentPlayerId) {
      return res.status(400).json({
        ok: false,
        exists: false,
        error: "No puedes transferirte monedas a ti mismo."
      });
    }

    return res.json({
      ok: true,
      exists: true,
      user: {
        playerId: resolved.playerId,
        username: resolved.username
      }
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      exists: false,
      error: error.message || "No se pudo validar el usuario."
    });
  }
});

app.post("/api/transfers/coins/complete", (req, res) => {
  try {
    const body = req.body || {};

    const rawFromPlayerRef =
      body.fromPlayerId ||
      body.playerId;

    const rawToPlayerRef =
      body.toPlayerId ||
      body.receiverId ||
      body.targetPlayerId;

    const resolvedFrom =
      resolveRegisteredPlayerReference(
        rawFromPlayerRef
      );

    const resolvedTo =
      resolveRegisteredPlayerReference(
        rawToPlayerRef
      );

    if (!resolvedFrom) {
      throw new Error(
        "El usuario emisor no existe."
      );
    }

    if (!resolvedTo) {
      throw new Error(
        "El usuario destino no existe."
      );
    }

    const fromPlayerId =
      resolvedFrom.playerId;

    const toPlayerId =
      resolvedTo.playerId;

    const amount =
      Math.floor(
        Number(body.amount || 0)
      );

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      throw new Error(
        "La cantidad de monedas no es vÃ¡lida."
      );
    }

    if (fromPlayerId === toPlayerId) {
      throw new Error(
        "No puedes transferirte monedas a ti mismo."
      );
    }

    const passkeyProof =
      String(
        body.passkeyProof ||
        body.biometricProof ||
        ""
      ).trim();

    cleanupUsedTransferPasskeyProofs();

    const proofKey =
      getTransferPasskeyProofKey(
        passkeyProof
      );

    if (
      usedTransferPasskeyProofs.has(
        proofKey
      )
    ) {
      throw new Error(
        "Esta validaciÃ³n de huella ya fue utilizada."
      );
    }

    const verifiedProof =
      verifyTransferPasskeyProof(
        passkeyProof,
        {
          purpose:
            "COIN_TRANSFER_COMPLETE",

          playerId:
            fromPlayerId,

          toPlayerId:
            toPlayerId,

          amount
        }
      );

    const transfer =
      transferPlayerCoins({
        fromPlayerId,
        toPlayerId,
        amount,

        note:
          String(
            body.note ||
            "Transferencia entre usuarios"
          ).trim()
      });

    const proofExpiresAt =
      new Date(
        verifiedProof.expiresAt
      ).getTime();

    usedTransferPasskeyProofs.set(
      proofKey,
      proofExpiresAt
    );

    return res.json({
      ok: true,
      transfer,
      fromUser: {
        playerId: fromPlayerId,
        username:
          resolvedFrom.username
      },
      toUser: {
        playerId: toPlayerId,
        username:
          resolvedTo.username
      },
      fromBalance:
        getPlayerBalancePayload(
          fromPlayerId
        ),
      toBalance:
        getPlayerBalancePayload(
          toPlayerId
        )
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error:
        error.message ||
        "No se pudo completar la transferencia."
    });
  }
});
app.post("/api/transfers/coins/create", (req, res) => {
  try {
    const body = req.body || {};

    const rawFromPlayerRef = body.fromPlayerId || body.playerId;
    const rawToPlayerRef = body.toPlayerId || body.receiverId || body.targetPlayerId;

    const resolvedFrom = resolveRegisteredPlayerReference(rawFromPlayerRef);
    const resolvedTo = resolveRegisteredPlayerReference(rawToPlayerRef);

    if (!resolvedFrom) {
      throw new Error("Usuario emisor no existe o no esta registrado.");
    }

    if (!resolvedTo) {
      throw new Error("Usuario destino no existe. Verifica el nombre antes de transferir.");
    }

    const fromPlayerId = resolvedFrom.playerId;
    const toPlayerId = resolvedTo.playerId;
    const amount = Number(body.amount || 0);

    if (!fromPlayerId) throw new Error("fromPlayerId es obligatorio.");
    if (!toPlayerId) throw new Error("toPlayerId es obligatorio.");

    const passkeyProof = String(body.passkeyProof || body.biometricProof || "").trim();

    verifyTransferPasskeyProof(passkeyProof, {
      purpose: "COIN_TRANSFER_CREATE",
      playerId: fromPlayerId,
      toPlayerId: String(rawToPlayerRef || "").trim(),
      amount
    });

    const transfer = createCoinTransfer({
      ...body,
      fromPlayerId,
      fromName: resolvedFrom.username,
      toPlayerId,
      toName: resolvedTo.username
    });

    res.json({
      ok: true,
      transfer: publicCoinTransfer(transfer),
      fromBalance: getPlayerBalancePayload(transfer.fromPlayerId),
      toBalance: getPlayerBalancePayload(transfer.toPlayerId),
      fromEscrow: userEscrow[transfer.fromPlayerId] || null
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo crear la transferencia."
    });
  }
});

app.post("/api/transfers/coins/:transferId/confirm", (req, res) => {
  try {
    const body = req.body || {};
    const confirmingPlayerId = normalizePlayerId(body.confirmingPlayerId || body.fromPlayerId || body.playerId);

    const paymentReceived =
      body.paymentReceived === true ||
      body.confirmPaymentReceived === true;

    const confirmationText = String(body.confirmationText || body.confirmationStep || "").trim().toUpperCase();

    if (!paymentReceived || confirmationText !== "PAGO_RECIBIDO") {
      throw new Error('Debes presionar "Pago recibido" y luego confirmar con "Â¿EstÃ¡s seguro?" antes de completar la transferencia.');
    }

    const pendingTransfer = findCoinTransfer(req.params.transferId);

    if (!pendingTransfer) {
      throw new Error("Transferencia no encontrada.");
    }

    const passkeyProof = String(body.passkeyProof || body.biometricProof || "").trim();

    verifyTransferPasskeyProof(passkeyProof, {
      purpose: "COIN_TRANSFER_CONFIRM",
      playerId: pendingTransfer.fromPlayerId,
      transferId: req.params.transferId
    });

    const transfer = confirmCoinTransfer(req.params.transferId, {
      ...body,
      confirmingPlayerId
    });

    res.json({
      ok: true,
      transfer: publicCoinTransfer(transfer),
      fromBalance: getPlayerBalancePayload(transfer.fromPlayerId),
      toBalance: getPlayerBalancePayload(transfer.toPlayerId),
      fromEscrow: userEscrow[transfer.fromPlayerId] || null
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo confirmar la transferencia."
    });
  }
});

app.post("/api/transfers/coins/:transferId/cancel", (req, res) => {
  try {
    const body = req.body || {};
    const cancellingPlayerId = normalizePlayerId(body.cancellingPlayerId || body.fromPlayerId || body.playerId);

    const transfer = cancelCoinTransfer(req.params.transferId, {
      ...body,
      cancellingPlayerId
    });

    res.json({
      ok: true,
      transfer: publicCoinTransfer(transfer),
      fromBalance: getPlayerBalancePayload(transfer.fromPlayerId),
      toBalance: getPlayerBalancePayload(transfer.toPlayerId),
      fromEscrow: userEscrow[transfer.fromPlayerId] || null
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo cancelar la transferencia."
    });
  }
});

app.post("/api/bet", (req, res) => {
  try {
    const bet = registerBet(req.body);
    res.json({
      ok: true,
      message: "Apuesta registrada correctamente.",
      bet: {
        id: bet.id,
        raceNumber: bet.raceNumber,
        playerId: bet.playerId,
        horseId: bet.horseId,
        horseName: bet.horseName,
        balanceApostado: bet.balanceApostado,
        balanceTotal: bet.balanceTotal,
        balanceBeforeBet: bet.balanceBeforeBet,
        balanceAfterBet: bet.balanceAfterBet,
        serverBalance: bet.balanceAfterBet
      },
      state: getPublicState()
    });
  } catch (error) { res.status(error.status || 500).json({ ok: false, error: error.message }); }
});

app.post("/api/admin/player/balance", (req, res) => {
  try {
    const playerId =
      normalizePlayerId(req.body?.playerId);

    const balance =
      Math.floor(
        toNumber(req.body?.balance)
      );

    if (
      !playerId ||
      !Number.isFinite(balance) ||
      balance < 0
    ) {
      return res.status(400).json({
        ok: false,
        error: "Debe enviar playerId y balance válido."
      });
    }

    const beforeAccount =
      dualBalanceService.getAccount(playerId);

    const previousDualBalance =
      Number(beforeAccount.totalBalance || 0);

    const difference =
      balance - previousDualBalance;

    const referenceId =
      `ADMIN_BALANCE:${playerId}:${Date.now()}`;

    let operation = "NO_CHANGE";
    let ledgerEntry = null;

    if (difference > 0) {
      const credit =
        dualBalanceService.creditComposition(
          playerId,
          {
            promoAmount: 0,
            purchasedAmount: difference
          },
          {
            type: "ADMIN_BALANCE_CREDIT",
            referenceId,
            metadata: {
              previousBalance: previousDualBalance,
              targetBalance: balance,
              source: "ADMIN_BALANCE_PANEL"
            }
          }
        );

      operation = "CREDIT";
      ledgerEntry = credit.ledgerEntry;
    }
    else if (difference < 0) {
      const debit =
        dualBalanceService.debitForSpend(
          playerId,
          Math.abs(difference),
          {
            type: "ADMIN_BALANCE_DEBIT",
            promoFirst: true,
            referenceId,
            metadata: {
              previousBalance: previousDualBalance,
              targetBalance: balance,
              source: "ADMIN_BALANCE_PANEL"
            }
          }
        );

      operation = "DEBIT";
      ledgerEntry = debit.ledgerEntry;
    }

    const account =
      dualBalanceService.getAccount(playerId);

    const savedBalance =
      setPlayerBalance(
        playerId,
        Number(account.totalBalance)
      );

    if (
      Number(savedBalance) !==
      Number(account.totalBalance)
    ) {
      throw new Error(
        `ADMIN_BALANCE_MIRROR_FAILED for ${playerId}. Legacy: ${savedBalance}. Dual: ${account.totalBalance}.`
      );
    }

    res.json({
      ok: true,
      playerId,
      balance: savedBalance,
      legacyBalance: savedBalance,
      dualBalance: account.totalBalance,
      promoBalance: account.promoBalance,
      purchasedBalance: account.purchasedBalance,
      adjustment: Math.abs(difference),
      operation,
      account,
      ledgerEntry,
      serverManaged: true
    });
  }
  catch (error) {
    res.status(error.status || 500).json({
      ok: false,
      error: error.message
    });
  }
});
app.post("/api/admin/reset", (req, res) => {
  roundId += 1;
  phase = "BETTING";
  secondsRemaining = BETTING_SECONDS;
  bets = [];
  winners = [];
  hiddenWinners = [];
  orderedResults = [];
  settlements = [];
  raceStartedAt = null;
  resultsStartedAt = null;
  roundStatus = "BETTING";
  roundCancelReason = null;
  broadcastState();
  res.json({ ok: true, message: "Ronda reiniciada manualmente.", state: getAdminState() });
});

app.use("/pwa", express.static(PWA_DIST_PATH));

app.use("/race-images", express.static(path.join(PWA_DIST_PATH, "race-images")));
app.get("/race-waith.png", (req, res) => {
  res.sendFile(path.join(PWA_DIST_PATH, "race-waith.png"));
});

app.use("/icons", express.static(path.join(PWA_DIST_PATH, "icons")));

app.get("/sw.js", (req, res) => {
  res.sendFile(path.join(PWA_DIST_PATH, "sw.js"));
});

app.get("/manifest.webmanifest", (req, res) => {
  res.sendFile(path.join(PWA_DIST_PATH, "manifest.webmanifest"));
});

app.get(/^\/pwa(\/.*)?$/, (req, res) => {
  res.sendFile(path.join(PWA_DIST_PATH, "index.html"));
});

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);
  socket.emit("game_state", getPublicState());
  socket.on("admin_join", () => { socket.join("admin"); socket.emit("admin_state", getAdminState()); });
  socket.on("player_join", (data) => {
    if (!data || !data.playerId) return socket.emit("player_join_error", { ok: false, error: "Falta playerId." });
    const playerId = String(data.playerId);
    socket.join(`player:${playerId}`);
    socket.emit("player_joined", { ok: true, playerId, state: getPublicState() });
    if (phase === "RESULTS") socket.emit("player_result", getPlayerResultPayload(playerId));
  });
  socket.on("place_bet", (data) => {
    try {
      const bet = registerBet(data);
      if (data && data.playerId) socket.join(`player:${String(data.playerId)}`);
      socket.emit("bet_success", {
        ok: true,
        message: "Apuesta registrada correctamente.",
        bet: { id: bet.id, raceNumber: bet.raceNumber, playerId: bet.playerId, horseId: bet.horseId, horseName: bet.horseName, balanceApostado: bet.balanceApostado, balanceTotal: bet.balanceTotal, balanceAfterBet: bet.balanceAfterBet },
        state: getPublicState()
      });
    } catch (error) { socket.emit("bet_error", { ok: false, error: error.message }); }
  });
  socket.on("get_state", () => socket.emit("game_state", getPublicState()));
  socket.on("get_admin_state", () => socket.emit("admin_state", getAdminState()));
  socket.on("get_public_history", () => socket.emit("public_history", { ok: true, history: getPublicHistory() }));
  socket.on("get_player_result", (data) => {
    if (!data || !data.playerId) return socket.emit("player_result_error", { ok: false, error: "Falta playerId." });
    if (phase !== "RESULTS") return socket.emit("player_result", { ok: true, available: false, playerId: String(data.playerId), phase, message: "Resultado no disponible todavÃƒÆ’Ã‚Â­a." });
    socket.emit("player_result", { ...getPlayerResultPayload(data.playerId), available: true });
  });
  socket.on("disconnect", () => console.log("Cliente desconectado:", socket.id));
});


app.get("/api/p2p/offers", (req, res) => {
  res.json({
    ok: true,
    offers: getOpenP2POffers()
  });
});

app.post("/api/p2p/offers/create", (req, res) => {
  try {
    const offer = createP2POffer(req.body || {});

    res.json({
      ok: true,
      offer: publicP2POffer(offer),
      balance: getPlayerBalancePayload(offer.sellerId),
      escrow: userEscrow[offer.sellerId] || null
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo crear la oferta P2P."
    });
  }
});

app.post("/api/p2p/offers/:offerId/cancel", (req, res) => {
  try {
    const offer = cancelP2POffer(req.params.offerId, req.body || {});

    res.json({
      ok: true,
      offer: publicP2POffer(offer),
      balance: getPlayerBalancePayload(offer.sellerId),
      escrow: userEscrow[offer.sellerId] || null
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo cancelar la oferta P2P."
    });
  }
});

app.post("/api/p2p/offers/:offerId/take", (req, res) => {
  try {
    const trade = takeP2POffer(req.params.offerId, req.body || {});

    res.json({
      ok: true,
      trade: publicP2PTrade(trade)
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo tomar la oferta P2P."
    });
  }
});

app.get("/api/p2p/trades/:tradeId", (req, res) => {
  const trade = p2pTrades.find((item) => String(item.tradeId) === String(req.params.tradeId));

  if (!trade) {
    return res.status(404).json({
      ok: false,
      error: "Trade no encontrado."
    });
  }

  res.json({
    ok: true,
    trade: publicP2PTrade(trade)
  });
});

app.get("/api/p2p/my-trades/:playerId", (req, res) => {
  const playerId = normalizePlayerId(req.params.playerId);

  const trades = p2pTrades
    .filter((trade) => trade.sellerId === playerId || trade.buyerId === playerId)
    .map(publicP2PTrade);

  const offers = p2pOffers
    .filter((offer) => offer.sellerId === playerId)
    .map(publicP2POffer);

  res.json({
    ok: true,
    playerId,
    balance: getPlayerBalancePayload(playerId),
    escrow: userEscrow[playerId] || { playerId, p2pLocked: 0 },
    usdtBalance: userUsdtBalances[playerId] || { playerId, balance: 0, token: "USDT" },
    offers,
    trades
  });
});

app.get("/api/admin/p2p/offers", (req, res) => {
  res.json({
    ok: true,
    summary: getP2PAdminSummary(),
    offers: p2pOffers
  });
});

app.get("/api/admin/p2p/trades", (req, res) => {
  res.json({
    ok: true,
    summary: getP2PAdminSummary(),
    trades: p2pTrades
  });
});

app.get("/api/admin/p2p/escrow", (req, res) => {
  res.json({
    ok: true,
    escrow: userEscrow
  });
});

app.get("/api/admin/p2p/usdt-balances", (req, res) => {
  res.json({
    ok: true,
    usdtBalances: userUsdtBalances
  });
});

app.post("/api/admin/p2p/trades/:tradeId/confirm", (req, res) => {
  try {
    const trade = confirmP2PTradePayment(req.params.tradeId, req.body || {});

    res.json({
      ok: true,
      trade: publicP2PTrade(trade),
      buyerBalance: getPlayerBalancePayload(trade.buyerId),
      sellerEscrow: userEscrow[trade.sellerId] || null,
      sellerUsdtBalance: userUsdtBalances[trade.sellerId] || null
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo confirmar el trade P2P."
    });
  }
});

app.post("/api/admin/p2p/trades/:tradeId/cancel", (req, res) => {
  try {
    const trade = cancelP2PTrade(req.params.tradeId, req.body || {});

    res.json({
      ok: true,
      trade: publicP2PTrade(trade)
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo cancelar el trade P2P."
    });
  }
});


app.get("/api/wallet/summary/:playerId", (req, res) => {
  try {
    res.json(getWalletSummary(req.params.playerId));
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo consultar la wallet."
    });
  }
});

app.post("/api/wallet/transfer", (req, res) => {
  try {
    const transfer = transferPlayerCoins(req.body || {});

    res.json({
      ok: true,
      transfer,
      fromBalance: getPlayerBalancePayload(transfer.fromPlayerId),
      toBalance: getPlayerBalancePayload(transfer.toPlayerId)
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo realizar la transferencia."
    });
  }
});

app.post("/api/wallet/withdraw/request", (req, res) => {
  try {
    const withdrawal = createWithdrawalRequest(req.body || {});

    res.json({
      ok: true,
      withdrawal,
      wallet: getWalletSummary(withdrawal.playerId)
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo crear la solicitud de retiro."
    });
  }
});

app.get("/api/wallet/withdrawals/:playerId", (req, res) => {
  const playerId = normalizePlayerId(req.params.playerId);

  res.json({
    ok: true,
    playerId,
    withdrawals: withdrawals.filter((item) => item.playerId === playerId)
  });
});

app.get("/api/admin/withdrawals", (req, res) => {
  res.json({
    ok: true,
    withdrawals
  });
});

app.post("/api/admin/withdrawals/:withdrawalId/confirm", requireAdminToken, (req, res) => {
  try {
    const withdrawal = confirmWithdrawalRequest(req.params.withdrawalId, req.body || {});

    res.json({
      ok: true,
      withdrawal,
      wallet: getWalletSummary(withdrawal.playerId)
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo confirmar el retiro."
    });
  }
});

app.post("/api/admin/withdrawals/:withdrawalId/reject", requireAdminToken, (req, res) => {
  try {
    const withdrawal = rejectWithdrawalRequest(req.params.withdrawalId, req.body || {});

    res.json({
      ok: true,
      withdrawal,
      wallet: getWalletSummary(withdrawal.playerId)
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "No se pudo rechazar el retiro."
    });
  }
});

// HIPIPLAY DUAL BALANCE SHADOW - START
const dualBalanceService =
  require('./dual-balance-service')({
    dataDir: HIPI_AUTO_DATA_DIR,
    welcomePromoAmount: 1000
  });

// HIPIPLAY DUAL BETTING V2 - START
function hipiDualFindLedgerEntry(
  playerId,
  referenceId,
  direction = null
) {
  const entries =
    dualBalanceService.getLedger(
      playerId
    );

  return (
    entries.find(entry =>
      String(
        entry.referenceId || ''
      ) === String(referenceId) &&
      (
        !direction ||
        String(
          entry.direction || ''
        ).toUpperCase() ===
        String(direction).toUpperCase()
      )
    ) || null
  );
}

function hipiDualAssertLegacyMirror(
  playerId
) {
  const account =
    dualBalanceService.getAccount(
      playerId
    );

  const legacyBalance =
    Number(
      getPlayerBalance(
        playerId
      )
    );

  if (
    legacyBalance !==
    Number(account.totalBalance)
  ) {
    throw new Error(
      `DUAL_BALANCE_MISMATCH for ${playerId}. Legacy: ${legacyBalance}. Dual: ${account.totalBalance}.`
    );
  }

  return account;
}

function hipiDualReserveAutoBet({
  playerId,
  amount,
  roundId,
  jugadaId
}) {
  const id =
    String(
      playerId || ''
    ).trim();

  const cleanAmount =
    Math.max(
      0,
      Math.floor(
        Number(
          amount || 0
        )
      )
    );

  if (!id) {
    throw new Error(
      'Dual betting: playerId is required.'
    );
  }

  if (cleanAmount <= 0) {
    throw new Error(
      'Dual betting: amount must be greater than zero.'
    );
  }

  const referenceId =
    `BET_STAKE:${roundId}:${id}`;

  const existingEntry =
    hipiDualFindLedgerEntry(
      id,
      referenceId,
      'DEBIT'
    );

  if (existingEntry) {
    const account =
      dualBalanceService.getAccount(
        id
      );

    setPlayerBalance(
      id,
      account.totalBalance
    );

    return {
      reused: true,
      referenceId,
      balanceBefore:
        Number(
          existingEntry.balanceBefore
            ?.totalBalance ??
          existingEntry.balanceBefore
            ?.balance ??
          account.totalBalance +
            cleanAmount
        ),
      amount:
        Number(
          existingEntry.amount ||
          cleanAmount
        ),
      composition:
        existingEntry.composition,
      ledgerEntry:
        existingEntry,
      account
    };
  }

  const before =
    hipiDualAssertLegacyMirror(
      id
    );

  const debit =
    dualBalanceService.debitForSpend(
      id,
      cleanAmount,
      {
        type:
          'BET_STAKE_RESERVED',
        promoFirst:
          true,
        referenceId,
        metadata: {
          roundId,
          jugadaId
        }
      }
    );

  const legacyAfter =
    setPlayerBalance(
      id,
      debit.account.totalBalance
    );

  if (
    Number(legacyAfter) !==
    Number(
      debit.account.totalBalance
    )
  ) {
    throw new Error(
      'Dual betting: legacy mirror could not be synchronized after reservation.'
    );
  }

  return {
    reused: false,
    referenceId,
    balanceBefore:
      before.totalBalance,
    ...debit
  };
}

function hipiDualGetStakeComposition(
  bet
) {
  const amount =
    Math.max(
      0,
      Math.floor(
        Number(
          bet?.amount || 0
        )
      )
    );

  const promoAmount =
    Math.max(
      0,
      Math.floor(
        Number(
          bet?.dualStakeComposition
            ?.promoAmount || 0
        )
      )
    );

  const purchasedAmount =
    Math.max(
      0,
      Math.floor(
        Number(
          bet?.dualStakeComposition
            ?.purchasedAmount || 0
        )
      )
    );

  if (
    amount <= 0 ||
    promoAmount +
      purchasedAmount !==
      amount
  ) {
    throw new Error(
      `Dual betting: invalid or missing stake composition for bet ${bet?.id || bet?.betId || 'UNKNOWN'}.`
    );
  }

  return {
    promoAmount,
    purchasedAmount
  };
}

function hipiDualBuildPayoutComposition(
  bet,
  payout
) {
  const stake =
    hipiDualGetStakeComposition(
      bet
    );

  const stakeTotal =
    stake.promoAmount +
    stake.purchasedAmount;

  const cleanPayout =
    Math.max(
      0,
      Math.floor(
        Number(
          payout || 0
        )
      )
    );

  if (cleanPayout <= 0) {
    return {
      promoAmount: 0,
      purchasedAmount: 0
    };
  }

  const promoAmount =
    Math.floor(
      cleanPayout *
      stake.promoAmount /
      stakeTotal
    );

  return {
    promoAmount,
    purchasedAmount:
      cleanPayout -
      promoAmount
  };
}

function hipiDualSettleAutoBet({
  bet,
  payout,
  won,
  state
}) {
  if (
    !bet ||
    !bet.playerId
  ) {
    throw new Error(
      'Dual betting: invalid bet for settlement.'
    );
  }

  if (
    bet.dualSettlement &&
    bet.dualSettlement.status ===
      'SETTLED'
  ) {
    const existingAccount =
      dualBalanceService.getAccount(
        bet.playerId
      );

    setPlayerBalance(
      bet.playerId,
      existingAccount.totalBalance
    );

    return {
      reused: true,
      finalBalance:
        existingAccount.totalBalance,
      settlement:
        bet.dualSettlement
    };
  }

  const roundId =
    Number(
      state?.roundId ??
      bet.roundId
    );

  const cleanPayout =
    Math.max(
      0,
      Math.floor(
        Number(
          payout || 0
        )
      )
    );

  const referenceId =
    `BET_PAYOUT:${roundId}:${bet.playerId}`;

  let ledgerEntry =
    null;

  let payoutComposition = {
    promoAmount: 0,
    purchasedAmount: 0
  };

  let account =
    dualBalanceService.getAccount(
      bet.playerId
    );

  if (cleanPayout > 0) {
    payoutComposition =
      hipiDualBuildPayoutComposition(
        bet,
        cleanPayout
      );

    ledgerEntry =
      hipiDualFindLedgerEntry(
        bet.playerId,
        referenceId,
        'CREDIT'
      );

    if (!ledgerEntry) {
      const credit =
        dualBalanceService.creditComposition(
          bet.playerId,
          payoutComposition,
          {
            type:
              'BET_PAYOUT',
            referenceId,
            metadata: {
              betId:
                bet.id ||
                bet.betId,
              roundId,
              won:
                Boolean(won),
              multiplier:
                Number(
                  bet.multiplier || 0
                )
            }
          }
        );

      ledgerEntry =
        credit.ledgerEntry;

      account =
        credit.account;
    } else {
      account =
        dualBalanceService.getAccount(
          bet.playerId
        );
    }
  }

  const legacyAfter =
    setPlayerBalance(
      bet.playerId,
      account.totalBalance
    );

  if (
    Number(legacyAfter) !==
    Number(account.totalBalance)
  ) {
    throw new Error(
      'Dual betting: legacy mirror could not be synchronized after settlement.'
    );
  }

  bet.dualSettlement = {
    status:
      'SETTLED',
    referenceId:
      cleanPayout > 0
        ? referenceId
        : null,
    ledgerEntryId:
      ledgerEntry
        ? ledgerEntry.id
        : null,
    payout:
      cleanPayout,
    payoutComposition,
    settledAt:
      new Date().toISOString()
  };

  return {
    reused:
      Boolean(ledgerEntry) &&
      String(
        ledgerEntry.referenceId || ''
      ) === referenceId,
    finalBalance:
      account.totalBalance,
    settlement:
      bet.dualSettlement
  };
}
// HIPIPLAY DUAL BETTING V2 - END
function getDualBalanceComparison() {
  const dualAccounts =
    dualBalanceService.listAccounts();

  const dualByPlayer =
    new Map(
      dualAccounts.map(
        account => [
          account.playerId,
          account
        ]
      )
    );

  const legacyIds =
    Object.keys(
      playerBalances || {}
    );

  const playerIds =
    Array.from(
      new Set([
        ...legacyIds,
        ...dualAccounts.map(
          account =>
            account.playerId
        )
      ])
    );

  const comparisons =
    playerIds.map(
      playerId => {
        const legacyBalance =
          Number(
            playerBalances?.[playerId]?.balance ??
            0
          );

        const dualAccount =
          dualByPlayer.get(
            playerId
          ) || null;

        const dualBalance =
          Number(
            dualAccount?.totalBalance ??
            0
          );

        return {
          playerId,
          legacyBalance:
            Number.isFinite(legacyBalance)
              ? legacyBalance
              : 0,
          dualBalance:
            Number.isFinite(dualBalance)
              ? dualBalance
              : 0,
          matches:
            Number(legacyBalance || 0) ===
            Number(dualBalance || 0)
        };
      }
    );

  const legacyTotal =
    comparisons.reduce(
      (sum, item) =>
        sum +
        Number(
          item.legacyBalance || 0
        ),
      0
    );

  const promoTotal =
    dualAccounts.reduce(
      (sum, account) =>
        sum +
        Number(
          account.promoBalance || 0
        ),
      0
    );

  const purchasedTotal =
    dualAccounts.reduce(
      (sum, account) =>
        sum +
        Number(
          account.purchasedBalance || 0
        ),
      0
    );

  const mismatches =
    comparisons.filter(
      item =>
        !item.matches
    );

  return {
    mode: 'SHADOW',
    legacyUsers:
      legacyIds.length,
    dualUsers:
      dualAccounts.length,
    legacyTotal,
    promoTotal,
    purchasedTotal,
    dualTotal:
      promoTotal +
      purchasedTotal,
    mismatchCount:
      mismatches.length,
    mismatches
  };
}

app.get(
  '/api/admin/dual-balance/summary',
  (req, res) => {
    res.set(
      'Cache-Control',
      'no-store'
    );

    res.json({
      ok: true,
      accounting:
        getDualBalanceComparison()
    });
  }
);

app.get(
  '/api/admin/dual-balance/accounts',
  (req, res) => {
    res.set(
      'Cache-Control',
      'no-store'
    );

    res.json({
      ok: true,
      mode: 'SHADOW',
      accounts:
        dualBalanceService.listAccounts()
    });
  }
);

app.get(
  '/api/admin/dual-balance/player/:playerId',
  (req, res) => {
    try {
      res.set(
        'Cache-Control',
        'no-store'
      );

      res.json({
        ok: true,
        mode: 'SHADOW',
        account:
          dualBalanceService.getAccount(
            req.params.playerId
          ),
        ledger:
          dualBalanceService.getLedger(
            req.params.playerId
          )
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error:
          error.message ||
          'Could not read dual balance.'
      });
    }
  }
);
// HIPIPLAY DUAL BALANCE SHADOW - END
const demoProfileService =
  require('./demo-profile-service')({
    dataDir: HIPI_AUTO_DATA_DIR,
    getPlayerBalance
  });

demoProfileService.registerRoutes(app);

// HIPIPLAY ETHEREUM SEPOLIA DEPOSITS - START
const ethereumSepoliaDepositService =
  require('./ethereum-sepolia-deposit-service')({
    dataDir:
      path.join(
        dataDir,
        'crypto',
        'ethereum-sepolia'
      ),

    requireDemoAuth:
      demoProfileService.requireDemoAuth,

    addLedgerEntry
  });

ethereumSepoliaDepositService.registerRoutes(app);
// HIPIPLAY ETHEREUM SEPOLIA DEPOSITS - END

require('./demo-passkey-routes')({
  app,
  dataDir: HIPI_AUTO_DATA_DIR,
  getPlayerBalance,
  setPlayerBalance,
  createTransferPasskeyProof,
  issueDemoAuthToken:
    demoProfileService.issueDemoAuthToken,
  grantWelcomePromo:
    dualBalanceService.grantWelcomePromo
});
server.listen(PORT, "0.0.0.0", () => {
  console.log("===============================================");
  console.log("HipiPlayRD Server v7 DB Balance activo");
  console.log(`Admin:            http://localhost:${PORT}/admin.html`);
  console.log(`Estado PWA:       http://localhost:${PORT}/api/state`);
  console.log(`Historial PWA:    http://localhost:${PORT}/api/history`);
  console.log(`Resultado jugador http://localhost:${PORT}/api/player/result/PLAYER_ID`);
  console.log(`Balance jugador   http://localhost:${PORT}/api/player/balance/PLAYER_ID`);
  console.log(`Balance admin     POST http://localhost:${PORT}/api/admin/player/balance`);
  console.log(`Multiplicadores: 1ro x${PAYOUT_MULTIPLIERS.first} | 2do x${PAYOUT_MULTIPLIERS.second} | 3ro x${PAYOUT_MULTIPLIERS.third}`);
  console.log(`MÃƒÂ­nimo caballos activos: ${MIN_ACTIVE_HORSES_FOR_VALID_RACE}`);
  console.log("Fases: BETTING -> RACE -> RESULTS -> BETTING");
  console.log("===============================================");
});










// HIPIPLAY DEMO SESSION ENGINE LEGACY DISABLED


