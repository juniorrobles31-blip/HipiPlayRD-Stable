import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { CinematicHorseRace } from './components/cinematicRace/CinematicHorseRace';
import './styles.css';

function RacePreview() {
  const [raceId, setRaceId] = useState(`preview-${Date.now()}`);
  const [winners, setWinners] = useState([4, 2, 6]);

  function randomizeWinners() {
    const horses = [1, 2, 3, 4, 5, 6].sort(() => Math.random() - 0.5);
    setWinners(horses.slice(0, 3));
    setRaceId(`preview-${Date.now()}`);
  }

  return (
    <main style={{
      minHeight: '100vh',
      background: '#06160f',
      padding: '20px',
      color: '#fff',
      boxSizing: 'border-box'
    }}>
      <section style={{ maxWidth: 980, margin: '0 auto' }}>
        <h1 style={{ marginBottom: 6 }}>HipiPlay — prueba carrera cinematográfica</h1>
        <p style={{ color: 'rgba(255,255,255,.7)', marginBottom: 16 }}>
          Los ganadores internos de esta prueba son: {winners.join(' · ')}
        </p>

        <CinematicHorseRace
          key={raceId}
          raceId={raceId}
          winners={winners}
          horseCount={6}
          durationMs={30000}
          autoStart
        />

        <button
          onClick={randomizeWinners}
          style={{
            marginTop: 16,
            border: 0,
            borderRadius: 14,
            padding: '14px 18px',
            background: '#facc15',
            color: '#052e16',
            fontWeight: 900,
            cursor: 'pointer'
          }}
        >
          Generar otra carrera random
        </button>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<RacePreview />);
