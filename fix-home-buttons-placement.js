const fs = require("fs");

const file = "C:\\hipiplay-app\\apps\\web\\src\\App.tsx";

if (!fs.existsSync(file)) {
  throw new Error("No existe App.tsx");
}

const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
fs.copyFileSync(file, `${file}.bak_fix_home_buttons_placement_${stamp}`);

let text = fs.readFileSync(file, "utf8");

// Quitar bloques home-session-actions que quedaron fuera del men? principal.
text = text.replace(/\s*<div className="home-session-actions"[\s\S]*?<\/div>\s*/g, "\n");

// Asegurar listener para abrir historial desde el men? principal.
if (!text.includes("hipiplay-request-history")) {
  const marker = "const [tab, setTab] = useState<Tab>('games');";

  if (!text.includes(marker)) {
    throw new Error("No encontr? const [tab, setTab].");
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

const walletStart = text.indexOf("function WalletActionsPanel");
const walletEnd = text.indexOf("\nfunction WalletActionModal", walletStart);

if (walletStart < 0 || walletEnd < 0) {
  throw new Error("No pude ubicar WalletActionsPanel completo.");
}

let beforeWallet = text.slice(0, walletStart);
let walletBlock = text.slice(walletStart, walletEnd);
let afterWallet = text.slice(walletEnd);

if (!walletBlock.includes("home-session-actions")) {
  const closeSection = walletBlock.lastIndexOf("</section>");

  if (closeSection < 0) {
    throw new Error("No encontr? cierre </section> dentro de WalletActionsPanel.");
  }

  const buttons = `
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
      </div>
`;

  walletBlock =
    walletBlock.slice(0, closeSection) +
    buttons +
    walletBlock.slice(closeSection);
}

text = beforeWallet + walletBlock + afterWallet;

fs.writeFileSync(file, text, "utf8");

console.log("Botones Historial / Salir movidos al men? principal.");
