const fs = require("fs");

const file = "C:\\hipiplay-app\\apps\\web\\src\\App.tsx";

if (!fs.existsSync(file)) {
  throw new Error("No existe App.tsx");
}

const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
fs.copyFileSync(file, `${file}.bak_fix_home_actions_no_props_${stamp}`);

let text = fs.readFileSync(file, "utf8");

// 1) Asegurar listener en App para abrir historial desde el componente de inicio
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

// 2) Reemplazar o crear HomeMainQuickActions SIN props
const cleanComponent = `
function HomeMainQuickActions() {
  return (
    <div className="home-main-quick-actions" aria-label="Acciones principales">
      <button
        className="home-main-quick-button home-main-history-button"
        type="button"
        onClick={() => {
          window.dispatchEvent(new CustomEvent('hipiplay-request-history'));
        }}
      >
        <History size={21} />
        <span>HISTORIAL</span>
      </button>

      <button
        className="home-main-quick-button home-main-logout-button"
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
  );
}

`;

if (text.includes("function HomeMainQuickActions")) {
  const start = text.indexOf("function HomeMainQuickActions");
  const end = text.indexOf("\nfunction WalletActionsPanel", start);

  if (start < 0 || end < 0) {
    throw new Error("No pude reemplazar HomeMainQuickActions.");
  }

  text = text.slice(0, start) + cleanComponent + text.slice(end);
} else {
  const marker = "function WalletActionsPanel";

  if (!text.includes(marker)) {
    throw new Error("No encontr? WalletActionsPanel.");
  }

  text = text.replace(marker, cleanComponent + marker);
}

// 3) Dejar WalletActionsPanel con su firma original
text = text.replace(
  /function WalletActionsPanel\(\{[\s\S]*?\}:\s*\{[\s\S]*?onAction:\s*\(action:\s*WalletAction\)\s*=>\s*void;[\s\S]*?\}\)\s*\{/,
  "function WalletActionsPanel({ user, onAction }: { user: User; onAction: (action: WalletAction) => void }) {"
);

// 4) Reemplazar cualquier llamada larga a HomeMainQuickActions por una simple
text = text.replace(
  /<HomeMainQuickActions[\s\S]*?\/>/g,
  "<HomeMainQuickActions />"
);

// 5) Reemplazar llamada a WalletActionsPanel por la original
text = text.replace(
  /<WalletActionsPanel[\s\S]*?user=\{user\}[\s\S]*?onAction=\{setWalletAction\}[\s\S]*?\/>/g,
  "<WalletActionsPanel user={user} onAction={setWalletAction} />"
);

// 6) Quitar props onHomeHistory/onHomeLogout del DerbyGame en App
text = text.replace(/\s*onHomeHistory=\{\(\) => setTab\('history'\)\}/g, "");
text = text.replace(/\s*onHomeLogout=\{\(\) => \{\s*clearLocalUser\(\);\s*logout\(\);\s*location\.reload\(\);\s*\}\}/g, "");

// 7) Quitar firma extendida de DerbyGame si qued? aplicada parcialmente
text = text.replace(
  /function DerbyGame\(\{\s*user,\s*wallet,\s*refreshLocal,\s*onHomeHistory,\s*onHomeLogout\s*\}:\s*\{[\s\S]*?onHomeLogout:\s*\(\)\s*=>\s*void;\s*\}\)\s*\{/,
  "function DerbyGame({ user, wallet, refreshLocal }: { user: User; wallet: LocalWalletState | null; refreshLocal: () => Promise<void>; }) {"
);

fs.writeFileSync(file, text, "utf8");

console.log("HomeMainQuickActions corregido sin props y sin choque con DerbyGame.");
