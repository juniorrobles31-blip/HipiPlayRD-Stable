type BettingHorsesPreviewProps = {
  secondsLeft: number;
  selectedHorse?: number;
};

export function BettingHorsesPreview({
  secondsLeft
}: BettingHorsesPreviewProps) {
  return (
    <section className="betting-time-only-panel glass">
      <div className="betting-time-only-label">
        APUESTAS ABIERTAS
      </div>

      <div className="betting-time-only-box">
        <span>Tiempo restante</span>
        <strong>{secondsLeft}s</strong>
      </div>
    </section>
  );
}
