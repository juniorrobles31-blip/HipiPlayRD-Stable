const fs = require("fs");

const appFile = "C:\\hipiplay-app\\apps\\web\\src\\App.tsx";
const walletFile = "C:\\hipiplay-app\\apps\\web\\src\\localWallet.ts";

const stamp = new Date().toISOString().replace(/[:.]/g, "-");

fs.copyFileSync(appFile, `${appFile}.backup_wallet_server_only_${stamp}`);
fs.copyFileSync(walletFile, `${walletFile}.backup_wallet_server_only_${stamp}`);

let app = fs.readFileSync(appFile, "utf8").replace(/\r\n/g, "\n");
let wallet = fs.readFileSync(walletFile, "utf8").replace(/\r\n/g, "\n");

function mustReplace(label, regex, replacement, targetName) {
  const target = targetName === "app" ? app : wallet;

  if (!regex.test(target)) {
    console.error("NO ENCONTRADO:", label);
    process.exit(1);
  }

  if (targetName === "app") {
    app = app.replace(regex, replacement);
  } else {
    wallet = wallet.replace(regex, replacement);
  }

  console.log("OK:", label);
}

// 1) Wallet local puede existir, pero no puede regalar monedas.
mustReplace(
  "localWallet demoBalance default 10000 -> 0",
  /demoBalance:\s*initial\?\.demoBalance\s*\?\?\s*10000,/,
  "demoBalance: initial?.demoBalance ?? 0,",
  "wallet"
);

mustReplace(
  "localWallet realBalance default 5000 -> 0",
  /realBalance:\s*initial\?\.realBalance\s*\?\?\s*5000,/,
  "realBalance: initial?.realBalance ?? 0,",
  "wallet"
);

// 2) Si ya existe una wallet vieja en IndexedDB, no debe conservar monedas locales viejas.
//    Se reconstruye con el balance que le pase App.tsx, que viene del servidor.
mustReplace(
  "sanitizar wallet local existente",
  /const existing = await dbGet<LocalWalletState>\('wallet_state', userId\);\s*if \(existing\) return existing;/,
`const existing = await dbGet<LocalWalletState>('wallet_state', userId);
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
  }`,
  "wallet"
);

// 3) refreshLocal ahora pregunta al servidor; si el servidor no responde, queda en 0.
mustReplace(
  "refreshLocal consulta balance del servidor",
  /async function refreshLocal\(userId = user\?\.id\) \{\s*if \(!userId\) return;\s*const wallet = await getLocalWallet\(userId\);\s*setLocalWallet\(wallet\);\s*\}/,
`async function refreshLocal(userId = user?.id) {
    if (!userId) return;

    let safeBalance = 0;
    let syncedFromServer = false;

    try {
      const serverWallet = await getServerPlayerBalance(userId);
      const rawBalance =
        (serverWallet as any)?.balance ??
        (serverWallet as any)?.serverBalance ??
        (serverWallet as any)?.walletBalance ??
        (serverWallet as any)?.finalBalance ??
        (serverWallet as any)?.demoBalance ??
        0;

      const numericBalance = Number(rawBalance);
      safeBalance = Number.isFinite(numericBalance) ? Math.max(0, Math.floor(numericBalance)) : 0;
      syncedFromServer = true;
    } catch {
      safeBalance = 0;
    }

    const local = await initLocalWallet(userId, {
      demoBalance: safeBalance,
      realBalance: 0,
      giftLocked: 0,
    });

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
  }`,
  "app"
);

// 4) bootstrap ya no toma w.demoBalance como autoridad.
mustReplace(
  "bootstrap no usa w.demoBalance como balance inicial",
  /let serverBalance = Number\(w\.demoBalance \|\| 0\);/,
  "let serverBalance = 0;",
  "app"
);

// 5) bootstrap lee balance del servidor con campos compatibles.
app = app.replace(
  /serverBalance = Number\(serverWallet\.balance\);/,
`serverBalance = Number(
      (serverWallet as any)?.balance ??
      (serverWallet as any)?.serverBalance ??
      (serverWallet as any)?.walletBalance ??
      (serverWallet as any)?.finalBalance ??
      (serverWallet as any)?.demoBalance ??
      0
    );`
);

// 6) No usar realBalance recibido del login como balance de monedas.
app = app.replace(/realBalance:\s*w\.realBalance,/g, "realBalance: 0,");

fs.writeFileSync(walletFile, wallet, "utf8");
fs.writeFileSync(appFile, app, "utf8");

console.log("");
console.log("LISTO: la PWA ya no crea monedas estáticas.");
console.log("LISTO: la wallet local queda como referencia/cache.");
console.log("LISTO: el balance sale del servidor; si el servidor dice 0, la PWA muestra 0.");
