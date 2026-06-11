import { useEffect, useRef, useState } from 'react';
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

export function RaceVideoEngine({
  raceId,
  autoPlay = true,
  startAtSeconds = 0,
  onFinish
}: RaceVideoEngineProps) {
  const finishSentRef = useRef(false);
  const initialStartAtSecondsRef = useRef(Math.max(0, startAtSeconds || 0));

  const [startedAt, setStartedAt] = useState<number | null>(autoPlay ? performance.now() : null);
  const [now, setNow] = useState(performance.now());

  useEffect(() => {
    finishSentRef.current = false;
    initialStartAtSecondsRef.current = Math.max(0, startAtSeconds || 0);
    setStartedAt(performance.now());
    setNow(performance.now());
  }, [raceId, startAtSeconds]);

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

    onFinish?.({
      raceId,
      templateId: 'server-race-running-only',
      finalOrder: [],
      mapping: {}
    });
  }, [progress, raceId, onFinish]);

  return (
    <section className="race-image-fullscreen-engine">
      <div className="race-image-running-screen">
        <img
          src={RACE_IMAGE_SRC}
          alt="Carrera en curso"
          className="race-image-running-img"
        />

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
    </section>
  );
}

