import './raceVideoEngine.css';

type ServerWinner = {
  position: number;
  horseId: number;
  name?: string;
  color?: string;
  totalAmount?: number;
  totalBets?: number;
};

type ServerRaceResultPanelProps = {
  winners: ServerWinner[];
  selectedHorse?: number;
  betAmount?: number;
  secondsLeft: number;
};

function coins(value: number) {
  return new Intl.NumberFormat('es-DO', {
    maximumFractionDigits: 0
  }).format(Math.max(0, Math.floor(Number(value || 0))));
}

function getPrizeMultiplier(rank: number) {
  if (rank === 1) return 3;
  if (rank === 2) return 2;
  if (rank === 3) return 1.5;
  return 0;
}

export function ServerRaceResultPanel({
  winners,
  selectedHorse,
  betAmount = 0,
  secondsLeft
}: ServerRaceResultPanelProps) {
  const top3 = [...(winners || [])]
    .sort((a, b) => a.position - b.position)
    .map((winner) => winner.horseId)
    .slice(0, 3);

  const selectedRank = selectedHorse ? top3.indexOf(selectedHorse) + 1 : 0;
  const won = selectedRank > 0;
  const prizeCoins = won ? Math.floor(betAmount * getPrizeMultiplier(selectedRank)) : 0;

  return (
    <section className="server-results-fullscreen">`r`n      <img src="/race-images/result-background.jpg" alt="" className="server-results-bg-img" />
      <div className="result-panel-compact server-results-panel">
        <span className="result-kicker">RESULTADO OFICIAL</span>
        <h2>Top 3</h2>

        {top3.length >= 3 ? (
          <div className="result-top3-grid">
            <div>
              <small>1.º</small>
              <strong>#{top3[0]}</strong>
            </div>

            <div>
              <small>2.º</small>
              <strong>#{top3[1]}</strong>
            </div>

            <div>
              <small>3.º</small>
              <strong>#{top3[2]}</strong>
            </div>
          </div>
        ) : (
          <div className="server-result-waiting">
            Esperando resultado oficial del servidor...
          </div>
        )}

        <div className={`result-coins-box ${won ? 'win' : 'loss'}`}>
          <small>Monedas ganadas</small>
          <strong>{coins(prizeCoins)}</strong>
          <span>
            {!selectedHorse
              ? 'Sin boleto activo para esta carrera.'
              : won
                ? `Tu caballo #${selectedHorse} quedó en el Top 3.`
                : `Tu caballo #${selectedHorse} no quedó en el Top 3.`}
          </span>
        </div>

        <div className="server-results-countdown">
          Nueva ronda en {secondsLeft}s
        </div>
      </div>
    </section>
  );
}

