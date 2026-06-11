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

const RACE_DURATION_MS = 15_000;
const RACE_GIF_SRC = '/race-gifs/race-running.gif';

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
  selectedHorse,
  betAmount = 0,
  onFinish
}: RaceVideoEngineProps) {
  const finishSentRef = useRef(false);
  const [startedAt, setStartedAt] = useState<number | null>(autoPlay ? performance.now() : null);
  const [now, setNow] = useState(performance.now());
  const [isFinished, setIsFinished] = useState(false);

  const finalOrder = useMemo(() => buildFinalOrder(winners), [winners]);
  const top3 = finalOrder.slice(0, 3);

  const selectedRank = selectedHorse ? top3.indexOf(selectedHorse) + 1 : 0;
  const won = selectedRank > 0;
  const prizeCoins = won ? Math.floor(betAmount * getPrizeMultiplier(selectedRank)) : 0;

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

  const elapsed = startedAt ? now - startedAt : 0;
  const progress = clamp(elapsed / RACE_DURATION_MS, 0, 1);

  useEffect(() => {
    if (progress < 1 || finishSentRef.current) return;

    finishSentRef.current = true;
    setIsFinished(true);

    onFinish?.({
      raceId,
      templateId: 'fullscreen-gif-15s-engine',
      finalOrder,
      mapping: {
        A: finalOrder[0],
        B: finalOrder[1],
        C: finalOrder[2]
      }
    });
  }, [progress, raceId, finalOrder, onFinish]);

  return (
    <section className="race-gif-fullscreen-engine">
      {!isFinished && (
        <div className="race-gif-running-screen">
          <img
            src={RACE_GIF_SRC}
            alt="Carrera en curso"
            className="race-gif-running-image"
          />

          <div className="race-gif-running-overlay">
            <h2>Carrera en curso</h2>
          </div>
        </div>
      )}

      {isFinished && (
        <div className="race-gif-result-screen">
          <div className="result-panel-compact race-gif-result-panel">
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
