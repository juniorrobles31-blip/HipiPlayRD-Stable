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

function getSafeStartAtSeconds(value: number, template: RaceTemplate) {
  const maxStart = Math.max(0, Math.min(template.duration, template.closeUpEnd) - 1);
  return Math.min(Math.max(0, value || 0), maxStart);
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

  const [templates, setTemplates] = useState<RaceTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<RaceTemplate | null>(null);
  const [recentTemplates, setRecentTemplates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isStarted, setIsStarted] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [resultAnnounced, setResultAnnounced] = useState(false);
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
        templateMarkedAsUsedRef.current = false;

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
    const safeStart = getSafeStartAtSeconds(startAtSeconds, selectedTemplate);

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

  function announceResult() {
    if (!selectedTemplate || resultAnnounced) return;

    const result: RaceResult = {
      raceId,
      templateId: selectedTemplate.id,
      finalOrder,
      mapping
    };

    setResultAnnounced(true);
    onFinish?.(result);
  }

  function finishCloseUp() {
    if (isFinished) return;
    setIsFinished(true);
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video || !selectedTemplate) return;

    const time = video.currentTime;
    setCurrentTime(time);

    const resultShowAt =
      selectedTemplate.resultShowAt ??
      selectedTemplate.thirdHorseCrossAt ??
      selectedTemplate.finishMoment;

    if (time >= resultShowAt && !resultAnnounced) {
      announceResult();
    }

    if (time >= selectedTemplate.closeUpEnd) {
      finishCloseUp();
    }
  }

  function handleEnded() {
    if (!resultAnnounced) {
      announceResult();
    }

    finishCloseUp();
  }

  async function startRace() {
    const video = videoRef.current;
    if (!video) return;

    const safeStart = selectedTemplate ? getSafeStartAtSeconds(startAtSeconds, selectedTemplate) : 0;

    video.currentTime = safeStart;
    setCurrentTime(safeStart);
    setIsFinished(false);
    setResultAnnounced(false);

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

  const resultShowAt =
    selectedTemplate.resultShowAt ??
    selectedTemplate.thirdHorseCrossAt ??
    selectedTemplate.finishMoment;

  const remaining = Math.max(0, selectedTemplate.duration - currentTime);
  const isCloseUp = currentTime >= selectedTemplate.closeUpStart;
  const isFinishMoment = currentTime >= selectedTemplate.finishMoment;
  const isResultMoment = currentTime >= resultShowAt;

  return (
    <section className="race-video-engine">
      <div className="race-video-header">
        <div>
          <span>HIPIPLAY LIVE</span>
          <strong>Carrera hípica generada</strong>
        </div>

        <div className="race-video-status">
          {!isStarted && 'Lista para iniciar'}
          {isStarted && !resultAnnounced && !isFinishMoment && 'En carrera'}
          {isStarted && !resultAnnounced && isFinishMoment && 'Llegada a meta'}
          {resultAnnounced && !isFinished && 'Resultado confirmado'}
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
          <span>Tiempo</span>
          <strong>{formatTime(remaining)}</strong>
        </div>

        {!isStarted && (
          <div className="race-video-start-panel">
            <h2>Carrera lista</h2>
            <p>
              El motor seleccionó automáticamente un video limpio evitando repetir los usados recientemente.
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
            Close-up final
          </div>
        )}

        {isResultMoment && !isFinished && (
          <div className="race-video-announced-result">
            <span>Resultado oficial</span>
            <strong>
              1.º #{finalOrder[0]} · 2.º #{finalOrder[1]} · 3.º #{finalOrder[2]}
            </strong>
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
          <span>Resultado aparece en</span>
          <strong>{resultShowAt}s</strong>
        </div>

        <div>
          <span>Videos disponibles</span>
          <strong>{templates.length}</strong>
        </div>

        <div>
          <span>Usados recientemente</span>
          <strong>{recentTemplates.length}</strong>
        </div>
      </div>
    </section>
  );
}

