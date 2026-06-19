const fs = require("fs");

const file = "C:\\hipiplay-app\\apps\\web\\src\\App.tsx";

if (!fs.existsSync(file)) {
  throw new Error("No existe App.tsx");
}

const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
fs.copyFileSync(file, `${file}.bak_home_actions_as_menu_buttons_${stamp}`);

let text = fs.readFileSync(file, "utf8");

// 1) Quitar componentes o bloques anteriores que no funcionaron.
text = text.replace(
  /\nfunction HomeMainQuickActions[\s\S]*?\nfunction WalletActionsPanel/,
  "\nfunction WalletActionsPanel"
);

text = text.replace(
  /\s*<HomeMainQuickActions[\s\S]*?\/>\s*/g,
  "\n"
);

text = text.replace(
  /\s*<div className="home-session-actions[\s\S]*?<span>SALIR<\/span>\s*<\/button>\s*<\/div>\s*/g,
  "\n"
);

text = text.replace(
  /\s*<div className="home-main-quick-actions[\s\S]*?<span>SALIR<\/span>\s*<\/button>\s*<\/div>\s*/g,
  "\n"
);

// 2) Limpiar props viejas de DerbyGame y WalletActionsPanel.
text = text.replace(/\s*onHomeHistory=\{\(\) => setTab\('history'\)\}/g, "");
text = text.replace(/\s*onHomeLogout=\{\(\) => \{\s*clearLocalUser\(\);\s*logout\(\);\s*location\.reload\(\);\s*\}\}/g, "");

text = text.replace(
  /function DerbyGame\(\{\s*user,\s*wallet,\s*refreshLocal,\s*onHomeHistory,\s*onHomeLogout\s*\}:\s*\{[\s\S]*?onHomeLogout:\s*\(\)\s*=>\s*void;\s*\}\)\s*\{/,
  "function DerbyGame({ user, wallet, refreshLocal }: { user: User; wallet: LocalWalletState | null; refreshLocal: () => Promise<void>; }) {"
);

text = text.replace(
  /<WalletActionsPanel[\s\S]*?user=\{user\}[\s\S]*?onAction=\{setWalletAction\}[\s\S]*?\/>/g,
  "<WalletActionsPanel user={user} onAction={setWalletAction} />"
);

text = text.replace(
  /function WalletActionsPanel\(\{[\s\S]*?\}:\s*\{[\s\S]*?onAction:\s*\(action:\s*WalletAction\)\s*=>\s*void;[\s\S]*?\}\)\s*\{/,
  "function WalletActionsPanel({ user, onAction }: { user: User; onAction: (action: WalletAction) => void }) {"
);

// 3) Asegurar listener para abrir historial desde el men?.
if (!text.includes("window.addEventListener('hipiplay-request-history'")) {
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

// 4) Cambiar openAction para aceptar los dos botones nuevos.
text = text.replace(
  "function openAction(action: WalletAction) {",
  "function openAction(action: WalletAction | 'history-home' | 'logout-home') {"
);

if (!text.includes("action === 'history-home'")) {
  text = text.replace(
    "function openAction(action: WalletAction | 'history-home' | 'logout-home') {",
    `function openAction(action: WalletAction | 'history-home' | 'logout-home') {
    if (action === 'history-home') {
      window.dispatchEvent(new CustomEvent('hipiplay-request-history'));
      return;
    }

    if (action === 'logout-home') {
      clearLocalUser();
      logout();
      location.reload();
      return;
    }
`
  );
}

// 5) Ajustar tipo del array de acciones.
text = text.replace(
  "const actions: Array<{ action: WalletAction; label: string; caption: string; icon: JSX.Element }> = [",
  "const actions: Array<{ action: WalletAction | 'history-home' | 'logout-home'; label: string; caption: string; icon: JSX.Element }> = ["
);

// 6) Agregar Historial / Salir como botones 7 y 8 dentro del mismo men?.
if (!text.includes("action: 'history-home'")) {
  const lastAction = "{ action: 'buy-p2p', label: 'COMPRA P2P', caption: 'VER OFERTAS', icon: <ShoppingCart size={54} /> }";

  if (!text.includes(lastAction)) {
    throw new Error("No encontr? la acci?n buy-p2p para insertar Historial / Salir.");
  }

  const newLastActions = `${lastAction},
    { action: 'history-home', label: 'HISTORIAL', caption: 'CARRERAS', icon: <History size={54} /> },
    { action: 'logout-home', label: 'SALIR', caption: 'CERRAR SESI?N', icon: <LogOut size={54} /> }`;

  text = text.replace(lastAction, newLastActions);
}

// 7) Asegurar que onAction solo reciba acciones Wallet reales.
text = text.replace(
  "onClick={() => openAction(item.action)}",
  "onClick={() => openAction(item.action)}"
);

fs.writeFileSync(file, text, "utf8");

console.log("Historial y Salir agregados como botones 7 y 8 del men? principal.");
