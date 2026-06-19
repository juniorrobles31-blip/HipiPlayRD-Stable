const fs = require("fs");

const file = "C:\\hipiplay-app\\apps\\web\\src\\App.tsx";

if (!fs.existsSync(file)) {
  throw new Error("No existe App.tsx");
}

const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
fs.copyFileSync(file, `${file}.bak_fix_derbygame_home_props_${stamp}`);

let text = fs.readFileSync(file, "utf8");

if (!text.includes("onHomeHistory: () => void;")) {
  const oldPattern = /function DerbyGame\(\s*\{\s*user,\s*wallet,\s*refreshLocal\s*\}\s*:\s*\{\s*user:\s*User;\s*wallet:\s*LocalWalletState\s*\|\s*null;\s*refreshLocal:\s*\(\)\s*=>\s*Promise<void>;\s*\}\s*\)\s*\{/s;

  const replacement = `function DerbyGame({
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
}) {`;

  const next = text.replace(oldPattern, replacement);

  if (next === text) {
    throw new Error("No pude reemplazar la firma de DerbyGame. Hay que verla manualmente.");
  }

  text = next;
}

fs.writeFileSync(file, text, "utf8");

console.log("DerbyGame actualizado para recibir onHomeHistory y onHomeLogout.");
