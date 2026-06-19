const fs = require("fs");

const file = "C:\\hipiplay-app\\apps\\web\\src\\App.tsx";

if (!fs.existsSync(file)) {
  throw new Error("No existe App.tsx");
}

const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
fs.copyFileSync(file, `${file}.bak_home_history_logout_${stamp}`);

let text = fs.readFileSync(file, "utf8");

// 1) Agregar listener para abrir historial desde botones internos de inicio
if (!text.includes("hipiplay-request-history")) {
  const marker = "const [tab, setTab] = useState<Tab>('games');";

  if (!text.includes(marker)) {
    throw new Error("No encontr? el estado tab/setTab.");
  }

  text = text.replace(
    marker,
    `${marker}
  useEffect(() => {
    function openHistoryFromHome() {
      setTab('history');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    window.addEventListener('hipiplay-request-history', openHistoryFromHome);

    return () => {
      window.removeEventListener('hipiplay-request-history', openHistoryFromHome);
    };
  }, []);`
  );
}

// 2) Insertar botones debajo del panel principal de inicio
if (!text.includes("home-session-actions")) {
  const marker = "    <WalletActionsPanel user={user} onAction={setWalletAction} />";

  if (!text.includes(marker)) {
    throw new Error("No encontr? WalletActionsPanel para insertar botones de inicio.");
  }

  const buttons = `${marker}
    <div className="home-session-actions" aria-label="Acciones de inicio">
      <button
        className="home-session-action home-history-action"
        type="button"
        onClick={() => {
          window.dispatchEvent(new CustomEvent('hipiplay-request-history'));
        }}
      >
        <History size={21} />
        <span>HISTORIAL</span>
      </button>

      <button
        className="home-session-action home-logout-action"
        type="button"
        onClick={() => {
          clearLocalUser();
          logout();
          location.reload();
        }}
      >
        <LogOut size={21} />
        <span>SALIR</span>
      </button>
    </div>`;

  text = text.replace(marker, buttons);
}

fs.writeFileSync(file, text, "utf8");

console.log("Botones de Historial y Salir agregados debajo del inicio.");
