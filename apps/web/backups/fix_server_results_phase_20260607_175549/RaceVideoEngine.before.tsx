import { useEffect, useMemo, useRef, useState } from 'react';
import './raceVideoEngine.css';

type RaceVideoEngineProps = {
  winners: number[];
  raceId: string;
  autoPlay?: boolean;
  startAtSeconds?: number;
  selectedHorse?: number;
  betAmount?: number;
  onFinish?: (result: RaceResult) => void;
};

type RaceResult = {
  raceId: string;
  templateId: string;
  finalOrder: number[];
  mapping: Record<string, number>;
};

const RACE_DURATION_MS = 20_000;
const RACE_IMAGE_SRC = '/race-images/race-running.png';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function coins(value: number) {
  return new Intl.NumberFormat('es-DO', {
    maximumFractionDigits: 0
  }).format(Math.max(0, Math.floor(Number(value || 0))));
}

function buildFinalOrder(winners: number[]) {
  const allHorses = [1, 2, 3, 4, 5, 6];
  const cleanWinners = winners.filter((horse) => allHorses.includes(horse)).slice(0, 3);
  const others = allHorses.filter((horse) => !cleanWinners.includes(horse));

  return [...cleanWinners, ...others];
}

function getPrizeMultiplier(rank: number) {
  if (rank === 1) return 3;
  if (rank === 2) return 2;
  if (rank === 3) return 1.5;
  return 0;
}

export function RaceVideoEngine({
  winners,
  raceId,
  autoPlay = true,
  startAtSeconds = 0,
  selectedHorse,
  betAmount = 0,
  onFinish
}: RaceVideoEngineProps) {
  const finishSentRef = useRef(false);
  const initialStartAtSecondsRef = useRef(Math.max(0, startAtSeconds || 0));

  const [startedAt, setStartedAt] = useState<number | null>(autoPlay ? performance.now() : null);
  const [now, setNow] = useState(performance.now());
  const [isFinished, setIsFinished] = useState(false);

  const finalOrder = useMemo(() => buildFinalOrder(winners), [winners]);
  const top3 = finalOrder.slice(0, 3);

  const selectedRank = selectedHorse ? top3.indexOf(selectedHorse) + 1 : 0;
  const won = selectedRank > 0;
  const prizeCoins = won ? Math.floor(betAmount * getPrizeMultiplier(selectedRank)) : 0;

  useEffect(() => {
    finishSentRef.current = false;
    initialStartAtSecondsRef.current = Math.max(0, startAtSeconds || 0);
    setStartedAt(performance.now());
    setNow(performance.now());
    setIsFinished(false);
  }, [raceId]);

  useEffect(() => {
    if (!startedAt && autoPlay) {
      setStartedAt(performance.now());
    }
  }, [autoPlay, startedAt]);

  useEffect(() => {
    let frame = 0;

    const tick = () => {
      setNow(performance.now());
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, []);

  const localElapsed = startedAt ? now - startedAt : 0;
  const serverOffsetElapsed = initialStartAtSecondsRef.current * 1000;
  const elapsed = serverOffsetElapsed + localElapsed;
  const progress = clamp(elapsed / RACE_DURATION_MS, 0, 1);
  const secondsRemaining = Math.max(0, Math.ceil((RACE_DURATION_MS - elapsed) / 1000));

  useEffect(() => {
    if (progress < 1 || finishSentRef.current) return;

    finishSentRef.current = true;
    setIsFinished(true);

    onFinish?.({
      raceId,
      templateId: 'server-synced-image-20s-loader-engine',
      finalOrder,
      mapping: {
        A: finalOrder[0],
        B: finalOrder[1],
        C: finalOrder[2]
      }
    });
  }, [progress, raceId, finalOrder, onFinish]);

  return (
    <section className="race-image-fullscreen-engine">
      {!isFinished && (
        <div className="race-image-running-screen">
          <img
            src={RACE_IMAGE_SRC}
            alt="Carrera en curso"
            className="race-image-running-img"
          />

          <div className="race-image-overlay">
            <h2>Carrera en curso</h2>
          </div>

          <div className="race-image-loader-wrap">
            <div className="race-image-loader-info">
              <span>Procesando carrera</span>
              <strong>{secondsRemaining}s</strong>
            </div>

            <div className="race-image-loader-track">
              <div style={{ width: `${progress * 100}%` }}></div>
            </div>
          </div>
        </div>
      )}

      {isFinished && (
        <div className="race-image-result-screen">
          <div className="result-panel-compact race-image-result-panel">
            <span className="result-kicker">RESULTADO OFICIAL</span>
            <h2>Top 3</h2>

            <div className="result-top3-grid">
              <div>
                <small>1.º</small>
                <strong>#{top3[0]}</strong>
              </div>

              <div>
                <small>2.º</small>
                <strong>#{top3[1]}</strong>
              </div>

              <div>
                <small>3.º</small>
                <strong>#{top3[2]}</strong>
              </div>
            </div>

            <div className={`result-coins-box ${won ? 'win' : 'loss'}`}>
              <small>Monedas ganadas</small>
              <strong>{coins(prizeCoins)}</strong>
              <span>
                {!selectedHorse
                  ? 'Sin boleto activo para esta carrera.'
                  : won
                    ? `Tu caballo #${selectedHorse} quedó en el Top 3.`
                    : `Tu caballo #${selectedHorse} no quedó en el Top 3.`}
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
