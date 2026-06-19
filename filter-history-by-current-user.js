const fs = require("fs");

const file = "C:\\hipiplay-app\\apps\\web\\src\\App.tsx";

if (!fs.existsSync(file)) {
  throw new Error("No existe App.tsx");
}

const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
fs.copyFileSync(file, `${file}.bak_filter_history_current_user_${stamp}`);

let text = fs.readFileSync(file, "utf8");

const startMarker = "function HistoryPanel({ userId }: { userId: string }) {";
const start = text.indexOf(startMarker);

if (start < 0) {
  throw new Error("No encontr? HistoryPanel.");
}

const nextFunction = text.indexOf("\nfunction ", start + startMarker.length);

if (nextFunction < 0) {
  throw new Error("No encontr? el final de HistoryPanel.");
}

const replacement = String.raw`function HistoryPanel({ userId }: { userId: string }) {
  const [serverHistory, setServerHistory] = useState<ServerPublicRaceHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState('');

  function extractRaceNumberFromBet(bet: any): number | null {
    const candidates = [
      bet?.raceNumber,
      bet?.roundId,
      bet?.serverRoundId,
      bet?.raceCode,
      bet?.raceId
    ];

    for (const value of candidates) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }

      const textValue = String(value || '').trim();

      if (!textValue) continue;

      const match =
        textValue.match(/server-round-(\d+)/i) ||
        textValue.match(/carrera\s*#?\s*(\d+)/i) ||
        textValue.match(/round\s*#?\s*(\d+)/i) ||
        textValue.match(/(\d+)/);

      if (match) {
        const numberValue = Number(match[1]);

        if (Number.isFinite(numberValue)) {
          return numberValue;
        }
      }
    }

    return null;
  }

  useEffect(() => {
    let alive = true;

    async function loadServerHistory() {
      try {
        const [history, localBets] = await Promise.all([
          getServerRaceHistory(),
          localDerbyHistory(userId)
        ]);

        if (!alive) return;

        const userRaceNumbers = new Set<number>();

        for (const bet of localBets as any[]) {
          const raceNumber = extractRaceNumberFromBet(bet);

          if (raceNumber !== null) {
            userRaceNumbers.add(raceNumber);
          }
        }

        const filteredHistory = history.filter((race) => {
          const raceNumber = Number((race as any).raceNumber);

          return Number.isFinite(raceNumber) && userRaceNumbers.has(raceNumber);
        });

        setServerHistory(filteredHistory);
        setHistoryError('');
      } catch (error) {
        if (!alive) return;

        setHistoryError(error instanceof Error ? error.message : 'No se pudo cargar tu historial.');
      } finally {
        if (alive) {
          setLoadingHistory(false);
        }
      }
    }

    loadServerHistory();

    const timer = window.setInterval(loadServerHistory, 5000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [userId]);

  return (
    <section className="glass history-card clean-history server-history-card">
      <h2><History /> Mi historial de carreras</h2>

      {loadingHistory && (
        <p>Cargando tu historial...</p>
      )}

      {!loadingHistory && historyError && (
        <div className="server-history-error">
          {historyError}
        </div>
      )}

      {!loadingHistory && !historyError && serverHistory.length === 0 && (
        <p>No tienes carreras registradas en tu historial de apuestas.</p>
      )}

      {!loadingHistory && !historyError && serverHistory.map((race) => (
        <div className="server-history-row" key={race.raceNumber}>
          <div>
            <strong>Carrera #{race.raceNumber}</strong>
            <small>Resultado oficial donde participaste</small>
          </div>

          <div className="server-history-winners">
            {(race.winners || []).slice(0, 3).map((horse, index) => (
              <span key={String(race.raceNumber) + '-' + horse + '-' + index}>
                {index + 1}. #{horse}
              </span>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
`;

text = text.slice(0, start) + replacement + text.slice(nextFunction);

fs.writeFileSync(file, text, "utf8");

console.log("Historial filtrado por apuestas del usuario actual.");
