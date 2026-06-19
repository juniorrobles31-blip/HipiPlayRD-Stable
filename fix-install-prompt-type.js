const fs = require("fs");

const file = "C:\\hipiplay-app\\apps\\web\\src\\App.tsx";

if (!fs.existsSync(file)) {
  throw new Error("No existe App.tsx");
}

const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
fs.copyFileSync(file, `${file}.bak_install_prompt_type_${stamp}`);

let text = fs.readFileSync(file, "utf8");

if (!text.includes("type InstallPromptEvent = Event &")) {
  const marker = "type WalletAction = 'transfer' | 'bet' | 'withdraw' | 'deposit' | 'sell-p2p' | 'buy-p2p';";

  if (!text.includes(marker)) {
    throw new Error("No encontr? la l?nea type WalletAction.");
  }

  const insert = `${marker}
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
};`;

  text = text.replace(marker, insert);
}

fs.writeFileSync(file, text, "utf8");

console.log("Tipo InstallPromptEvent agregado.");
