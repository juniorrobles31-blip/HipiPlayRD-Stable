type BettingHorsesPreviewProps = {
  secondsLeft: number;
  selectedHorse?: number;
};

export function BettingHorsesPreview({
  selectedHorse
}: BettingHorsesPreviewProps) {
    if (selectedHorse) {
    return (
      <section
        className="race-wait-fullscreen"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999999,
          width: '100vw',
          height: '100dvh',
          margin: 0,
          padding: 0,
          overflow: 'hidden',
          background: '#020611',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <img
          src="/race-waith.png"
          alt="Esperando inicio de carrera"
          className="race-wait-fullscreen-image"
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            objectFit: 'cover',
            objectPosition: 'center center'
          }}
        />

        <div className="race-wait-loading">
          <div className="race-wait-spinner"></div>
          <span>Preparando carrera...</span>
        </div>
      </section>
    );
  }

  return (
    <section className="betting-time-only-panel glass">
      <div className="betting-time-only-title">
        APUESTAS ABIERTAS
      </div>

      <div className="betting-time-only-message">
        Selecciona tu caballo y duplica tu apuesta.
      </div>
    </section>
  );
}