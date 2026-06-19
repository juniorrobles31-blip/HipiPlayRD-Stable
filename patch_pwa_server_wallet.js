const fs = require("fs");

const appFile = "C:\\hipiplay-app\\apps\\web\\src\\App.tsx";
const walletFile = "C:\\hipiplay-app\\apps\\web\\src\\localWallet.ts";

function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(file, `${file}.backup_server_wallet_${stamp}`);
}

backup(appFile);
backup(walletFile);

let wallet = fs.readFileSync(walletFile, "utf8").replace(/\r\n/g, "\n");
let app = fs.readFileSync(appFile, "utf8").replace(/\r\n/g, "\n");

// ======================================================
// 1) localWallet.ts: eliminar balances locales por defecto
// ======================================================

wallet = wallet.replace(
  "demoBalance: initial?.demoBalance ?? 10000,",
  "demoBalance: initial?.demoBalance ?? 0,"
);

wallet = wallet.replace(
  "realBalance: initial?.realBalance ?? 5000,",
  "realBalance: initial?.realBalance ?? 0,"
);

// Si ya existe una wallet vieja en IndexedDB, no permitir que conserve monedas locales viejas.
wallet = wallet.replace(
`  const existing = await dbGet<LocalWalletState>('wallet_state', userId);
  if (existing) return existing;
  const createdAt = new Date().toISOString();`,
`  const existing = await dbGet<LocalWalletState>('wallet_state', userId);
  if (existing) {
    const updatedAt = new Date().toISOString();
    const sanitized: LocalWalletState = {
      ...existing,
      demoBalance: Number(initial?.demoBalance ?? 0),
      realBalance: Number(initial?.realBalance ?? 0),
      giftBalance: Number(initial?.giftLocked ?? 0),
      updatedAt
    };
    await dbPut('wallet_state', sanitized);
    return sanitized;
  }
  const createdAt = new Date().toISOString();`
);

// ======================================================
// 2) App.tsx: helper para leer balance real de respuestas del servidor
// ======================================================

const balanceHelper = `
function readServerBalanceValue(payload: unknown, fallback = 0) {
  const data = payload as {
    balance?: unknown;
    serverBalance?: unknown;
    walletBalance?: unknown;
    finalBalance?: unknown;
    balanceAfterBet?: unknown;
    demoBalance?: unknown;
  };

  const raw =
    data?.balance ??
    data?.serverBalance ??
    data?.walletBalance ??
    data?.finalBalance ??
    data?.balanceAfterBet ??
    data?.demoBalance ??
    fallback;

  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : Math.max(0, Math.floor(Number(fallback || 0)));
}

`;

if (!app.includes("function readServerBalanceValue(")) {
  app = app.replace(/\ntype User =/, "\n" + balanceHelper + "type User =");
}

// ======================================================
// 3) App.tsx: refreshLocal ahora consulta servidor primero
// ======================================================

const newRefreshLocal = `  async function refreshLocal(userId = user?.id) {
    if (!userId) return;

    let serverBalance = 0;
    let syncedFromServer = false;

    try {
      const serverWallet = await getServerPlayerBalance(userId);
      serverBalance = readServerBalanceValue(serverWallet, 0);
      syncedFromServer = true;
    } catch {
      serverBalance = 0;
    }

    const local = await initLocalWallet(userId, {
      demoBalance: 0,
      realBalance: 0,
      giftLocked: 0,
    });

    const safeBalance = Math.max(0, Math.floor(Number(serverBalance || 0)));

    const syncedWallet = {
      ...local,
      userId,
      demoBalance: safeBalance,
      realBalance: 0,
      serverManaged: syncedFromServer,
      balanceSource: syncedFromServer ? 'server' : 'unavailable',
    } as LocalWalletState & { serverManaged: boolean; balanceSource: string };

    try {
      localStorage.setItem('hipiplay_wallet_' + userId, JSON.stringify(syncedWallet));
    } catch {
      // No bloquear la app si localStorage falla.
    }

    setLocalWallet(syncedWallet);

    window.dispatchEvent(
      new CustomEvent('hipiplay-wallet-balance-updated', {
        detail: { balance: safeBalance },
      })
    );
  }`;

