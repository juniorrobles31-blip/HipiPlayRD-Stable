import resultTop3Bg from '../../assets/results-top3-bg.png';

type ServerWinner =
  | number
  | string
  | {
      id?: number | string;
      horseId?: number | string;
      horse?: number | string;
      number?: number | string;
      selectedHorse?: number | string;
    };

type ServerRaceResultPanelProps = {
  winners: ServerWinner[];
  selectedHorse?: number;
  betAmount?: number;
  secondsLeft?: number;
  serverPlayerResult?: any;
};

function normalizeWinner(winner: ServerWinner): number | null {
  if (typeof winner === 'number') return winner;

  if (typeof winner === 'string') {
    const parsed = Number(winner);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (winner && typeof winner === 'object') {
    const value =
      winner.id ??
      winner.horseId ??
      winner.horse ??
      winner.number ??
      winner.selectedHorse;

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

const HORSE_VISUALS: Record<number, {
  accent: string;
  tint: string;
  text: string;
  label: string;
}> = {
  1: { accent: '#dc2626', tint: 'rgba(220, 38, 38, 0.18)', text: '#ffffff', label: '#1' }, // rojo
  2: { accent: '#2563eb', tint: 'rgba(37, 99, 235, 0.18)', text: '#ffffff', label: '#2' }, // azul
  3: { accent: '#16a34a', tint: 'rgba(22, 163, 74, 0.18)', text: '#ffffff', label: '#3' }, // verde
  4: { accent: '#facc15', tint: 'rgba(250, 204, 21, 0.18)', text: '#111827', label: '#4' }, // amarillo
  5: { accent: '#7c3aed', tint: 'rgba(124, 58, 237, 0.18)', text: '#ffffff', label: '#5' }, // morado
  6: { accent: '#f97316', tint: 'rgba(249, 115, 22, 0.18)', text: '#ffffff', label: '#6' }, // naranja
};

function getHorseVisual(horseId: number | null) {
  if (!horseId || !HORSE_VISUALS[horseId]) {
    return {
      accent: '#94a3b8',
      tint: 'rgba(148, 163, 184, 0.18)',
      text: '#ffffff',
      label: '-'
    };
  }

  return HORSE_VISUALS[horseId];
}

export function ServerRaceResultPanel({
  winners
}: ServerRaceResultPanelProps) {
  const officialWinners = (Array.isArray(winners) ? winners : [])
    .map(normalizeWinner)
    .filter((winner): winner is number => winner !== null && Number.isFinite(winner) && winner >= 1 && winner <= 6)
    .slice(0, 3);

  const podium = [
    { place: '1.º', horseId: officialWinners[0] ?? null, className: 'podium-slot podium-slot-left' },
    { place: '2.º', horseId: officialWinners[1] ?? null, className: 'podium-slot podium-slot-center' },
    { place: '3.º', horseId: officialWinners[2] ?? null, className: 'podium-slot podium-slot-right' }
  ];

  return (
    <section className="server-results-fullscreen-image">
      <div className="server-results-stage-image">
        <img
          src={resultTop3Bg}
          alt="Resultado oficial Top 3"
          className="server-results-bg-image"
        />

        <div className="server-results-image-overlay">
          {podium.map((item) => {
            const visual = getHorseVisual(item.horseId);

            return (
              <div key={item.place} className={item.className}>
<div
                  className="podium-horse-chip"
                  style={{
                    borderColor: visual.accent,
                    background: `linear-gradient(180deg, rgba(6, 10, 14, 0.92) 0%, rgba(6, 10, 14, 0.88) 100%), ${visual.tint}`,
                    boxShadow: `0 0 0 1px ${visual.accent}40, 0 10px 24px rgba(0,0,0,0.28)`
                  }}
                >
                  <span
                    className="podium-horse-chip-accent"
                    style={{ background: visual.accent }}
                  />
                  <strong
                    className="podium-horse-chip-number"
                    style={{ color: visual.text }}
                  >
                    {item.horseId ? `#${item.horseId}` : '-'}
                  </strong>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}