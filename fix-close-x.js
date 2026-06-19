const fs = require("fs");

const file = "C:\\hipiplay-app\\apps\\web\\src\\App.tsx";

if (!fs.existsSync(file)) {
  throw new Error("No existe App.tsx");
}

const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
fs.copyFileSync(file, `${file}.bak_close_x_${stamp}`);

let text = fs.readFileSync(file, "utf8");

// Corrige variantes da?adas del s?mbolo cerrar.
const badCloseSymbols = [
  "??",
  "?\u0097",
  "??",
  "??",
  "?",
];

for (const bad of badCloseSymbols) {
  text = text.split(bad).join("X");
}

// Fuerza cualquier bot?n de cierre peque?o a usar X.
// Busca botones con onClose y reemplaza solo el texto interno si est? corrupto.
text = text.replace(
  /(<button[^>]*onClick=\{onClose\}[^>]*>)([\s\S]*?)(<\/button>)/g,
  "$1X$3"
);

fs.writeFileSync(file, text, "utf8");

console.log("Bot?n de cerrar corregido a X.");