const refreshRegex = /  async function refreshLocal\(userId = user\?\.id\) \{[\s\S]*?\n  \}\n\n  async function bootstrap/;

if (!refreshRegex.test(app)) {
  console.error("No pude encontrar refreshLocal() en App.tsx. No se aplicaron cambios.");
  process.exit(1);
}

app = app.replace(refreshRegex, newRefreshLocal + "\n\n  async function bootstrap");

// ======================================================
// 4) App.tsx: bootstrap no toma w.demoBalance como autoridad
// ======================================================

const newBootstrap = `  async function bootstrap(u: User, w: Wallet) {
    setUser(u);

    let serverBalance = 0;
    let syncedFromServer = false;

    try {
      const serverWallet = await getServerPlayerBalance(u.id);
      serverBalance = readServerBalanceValue(serverWallet, 0);
      syncedFromServer = true;
    } catch {
      serverBalance = 0;
    }

    const safeBalance = Math.max(0, Math.floor(Number(serverBalance || 0)));

    const local = await initLocalWallet(u.id, {
      demoBalance: 0,
      realBalance: 0,
      giftLocked: Number(w.giftLocked || 0),
    });

    const syncedWallet = {
      ...local,
      demoBalance: safeBalance,
      realBalance: 0,
      serverManaged: syncedFromServer,
      balanceSource: syncedFromServer ? 'server' : 'unavailable',
    } as LocalWalletState & { serverManaged: boolean; balanceSource: string };

    try {
      localStorage.setItem('hipiplay_wallet_' + u.id, JSON.stringify(syncedWallet));
    } catch {
      // No bloquear la app si localStorage falla.
    }

    setLocalWallet(syncedWallet);

    window.dispatchEvent(
      new CustomEvent('hipiplay-wallet-balance-updated', {
        detail: { balance: safeBalance },
      })
    );
  }`;

const bootstrapRegex = /  async function bootstrap\(u: User, w: Wallet\) \{[\s\S]*?\n  \}\n\n  useEffect\(\(\) =>/;

if (!bootstrapRegex.test(app)) {
  console.error("No pude encontrar bootstrap() en App.tsx. No se aplicaron cambios.");
  process.exit(1);
}

app = app.replace(bootstrapRegex, newBootstrap + "\n\n  useEffect(() =>");

// ======================================================
// 5) DerbyGame: antes de apostar sincronizar balance del servidor
// ======================================================

const newBalanceFunctions = `  function getCurrentWalletBalance() {
    return Math.max(0, Math.floor(Number(wallet?.demoBalance || 0)));
  }

  async function refreshServerBalanceForBet() {
    try {
      const serverWallet = await getServerPlayerBalance(user.id);
      const nextBalance = readServerBalanceValue(serverWallet, 0);
      applyServerWalletBalance(nextBalance);
      return nextBalance;
    } catch {
      return getCurrentWalletBalance();
    }
  }`;

const balanceFuncRegex = /  function getCurrentWalletBalance\(\) \{[\s\S]*?\n  \}\n\n  async function bet/;

if (!balanceFuncRegex.test(app)) {
  console.error("No pude encontrar getCurrentWalletBalance() en App.tsx. No se aplicaron cambios.");
  process.exit(1);
}

app = app.replace(balanceFuncRegex, newBalanceFunctions + "\n\n  async function bet");

// Cambiar el balance enviado al servidor para que sea consultado fresco.
app = app.replace(
  "  const balanceTotal = getCurrentWalletBalance();",
  "  const balanceTotal = await refreshServerBalanceForBet();"
);

// ======================================================
// 6) Guardar archivos
// ======================================================

fs.writeFileSync(walletFile, wallet, "utf8");
fs.writeFileSync(appFile, app, "utf8");

console.log("OK: PWA ajustada para que las monedas dependan del balance del servidor.");
console.log("OK: Wallet local queda como referencia/cache, no como fuente de monedas.");
