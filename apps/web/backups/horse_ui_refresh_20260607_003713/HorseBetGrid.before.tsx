import horse1 from '../assets/cinematic-race/h1.gif';
import horse2 from '../assets/cinematic-race/h2.gif';
import horse3 from '../assets/cinematic-race/h3.gif';
import horse4 from '../assets/cinematic-race/h4.gif';
import horse5 from '../assets/cinematic-race/h5.gif';
import horse6 from '../assets/cinematic-race/h6.gif';

type HorseBetGridProps = {
  selectedHorse: number;
  onSelect: (horse: number) => void;
};

const HORSES = [
  { id: 1, number: '01', color: '#d97706', image: horse1 },
  { id: 2, number: '02', color: '#9333ea', image: horse2 },
  { id: 3, number: '03', color: '#16a34a', image: horse3 },
  { id: 4, number: '04', color: '#0284c7', image: horse4 },
  { id: 5, number: '05', color: '#9ca3af', image: horse5 },
  { id: 6, number: '06', color: '#6b7280', image: horse6 }
];

export function HorseBetGrid({ selectedHorse, onSelect }: HorseBetGridProps) {
  return (
    <div className="horse-bet-grid">
      {HORSES.map((horse) => {
        const active = selectedHorse === horse.id;

        return (
          <button
            key={horse.id}
            type="button"
            className={`horse-bet-card ${active ? 'active' : ''}`}
            onClick={() => onSelect(horse.id)}
          >
            <div className="horse-bet-number" style={{ color: horse.color }}>
              {horse.number}
            </div>

            <div className="horse-bet-image-wrap">
              <img
                src={horse.image}
                alt={`Caballo ${horse.number}`}
                className="horse-bet-image"
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}
