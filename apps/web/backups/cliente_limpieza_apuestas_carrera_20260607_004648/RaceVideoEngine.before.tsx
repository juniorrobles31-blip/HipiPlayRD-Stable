import { useEffect, useMemo, useRef, useState } from 'react';
import horse1 from '../../assets/cinematic-race/h1.gif';
import horse2 from '../../assets/cinematic-race/h2.gif';
import horse3 from '../../assets/cinematic-race/h3.gif';
import horse4 from '../../assets/cinematic-race/h4.gif';
import horse5 from '../../assets/cinematic-race/h5.gif';
import horse6 from '../../assets/cinematic-race/h6.gif';
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

const HORSE_IMAGES = [horse1, horse2, horse3, horse4, horse5, horse6];

const HORSE_COLORS = [
  '#ef4444',
  '#3b82f6',
  '#22c55e',
  '#facc15',
  '#a855f7',
  '#f97316'
];

const RACE_DURATION_MS = 20_000;
const FINISH_ANIMATION_MS = 5_000;

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
  const secondsRemaining = Math.max(0, Math.ceil((RACE_DURATION_MS - elapsed) / 1000));
  const finishStartAt = RACE_DURATION_MS - FINISH_ANIMATION_MS;
  const isFinalAnimation = elapsed >= finishStartAt && !isFinished;
  const finishProgress = clamp((elapsed - finishStartAt) / FINISH_ANIMATION_MS, 0, 1);

  useEffect(() => {
    if (progress < 1 || finishSentRef.current) return;

    finishSentRef.current = true;
    setIsFinished(true);

    onFinish?.({
      raceId,
      templateId: 'gif-result-engine',
      finalOrder,
      mapping: {
        A: finalOrder[0],
        B: finalOrder[1],
        C: finalOrder[2]
      }
    });
  }, [progress, raceId, finalOrder, onFinish]);

  return (
    <section className="race-video-engine race-result-engine">
      <div className="race-video-header">
        <div>
          <span>HIPIPLAY LIVE</span>
          <strong>{isFinished ? 'Resultado oficial' : 'Carrera en curso'}</strong>
        </div>

        <div className="race-video-status">
          {!isFinished && !isFinalAnimation && 'En curso'}
          {!isFinished && isFinalAnimation && 'Llegada a meta'}
          {isFinished && 'Resultado oficial'}
        </div>
      </div>

      <div className="race-result-stage">
        {!isFinished && (
          <>
            <div className="race-progress-simple">
              <span className="race-mini-kicker">HIPIPLAY LIVE</span>
              <h2>Carrera en curso</h2>

              <div className="race-progress-bar-simple">
                <div style={{ width: `${progress * 100}%` }}></div>
              </div>

              <strong>{secondsRemaining}s</strong>
            </div>

            {isFinalAnimation && (
              <div className="finish-preview-compact">
                <div className="finish-line-marker">META</div>

                {top3.map((horse, index) => {
                  const horseImage = HORSE_IMAGES[(horse - 1) % HORSE_IMAGES.length];
                  const color = HORSE_COLORS[(horse - 1) % HORSE_COLORS.length];
                  const left = 12 + finishProgress * (72 + (2 - index) * 4);

                  return (
                    <div
                      key={horse}
                      className="finish-preview-lane"
                      style={{ top: `${18 + index * 28}%` }}
                    >
                      <div
                        className="finish-preview-runner"
                        style={{ left: `${left}%` }}
                      >
                        <div
                          className="finish-preview-number"
                          style={{ backgroundColor: color }}
                        >
                          #{horse}
                        </div>

                        <img src={horseImage} alt={`Caballo ${horse}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {isFinished && (
          <div className="result-panel-compact">
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
        )}
      </div>

      <div className="race-video-footer race-result-footer">
        <div>
          <span>Carrera</span>
          <strong>20 segundos</strong>
        </div>

        <div>
          <span>Final</span>
          <strong>Últimos 5s</strong>
        </div>

        <div>
          <span>Resultado</span>
          <strong>Top 3</strong>
        </div>
      </div>
    </section>
  );
}
