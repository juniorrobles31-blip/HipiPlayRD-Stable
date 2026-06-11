import { useEffect, useMemo, useRef, useState } from 'react';
import './raceVideoEngine.css';

type MaskArea = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  blur?: boolean;
  text?: string;
  variant?: 'brand' | 'dark' | 'blur';
};

type RaceTemplate = {
  id: string;
  src: string;
  duration: number;
  visualWinnerSlots: string[];
  finishMoment: number;
  firstHorseCrossAt?: number;
  secondHorseCrossAt?: number;
  thirdHorseCrossAt?: number;
  resultShowAt?: number;
  closeUpStart: number;
  closeUpEnd: number;
  cameraType: string;
  startGateVisible: boolean;
  finishLineVisible: boolean;
  maskAreas?: MaskArea[];
  notes?: string;
};

type RaceVideoEngineProps = {
  winners: number[];
  raceId: string;
  autoPlay?: boolean;
  startAtSeconds?: number;
  onFinish?: (result: RaceResult) => void;
};

type RaceResult = {
  raceId: string;
  templateId: string;
  finalOrder: number[];
  mapping: Record<string, number>;
};

const RECENT_TEMPLATES_KEY = 'hipiplay_recent_race_templates';
const MAX_RECENT_TEMPLATES = 10;

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const min = Math.floor(safeSeconds / 60);
  const sec = safeSeconds % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function hashText(text: string) {
  let hash = 2166136261;

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return Math.abs(hash >>> 0);
}

function getRecentTemplates() {
  try {
    const raw = localStorage.getItem(RECENT_TEMPLATES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item) => typeof item === 'string');
  } catch {
    return [];
  }
}

function saveRecentTemplate(templateId: string) {
  const current = getRecentTemplates();
  const updated = [templateId, ...current.filter((id) => id !== templateId)].slice(
    0,
    MAX_RECENT_TEMPLATES
  );

  localStorage.setItem(RECENT_TEMPLATES_KEY, JSON.stringify(updated));
}

function selectRaceTemplate(templates: RaceTemplate[], raceId: string) {
  const recent = getRecentTemplates();

  let available = templates.filter((template) => !recent.includes(template.id));

  if (available.length === 0) {
    available = templates;
  }

  const seed = hashText(`${raceId}-${Date.now()}-${Math.random()}`);
  const index = seed % available.length;

  return available[index];
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
  startAtSeconds = 0,
  onFinish
}: RaceVideoEngineProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const templateMarkedAsUsedRef = useRef(false);
  const finishSentRef = useRef(false);

  const [templates, setTemplates] = useState<RaceTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<RaceTemplate | null>(null);
  const [recentTemplates, setRecentTemplates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isStarted, setIsStarted] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [actualDuration, setActualDuration] = useState(0);

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
        templateMarkedAsUsedRef.current = false;
        finishSentRef.current = false;

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

        const selected = selectRaceTemplate(data, raceId);

        if (!cancelled) {
          setTemplates(data);
          setSelectedTemplate(selected);
          setRecentTemplates(getRecentTemplates());
          setIsStarted(false);
          setIsFinished(false);
          setCurrentTime(0);
          setActualDuration(0);
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
  }, [raceId]);

  useEffect(() => {
    if (!autoPlay || !selectedTemplate || !videoRef.current) return;

    const video = videoRef.current;

    const safeStart =
      startAtSeconds > 0 && Number.isFinite(video.duration)
        ? Math.min(Math.max(0, startAtSeconds), Math.max(0, video.duration - 1))
        : 0;

    video.currentTime = safeStart;
    setCurrentTime(safeStart);

    video
      .play()
      .then(() => {
        markTemplateAsUsed();
        setIsStarted(true);
      })
      .catch(() => {
        setIsStarted(false);
      });
  }, [autoPlay, selectedTemplate, startAtSeconds]);

  function markTemplateAsUsed() {
    if (!selectedTemplate || templateMarkedAsUsedRef.current) return;

    saveRecentTemplate(selectedTemplate.id);
    setRecentTemplates(getRecentTemplates());
    templateMarkedAsUsedRef.current = true;
  }

  function finishRaceByRealVideoEnd() {
    if (!selectedTemplate || finishSentRef.current) return;

    finishSentRef.current = true;

    const result: RaceResult = {
      raceId,
      templateId: selectedTemplate.id,
      finalOrder,
      mapping
    };

    setIsFinished(true);
    onFinish?.(result);
  }

  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;

    if (Number.isFinite(video.duration) && video.duration > 0) {
      setActualDuration(video.duration);
    }
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;

    setCurrentTime(video.currentTime);

    /**
     * Fallback de seguridad:
     * algunos navegadores tardan en disparar onEnded.
     * Si el currentTime llega al final real del MP4, cerramos la carrera.
     */
    if (
      Number.isFinite(video.duration) &&
      video.duration > 0 &&
      video.currentTime >= video.duration - 0.25
    ) {
      finishRaceByRealVideoEnd();
    }
  }

  function handleEnded() {
    finishRaceByRealVideoEnd();
  }

  async function startRace() {
    const video = videoRef.current;
    if (!video) return;

    finishSentRef.current = false;
    video.currentTime = 0;

    setCurrentTime(0);
    setIsFinished(false);

    await video.play();

    markTemplateAsUsed();
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

  const realDuration = actualDuration || selectedTemplate.duration || 0;
  const remaining = Math.max(0, realDuration - currentTime);
  const isCloseUp = realDuration > 0 && currentTime >= realDuration - 6;
  const isFinalStretch = realDuration > 0 && currentTime >= realDuration - 12;

  return (
    <section className="race-video-engine">
      <div className="race-video-header">
        <div>
          <span>HIPIPLAY LIVE</span>
          <strong>Carrera hípica generada</strong>
        </div>

        <div className="race-video-status">
          {!isStarted && 'Lista para iniciar'}
          {isStarted && !isFinished && !isFinalStretch && 'En carrera'}
          {isStarted && !isFinished && isFinalStretch && 'Recta final'}
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
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
        />

        {(selectedTemplate.maskAreas || []).map((mask, index) => (
          <div
            key={`${mask.label}-${index}`}
            className={`race-video-mask ${mask.variant || 'dark'} ${mask.blur ? 'with-blur' : ''}`}
            title={mask.label}
            style={{
              left: `${mask.x}%`,
              top: `${mask.y}%`,
              width: `${mask.width}%`,
              height: `${mask.height}%`,
              opacity: mask.opacity ?? 0.82
            }}
          >
            {mask.text && <span>{mask.text}</span>}
          </div>
        ))}

        <div className="race-video-overlay top-left">
          <span>Video seleccionado</span>
          <strong>{selectedTemplate.id}</strong>
        </div>

        <div className="race-video-overlay top-right">
          <span>Tiempo restante</span>
          <strong>{formatTime(remaining)}</strong>
        </div>

        {!isStarted && (
          <div className="race-video-start-panel">
            <h2>Carrera lista</h2>
            <p>
              El motor seleccionó automáticamente un video limpio. El resultado aparecerá únicamente
              cuando el MP4 termine por completo.
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
            Cierre final
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
          <span>Resultado</span>
          <strong>Al terminar el MP4</strong>
        </div>

        <div>
          <span>Duración real detectada</span>
          <strong>{realDuration ? `${Math.round(realDuration)}s` : 'Detectando...'}</strong>
        </div>

        <div>
          <span>Usados recientemente</span>
          <strong>{recentTemplates.length}</strong>
        </div>
      </div>
    </section>
  );
}
