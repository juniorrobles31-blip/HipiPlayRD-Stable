import { useEffect, useMemo, useRef, useState } from 'react';
import './raceVideoEngine.css';

type RaceTemplate = {
  id: string;
  src: string;
  duration: number;
  visualWinnerSlots: string[];
  finishMoment: number;
  closeUpStart: number;
  closeUpEnd: number;
  cameraType: string;
  startGateVisible: boolean;
  finishLineVisible: boolean;
  notes?: string;
};

type RaceVideoEngineProps = {
  winners: number[];
  raceId: string;
  autoPlay?: boolean;
  onFinish?: (result: RaceResult) => void;
};

type RaceResult = {
  raceId: string;
  templateId: string;
  finalOrder: number[];
  mapping: Record<string, number>;
};

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const min = Math.floor(safeSeconds / 60);
  const sec = safeSeconds % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function buildMapping(winners: number[], visualSlots: string[]) {
  const mapping: Record<string, number> = {};

  visualSlots.forEach((slot, index) => {
    mapping[slot] = winners[index];
  });

  return mapping;
}

function buildFinalOrder(winners: number[]) {
  const allHorses = [1, 2, 3, 4, 5, 6];
  const cleanWinners = winners.filter((horse) => allHorses.includes(horse)).slice(0, 3);
  const others = allHorses.filter((horse) => !cleanWinners.includes(horse));

  return [...cleanWinners, ...others];
}

export function RaceVideoEngine({
  winners,
  raceId,
  autoPlay = false,
  onFinish
}: RaceVideoEngineProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [templates, setTemplates] = useState<RaceTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<RaceTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isStarted, setIsStarted] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const finalOrder = useMemo(() => buildFinalOrder(winners), [winners]);

  const mapping = useMemo(() => {
    if (!selectedTemplate) return {};
    return buildMapping(winners, selectedTemplate.visualWinnerSlots);
  }, [winners, selectedTemplate]);

  useEffect(() => {
    let cancelled = false;

    async function loadMetadata() {
      try {
        setLoading(true);
        setLoadError('');

        const response = await fetch('/race-videos/metadata.json', {
          cache: 'no-store'
        });

        if (!response.ok) {
          throw new Error(`No se pudo cargar metadata.json. HTTP ${response.status}`);
        }

        const data = (await response.json()) as RaceTemplate[];

        if (!Array.isArray(data) || data.length === 0) {
          throw new Error('metadata.json está vacío o no tiene formato válido.');
        }

        if (!cancelled) {
          setTemplates(data);
          setSelectedTemplate(data[0]);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Error desconocido cargando metadata.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadMetadata();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!autoPlay || !selectedTemplate || !videoRef.current) return;

    const video = videoRef.current;

    video
      .play()
      .then(() => {
        setIsStarted(true);
      })
      .catch(() => {
        setIsStarted(false);
      });
  }, [autoPlay, selectedTemplate]);

  function finishRace() {
    if (!selectedTemplate || isFinished) return;

    const result: RaceResult = {
      raceId,
      templateId: selectedTemplate.id,
      finalOrder,
      mapping
    };

    setIsFinished(true);
    onFinish?.(result);
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video || !selectedTemplate) return;

    const time = video.currentTime;
    setCurrentTime(time);

    if (time >= selectedTemplate.closeUpEnd) {
      finishRace();
    }
  }

  function handleEnded() {
    finishRace();
  }

  async function startRace() {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    setCurrentTime(0);
    setIsFinished(false);

    await video.play();
    setIsStarted(true);
  }

  function replayRace() {
    startRace();
  }

  if (loading) {
    return (
      <section className="race-video-engine loading">
        <strong>Cargando motor de carrera...</strong>
      </section>
    );
  }

  if (loadError || !selectedTemplate) {
    return (
      <section className="race-video-engine error">
        <strong>Error cargando RaceVideoEngine</strong>
        <p>{loadError || 'No hay plantilla de carrera seleccionada.'}</p>
      </section>
    );
  }

  const remaining = Math.max(0, selectedTemplate.duration - currentTime);
  const isCloseUp = currentTime >= selectedTemplate.closeUpStart;
  const isFinishMoment = currentTime >= selectedTemplate.finishMoment;

  return (
    <section className="race-video-engine">
      <div className="race-video-header">
        <div>
          <span>HIPIPLAY LIVE</span>
          <strong>Carrera hípica generada</strong>
        </div>

        <div className="race-video-status">
          {!isStarted && 'Lista para iniciar'}
          {isStarted && !isFinished && !isFinishMoment && 'En carrera'}
          {isStarted && !isFinished && isFinishMoment && 'Llegada a meta'}
          {isFinished && 'Resultado oficial'}
        </div>
      </div>

      <div className="race-video-stage">
        <video
          ref={videoRef}
          className="race-video-player"
          src={selectedTemplate.src}
          playsInline
          muted
          preload="auto"
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
        />

        <div className="race-video-overlay top-left">
          <span>Plantilla</span>
          <strong>{selectedTemplate.id}</strong>
        </div>

        <div className="race-video-overlay top-right">
          <span>Tiempo</span>
          <strong>{formatTime(remaining)}</strong>
        </div>

        {!isStarted && (
          <div className="race-video-start-panel">
            <h2>Carrera lista</h2>
            <p>
              El video real se reproduce como una carrera visual. El resultado interno ya está
              calculado antes de iniciar.
            </p>
            <button type="button" onClick={startRace}>
              Iniciar carrera
            </button>
          </div>
        )}

        {isStarted && !isFinished && (
          <div className="race-video-live-badge">
            <span></span>
            EN VIVO
          </div>
        )}

        {isCloseUp && !isFinished && (
          <div className="race-video-closeup-label">
            Close-up final de los caballos ganadores
          </div>
        )}

        {isFinished && (
          <div className="race-video-result-panel">
            <span>Resultado oficial</span>
            <h2>Top 3 HipiPlay</h2>

            <div className="race-video-podium">
              <div>
                <small>1.º lugar</small>
                <strong>Caballo {finalOrder[0]}</strong>
              </div>
              <div>
                <small>2.º lugar</small>
                <strong>Caballo {finalOrder[1]}</strong>
              </div>
              <div>
                <small>3.º lugar</small>
                <strong>Caballo {finalOrder[2]}</strong>
              </div>
            </div>

            <button type="button" onClick={replayRace}>
              Reproducir de nuevo
            </button>
          </div>
        )}
      </div>

      <div className="race-video-footer">
        <div>
          <span>Video</span>
          <strong>{selectedTemplate.src}</strong>
        </div>

        <div>
          <span>Tipo de cámara</span>
          <strong>{selectedTemplate.cameraType}</strong>
        </div>

        <div>
          <span>Videos cargados</span>
          <strong>{templates.length}</strong>
        </div>
      </div>
    </section>
  );
}
