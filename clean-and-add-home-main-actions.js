const fs = require("fs");

const file = "C:\\hipiplay-app\\apps\\web\\src\\App.tsx";

if (!fs.existsSync(file)) {
  throw new Error("No existe App.tsx");
}

const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
fs.copyFileSync(file, `${file}.bak_clean_home_actions_${stamp}`);

let text = fs.readFileSync(file, "utf8");

// 1) Limpiar todos los intentos anteriores de botones de inicio.
text = text.replace(
  /\s*<div className="home-session-actions[\s\S]*?<span>SALIR<\/span>\s*<\/button>\s*<\/div>\s*/g,
  "\n"
);

// 2) Limpiar listener viejo si existe.
text = text.replace(
  /\s*useEffect\(\(\) => \{\s*function openHistoryFromHome\(\)[\s\S]*?hipiplay-request-history[\s\S]*?\}, \[\]\);\s*/g,
  "\n"
);

// 3) Crear componente nuevo, independiente, para la pantalla principal.
if (!text.includes("function HomeMainQuickActions")) {
  const marker = "function WalletActionsPanel";

  if (!text.includes(marker)) {
    throw new Error("No encontr? WalletActionsPanel.");
  }

  const component = `
function HomeMainQuickActions({
  onHistory,
  onLogout
}: {
  onHistory: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="home-main-quick-actions" aria-label="Acciones principales">
      <button
        className="home-main-quick-button home-main-history-button"
        type="button"
        onClick={onHistory}
      >
        <History size={21} />
        <span>HISTORIAL</span>
      </button>

      <button
        className="home-main-quick-button home-main-logout-button"
        type="button"
        onClick={onLogout}
      >
        <LogOut size={21} />
        <span>SALIR</span>
      </button>
    </div>
  );
}

`;

  text = text.replace(marker, component + marker);
}

// 4) Modificar WalletActionsPanel para recibir las funciones nuevas.
text = text.replace(
  "function WalletActionsPanel({ user, onAction }: { user: User; onAction: (action: WalletAction) => void })",
  "function WalletActionsPanel({ user, onAction, onHomeHistory, onHomeLogout }: { user: User; onAction: (action: WalletAction) => void; onHomeHistory: () => void; onHomeLogout: () => void })"
);

// 5) Insertar el componente nuevo dentro de WalletActionsPanel, antes del cierre de section.
const walletStart = text.indexOf("function WalletActionsPanel");
const walletEnd = text.indexOf("\nfunction WalletActionModal", walletStart);

if (walletStart < 0 || walletEnd < 0) {
  throw new Error("No pude ubicar WalletActionsPanel completo.");
}

let before = text.slice(0, walletStart);
let walletBlock = text.slice(walletStart, walletEnd);
let after = text.slice(walletEnd);

if (!walletBlock.includes("<HomeMainQuickActions")) {
  const sectionClose = walletBlock.lastIndexOf("</section>");

  if (sectionClose < 0) {
    throw new Error("No encontr? el cierre de section dentro de WalletActionsPanel.");
  }

  const insert = `
      <HomeMainQuickActions
        onHistory={onHomeHistory}
        onLogout={onHomeLogout}
      />
`;

  walletBlock = walletBlock.slice(0, sectionClose) + insert + walletBlock.slice(sectionClose);
}

text = before + walletBlock + after;

// 6) Modificar DerbyGame para recibir las funciones desde App.
text = text.replace(
  /function DerbyGame\(\{\s*user,\s*wallet,\s*refreshLocal\s*\}:\s*\{\s*user:\s*User;\s*wallet:\s*LocalWalletState\s*\|\s*null;\s*refreshLocal:\s*\(\)\s*=>\s*Promise<void>;\s*\}\)\s*\{/,
  `function DerbyGame({
  user,
  wallet,
  refreshLocal,
  onHomeHistory,
  onHomeLogout
}: {
  user: User;
  wallet: LocalWalletState | null;
  refreshLocal: () => Promise<void>;
  onHomeHistory: () => void;
  onHomeLogout: () => void;
}) {`
);

// 7) Pasar las funciones al WalletActionsPanel.
text = text.replace(
  "<WalletActionsPanel user={user} onAction={setWalletAction} />",
  `<WalletActionsPanel
      user={user}
      onAction={setWalletAction}
      onHomeHistory={onHomeHistory}
      onHomeLogout={onHomeLogout}
    />`
);

// 8) Pasar las funciones desde App hacia DerbyGame.
text = text.replace(
  "{tab === 'games' && <DerbyGame user={user} wallet={localWallet} refreshLocal={() => refreshLocal(user.id)} />}",
  `{tab === 'games' && (
        <DerbyGame
          user={user}
          wallet={localWallet}
          refreshLocal={() => refreshLocal(user.id)}
          onHomeHistory={() => setTab('history')}
          onHomeLogout={() => {
            clearLocalUser();
            logout();
            location.reload();
          }}
        />
      )}`
);

fs.writeFileSync(file, text, "utf8");

console.log("Pantalla principal limpiada y botones nuevos agregados correctamente.");
