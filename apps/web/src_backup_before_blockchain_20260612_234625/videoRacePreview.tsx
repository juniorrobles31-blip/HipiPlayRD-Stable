import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { RaceVideoEngine } from './components/raceVideoEngine/RaceVideoEngine';

function VideoRacePreview() {
  const [raceId, setRaceId] = useState(`video-race-${Date.now()}`);
  const [winners, setWinners] = useState([4, 2, 6]);
  const [lastResult, setLastResult] = useState<any>(null);

  function generateRandomWinners() {
    const horses = [1, 2, 3, 4, 5, 6].sort(() => Math.random() - 0.5);
    setWinners(horses.slice(0, 3));
    setRaceId(`video-race-${Date.now()}`);
    setLastResult(null);
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at top, rgba(250,204,21,.12), transparent 32%), #03120a',
        padding: '20px',
        color: '#fff',
        boxSizing: 'border-box'
      }}
    >
      <section style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 6px' }}>HipiPlay — RaceVideoEngine</h1>

        <p style={{ color: 'rgba(255,255,255,.7)', margin: '0 0 18px' }}>
          Prueba aislada del motor de carrera con video real y resultado controlado.
        </p>

        <div
          style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginBottom: 16
          }}
        >
          <div
            style={{
              background: 'rgba(255,255,255,.08)',
              border: '1px solid rgba(255,255,255,.12)',
              borderRadius: 14,
              padding: '10px 14px'
            }}
          >
            Ganadores definidos: <strong>{winners.join(' · ')}</strong>
          </div>

          <button
            type="button"
            onClick={generateRandomWinners}
            style={{
              border: 0,
              borderRadius: 14,
              padding: '12px 16px',
              background: '#facc15',
              color: '#052e16',
              fontWeight: 900,
              cursor: 'pointer'
            }}
          >
            Generar ganadores random
          </button>
        </div>

        <RaceVideoEngine
          key={raceId}
          raceId={raceId}
          winners={winners}
          onFinish={(result) => setLastResult(result)}
        />

        {lastResult && (
          <pre
            style={{
              marginTop: 16,
              padding: 16,
              borderRadius: 16,
              background: 'rgba(0,0,0,.45)',
              border: '1px solid rgba(255,255,255,.12)',
              overflowX: 'auto'
            }}
          >
            {JSON.stringify(lastResult, null, 2)}
          </pre>
        )}
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<VideoRacePreview />);
