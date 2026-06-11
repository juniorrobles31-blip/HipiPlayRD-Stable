import { useEffect, useMemo, useRef, useState } from 'react';
import horse1 from '../../assets/cinematic-race/h1.gif';
import horse2 from '../../assets/cinematic-race/h2.gif';
import horse3 from '../../assets/cinematic-race/h3.gif';
import horse4 from '../../assets/cinematic-race/h4.gif';
import horse5 from '../../assets/cinematic-race/h5.gif';
import './cinematicHorseRace.css';

type RacePhase = 'intro' | 'running' | 'finished';

type CinematicHorseRaceProps = {
  winners: number[];
  horseCount?: number;
  durationMs?: number;
  raceId?: string;
  autoStart?: boolean;
  onFinish?: (finalOrder: number[]) => void;
};

type HorseFrame = {
  horse: number;
  x: number;
  y: number;
  rank: number;
  isWinner: boolean;
};

const HORSE_IMAGES = [horse1, horse2, horse3, horse4, horse5];
const WORLD_WIDTH = 3200;
const FINISH_X = WORLD_WIDTH - 260;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function smoothStep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hashText(text: string) {
  let h = 2166136261;

  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }

  return Math.abs(h >>> 0);
}

function seededRandom(seed: number) {
  let value = seed || 1;

  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function buildFinalOrder(horseCount: number, winners: number[], raceId: string) {
  const all = Array.from({ length: horseCount }, (_, index) => index + 1);
  const cleanWinners = winners.filter((horse) => all.includes(horse)).slice(0, 3);
  const remaining = all.filter((horse) => !cleanWinners.includes(horse));

  const rand = seededRandom(hashText(raceId));

  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }

  return [...cleanWinners, ...remaining];
}

function calculateHorseFrame(params: {
  horse: number;
  finalOrder: number[];
  progress: number;
  seed: number;
  laneIndex: number;
}) {
  const { horse, finalOrder, progress, seed, laneIndex } = params;

  const rank = finalOrder.indexOf(horse) + 1;
  const startDelay = 0.018 * ((horse + seed) % 5);
  const t = clamp((progress - startDelay) / (1 - startDelay), 0, 1);

  const base = easeInOutCubic(t);
  const lateLock = smoothStep(0.72, 1, t);

  const finalX = FINISH_X - (rank - 1) * 78;
  const startX = 120;

  const fakeDrama =
    Math.sin(t * 14 + horse * 1.7) * 90 * (1 - lateLock) +
    Math.sin(t * 31 + seed * 0.003 + horse) * 38 * (1 - lateLock);

  const middlePush = Math.sin(Math.PI * t) * (((horse * 47 + seed) % 120) - 60) * (1 - lateLock);

  const cinematicX = startX + (finalX - startX) * base + fakeDrama + middlePush;
  const lockedX = startX + (finalX - startX) * base;

  const x = t > 0.985 ? finalX : cinematicX * (1 - lateLock) + lockedX * lateLock;

  const laneGap = 52;
  const y = 155 + laneIndex * laneGap + Math.sin(t * 18 + horse) * 4;

  return {
    horse,
    x,
    y,
    rank,
    isWinner: rank <= 3
  };
}

export function CinematicHorseRace({
  winners,
  horseCount = 6,
  durationMs = 60000,
  raceId = `race-${Date.now()}`,
  autoStart = true,
  onFinish
}: CinematicHorseRaceProps) {
  const [startedAt, setStartedAt] = useState<number | null>(autoStart ? performance.now() : null);
  const [now, setNow] = useState(performance.now());
  const [finished, setFinished] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const seed = useMemo(() => hashText(raceId + winners.join('-')), [raceId, winners]);

  const finalOrder = useMemo(
    () => buildFinalOrder(horseCount, winners, raceId),
    [horseCount, winners, raceId]
  );

  useEffect(() => {
    let frame = 0;

    const tick = () => {
      setNow(performance.now());
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, []);

  const elapsed = startedAt ? now - startedAt : 0;
  const rawProgress = startedAt ? clamp(elapsed / durationMs, 0, 1) : 0;
  const progress = rawProgress;

  const phase: RacePhase =
    !startedAt || progress < 0.08 ? 'intro' : progress >= 1 ? 'finished' : 'running';

  useEffect(() => {
    if (progress >= 1 && !finished) {
      setFinished(true);
      onFinish?.(finalOrder);
    }
  }, [progress, finished, finalOrder, onFinish]);

  const frames: HorseFrame[] = Array.from({ length: horseCount }, (_, index) =>
    calculateHorseFrame({
      horse: index + 1,
      finalOrder,
      progress,
      seed,
      laneIndex: index
    })
  );

  const leaderX = Math.max(...frames.map((frame) => frame.x));
  const viewportWidth = viewportRef.current?.clientWidth || 390;
  const cameraX =
    phase === 'intro'
      ? 0
      : clamp(leaderX - viewportWidth * 0.52, 0, WORLD_WIDTH - viewportWidth);

  function restartRace() {
    setFinished(false);
    setStartedAt(performance.now());
  }

  return (
    <section className="cinematic-race-shell">
      <div className="cinematic-race-topbar">
        <div>
          <span>HIPIPLAY LIVE</span>
          <strong>Carrera generada en tiempo real</strong>
        </div>
        <em>{phase === 'intro' ? 'Partidor' : phase === 'running' ? 'En vivo' : 'Resultado'}</em>
      </div>

      <div className="cinematic-race-viewport" ref={viewportRef}>
        <div
          className="cinematic-race-world"
          style={{
            width: WORLD_WIDTH,
            transform: `translate3d(${-cameraX}px, 0, 0)`
          }}
        >
          <div className="cinematic-skyline">
            <span>GRADAS</span>
            <span>PÚBLICO</span>
            <span>HIPÓDROMO</span>
          </div>

          <div className="cinematic-track-ground">
            <div className="cinematic-rail top"></div>
            <div className="cinematic-rail bottom"></div>

            <div className={`cinematic-start-gate ${phase === 'intro' ? 'visible' : 'opening'}`}>
              <strong>PARTIDOR</strong>
              {Array.from({ length: horseCount }, (_, index) => (
                <span key={index}>{index + 1}</span>
              ))}
            </div>

            <div className="cinematic-finish-line">
              <strong>META</strong>
            </div>

            {frames.map((frame, index) => {
              const img = HORSE_IMAGES[index % HORSE_IMAGES.length];

              return (
                <div
                  key={frame.horse}
                  className={`cinematic-horse ${frame.isWinner ? 'winner' : ''}`}
                  style={{
                    transform: `translate3d(${frame.x}px, ${frame.y}px, 0)`
                  }}
                >
                  <div className="cinematic-horse-shadow"></div>
                  <img src={img} alt={`Caballo ${frame.horse}`} />
                  <b>{frame.horse}</b>
                  {phase === 'finished' && frame.rank <= 3 && <i>{frame.rank}º</i>}
                </div>
              );
            })}

            <div className="cinematic-dust dust-one"></div>
            <div className="cinematic-dust dust-two"></div>
          </div>
        </div>
      </div>

      <div className="cinematic-race-footer">
        <div>
          <span>Progreso</span>
          <strong>{Math.round(progress * 100)}%</strong>
        </div>
        <div>
          <span>Top 3 interno</span>
          <strong>{finalOrder.slice(0, 3).join(' · ')}</strong>
        </div>
        <button type="button" onClick={restartRace}>
          Reproducir otra carrera
        </button>
      </div>
    </section>
  );
}
