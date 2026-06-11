import { useEffect, useMemo, useRef, useState } from 'react';
import { Coins, History, LogOut, Sparkles, Trophy } from 'lucide-react';
import { syncLocalUserAfterLogin } from './localUserSync';
import { clearLocalUser, getLocalUser } from './localUserDb';
import { api, logout, setToken, Wallet } from './api';
import hipiPlayLogo from './assets/hipiplay-logo.png';
import { dbGetAll, LocalDerbyBet, LocalLedgerMovement, LocalWalletState } from './localDb';
import { getLocalWallet, initLocalWallet } from './localWallet';
import { localDerbyHistory, placeLocalDerbyBet, resolvePendingLocalBets } from './localLedger';
import { syncPendingQueue } from './syncQueue';
import { RaceVideoEngine } from './components/raceVideoEngine/RaceVideoEngine';
import { ServerRaceResultPanel } from './components/raceVideoEngine/ServerRaceResultPanel';
import { BettingHorsesPreview } from './components/raceVideoEngine/BettingHorsesPreview';
import { getServerRaceState, ServerRaceState, getServerRaceHistory, ServerPublicRaceHistory, sendServerBet, getServerPlayerResult, ServerPlayerResult } from './hipiplayServerApi';
import { HorseBetGrid } from './components/HorseBetGrid';
import {
  addBetToExposure,
  buildResultOrderFromExposure,
  createEmptyExposure,
  DerbyMarketExposure,
  getMarketStatus,
  MARKET_CONFIG,
} from './marketEngine';

type User = { id: string; username: string };
type Tab = 'games' | 'history';
type CyclePhase = 'betting' | 'running' | 'result';

type CycleInfo = {
  cycleIndex: number;
  raceId: string;
  raceCode: string;
  seed: string;
  phase: CyclePhase;
  phaseElapsed: number;
  phaseRemaining: number;
  bettingProgress: number;
  raceProgress: number;
};

type UserRaceBet = {
  raceId: string;
  raceCode: string;
  betId: string;
  selectedHorse: number;
  amount: number;
};

type RaceResult = {
  raceId: string;
  raceCode: string;
  resultOrder: number[];
  exposure: DerbyMarketExposure;
  selectedHorse?: number;
  amount?: number;
  won?: boolean;
  resolvedAt: number;
};

const BETTING_WINDOW_MS = 60_000;
const RACE_WINDOW_MS = 20_000;
const RESULT_WINDOW_MS = 12_000;
const RESULT_HOLD_AFTER_VIDEO_MS = 12_000;
const CYCLE_WINDOW_MS = BETTING_WINDOW_MS + RACE_WINDOW_MS + RESULT_WINDOW_MS;
const HORSES = [1, 2, 3, 4, 5, 6];
const laneTop = (horse: number) => 9 + (horse - 1) * 16.4;
const stageLaneTop = (horse: number) => 18 + laneTop(horse) * 0.64;
const GAME_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

