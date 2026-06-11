import horse1 from "../assets/horses/horse-1.png";
import horse2 from "../assets/horses/horse-2.png";
import horse3 from "../assets/horses/horse-3.png";
import horse4 from "../assets/horses/horse-4.png";
import horse5 from "../assets/horses/horse-5.png";
import horse6 from "../assets/horses/horse-6.png";

type HorseBetGridProps = {
  selectedHorse: number;
  onSelect: (horse: number) => void;
};

const horses = [
  { number: 1, image: horse1 },
  { number: 2, image: horse2 },
  { number: 3, image: horse3 },
  { number: 4, image: horse4 },
  { number: 5, image: horse5 },
  { number: 6, image: horse6 }
];

export function HorseBetGrid({ selectedHorse, onSelect }: HorseBetGridProps) {
  return (
    <div className="horse-bet-grid">
      {horses.map((horse) => (
        <button
          key={horse.number}
          type="button"
          className={`horse-bet-card ${selectedHorse === horse.number ? "active" : ""}`}
          onClick={() => onSelect(horse.number)}
        >
          <div className="horse-bet-card-number">#{horse.number}</div>
          <img
            src={horse.image}
            alt={`Caballo ${horse.number}`}
            className="horse-bet-card-image"
          />
        </button>
      ))}
    </div>
  );
}
