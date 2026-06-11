import './BettingHorsesPreview.css';

import horse1 from '../../assets/cinematic-race/h1.gif';
import horse2 from '../../assets/cinematic-race/h2.gif';
import horse3 from '../../assets/cinematic-race/h3.gif';
import horse4 from '../../assets/cinematic-race/h4.gif';
import horse5 from '../../assets/cinematic-race/h5.gif';
import horse6 from '../../assets/cinematic-race/h6.gif';

type BettingHorsesPreviewProps = {
  secondsLeft: number;
  selectedHorse?: number;
};

const HORSES = [
  { id: 1, color: '#ef4444', image: horse1 },
  { id: 2, color: '#3b82f6', image: horse2 },
  { id: 3, color: '#22c55e', image: horse3 },
  { id: 4, color: '#facc15', image: horse4 },
  { id: 5, color: '#a855f7', image: horse5 },
  { id: 6, color: '#f97316', image: horse6 }
];

export function BettingHorsesPreview({
  secondsLeft,
  selectedHorse
}: BettingHorsesPreviewProps) {
  return (
    <section className="betting-preview-panel">
      <div className="betting-preview-top">
        <div className="betting-preview-title-block">
          <span className="betting-preview-kicker">APUESTAS ABIERTAS</span>
          <h2>Elige tu caballo</h2>
        </div>

        <div className="betting-preview-timer">
          <small>Tiempo</small>
          <strong>{secondsLeft}s</strong>
        </div>
      </div>

      <div className="betting-preview-grid">
        {HORSES.map((horse) => (
          <div
            key={horse.id}
            className={`betting-preview-card ${selectedHorse === horse.id ? 'selected' : ''}`}
          >
            <div
              className="betting-preview-badge"
              style={{ backgroundColor: horse.color }}
            >
              #{horse.id}
            </div>

            <div className="betting-preview-image-wrap">
              <img
                src={horse.image}
                alt={`Caballo ${horse.id}`}
                className="betting-preview-image"
              />
            </div>

            <div className="betting-preview-name">Caballo {horse.id}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
