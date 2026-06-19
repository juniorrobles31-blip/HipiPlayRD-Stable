const fs = require("fs");

const file = "C:\\hipiplay-app\\apps\\web\\src\\App.tsx";

if (!fs.existsSync(file)) {
  throw new Error("No existe App.tsx");
}

const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
fs.copyFileSync(file, `${file}.bak_home_buttons_inside_menu_${stamp}`);

let text = fs.readFileSync(file, "utf8");

// Quitar cualquier bloque anterior de home-session-actions para evitar duplicados.
text = text.replace(/\s*<div className="home-session-actions"[\s\S]*?<\/div>\s*/g, "\n");

// Asegurar listener para abrir historial.
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

// Insertar botones dentro de WalletActionsPanel, justo despu?s del grid de acciones.
const start = text.indexOf("function WalletActionsPanel");
const end = text.indexOf("\nfunction WalletActionModal", start);

if (start < 0 || end < 0) {
  throw new Error("No pude ubicar WalletActionsPanel.");
}

let before = text.slice(0, start);
let block = text.slice(start, end);
let after = text.slice(end);

const gridCloseMarker = `      </div>
    </section>`;

if (!block.includes(gridCloseMarker)) {
  throw new Error("No encontr? el cierre del grid dentro de WalletActionsPanel.");
}

const insert = `      </div>

      <div className="home-session-actions home-session-actions-inline" aria-label="Acciones de inicio">
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
    </section>`;

block = block.replace(gridCloseMarker, insert);

text = before + block + after;

fs.writeFileSync(file, text, "utf8");

console.log("Botones Historial / Salir insertados dentro del men? principal.");