const coins = (n: number) => new Intl.NumberFormat('es-DO', { maximumFractionDigits: 0 }).format(Math.max(0, Math.floor(Number(n || 0))));
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function hashString(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function getCycleInfo(now: number, forcedIndex?: number, epochMs = GAME_EPOCH_MS): CycleInfo {
  const elapsed = Math.max(0, now - epochMs);
  const cycleIndex = forcedIndex ?? Math.floor(elapsed / CYCLE_WINDOW_MS);
  const cycleStart = epochMs + cycleIndex * CYCLE_WINDOW_MS;
  const insideCycle = forcedIndex === undefined ? elapsed % CYCLE_WINDOW_MS : BETTING_WINDOW_MS + RACE_WINDOW_MS;
  const phase: CyclePhase = insideCycle < BETTING_WINDOW_MS
    ? 'betting'
    : insideCycle < BETTING_WINDOW_MS + RACE_WINDOW_MS
      ? 'running'
      : 'result';
  const phaseElapsed = phase === 'betting'
    ? insideCycle
    : phase === 'running'
      ? insideCycle - BETTING_WINDOW_MS
      : insideCycle - BETTING_WINDOW_MS - RACE_WINDOW_MS;
  const phaseLimit = phase === 'betting' ? BETTING_WINDOW_MS : phase === 'running' ? RACE_WINDOW_MS : RESULT_WINDOW_MS;
  const phaseRemaining = Math.max(0, phaseLimit - phaseElapsed);
  const raceCode = `DERBY-${String(cycleIndex).padStart(7, '0')}`;
  const raceId = `race-${cycleIndex}`;
  const seed = `${raceId}:${cycleStart}:juega123-derby`;

  return {
    cycleIndex,
    raceId,
    raceCode,
    seed,
    phase,
    phaseElapsed,
    phaseRemaining,
    bettingProgress: phase === 'betting' ? clamp(phaseElapsed / BETTING_WINDOW_MS, 0, 1) : 1,
    raceProgress: phase === 'running' ? clamp(phaseElapsed / RACE_WINDOW_MS, 0, 1) : phase === 'result' ? 1 : 0,
  };
}

function buildPublicMarket(race: CycleInfo, progress = race.bettingProgress) {
  let exposure = createEmptyExposure(race.raceId);
  const maxPublicBets = 42;
  const visiblePublicBets = Math.floor(maxPublicBets * clamp(progress, 0, 1));

  for (let i = 0; i < visiblePublicBets; i++) {
    const h = hashString(`${race.seed}:public:${i}`);
    const horse = (h % 6) + 1;
    const amount = 10 + ((h >>> 5) % 20) * 10;
    exposure = addBetToExposure(exposure, horse, amount, `public-${i}`, 'public');
  }

  return exposure;
}

function addUserBetToExposure(exposure: DerbyMarketExposure, bet: UserRaceBet | null, userId: string) {
  if (!bet) return exposure;
  return addBetToExposure(exposure, bet.selectedHorse, bet.amount, userId, 'local');
}

function normalizeError(err: unknown) {
  const raw = err instanceof Error ? err.message : 'No se pudo generar el boleto.';
  return raw
    .replace('Saldo local insuficiente en la wallet del teléfono.', 'Monedas insuficientes.')
    .replace('Saldo local insuficiente en la wallet del dispositivo.', 'Monedas insuficientes.')
    .replace('Monto inválido.', 'Cantidad inválida.')
    .replace('Apuestas cerradas para esta carrera. Espera la próxima.', 'Las apuestas están cerradas. Espera la próxima ventana.')
    .replace('Ya tienes un boleto pendiente en esta carrera. Espera el resultado o la próxima carrera.', 'Ya tienes un boleto activo en esta carrera.');
}

function Login({ onLogin }: { onLogin: (user: User, wallet: Wallet) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.login(username, password);
      setToken(res.token);
      await syncLocalUserAfterLogin(res.user.username || username);
      onLogin(res.user, res.wallet);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }

  return <div className="login-shell">
    <div className="login-card glass clean-login-card">
      <div className="login-brand-lockup">
        <img src={hipiPlayLogo} alt="HipiPlay" className="hipiplay-logo login-logo" />
        <div>
          <div className="brand-badge"><Sparkles size={18} /> HipiPlay</div>
          <h1>HipiPlay</h1>
          <p>Carreras Hípicas con monedas. Apuesta, espera la salida y vive una carrera automática de 60 segundos.</p>
        </div>
      </div>
      <form onSubmit={submit} className="form-grid">
        <label>Usuario<input value={username} onChange={e => setUsername(e.target.value)} /></label>
        <label>Clave<input type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        {error && <div className="error-box">{error}</div>}
        <button className="primary" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>
      </form>
      <small>Prueba local: admin / admin123</small>
    </div>
  </div>;
}

function PlayerSummary({ wallet }: { wallet: LocalWalletState | null; pendingCount: number; lastBet?: LocalDerbyBet; lastResult?: RaceResult | null }) {
  return <section className="coin-dashboard coin-dashboard-single">
    <div className="coin-card featured hipiplay-secondary-balance-card">
      <Coins />
      <span>Monedas disponibles</span>
      <strong>{coins(wallet?.demoBalance || 0)}</strong>
    </div>
  </section>;
}


type TrackPoint = {
  x: number;
  y: number;
  angle: number;
  z: number;
  crossed: boolean;
};

function smoothStep(value: number) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function seededWave(seed: string, horse: number, timeSeconds: number, channel: number) {
  const base = (hashString(`${seed}:horse:${horse}:channel:${channel}`) % 6283) / 1000;
  return Math.sin(base + timeSeconds * (0.9 + horse * 0.07 + channel * 0.19));
}

function getRaceLapProgress(cycle: CycleInfo, horse: number, rank: number) {
  const progress = clamp(cycle.raceProgress, 0, 1);
  const timeSeconds = cycle.phaseElapsed / 1000;

  // Movimiento visual abierto: variaciones de ritmo durante toda la carrera.
  // El resultado oficial sigue siendo el Top 3 interno calculado por menor exposición.
  const waveA = seededWave(cycle.seed, horse, timeSeconds, 1) * 0.018;
  const waveB = seededWave(cycle.seed, horse, timeSeconds, 2) * 0.012;
  const surge = seededWave(cycle.seed, horse, timeSeconds * 0.55, 3) * 0.02;
  const visualNoise = waveA + waveB + surge;

  const packProgress = smoothStep(progress) * 0.92 + visualNoise;

  // El remate solo aparece al final para que no se vea estático ni predecible.
  const sprintMix = smoothStep((progress - 0.82) / 0.18);
  const officialFinish = rank === 1
    ? 1.035
    : rank === 2
      ? 1.025
      : rank === 3
        ? 1.016
        : 0.988 - ((rank - 4) * 0.015);

  const lap = packProgress + (officialFinish - packProgress) * sprintMix;
  return clamp(lap, 0.005, 1.04);
}

function getTrackPoint(cycle: CycleInfo, horse: number, rank: number, running: boolean): TrackPoint {
  const laneIndex = horse - 3.5;
  const lap = running ? getRaceLapProgress(cycle, horse, rank) : 0.004 + horse * 0.002;
  const angle = lap * Math.PI * 2;

  // Carril ovalado, similar a pista hípica. Cada caballo corre en su propia línea.
  const rx = 38.5 + laneIndex * 1.12;
  const ry = 27.5 + laneIndex * 0.72;
  const cx = 50;
  const cy = 52;

  const x = cx + rx * Math.cos(angle);
  const y = cy + ry * Math.sin(angle);

  // Tangente del óvalo para orientar caballo y jinete con la curva.
  const dx = -rx * Math.sin(angle);
  const dy = ry * Math.cos(angle);
  const rotation = Math.atan2(dy, dx) * 180 / Math.PI;

  return {
    x,
    y,
    angle: rotation,
    z: Math.round(y * 10),
    crossed: running && lap >= 1 && rank <= 3,
  };
}

function HorseSilhouette({ horse }: { horse: number }) {
  return <svg className="horse-svg" viewBox="0 0 220 115" role="img" aria-label={`Caballo ${horse}`}>
    <defs>
      <linearGradient id={`horseGrad${horse}`} x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stopColor="var(--horse-main)" />
        <stop offset="100%" stopColor="var(--horse-dark)" />
      </linearGradient>
      <linearGradient id={`silkGrad${horse}`} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor="var(--jockey-light)" />
        <stop offset="100%" stopColor="var(--jockey-color)" />
      </linearGradient>
    </defs>

    <ellipse className="horse-shadow-svg" cx="101" cy="103" rx="76" ry="8" />

    <path className="horse-tail-svg" d="M42 49 C18 36 10 42 4 50 C18 49 26 61 46 59" />
    <path className="horse-body-svg" d="M43 42 C63 24 112 25 140 36 C158 43 165 55 158 68 C143 84 82 83 51 72 C36 67 31 52 43 42 Z" fill={`url(#horseGrad${horse})`} />
    <path className="horse-chest-svg" d="M133 37 C148 24 161 20 174 24 C181 27 185 35 182 42 C172 43 164 47 157 58 C151 52 144 43 133 37 Z" fill={`url(#horseGrad${horse})`} />
    <path className="horse-neck-svg" d="M143 34 C154 15 170 7 188 14 C185 29 177 42 162 56 C156 49 151 41 143 34 Z" fill={`url(#horseGrad${horse})`} />
    <path className="horse-head-svg" d="M181 13 C202 14 215 26 212 39 C202 45 188 43 176 35 C174 26 176 19 181 13 Z" fill={`url(#horseGrad${horse})`} />
    <path className="horse-ear-svg" d="M187 12 L192 1 L197 16 Z" />
    <path className="horse-mane-svg" d="M145 33 C154 20 168 10 185 13 C176 23 166 36 158 52 C154 43 150 37 145 33 Z" />

    <g className="legs-group">
      <path className="horse-leg-svg leg-1" d="M62 71 C52 84 47 94 37 106" />
      <path className="horse-leg-svg leg-2" d="M84 75 C94 88 102 96 111 108" />
      <path className="horse-leg-svg leg-3" d="M126 72 C118 86 116 97 110 109" />
      <path className="horse-leg-svg leg-4" d="M143 67 C157 78 169 88 180 101" />
    </g>

    <g className="jockey-svg">
      <path className="saddle-svg" d="M86 33 C101 28 115 29 128 35 L122 45 C108 42 96 42 84 45 Z" />
      <circle className="jockey-head-svg" cx="103" cy="17" r="9" />
      <path className="jockey-body-svg" d="M96 25 C106 20 118 24 124 37 C114 40 101 38 90 35 Z" fill={`url(#silkGrad${horse})`} />
      <path className="jockey-arm-svg" d="M118 34 C132 39 145 42 156 47" />
      <path className="jockey-leg-svg" d="M101 38 C96 52 94 60 88 67" />
      <path className="jockey-leg-svg" d="M117 39 C124 50 130 57 137 66" />
      <path className="helmet-svg" d="M93 12 C103 3 116 10 116 18 C107 16 100 16 93 18 Z" />
      <text className="jockey-number-svg" x="106" y="34" textAnchor="middle">{horse}</text>
    </g>
  </svg>;
}


type BroadcastPoint = {
  left: number;
  top: number;
  crossed: boolean;
  burst: boolean;
};

function getBroadcastPoint(cycle: CycleInfo, horse: number, rank: number, running: boolean): BroadcastPoint {
  const lane = horse - 1;
  const top = stageLaneTop(horse);
  if (!running) {
    return { left: 14.4 + lane * 0.08, top, crossed: false, burst: false };
  }

  const t = clamp(cycle.raceProgress, 0, 1);
  const secs = cycle.phaseElapsed / 1000;
  const flutterA = seededWave(cycle.seed, horse, secs, 1) * 0.012;
  const flutterB = seededWave(cycle.seed, horse, secs, 2) * 0.009;
  const surge = seededWave(cycle.seed, horse, secs * 0.72, 3) * 0.018;
  const packNoise = flutterA + flutterB + surge;

  const launch = smoothStep(t / 0.16) * 0.12;
  const cruise = smoothStep((t - 0.12) / 0.58) * 0.52;
  const packForward = clamp(0.025 + launch + cruise + packNoise + lane * 0.002, 0.025, 0.72);

  const sprintMix = smoothStep((t - 0.74) / 0.22);
  const targetByRank: Record<number, number> = {
    1: 0.965,
    2: 0.952,
    3: 0.941,
    4: 0.895,
    5: 0.872,
    6: 0.848,
  };

  let forward = packForward * (1 - sprintMix) + (targetByRank[rank] ?? 0.84) * sprintMix;

  if (rank <= 3) {
    const crossStart = rank === 1 ? 0.905 : rank === 2 ? 0.94 : 0.965;
    const crossMix = smoothStep((t - crossStart) / (1 - crossStart));
    const crossTarget = rank === 1 ? 1.055 : rank === 2 ? 1.025 : 1.0;
    forward = forward * (1 - crossMix) + crossTarget * crossMix;
  } else {
    forward = Math.min(forward, 0.91 - (rank - 4) * 0.03 + packNoise * 0.2);
  }

  const left = 15.6 + clamp(forward, 0, 1.08) * 70;
  return {
    left,
    top,
    crossed: rank <= 3 && left >= 87,
    burst: t >= 0.78,
  };
}

function BroadcastHorse({
  horse,
  point,
  running,
  selected,
  rank,
}: {
  horse: number;
  point: BroadcastPoint;
  running: boolean;
  selected: boolean;
  rank: number;
}) {
  return <div
    className={`broadcast-horse horse-color-${horse} ${running ? 'is-running' : ''} ${selected ? 'selected-horse' : ''} ${point.burst ? 'in-burst' : ''} ${point.crossed ? 'crossed-line' : ''}`}
    style={{
      left: `${point.left}%`,
      top: `${point.top}%`,
      ['--delay' as string]: `${horse * 70}ms`,
    }}
  >
    <div className="horse-lane-chip">#{horse}</div>
    <HorseSilhouette horse={horse} />
    {running && <span className="track-dust dust-a"></span>}
    {running && <span className="track-dust dust-b"></span>}
    {point.burst && <span className="motion-streak streak-a"></span>}
    {point.burst && <span className="motion-streak streak-b"></span>}
    {point.crossed && <span className="finish-ribbon">{rank}o</span>}
  </div>;
}

function RaceTrack({ cycle, resultOrder, selectedHorse, lastResult }: { cycle: CycleInfo; resultOrder: number[]; selectedHorse?: number; lastResult?: RaceResult | null }) {
  const running = cycle.phase === 'running';
  const betting = cycle.phase === 'betting';
  const resultPhase = cycle.phase === 'result';
  const secondsLeft = Math.ceil(cycle.phaseRemaining / 1000);
  const showRaceStartCountdown = betting && secondsLeft <= 10;
  const countdownValue = Math.max(0, Math.min(10, secondsLeft));
  const top3 = resultOrder.slice(0, 3);
  const finalSprint = running && cycle.raceProgress >= 0.78;
  const photoFinish = running && cycle.raceProgress >= 0.94;
  const userWon = selectedHorse ? top3.includes(selectedHorse) : undefined;

  return <section className={`race-tv glass broadcast-race-tv ${running ? 'race-running' : betting ? 'race-betting' : 'race-result'} ${finalSprint ? 'final-sprint' : ''} ${photoFinish ? 'photo-finish' : ''}`}>
    <div className="race-tv-header broadcast-header">
      <div>
        <span className={running ? 'live-badge' : resultPhase ? 'result-badge' : 'betting-badge'}>{running ? 'EN VIVO' : resultPhase ? 'RESULTADO' : 'APUESTAS'}</span>
        <strong>{running ? 'Carrera hípica en desarrollo' : resultPhase ? 'Resultado oficial' : 'Apuestas abiertas - selecciona tu caballo'}</strong>
        <small>{running ? `Tiempo restante de carrera: ${secondsLeft}s` : resultPhase ? `Nueva ronda en ${secondsLeft}s` : `Cierre de apuestas en ${secondsLeft}s`}</small>
      </div>
      <div className="race-clock"><span>{secondsLeft}</span></div>
    </div>

    <div className="hipica-broadcast-stage clean-gate-stage">
      <div className="grandstand-band grandstand-top"></div>
      <div className="grandstand-band grandstand-bottom"></div>
      <div className="rail rail-top"></div>
      <div className="rail rail-bottom"></div>
      <div className="track-label overlay-label label-publico">TRIBUNAS</div>
      <div className="track-label overlay-label label-recta">RECTA FINAL</div>
      <div className="track-label overlay-label label-meta">META</div>

      <div className={`starting-gate-real aligned-starting-gate ${running ? 'gate-open' : 'gate-closed'}`}>
        {HORSES.map(h => <div key={h} className="gate-stall aligned-stall" style={{ top: `${laneTop(h)}%` }}><span>#{h}</span></div>)}
      </div>

      <div className="finish-line-real">
        <div className="finish-post"></div>
        <span>META</span>
      </div>

      <div className="track-surface clean-track-surface">
        {HORSES.map(h => <div key={h} className={`track-lane lane-${h}`} style={{ top: `${laneTop(h)}%` }}>
          <div className="lane-guide-number">#{h}</div>
        </div>)}
      </div>

      {showRaceStartCountdown && <div className="race-start-countdown-overlay">
        <img src={hipiPlayLogo} alt="HipiPlay" className="hipiplay-logo countdown-logo" />
        <span>La carrera inicia en</span>
        <strong>{countdownValue}</strong>
      </div>}

      {running && HORSES.map((horse) => {
        const rankIndex = resultOrder.indexOf(horse);
        const rank = rankIndex >= 0 ? rankIndex + 1 : horse;
        const point = getBroadcastPoint(cycle, horse, rank, running);
        if (point.crossed) return null;
        return <BroadcastHorse
          key={horse}
          horse={horse}
          point={point}
          running={running}
          selected={selectedHorse === horse}
          rank={rank}
        />;
      })}

      {resultPhase && <div className={`track-result-overlay official-result-overlay ${userWon ? 'win' : userWon === false ? 'lose' : 'neutral'}`}>
        <div className="winner-branding">
          <img src={hipiPlayLogo} alt="HipiPlay" className="hipiplay-logo winner-logo" />
          <div>
            <span>RESULTADO OFICIAL</span>
            <em>HipiPlay Top 3</em>
          </div>
        </div>
        <strong>{top3.map((h, i) => `${i + 1}o #${h}`).join('   |   ')}</strong>
        <small>{userWon === undefined ? 'Carrera finalizada.' : userWon ? 'GANASTE - tu caballo entró en el Top 3.' : 'PERDISTE - tu caballo quedó fuera del Top 3.'}</small>
      </div>}
    </div>

    <div className="broadcast-commentary">
      <strong>{running ? (photoFinish ? 'Cruce de meta:' : finalSprint ? 'Ataque final:' : 'Relato de carrera:') : resultPhase ? 'Resultado:' : 'Estado:'}</strong>
      <span>
        {running
          ? (photoFinish
            ? ' los ganadores cruzan la línea de meta y desaparecen de la pista para revelar el Top 3 oficial.'
            : finalSprint
              ? ' se abre la recta final, los caballos aceleran y el lote se estira antes de la meta.'
              : ' el grupo corre por carriles, cambia el ritmo y nadie muestra todavía una ventaja definitiva.')
          : resultPhase
            ? ' se muestra el Top 3 durante 10 segundos y luego empieza una nueva ventana de apuestas.'
            : ' los caballos permanecen ocultos en el partidor; al cerrar el contador se abrirán las compuertas.'}
      </span>
    </div>

  </section>;
}

function DerbyGame({ user, wallet, refreshLocal }: { user: User; wallet: LocalWalletState | null; refreshLocal: () => Promise<void> }) {
  const [now, setNow] = useState(Date.now());
  const [amount, setAmount] = useState(100);
  const [horse, setHorse] = useState(1);
  const [bets, setBets] = useState<LocalDerbyBet[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverRaceState, setServerRaceState] = useState<ServerRaceState | null>(null);
  const [serverOnline, setServerOnline] = useState(false);
  const [serverSyncError, setServerSyncError] = useState('');
  const [serverPlayerResult, setServerPlayerResult] = useState<ServerPlayerResult | null>(null);
  const [clientDemoBalance, setClientDemoBalance] = useState(() => Number(wallet?.demoBalance || 0));
  const [userBetsByRace, setUserBetsByRace] = useState<Record<string, UserRaceBet>>({});
  const [serverUserBet, setServerUserBet] = useState<UserRaceBet | null>(null);
  const [lastResult, setLastResult] = useState<RaceResult | null>(null);
  const resolvedRacesRef = useRef<Set<string>>(new Set());
  const sessionEpochRef = useRef(Date.now());
  const serverRoundRef = useRef<number | null>(null);
  const settledServerResultRef = useRef<string | null>(null);
  const chargedServerBetIdsRef = useRef<Set<string>>(new Set());
  const resultHoldTimerRef = useRef<number | null>(null);

  const cycle = useMemo(() => getCycleInfo(now, undefined, sessionEpochRef.current), [now]);

  async function loadLocalBets() {
    const all = await localDerbyHistory(user.id);
    setBets(all);
  }

  async function syncNowQuietly() {
    try {
      await syncPendingQueue(20);
    } catch {
      // La sincronización no debe interrumpir la carrera.
    } finally {
      await refreshLocal();
    }
  }

  useEffect(() => {
    loadLocalBets().catch(() => null);
    const interval = setInterval(() => setNow(Date.now()), 250);
    const historyInterval = setInterval(() => loadLocalBets().catch(() => null), 3000);
    return () => {
      clearInterval(interval);
      clearInterval(historyInterval);
    };
  }, [user.id]);

  function userBetForRace(raceId: string, raceCode: string): UserRaceBet | null {
    if (userBetsByRace[raceId]) return userBetsByRace[raceId];
    const pending = bets.find(b => b.raceId === raceId && b.status === 'pending');
    if (!pending) return null;
    return {
      raceId,
      raceCode,
      betId: pending.id,
      selectedHorse: pending.selectedHorse,
      amount: pending.amount,
    };
  }

  function exposureForRace(race: CycleInfo, userBet: UserRaceBet | null, progressOverride?: number) {
    const publicExposure = buildPublicMarket(race, progressOverride ?? race.bettingProgress);
    return addUserBetToExposure(publicExposure, userBet, user.id);
  }

    useEffect(() => {
    let alive = true;

    async function syncServerState() {
      try {
        const state = await getServerRaceState();

        if (!alive) return;

        setServerRaceState(state);
        setServerOnline(true);
        setServerSyncError('');

        if (serverRoundRef.current !== state.roundId) {
          if (serverRoundRef.current !== null) {
            setServerUserBet(null);
            setServerPlayerResult(null);
            setMessage('');
          }

          serverRoundRef.current = state.roundId;
        }

        setNow(Date.now());
      } catch (error) {
        if (!alive) return;

        setServerOnline(false);
        setServerSyncError(error instanceof Error ? error.message : 'No se pudo conectar con el servidor.');
      }
    }

    syncServerState();

    const timer = window.setInterval(syncServerState, 1000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);


  useEffect(() => {
    setClientDemoBalance(Number(wallet?.demoBalance || 0));
  }, [wallet?.demoBalance]);

  const localCurrentUserBet = userBetForRace(cycle.raceId, cycle.raceCode);
  const currentUserBet =
    serverOnline && serverRaceState
      ? (
          serverUserBet && serverUserBet.raceId === `server-round-${serverRaceState.roundId}`
            ? serverUserBet
            : null
        )
      : localCurrentUserBet;
  
  useEffect(() => {
    if (!serverOnline || !serverRaceState || serverRaceState.phase !== 'RESULTS') return;

    let alive = true;

    async function loadServerPlayerResultAndApplyPayout() {
      try {
        const result = await getServerPlayerResult(user.id);

        if (!alive) return;

        setServerPlayerResult(result);

        const hasSettlements = Array.isArray(result.settlements) && result.settlements.length > 0;
        const resultRound = result.roundId || result.raceNumber || serverRaceState?.roundId || 0;
        const resultKey = `${resultRound}-${result.playerId}`;

        if (!result.available || !hasSettlements) return;
        if (settledServerResultRef.current === resultKey) return;

        settledServerResultRef.current = resultKey;

        const payout = Number(result.totalPayout || 0);

        if (payout > 0) {
          applyWalletDelta(payout);
        }
      } catch (error) {
        console.warn('No se pudo consultar el resultado económico del jugador:', error);
      }
    }

    loadServerPlayerResultAndApplyPayout();

    const timer = window.setInterval(loadServerPlayerResultAndApplyPayout, 1000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [serverOnline, serverRaceState?.phase, serverRaceState?.roundId, user.id]);
const currentExposure = exposureForRace(cycle, currentUserBet, cycle.phase === 'running' || cycle.phase === 'result' ? 1 : cycle.bettingProgress);
  // Resultado interno: se calcula con la exposición del mercado, pero el jugador solo ve el resultado final.
  const resultOrder = buildResultOrderFromExposure(currentExposure, cycle.seed);
  const pendingCount = bets.filter(b => b.status === 'pending').length;
  const lastBet = bets[0];
  const bettingOpen = Boolean(serverOnline && serverRaceState && serverRaceState.phase === 'BETTING' && !currentUserBet);

  
  const [videoRaceSession, setVideoRaceSession] = useState<{
    raceId: string;
    raceCode: string;
    winners: number[];
    finished: boolean;
    selectedHorse?: number;
    betAmount?: number;
  } | null>(null);

  useEffect(() => {
    if (cycle.phase !== 'running') return;

    setVideoRaceSession((current) => {
      if (current) {
        return current;
      }

      return {
        raceId: cycle.raceId,
        raceCode: cycle.raceCode,
        winners: resultOrder.slice(0, 3),
        selectedHorse: currentUserBet?.selectedHorse,
        betAmount: currentUserBet?.amount,
        finished: false
      };
    });
  }, [cycle.phase, cycle.raceId, cycle.raceCode, resultOrder]);

  useEffect(() => {
    // La sesión del video se limpia desde onFinish, después de mostrar el resultado.
  }, [videoRaceSession]);
useEffect(() => {
    if (cycle.phase !== 'result') return;
    if (resolvedRacesRef.current.has(cycle.raceId)) return;

    const raceUserBet = userBetForRace(cycle.raceId, cycle.raceCode);
    const finalExposure = exposureForRace(cycle, raceUserBet, 1);
    const finalOrder = buildResultOrderFromExposure(finalExposure, cycle.seed);
    const top3 = finalOrder.slice(0, 3);
    const won = raceUserBet ? top3.includes(raceUserBet.selectedHorse) : undefined;

    resolvedRacesRef.current.add(cycle.raceId);
    setMessage('');
    setLastResult({
      raceId: cycle.raceId,
      raceCode: cycle.raceCode,
      resultOrder: finalOrder,
      exposure: finalExposure,
      selectedHorse: raceUserBet?.selectedHorse,
      amount: raceUserBet?.amount,
      won,
      resolvedAt: Date.now(),
    });

    if (raceUserBet) {
      resolvePendingLocalBets(user.id, cycle.raceId, cycle.raceCode, finalOrder)
        .then(async () => {
          await refreshLocal();
          await loadLocalBets();
          await syncNowQuietly();
        })
        .catch(err => setMessage(normalizeError(err)));
    }
  }, [cycle.cycleIndex, cycle.phase]);  function applyWalletDelta(delta: number) {
    if (!Number.isFinite(delta) || delta === 0) return;

    setClientDemoBalance((currentBalance) => {
      const nextBalance = Math.max(0, Math.floor(Number(currentBalance || 0) + delta));

      const nextWallet = {
        ...(wallet || {}),
        userId: user.id,
        demoBalance: nextBalance
      };

      try {
        localStorage.setItem('hipiplay_wallet_' + user.id, JSON.stringify(nextWallet));
      } catch {
        // No interrumpir la app si localStorage falla
      }

      window.setTimeout(() => {
        void refreshLocal();
      }, 50);

      return nextBalance;
    });
  }

  async function bet() {
    if (!serverOnline || !serverRaceState) {
      setMessage('No hay conexión con el servidor. No se puede apostar.');
      return;
    }

    if (serverRaceState.phase !== 'BETTING') {
      setMessage('Las apuestas están cerradas. Espera la próxima ronda.');
      return;
    }

    if (currentUserBet) {
      setMessage('Ya tienes un boleto generado en esta carrera.');
      return;
    }

    const safeAmount = Math.floor(Number(amount || 0));

    if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
      setMessage('Ingresa una cantidad válida de monedas.');
      return;
    }

    if (clientDemoBalance < safeAmount) {
      setMessage('Monedas insuficientes para realizar esta apuesta.');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const res = await sendServerBet({
        playerId: user.id,
        clientName: user.username,
        horseId: horse,
        amount: safeAmount
      });

      const roundId = res.bet?.roundId || serverRaceState.roundId;
      const betId = res.bet?.id || `SERVER-${roundId}-${Date.now()}`;

      const placedBet: UserRaceBet = {
        raceId: `server-round-${roundId}`,
        raceCode: `Carrera ${roundId}`,
        betId,
        selectedHorse: horse,
        amount: safeAmount
      };

      setServerUserBet(placedBet);

      if (!chargedServerBetIdsRef.current.has(betId)) {
        chargedServerBetIdsRef.current.add(betId);
        applyWalletDelta(-safeAmount);
      }
      setUserBetsByRace(prev => ({
        ...prev,
        [placedBet.raceId]: placedBet
      }));

      if (res.state) {
        setServerRaceState(res.state);
      }

      setMessage(`Boleto enviado al servidor: ${betId}`);
    } catch (err) {
      setMessage(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }

  return <div className="player-screen">
    <PlayerSummary wallet={wallet} pendingCount={pendingCount} lastBet={lastBet} lastResult={lastResult} />
<div className="cycle-steps glass">
      <div className={cycle.phase === 'betting' ? 'step active' : 'step done'}><span>01</span><strong>Apuestas</strong><small>60 segundos</small></div>
      <div className="step-line"></div>
      <div className={cycle.phase === 'running' ? 'step active' : 'step'}><span>02</span><strong>Carrera</strong><small>20 segundos</small></div>
      <div className="step-line"></div>
      <div className={cycle.phase === 'result' ? 'step active' : lastResult ? 'step done' : 'step'}><span>03</span><strong>Resultado</strong><small>Al terminar</small></div>
    </div>
        <div className={`server-sync-card ${serverOnline ? 'online' : 'offline'}`}>
      <strong>{serverOnline ? 'Servidor conectado' : 'Sin conexión con el servidor'}</strong>
      <span>
        {serverOnline && serverRaceState
          ? `Ronda ${serverRaceState.roundId} · ${serverRaceState.phase === 'BETTING' ? 'Apuestas abiertas' : serverRaceState.phase === 'RACE' ? 'Carrera en curso' : 'Resultado oficial'} · ${serverRaceState.secondsRemaining}s`
          : serverSyncError || 'Esperando sincronización...'}
      </span>
    </div>

    <div className="horse-bet-panel glass">
      <h3 className="horse-bet-title">Selecciona tu caballo y apuesta</h3>

      <HorseBetGrid
        selectedHorse={horse}
        onSelect={(selected) => setHorse(selected)}
      />

      <label className="horse-bet-field-label">Cantidad de monedas</label>

      <input
        type="number"
        min={1}
        value={amount}
        onChange={e => setAmount(Number(e.target.value))}
        disabled={!bettingOpen || loading}
        className="horse-bet-amount-input"
        placeholder="100"
      />

      <button
        className="horse-bet-submit-btn"
        onClick={bet}
        disabled={!bettingOpen || loading}
      >
        Apostar
      </button>
    </div>
{serverOnline && serverRaceState ? (
      serverRaceState.phase === 'BETTING' ? (
        <BettingHorsesPreview
          secondsLeft={serverRaceState.secondsRemaining}
          selectedHorse={currentUserBet?.selectedHorse}
        />
      ) : serverRaceState.phase === 'RACE' ? (
        <RaceVideoEngine
          key={`server-race-${serverRaceState.roundId}`}
          raceId={`server-round-${serverRaceState.roundId}`}
          winners={[]}
          selectedHorse={currentUserBet?.selectedHorse}
          betAmount={currentUserBet?.amount || 0}
          autoPlay
          startAtSeconds={Math.max(
            0,
            (serverRaceState.raceSeconds || 20) - serverRaceState.secondsRemaining
          )}
          onFinish={() => {
            console.log('Carrera visual local terminó, esperando fase RESULTS del servidor:', serverRaceState.roundId);
          }}
        />
      ) : (
        <ServerRaceResultPanel
          winners={serverRaceState.winners || []}
          selectedHorse={currentUserBet?.selectedHorse}
          betAmount={currentUserBet?.amount || 0}
          secondsLeft={serverRaceState.secondsRemaining}
          serverPlayerResult={serverPlayerResult}
        />
      )
    ) : (
      <section className="server-required-panel glass">
        <strong>Sin conexión con el servidor</strong>
        <span>
          Las apuestas, el cronómetro, la carrera y los resultados se mostrarán cuando la PWA sincronice con el servidor central.
        </span>
      </section>
    )}
    {message && <div className={`result-card ${message.startsWith('GANASTE') ? 'win' : message.startsWith('PERDISTE') ? 'lose' : 'neutral'}`}>
      <strong>{message}</strong>
    </div>}
  </div>;
}

function HistoryPanel({ userId }: { userId: string }) {
  const [serverHistory, setServerHistory] = useState<ServerPublicRaceHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    let alive = true;

    async function loadServerHistory() {
      try {
        const history = await getServerRaceHistory();

        if (!alive) return;

        setServerHistory(history);
        setHistoryError('');
      } catch (error) {
        if (!alive) return;

        setHistoryError(error instanceof Error ? error.message : 'No se pudo cargar el historial del servidor.');
      } finally {
        if (alive) {
          setLoadingHistory(false);
        }
      }
    }

    loadServerHistory();

    const timer = window.setInterval(loadServerHistory, 5000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [userId]);

  return (
    <section className="glass history-card clean-history server-history-card">
      <h2><History /> Historial de carreras</h2>

      {loadingHistory && (
        <p>Cargando historial del servidor...</p>
      )}

      {!loadingHistory && historyError && (
        <div className="server-history-error">
          {historyError}
        </div>
      )}

      {!loadingHistory && !historyError && serverHistory.length === 0 && (
        <p>No hay carreras registradas en el servidor.</p>
      )}

      {!loadingHistory && !historyError && serverHistory.map((race) => (
        <div className="server-history-row" key={race.raceNumber}>
          <div>
            <strong>Carrera #{race.raceNumber}</strong>
            <small>Resultado oficial del servidor</small>
          </div>

          <div className="server-history-winners">
            {(race.winners || []).slice(0, 3).map((horse, index) => (
              <span key={`${race.raceNumber}-${horse}-${index}`}>
                {index + 1}. #{horse}
              </span>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function PwaInstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as InstallPromptEvent);
    };

    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  if (installed || !deferredPrompt) return null;
  return <button className="mobile-install-btn" onClick={install}>Instalar</button>;
}
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [localWallet, setLocalWallet] = useState<LocalWalletState | null>(null);
  const [tab, setTab] = useState<Tab>('games');
  const [loading, setLoading] = useState(true);

  async function refreshLocal(userId = user?.id) {
    if (!userId) return;
    const wallet = await getLocalWallet(userId);
    setLocalWallet(wallet);
  }

  async function bootstrap(u: User, w: Wallet) {
    setUser(u);
    const local = await initLocalWallet(u.id, {
      demoBalance: w.demoBalance,
      realBalance: w.realBalance,
      giftLocked: w.giftLocked,
    });
    setLocalWallet(local);
  }

  useEffect(() => {
    const localUser = getLocalUser();
    if (localUser) {
      console.log('HipiPlay usuario local:', localUser);
    }
    api.me().then(res => bootstrap(res.user, res.wallet)).catch(() => null).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading"><Sparkles className="spin" /> Cargando HipiPlay...</div>;
  if (!user) return <Login onLogin={(u, w) => { bootstrap(u, w); }} />;

  return <div className="app-shell clean-player-shell">
    <header className="mobile-app-header">
      <div className="mobile-brand-lockup">
        <img src={hipiPlayLogo} alt="HipiPlay" />
        <div>
          <strong>HipiPlay</strong>
          <small>Carreras Hípicas</small>
        </div>
      </div>
      <div className="mobile-header-actions">
        <PwaInstallButton />
        <div className="mobile-balance-pill"><Coins size={16} /> {coins(localWallet?.demoBalance || 0)}</div>
      </div>
    </header>
    <header className="topbar glass clean-topbar">
      <div className="brand brand-hipiplay"><img src={hipiPlayLogo} alt="HipiPlay" className="hipiplay-logo topbar-logo" /><div><strong>HipiPlay</strong><small>Carreras Hípicas con monedas</small></div></div>
      <nav>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History size={17}/> Historial</button>
      </nav>
      <button className="ghost" onClick={() => { clearLocalUser(); logout(); location.reload(); }}><LogOut size={18}/> Salir</button>
    </header>

    <main className="clean-main">
      {tab === 'games' && <DerbyGame user={user} wallet={localWallet} refreshLocal={() => refreshLocal(user.id)} />}
      {tab === 'history' && <HistoryPanel userId={user.id} />}
    </main>

    <nav className="mobile-bottom-nav" aria-label="NavegaciÃ³n mÃ³vil HipiPlay">
      <button className={tab === 'games' ? 'active' : ''} onClick={() => setTab('games')}><Trophy size={20} /><span>Carrera</span></button>
      <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History size={20} /><span>Historial</span></button>
      <button className="logout-mobile" onClick={() => { clearLocalUser(); logout(); location.reload(); }}><LogOut size={20} /><span>Salir</span></button>
    </nav>
  </div>;
}
































